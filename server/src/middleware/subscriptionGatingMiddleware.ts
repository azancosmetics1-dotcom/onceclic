import { Request, Response, NextFunction } from 'express';
import { db } from '../db';
import { SubscriptionStatus } from '@onceclic/shared';

export async function requireActiveSubscription(req: Request, res: Response, next: NextFunction) {
  try {
    const orgId = req.organizationId;
    if (!orgId) {
      return res.status(400).json({ success: false, error: 'Organization context required.' });
    }

    const sub = await db.getOne(
      'SELECT id, status, trial_ends_at, current_period_end FROM subscriptions WHERE organization_id = $1',
      [orgId]
    );

    if (!sub) {
      return res.status(402).json({
        success: false,
        error: 'Subscription not found for this organization. Please start your 7-day free trial.',
        code: 'SUBSCRIPTION_REQUIRED',
      });
    }

    const now = new Date();
    const status = sub.status as SubscriptionStatus;

    if (status === SubscriptionStatus.ACTIVE) {
      // Active paying customer
      return next();
    }

    if (status === SubscriptionStatus.TRIALING) {
      const trialEnds = new Date(sub.trial_ends_at);
      if (now <= trialEnds) {
        // Trial is still active
        return next();
      } else {
        // Trial has expired
        await db.execute('UPDATE subscriptions SET status = $1 WHERE id = $2', [
          SubscriptionStatus.EXPIRED,
          sub.id,
        ]);
        return res.status(402).json({
          success: false,
          error: 'Your 7-day free trial has expired. Please upgrade to ONCEClic Pro ($49/month) to continue using AI features.',
          code: 'TRIAL_EXPIRED',
        });
      }
    }

    return res.status(402).json({
      success: false,
      error: `Your subscription is currently ${status.toLowerCase()}. Please update your billing to activate AI services.`,
      code: 'SUBSCRIPTION_INACTIVE',
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: 'Failed to verify subscription status.' });
  }
}
