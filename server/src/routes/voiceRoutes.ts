import { Router, Request, Response } from 'express';
import { authMiddleware } from '../middleware/authMiddleware';
import { tenantIsolationMiddleware } from '../middleware/tenantIsolationMiddleware';
import { requirePermission } from '../middleware/rbacMiddleware';
import { VoiceService } from '../services/voice/VoiceService';
import { PhoneNumberPricingService } from '../services/voice/PhoneNumberPricingService';
import { PhoneNumberBillingService } from '../services/voice/PhoneNumberBillingService';
import { VoiceConnectionMethod } from '@onceclic/shared';
import {
  toCustomerVoiceConfig,
  toCustomerVoiceAnalytics,
  toCustomerCallRecordList,
} from '../serializers/customerSerializers';
import { db } from '../db';
import { VoiceAssistantProvisioningService } from '../services/voice/VoiceAssistantProvisioningService';
import { config } from '../config';

const router = Router();

const COMING_SOON_PHONE_MESSAGE =
  'Phone calling and phone number services are coming soon. ONCEClic currently supports AI voice conversations directly through your website.';

const phoneFeatureComingSoon = (_req: Request, res: Response) => {
  return res.status(400).json({
    success: false,
    code: 'FEATURE_COMING_SOON',
    error: COMING_SOON_PHONE_MESSAGE,
    message: COMING_SOON_PHONE_MESSAGE,
  });
};

router.use(authMiddleware);
router.use(tenantIsolationMiddleware);

/**
 * Dedicated Vapi Assistant for Website AI Voice Receptionist
 */
