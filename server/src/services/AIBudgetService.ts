import { db } from '../db';
import { config } from '../config';
import { SubscriptionStatus, AuditAction } from '@onceclic/shared';
import { AuditService } from './AuditService';

export interface BudgetStatus {
  allowed: boolean;
  isExpired?: boolean;
  isExceeded?: boolean;
  plan: 'TRIAL' | 'PRO' | 'INACTIVE';
  budgetUsd: number;
  spentUsd: number;
  remainingUsd: number;
  reason?: string;
}

export class AIBudgetService {
  /**
   * Calculate accumulated estimated AI cost for an organization
   */
  static async getOrganizationSpentUsd(organizationId: string): Promise<number> {
    const res = await db.query(
      `SELECT estimated_cost_usd FROM ai_usage_records WHERE organization_id = $1`,
      [organizationId]
    );

    let total = 0;
    for (const row of res.rows) {
      const cost = parseFloat(row.estimated_cost_usd ?? row.estimatedCostUsd ?? 0);
      if (!isNaN(cost)) {
        total += cost;
      }
    }
    return Math.round(total * 1000000) / 1000000;
  }

  /**
   * Check budget availability and subscription status server-side
   */
  static async checkBudget(organizationId: string): Promise<BudgetStatus> {
    const sub = await db.getOne<{
      id: string;
      status: string;
      trial_ends_at: string;
      trialEndsAt?: string;
    }>(
      `SELECT id, status, trial_ends_at, trial_ends_at as "trialEndsAt" FROM subscriptions WHERE organization_id = $1`,
      [organizationId]
    );

    const spentUsd = await this.getOrganizationSpentUsd(organizationId);

    if (!sub) {
      return {
        allowed: false,
        plan: 'INACTIVE',
        budgetUsd: 0,
        spentUsd,
        remainingUsd: 0,
        reason: 'No subscription found. Please start your 7-day free trial or subscribe to ONCEClic Pro ($19/month).',
      };
    }

    const status = sub.status as SubscriptionStatus;
    const now = new Date();

    // 1. Check Active Pro Customers
    if (status === SubscriptionStatus.ACTIVE) {
      const budgetUsd = config.billing.proAiBudgetUsd;
      const remainingUsd = Math.max(0, Math.round((budgetUsd - spentUsd) * 1000000) / 1000000);

      if (spentUsd >= budgetUsd) {
        return {
          allowed: false,
          isExceeded: true,
          plan: 'PRO',
          budgetUsd,
          spentUsd,
          remainingUsd: 0,
          reason: 'Your monthly Pro AI usage limit has been reached. Please contact support to increase your allocation.',
        };
      }

      return {
        allowed: true,
        plan: 'PRO',
        budgetUsd,
        spentUsd,
        remainingUsd,
      };
    }

    // 2. Check 7-Day Free Trial
    if (status === SubscriptionStatus.TRIALING) {
      const trialEnds = new Date(sub.trial_ends_at || sub.trialEndsAt || 0);

      // Check Trial Expiration
      if (now > trialEnds) {
        await db.execute('UPDATE subscriptions SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2', [
          SubscriptionStatus.EXPIRED,
          sub.id,
        ]);

        return {
          allowed: false,
          isExpired: true,
          plan: 'TRIAL',
          budgetUsd: config.billing.trialAiBudgetUsd,
          spentUsd,
          remainingUsd: 0,
          reason: 'Your 7-day free trial has expired. Upgrade to ONCEClic Pro ($19/month) to continue using your AI receptionist.',
        };
      }

      // Check Free Trial AI Cost Budget ($0.50 limit)
      const budgetUsd = config.billing.trialAiBudgetUsd;
      const remainingUsd = Math.max(0, Math.round((budgetUsd - spentUsd) * 1000000) / 1000000);

      if (spentUsd >= budgetUsd) {
        await AuditService.log({
          organizationId,
          action: AuditAction.AI_BUDGET_EXCEEDED,
          entityType: 'ORGANIZATION',
          entityId: organizationId,
          metadata: { spentUsd, budgetUsd, plan: 'TRIAL' },
        });

        return {
          allowed: false,
          isExceeded: true,
          plan: 'TRIAL',
          budgetUsd,
          spentUsd,
          remainingUsd: 0,
          reason: "You've reached the AI usage limit for your free trial. Upgrade to Pro to continue using your AI receptionist.",
        };
      }

      return {
        allowed: true,
        plan: 'TRIAL',
        budgetUsd,
        spentUsd,
        remainingUsd,
      };
    }

    // 3. Inactive / Expired / Canceled
    return {
      allowed: false,
      plan: 'INACTIVE',
      budgetUsd: 0,
      spentUsd,
      remainingUsd: 0,
      reason: `Your subscription is ${status.toLowerCase()}. Upgrade to ONCEClic Pro ($19/month) to continue using AI services.`,
    };
  }

  /**
   * Assert that organization has valid budget and active status, or throw user-friendly error.
   */
  static async assertBudgetAvailable(organizationId: string): Promise<BudgetStatus> {
    const status = await this.checkBudget(organizationId);
    if (!status.allowed) {
      throw new Error(status.reason || 'AI generation limit reached.');
    }
    return status;
  }
}
