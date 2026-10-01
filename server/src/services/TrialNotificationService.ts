import { db } from '../db';
import { AuditService } from './AuditService';
import { ResendEmailService } from './ResendEmailService';
import { AuditAction, SubscriptionStatus } from '@onceclic/shared';
import { v4 as uuidv4 } from 'uuid';

export interface TrialCheckSummary {
  remindersSent: number;
  expirationsProcessed: number;
  errors: string[];
}

export class TrialNotificationService {
  private static checkTimer: NodeJS.Timeout | null = null;
  private static isProcessing = false;

  /**
   * Start server-side background worker for scheduled trial reminder & expiration checks.
   */
  static startScheduledChecks(intervalMs: number = 3600000) {
    if (this.checkTimer) {
      clearInterval(this.checkTimer);
    }
    console.log(`[TrialNotificationService] Started background trial monitor worker (interval: ${intervalMs}ms)`);
    
    // Initial run
    this.checkAndProcessTrialReminders().catch((err) =>
      console.warn('[TrialNotificationService] Initial trial check cycle notice:', err.message || err)
    );

    this.checkTimer = setInterval(() => {
      this.checkAndProcessTrialReminders().catch((err) =>
        console.warn('[TrialNotificationService] Scheduled trial check cycle notice:', err.message || err)
      );
    }, intervalMs);
  }

  /**
   * Stop background trial check worker.
   */
  static stopScheduledChecks() {
    if (this.checkTimer) {
      clearInterval(this.checkTimer);
      this.checkTimer = null;
      console.log('[TrialNotificationService] Stopped background trial monitor worker.');
    }
  }

  /**
   * Authoritative server-side evaluation of all active and expired trials.
   * Fully deterministic and accepts an optional referenceTime for precise time-travel testing.
   */
  static async checkAndProcessTrialReminders(referenceTime: Date = new Date()): Promise<TrialCheckSummary> {
    if (this.isProcessing) {
      return { remindersSent: 0, expirationsProcessed: 0, errors: ['Another trial check cycle is currently active.'] };
    }

    this.isProcessing = true;
    const summary: TrialCheckSummary = {
      remindersSent: 0,
      expirationsProcessed: 0,
      errors: [],
    };

    try {
      const nowMs = referenceTime.getTime();

      // Fetch all trialing or expired subscriptions
      const subscriptions = await db.query<{
        id: string;
        organization_id: string;
        status: string;
        trial_started_at: string;
        trial_ends_at: string;
        paddle_subscription_id?: string;
      }>(
        `SELECT id, organization_id, status, trial_started_at, trial_ends_at, paddle_subscription_id
         FROM subscriptions
         WHERE status IN ('TRIALING', 'EXPIRED')`
      );

      for (const sub of subscriptions.rows) {
        try {
          if (!sub.trial_ends_at) continue;

          // If upgraded to paid Paddle subscription, no trial expiration or reminder needed
          if (sub.paddle_subscription_id && sub.status !== SubscriptionStatus.EXPIRED) {
            continue;
          }

          const trialEndMs = new Date(sub.trial_ends_at).getTime();
          const timeRemainingMs = trialEndMs - nowMs;
          const twoDaysMs = 2 * 24 * 60 * 60 * 1000; // Exactly 48 hours

          // 1. Expiration Evaluation: Trial reached or exceeded 7 days
          if (nowMs >= trialEndMs) {
            if (sub.status === SubscriptionStatus.TRIALING) {
              await db.execute(
                `UPDATE subscriptions
                 SET status = $1, updated_at = CURRENT_TIMESTAMP
                 WHERE id = $2 AND status = 'TRIALING'`,
                [SubscriptionStatus.EXPIRED, sub.id]
              );
              sub.status = SubscriptionStatus.EXPIRED;

              await AuditService.log({
                organizationId: sub.organization_id,
                action: AuditAction.SUBSCRIPTION_EXPIRED,
                entityType: 'SUBSCRIPTION',
                entityId: sub.id,
                metadata: { trialEndsAt: sub.trial_ends_at, expiredAt: referenceTime.toISOString() },
              });
            }

            const expiredKey = `TRIAL_EXPIRED:${sub.organization_id}`;
            const sent = await this.sendNotificationIfIdempotent({
              organizationId: sub.organization_id,
              subscriptionId: sub.id,
              notificationType: 'TRIAL_EXPIRED',
              idempotencyKey: expiredKey,
              sendEmailFn: async (recipient) => {
                return await ResendEmailService.sendTrialExpiredEmail({
                  toEmail: recipient.email,
                  customerName: recipient.fullName,
                  organizationId: sub.organization_id,
                  userId: recipient.userId,
                });
              },
            });

            if (sent) {
              summary.expirationsProcessed++;
            }
          }
          // 2. 2-Days-Remaining Reminder Evaluation: Within the final 48 hours and trial is active
          else if (timeRemainingMs > 0 && timeRemainingMs <= twoDaysMs && sub.status === SubscriptionStatus.TRIALING) {
            const reminderKey = `TRIAL_REMINDER_2_DAYS:${sub.organization_id}`;
            const sent = await this.sendNotificationIfIdempotent({
              organizationId: sub.organization_id,
              subscriptionId: sub.id,
              notificationType: 'TRIAL_REMINDER_2_DAYS',
              idempotencyKey: reminderKey,
              sendEmailFn: async (recipient) => {
                return await ResendEmailService.sendTrialTwoDaysRemainingReminder({
                  toEmail: recipient.email,
                  customerName: recipient.fullName,
                  organizationId: sub.organization_id,
                  userId: recipient.userId,
                });
              },
            });

            if (sent) {
              summary.remindersSent++;
            }
          }
        } catch (subErr: any) {
          console.error(`[TrialNotificationService] Error evaluating subscription ${sub.id}:`, subErr);
          summary.errors.push(`Subscription ${sub.id}: ${subErr.message || subErr}`);
        }
      }
    } finally {
      this.isProcessing = false;
    }

    return summary;
  }

