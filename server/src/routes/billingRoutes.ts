import { Router, Request, Response } from 'express';
import { authMiddleware } from '../middleware/authMiddleware';
import { tenantIsolationMiddleware } from '../middleware/tenantIsolationMiddleware';
import { requirePermission } from '../middleware/rbacMiddleware';
import { CreemBillingService } from '../services/CreemBillingService';
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

/**
 * Authoritative Webhook Endpoint (Unauthenticated, verified via HMAC signature)
 * Accepts Creem webhooks (via 'creem-signature') and retains Paddle support (via 'paddle-signature').
 */
router.post(['/webhook', '/creem/webhook'], async (req: Request, res: Response, next) => {
  try {
    const creemSignature = (req.headers['creem-signature'] || req.headers['x-creem-signature'] || req.headers['webhook-signature']) as string;
    const paddleSignature = req.headers['paddle-signature'] as string;
    const rawBody = (req as any).rawBody || JSON.stringify(req.body);

    // 1. Creem Webhook handling
    const isCreem = Boolean(creemSignature || (req.body?.eventType && !req.body?.event_type));
    if (isCreem) {
      if (config.creem.webhookSecret && !config.creem.webhookSecret.includes('placeholder')) {
        const isValid = await CreemBillingService.verifyWebhookSignature(rawBody, req.headers);
        if (!isValid) {
          console.warn('[Creem Webhook] Invalid signature rejected.');
          return res.status(401).json({ success: false, error: 'Invalid webhook signature.' });
        }
      } else if (config.creem.environment === 'prod' || config.nodeEnv === 'production') {
        console.error('[Creem Webhook] CREEM_WEBHOOK_SECRET is required in production. Webhook rejected.');
        return res.status(401).json({ success: false, error: 'Webhook signature verification required in production.' });
      } else if (!creemSignature && config.creem.webhookSecret) {
        console.warn('[Creem Webhook] Missing signature rejected.');
        return res.status(401).json({ success: false, error: 'Missing webhook signature.' });
      }

      const result = await CreemBillingService.handleWebhookEvent(req.body);
      return res.json({ success: true, data: result });
    }

    // 2. Retained Paddle Webhook handling (for backward compatibility)
    if (paddleSignature || req.body?.event_type) {
      if (config.paddle.webhookSecret && !config.paddle.webhookSecret.includes('placeholder')) {
        const isValid = PaddleBillingService.verifyWebhookSignature(rawBody, paddleSignature);
        if (!isValid) {
          console.warn('[Paddle Webhook] Invalid signature rejected.');
          return res.status(401).json({ success: false, error: 'Invalid webhook signature.' });
        }
      } else if (config.paddle.environment === 'production' || config.nodeEnv === 'production') {
        console.error('[Paddle Webhook] PADDLE_WEBHOOK_SECRET is required in production. Webhook rejected.');
        return res.status(401).json({ success: false, error: 'Webhook signature verification required in production.' });
      }

      const result = await PaddleBillingService.handleWebhookEvent(req.body);
      return res.json({ success: true, data: result });
    }

    // If neither signature or event structure is present
    return res.status(400).json({ success: false, error: 'Unrecognized webhook event or missing signature.' });
  } catch (err) {
    next(err);
  }
});

// Authenticated billing routes
router.use(authMiddleware);
router.use(tenantIsolationMiddleware);

// Server-side Creem Checkout creation (Authenticated, Plan-validated)
router.post('/checkout', requirePermission('billing:manage'), async (req: Request, res: Response, next) => {
  try {
    const rawTier = (req.body?.planTier || req.body?.plan || '').toUpperCase();
    if (rawTier !== 'STARTER' && rawTier !== 'PRO' && rawTier !== 'BUSINESS') {
      return res.status(400).json({
        success: false,
        error: `Invalid plan tier: "${req.body?.planTier}". Allowed tiers: Starter, Pro, Business.`,
      });
    }

    const session = await CreemBillingService.createCheckoutSession({
      organizationId: req.organizationId!,
      userId: req.user!.id,
      userEmail: req.user!.email,
      userName: req.user!.fullName,
      planTier: rawTier,
    });

    res.json({
      success: true,
      data: session,
    });
  } catch (err: any) {
    res.status(400).json({
      success: false,
      error: err.message || 'Failed to initiate checkout session.',
    });
  }
});

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
    const rawStatus = await CreemBillingService.getSubscription(req.organizationId!);
    const budgetStatus = await AIBudgetService.checkBudget(req.organizationId!);
    const safeStatus = toCustomerBillingStatus({
      subscription: rawStatus.subscription,
      isPro: rawStatus.isPro,
      planTier: rawStatus.planTier,
      daysRemainingInTrial: rawStatus.daysRemainingInTrial,
      billingConfigured: rawStatus.billingConfigured,
      budgetStatus,
    });
    res.json({ success: true, data: safeStatus });
  } catch (err) {
    next(err);
  }
});

// Get client-safe billing configuration & pricing (Customer Safe)
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

// Create Customer Portal Session URL (Creem Customer Portal)
router.post('/portal-session', requirePermission('billing:manage'), async (req: Request, res: Response, next) => {
  try {
    const session = await CreemBillingService.createCustomerPortalSession(req.organizationId!);
    res.json({ success: true, data: session });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message || 'Failed to create customer portal session.' });
  }
});

// Cancel subscription (scheduled at end of current billing period)
router.post('/cancel', requirePermission('billing:manage'), async (req: Request, res: Response, next) => {
  try {
    const result = await CreemBillingService.cancelSubscription(req.organizationId!);
    res.json({ success: true, data: result });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message || 'Failed to cancel subscription.' });
  }
});

export default router;
