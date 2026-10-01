import { Router, Request, Response } from 'express';
import { authMiddleware } from '../middleware/authMiddleware';
import { tenantIsolationMiddleware } from '../middleware/tenantIsolationMiddleware';
import { requirePermission } from '../middleware/rbacMiddleware';
import { PaddleBillingService } from '../services/PaddleBillingService';
import { TrialService } from '../services/TrialService';
import { AIBudgetService } from '../services/AIBudgetService';
import { config } from '../config';

import {
  toCustomerBillingStatus,
  toCustomerBillingConfig,
  toCustomerTrialEligibility,
  toCustomerAIStatus,
} from '../serializers/customerSerializers';

const router = Router();

// 1. Paddle Authoritative Webhook Endpoint (Unauthenticated, verified via HMAC signature)
router.post('/webhook', async (req: Request, res: Response, next) => {
  try {
    const signature = req.headers['paddle-signature'] as string;
    const rawBody = (req as any).rawBody || JSON.stringify(req.body);

    // If webhook secret is configured, verify signature strictly
    if (config.paddle.webhookSecret && !config.paddle.webhookSecret.includes('placeholder')) {
      const isValid = PaddleBillingService.verifyWebhookSignature(rawBody, signature);
      if (!isValid) {
        console.warn('[Paddle Webhook] Invalid signature rejected.');
        return res.status(401).json({ success: false, error: 'Invalid webhook signature.' });
      }
    } else {
      console.warn('[Paddle Webhook] PADDLE_WEBHOOK_SECRET is not configured. Webhook accepted in dev mode.');
    }

    const payload = req.body;
    const result = await PaddleBillingService.handleWebhookEvent(payload);

    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});

// Authenticated billing routes
router.use(authMiddleware);
router.use(tenantIsolationMiddleware);

// Check trial eligibility for current user
router.get('/trial-eligibility', requirePermission('billing:read'), async (req: Request, res: Response, next) => {
  try {
    const email = req.user?.email || (req.query.email as string);
    const result = await TrialService.checkEligibility(email);
    res.json({ success: true, data: toCustomerTrialEligibility(result) });
  } catch (err) {
    next(err);
  }
});

// Start 7-day free trial for current organization (if eligible)
router.post('/start-trial', requirePermission('billing:manage'), async (req: Request, res: Response, next) => {
  try {
    const email = req.user?.email;
    if (!email) {
      return res.status(400).json({ success: false, error: 'User email not found.' });
    }
    const result = await TrialService.redeemTrial({
      userId: req.user!.id,
      organizationId: req.organizationId!,
      email,
    });
    res.json({
      success: true,
      data: {
        success: result.success,
        trialEndsAt: result.trialEndsAt,
        message: result.message,
      },
    });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message || 'Failed to activate trial.' });
  }
});

// Get AI status and real-time usage (Customer Safe)
router.get('/budget', requirePermission('billing:read'), async (req: Request, res: Response, next) => {
  try {
    const budgetStatus = await AIBudgetService.checkBudget(req.organizationId!);
    res.json({ success: true, data: toCustomerAIStatus(budgetStatus) });
  } catch (err) {
    next(err);
  }
});

// Get current billing status and trial (Customer Safe)
router.get('/status', requirePermission('billing:read'), async (req: Request, res: Response, next) => {
  try {
    const rawStatus = await PaddleBillingService.getSubscription(req.organizationId!);
    const budgetStatus = await AIBudgetService.checkBudget(req.organizationId!);
    const safeStatus = toCustomerBillingStatus({
      subscription: rawStatus.subscription,
      isPro: rawStatus.isPro,
      daysRemainingInTrial: rawStatus.daysRemainingInTrial,
      billingConfigured: rawStatus.billingConfigured,
      budgetStatus,
    });
    res.json({ success: true, data: safeStatus });
  } catch (err) {
    next(err);
  }
});

// Get client-safe Paddle configuration & pricing (Customer Safe)
router.get('/config', requirePermission('billing:read'), async (req: Request, res: Response, next) => {
  try {
    res.json({
      success: true,
      data: toCustomerBillingConfig(config),
    });
  } catch (err) {
    next(err);
  }
});

// Create Customer Portal Session URL
router.post('/portal-session', requirePermission('billing:manage'), async (req: Request, res: Response, next) => {
  try {
    const session = await PaddleBillingService.createCustomerPortalSession(req.organizationId!);
    res.json({ success: true, data: session });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message || 'Failed to create customer portal session.' });
  }
});

// Cancel subscription (scheduled at end of current billing period)
router.post('/cancel', requirePermission('billing:manage'), async (req: Request, res: Response, next) => {
  try {
    const result = await PaddleBillingService.cancelSubscription(req.organizationId!);
    res.json({ success: true, data: result });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message || 'Failed to cancel subscription.' });
  }
});

export default router;
