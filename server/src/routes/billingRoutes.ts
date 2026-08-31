import { Router, Request, Response } from 'express';
import { authMiddleware } from '../middleware/authMiddleware';
import { tenantIsolationMiddleware } from '../middleware/tenantIsolationMiddleware';
import { requirePermission } from '../middleware/rbacMiddleware';
import { PaddleBillingService } from '../services/PaddleBillingService';
import { config } from '../config';

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

// Get current billing status and trial
router.get('/status', requirePermission('billing:read'), async (req: Request, res: Response, next) => {
  try {
    const status = await PaddleBillingService.getSubscription(req.organizationId!);
    res.json({ success: true, data: status });
  } catch (err) {
    next(err);
  }
});

// Get client-safe Paddle configuration
router.get('/config', requirePermission('billing:read'), async (req: Request, res: Response, next) => {
  try {
    res.json({
      success: true,
      data: {
        clientToken: config.paddle.clientToken,
        priceId: config.paddle.priceId,
        environment: config.paddle.environment,
        isConfigured: config.paddle.isConfigured,
        planName: config.billing.planName,
        monthlyPriceUsd: config.billing.monthlyPriceUsd,
        trialPeriodDays: config.billing.trialPeriodDays,
      },
    });
  } catch (err) {
    next(err);
  }
});

export default router;