router.get('/assistant', requirePermission('voice:read'), async (req: Request, res: Response, next) => {
  try {
    const orgId = req.organizationId!;
    const assistant = await VoiceAssistantProvisioningService.getOrCreateOrganizationAssistant(orgId);
    const configData = await VoiceService.getCustomerVoiceConfig(orgId);
    res.json({
      success: true,
      data: {
        assistantId: assistant.assistantId,
        vapiPublicKey: config.vapi.publicKey || null,
        isVoiceReceptionistReady: true,
        embedSnippet: configData.embedSnippet,
        browserVoiceMinutes: configData.browserVoiceMinutes,
      },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * Start Browser Voice Session (Checks Plan Allowance & Prepares Session)
 */
router.post('/browser/session', requirePermission('voice:read'), async (req: Request, res: Response, next) => {
  try {
    const session = await VoiceService.startBrowserVoiceSession(req.organizationId!);
    if (!session.allowed) {
      return res.status(403).json({
        success: false,
        code: 'USAGE_LIMIT_EXCEEDED',
        error: session.reason || 'AI voice minutes allowance exceeded',
        remainingMinutes: session.remainingMinutes ?? 0,
      });
    }
    res.json({
      success: true,
      data: session,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * Get AI Receptionist Voice Status, Active Numbers, and Minute Usage
 */
router.get('/status', requirePermission('voice:read'), async (req: Request, res: Response, next) => {
  try {
    const config = await VoiceService.getCustomerVoiceConfig(req.organizationId!);
    const serialized = toCustomerVoiceConfig(config);
    res.json({ success: true, data: serialized });
  } catch (err) {
    next(err);
  }
});

/**
 * List supported telephony countries, pricing, and carrier guides
 */
router.get('/countries', requirePermission('voice:read'), async (_req: Request, res: Response, next) => {
  try {
    const countries = VoiceService.getSupportedCountries();
    res.json({ success: true, data: countries });
  } catch (err) {
    next(err);
  }
});

/**
 * Search available phone numbers for provisioning (Postponed - Coming Soon)
 */
router.get('/available-numbers', requirePermission('voice:read'), phoneFeatureComingSoon);

/**
 * Authoritative Server-Side Pricing Quote (Postponed - Coming Soon)
 */
router.post('/numbers/quote', requirePermission('voice:read'), phoneFeatureComingSoon);

/**
 * Create Pre-Order Phone Number Checkout Session (Postponed - Coming Soon)
 */
router.post('/numbers/checkout-session', requirePermission('voice:manage'), phoneFeatureComingSoon);

/**
 * Cancel In-Flight Checkout Session (Postponed - Coming Soon)
 */
router.post('/numbers/checkout-session/:id/cancel', requirePermission('voice:manage'), phoneFeatureComingSoon);

/**
 * Authorize Checkout Session (Postponed - Coming Soon)
 */
router.post('/numbers/checkout-session/:id/authorize', requirePermission('voice:manage'), phoneFeatureComingSoon);

/**
 * List registered phone numbers for the organization
 */
router.get('/numbers', requirePermission('voice:read'), async (req: Request, res: Response, next) => {
  try {
    const numbers = await VoiceService.listPhoneNumbers(req.organizationId!);
    res.json({ success: true, data: numbers });
  } catch (err) {
    next(err);
  }
});

/**
 * Validate existing phone number and get carrier forwarding instructions (Postponed - Coming Soon)
 */
router.post('/numbers/existing/validate', requirePermission('voice:manage'), phoneFeatureComingSoon);

/**
 * Connect Existing Business Phone Number (Postponed - Coming Soon)
 */
router.post('/numbers/existing', requirePermission('voice:manage'), phoneFeatureComingSoon);

/**
 * Verify ownership of existing phone number (Postponed - Coming Soon)
 */
router.post('/numbers/existing/verify', requirePermission('voice:manage'), phoneFeatureComingSoon);

/**
 * Provision New Provider Phone Number (Postponed - Coming Soon)
 */
router.post('/numbers/new/order', requirePermission('voice:manage'), phoneFeatureComingSoon);

/**
 * Legacy / Fast Provision Endpoint (Postponed - Coming Soon)
 */
router.post('/numbers/new', requirePermission('voice:manage'), phoneFeatureComingSoon);

/**
 * Disconnect/Delete Phone Number (Postponed - Coming Soon)
 */
router.delete('/numbers/:id', requirePermission('voice:manage'), phoneFeatureComingSoon);

/**
 * Cancel recurring phone number rental subscription (Postponed - Coming Soon)
 */
router.post(['/numbers/:id/cancel-rental', '/numbers/:id/cancel-subscription'], requirePermission('voice:manage'), phoneFeatureComingSoon);

/**
 * Process idempotent refund for a phone number (Postponed - Coming Soon)
 */
router.post('/numbers/:id/refund', requirePermission('voice:manage'), phoneFeatureComingSoon);

/**
 * Safe Retry for partially configured or failed phone number provisioning (Postponed - Coming Soon)
 */
router.post('/numbers/:id/retry', requirePermission('voice:manage'), phoneFeatureComingSoon);

/**
 * Test Call to verify AI Receptionist routing before marking ACTIVE (Postponed - Coming Soon)
 */
router.post('/numbers/:id/test-call', requirePermission('voice:manage'), phoneFeatureComingSoon);

/**
 * Test Phone Number Connection / Forwarding Route (Postponed - Coming Soon)
 */
router.post('/numbers/:id/test', requirePermission('voice:manage'), phoneFeatureComingSoon);

/**
 * Get Call History (with masked numbers and no internal cost leaks)
 */
router.get('/calls', requirePermission('voice:read'), async (req: Request, res: Response, next) => {
  try {
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 50;
    const calls = await VoiceService.listCallRecords(req.organizationId!, limit);
    const serialized = toCustomerCallRecordList(calls);
    res.json({ success: true, data: serialized });
  } catch (err) {
    next(err);
  }
});

/**
 * Get Voice Analytics
 */
router.get('/analytics', requirePermission('analytics:read'), async (req: Request, res: Response, next) => {
  try {
    const analytics = await VoiceService.getVoiceAnalytics(req.organizationId!);
    const serialized = toCustomerVoiceAnalytics(analytics);
    res.json({ success: true, data: serialized });
  } catch (err) {
    next(err);
  }
});

// ─── Industry Configuration ───────────────────────────────────────────────────

const VALID_INDUSTRY_TYPES = ['clinic', 'restaurant', 'salon'] as const;

/**
 * GET /api/voice/industry-config
 * Returns the industry type and transfer phone number for the organization.
 */
router.get('/industry-config', requirePermission('voice:read'), async (req: Request, res: Response, next) => {
  try {
    const orgId = req.organizationId!;
    const row = await db.getOne(
      `SELECT industry_type, transfer_phone_number, salon_settings
       FROM business_settings WHERE organization_id = $1`,
      [orgId]
    );

    res.json({
      success: true,
      data: {
        industryType: row?.industry_type || 'clinic',
        transferPhoneNumber: row?.transfer_phone_number || null,
        salonSettings: row?.salon_settings || null,
      },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * PUT /api/voice/industry-config
 * Update the industry type, transfer phone number, and salon settings.
 */
router.put('/industry-config', requirePermission('voice:manage'), async (req: Request, res: Response, next) => {
  try {
    const orgId = req.organizationId!;
    const { industryType, transferPhoneNumber, salonSettings } = req.body;

    // Validate industryType
    if (industryType !== undefined && !VALID_INDUSTRY_TYPES.includes(industryType)) {
      return res.status(400).json({
        success: false,
        error: `Invalid industryType. Must be one of: ${VALID_INDUSTRY_TYPES.join(', ')}.`,
      });
    }

    // Validate and normalize E.164 phone number if provided
    let normalizedPhone: string | null = null;
    if (transferPhoneNumber !== undefined && transferPhoneNumber !== null && transferPhoneNumber !== '') {
      const digits = String(transferPhoneNumber).replace(/[\s\-().]/g, '');
      if (!/^\+?[1-9]\d{7,14}$/.test(digits)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid transfer phone number. Must be in E.164 format (e.g. +12125551234).',
        });
      }
      normalizedPhone = digits.startsWith('+') ? digits : `+${digits}`;
    }

    const sets: string[] = [];
    const values: any[] = [];
    let idx = 1;

    if (industryType !== undefined) {
      sets.push(`industry_type = $${idx++}`);
      values.push(industryType);
    }
    if (transferPhoneNumber !== undefined) {
      sets.push(`transfer_phone_number = $${idx++}`);
      values.push(normalizedPhone);
    }
    if (salonSettings !== undefined) {
      sets.push(`salon_settings = $${idx++}`);
      values.push(salonSettings === null ? null : JSON.stringify(salonSettings));
    }

    if (sets.length > 0) {
      sets.push(`updated_at = CURRENT_TIMESTAMP`);
      values.push(orgId);

      await db.execute(
        `UPDATE business_settings SET ${sets.join(', ')} WHERE organization_id = $${idx}`,
        values
      );
    }

    // Return updated config
    const updated = await db.getOne(
      `SELECT industry_type, transfer_phone_number, salon_settings
       FROM business_settings WHERE organization_id = $1`,
      [orgId]
    );

    res.json({
      success: true,
      data: {
        industryType: updated?.industry_type || 'clinic',
        transferPhoneNumber: updated?.transfer_phone_number || null,
        salonSettings: updated?.salon_settings || null,
      },
    });
  } catch (err) {
    next(err);
  }
});

export default router;
