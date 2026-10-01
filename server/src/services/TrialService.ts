import { db } from '../db';
import { config } from '../config';
import { normalizeEmail } from '../utils/emailNormalizer';
import { TrialRedemption, TrialEligibilityResponse, AuditAction, SubscriptionStatus } from '@onceclic/shared';
import { AuditService } from './AuditService';
import { v4 as uuidv4 } from 'uuid';

export class TrialService {
  /**
   * Check if a given email is eligible for the 7-day free trial.
   * Enforces the rule: ONE EMAIL = ONE FREE TRIAL EVER.
   */
  static async checkEligibility(email: string): Promise<TrialEligibilityResponse> {
    const normalized = normalizeEmail(email);
    if (!normalized) {
      return {
        eligible: false,
        normalizedEmail: '',
        hasUsedTrial: false,
        message: 'A valid email address is required.',
        pricePerMonthUsd: config.billing.monthlyPriceUsd,
      };
    }

    const redemption = await db.getOne<TrialRedemption>(
      `SELECT id, normalized_email as "normalizedEmail", user_id as "userId",
              trial_started_at as "trialStartedAt", trial_ends_at as "trialEndsAt"
       FROM trial_redemptions WHERE normalized_email = $1`,
      [normalized]
    );

    if (redemption) {
      return {
        eligible: false,
        normalizedEmail: normalized,
        hasUsedTrial: true,
        message: 'Your free trial has already been used for this email address. You can subscribe to ONCEClic Pro for $19/month.',
        pricePerMonthUsd: config.billing.monthlyPriceUsd,
      };
    }

    return {
      eligible: true,
      normalizedEmail: normalized,
      hasUsedTrial: false,
      message: 'Eligible for 7-day free trial (no credit card required).',
      pricePerMonthUsd: config.billing.monthlyPriceUsd,
    };
  }

  /**
   * Atomically redeem a 7-day free trial for a user and organization.
   * Guaranteed against race conditions via DB unique constraint on normalized_email.
   */
  static async redeemTrial(params: {
    userId: string;
    organizationId: string;
    email: string;
  }): Promise<{ success: boolean; trialEndsAt: Date; message: string }> {
    const normalized = normalizeEmail(params.email);
    if (!normalized) {
      throw new Error('Valid email is required for trial activation.');
    }

    // Pre-check
    const existing = await db.getOne(
      `SELECT id FROM trial_redemptions WHERE normalized_email = $1`,
      [normalized]
    );

    if (existing) {
      await AuditService.log({
        organizationId: params.organizationId,
        userId: params.userId,
        action: AuditAction.TRIAL_REDEMPTION_REJECTED,
        entityType: 'TRIAL_REDEMPTION',
        entityId: normalized,
        metadata: { reason: 'Trial already redeemed for this email', email: normalized },
      });

      throw new Error(
        'Your free trial has already been used for this email address. You can subscribe to ONCEClic Pro for $19/month.'
      );
    }

    const trialStartedAt = new Date();
    const trialEndsAt = new Date(trialStartedAt.getTime() + config.billing.trialPeriodDays * 24 * 60 * 60 * 1000);
    const redemptionId = uuidv4();

    try {
      // Insert into trial_redemptions (Protected by UNIQUE constraint on normalized_email)
      await db.execute(
        `INSERT INTO trial_redemptions (
           id, normalized_email, user_id, organization_id, trial_started_at, trial_ends_at, created_at
         ) VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP)`,
        [
          redemptionId,
          normalized,
          params.userId,
          params.organizationId,
          trialStartedAt.toISOString(),
          trialEndsAt.toISOString(),
        ]
      );

      // Create or update subscription record with TRIALING status
      const existingSub = await db.getOne(
        `SELECT id FROM subscriptions WHERE organization_id = $1`,
        [params.organizationId]
      );

      if (existingSub) {
        await db.execute(
          `UPDATE subscriptions
           SET status = $1,
               trial_started_at = $2,
               trial_ends_at = $3,
               updated_at = CURRENT_TIMESTAMP
           WHERE organization_id = $4`,
          [
            SubscriptionStatus.TRIALING,
            trialStartedAt.toISOString(),
            trialEndsAt.toISOString(),
            params.organizationId,
          ]
        );
      } else {
        await db.execute(
          `INSERT INTO subscriptions (
             id, organization_id, status, trial_started_at, trial_ends_at, cancel_at_period_end, created_at, updated_at
           ) VALUES ($1, $2, $3, $4, $5, FALSE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
          [
            uuidv4(),
            params.organizationId,
            SubscriptionStatus.TRIALING,
            trialStartedAt.toISOString(),
            trialEndsAt.toISOString(),
          ]
        );
      }

      await AuditService.log({
        organizationId: params.organizationId,
        userId: params.userId,
        action: AuditAction.TRIAL_REDEMPTION_SUCCESS,
        entityType: 'TRIAL_REDEMPTION',
        entityId: redemptionId,
        metadata: {
          normalizedEmail: normalized,
          trialEndsAt: trialEndsAt.toISOString(),
          trialAiBudgetUsd: config.billing.trialAiBudgetUsd,
        },
      });

      return {
        success: true,
        trialEndsAt,
        message: '7-day free trial activated successfully.',
      };
    } catch (err: any) {
      if (err.message && (err.message.includes('unique') || err.message.includes('duplicate key'))) {
        await AuditService.log({
          organizationId: params.organizationId,
          userId: params.userId,
          action: AuditAction.TRIAL_REDEMPTION_REJECTED,
          entityType: 'TRIAL_REDEMPTION',
          entityId: normalized,
          metadata: { reason: 'Concurrent trial redemption attempt caught by unique constraint', email: normalized },
        });

        throw new Error(
          'Your free trial has already been used for this email address. You can subscribe to ONCEClic Pro for $19/month.'
        );
      }
      throw err;
    }
  }
}