  /**
   * Safely resolve recipient and atomically dispatch email with durable database idempotency.
   */
  private static async sendNotificationIfIdempotent(params: {
    organizationId: string;
    subscriptionId: string;
    notificationType: 'TRIAL_REMINDER_2_DAYS' | 'TRIAL_EXPIRED';
    idempotencyKey: string;
    sendEmailFn: (recipient: { email: string; fullName?: string; userId?: string }) => Promise<any>;
  }): Promise<boolean> {
    // 1. Check existing record
    const existing = await db.getOne<{ id: string }>(
      `SELECT id FROM trial_notifications WHERE idempotency_key = $1`,
      [params.idempotencyKey]
    );
    if (existing) {
      return false; // Already sent (idempotent)
    }

    // 2. Resolve organization owner recipient
    const recipient = await this.resolveOwnerRecipient(params.organizationId);
    if (!recipient || !recipient.email) {
      console.warn(`[TrialNotificationService] No verified recipient found for organization ${params.organizationId}. Skipping.`);
      return false;
    }

    const notificationId = uuidv4();

    // 3. Atomically claim idempotency record in DB (Protected against race conditions by UNIQUE constraint)
    try {
      await db.execute(
        `INSERT INTO trial_notifications (
           id, organization_id, subscription_id, notification_type, idempotency_key, recipient_email, dispatched_at, created_at
         ) VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
        [
          notificationId,
          params.organizationId,
          params.subscriptionId,
          params.notificationType,
          params.idempotencyKey,
          recipient.email,
        ]
      );
    } catch (dbErr: any) {
      if (dbErr.message && (dbErr.message.includes('unique') || dbErr.message.includes('duplicate key'))) {
        // Concurrent worker already claimed this notification
        return false;
      }
      throw dbErr;
    }

    // 4. Dispatch Email
    try {
      await params.sendEmailFn(recipient);
      return true;
    } catch (emailErr: any) {
      console.error(`[TrialNotificationService] Failed to dispatch ${params.notificationType} to ${recipient.email}:`, emailErr);
      // We do NOT roll back or corrupt the subscription state if email fails
      return false;
    }
  }

  /**
   * Resolve authoritative owner email & name for an organization.
   */
  private static async resolveOwnerRecipient(organizationId: string): Promise<{
    email: string;
    fullName?: string;
    userId?: string;
  } | null> {
    // 1. Check owner membership
    const owner = await db.getOne<{
      email: string;
      full_name?: string;
      fullName?: string;
      user_id?: string;
      userId?: string;
    }>(
      `SELECT u.email, u.full_name as "fullName", om.user_id as "userId"
       FROM organization_memberships om
       JOIN users u ON om.user_id = u.id
       WHERE om.organization_id = $1 AND om.role = 'OWNER'
       ORDER BY om.created_at ASC
       LIMIT 1`,
      [organizationId]
    );

    if (owner?.email) {
      return {
        email: owner.email,
        fullName: owner.fullName || owner.full_name,
        userId: owner.userId || owner.user_id,
      };
    }

    // 2. Fallback to any member
    const anyMember = await db.getOne<{
      email: string;
      full_name?: string;
      fullName?: string;
      user_id?: string;
      userId?: string;
    }>(
      `SELECT u.email, u.full_name as "fullName", om.user_id as "userId"
       FROM organization_memberships om
       JOIN users u ON om.user_id = u.id
       WHERE om.organization_id = $1
       ORDER BY om.created_at ASC
       LIMIT 1`,
      [organizationId]
    );

    if (anyMember?.email) {
      return {
        email: anyMember.email,
        fullName: anyMember.fullName || anyMember.full_name,
        userId: anyMember.userId || anyMember.user_id,
      };
    }

    // 3. Fallback to trial redemption record if available
    const redemption = await db.getOne<{
      normalized_email: string;
      user_id?: string;
    }>(
      `SELECT normalized_email, user_id FROM trial_redemptions WHERE organization_id = $1 LIMIT 1`,
      [organizationId]
    );

    if (redemption?.normalized_email) {
      return {
        email: redemption.normalized_email,
        userId: redemption.user_id,
      };
    }

    return null;
  }
}
