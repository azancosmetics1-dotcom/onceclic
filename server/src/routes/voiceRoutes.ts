import { Router, Request, Response } from 'express';
import { authMiddleware } from '../middleware/authMiddleware';
import { tenantIsolationMiddleware } from '../middleware/tenantIsolationMiddleware';
import { requirePermission } from '../middleware/rbacMiddleware';
import { VoiceService } from '../services/voice/VoiceService';
import { VoiceConnectionMethod } from '@onceclic/shared';
import {
  toCustomerVoiceConfig,
  toCustomerVoiceAnalytics,
  toCustomerCallRecordList,
} from '../serializers/customerSerializers';

const router = Router();

router.use(authMiddleware);
router.use(tenantIsolationMiddleware);

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
 * Connect Existing Business Phone Number (Call Forwarding, SIP/VoIP, or Porting)
 */
router.post('/numbers/existing', requirePermission('voice:manage'), async (req: Request, res: Response, next) => {
  try {
    const { phoneNumber, connectionMethod, forwardingTarget, sipEndpoint } = req.body;

    if (!phoneNumber) {
      return res.status(400).json({ success: false, error: 'Phone number is required.' });
    }

    const method = connectionMethod || VoiceConnectionMethod.EXISTING_FORWARDING;

    const phoneRecord = await VoiceService.connectExistingNumber({
      organizationId: req.organizationId!,
      phoneNumber,
      connectionMethod: method,
      forwardingTarget,
      sipEndpoint,
      userId: req.user?.id,
    });

    res.status(201).json({ success: true, data: phoneRecord });
  } catch (err) {
    next(err);
  }
});

/**
 * Provision New Provider Phone Number
 */
router.post('/numbers/new', requirePermission('voice:manage'), async (req: Request, res: Response, next) => {
  try {
    const { areaCode, country } = req.body;

    const phoneRecord = await VoiceService.provisionNewNumber({
      organizationId: req.organizationId!,
      areaCode,
      country,
      userId: req.user?.id,
    });

    res.status(201).json({ success: true, data: phoneRecord });
  } catch (err) {
    next(err);
  }
});

/**
 * Disconnect/Delete Phone Number
 */
router.delete('/numbers/:id', requirePermission('voice:manage'), async (req: Request, res: Response, next) => {
  try {
    const success = await VoiceService.disconnectPhoneNumber(
      req.organizationId!,
      req.params.id,
      req.user?.id
    );

    if (!success) {
      return res.status(404).json({ success: false, error: 'Phone number not found.' });
    }

    res.json({ success: true, message: 'Phone number disconnected successfully.' });
  } catch (err) {
    next(err);
  }
});

/**
 * Test Phone Number Connection / Forwarding Route
 */
router.post('/numbers/:id/test', requirePermission('voice:manage'), async (req: Request, res: Response, next) => {
  try {
    const result = await VoiceService.testNumberConnection(req.organizationId!, req.params.id);
    res.json({ success: result.success, data: result });
  } catch (err) {
    next(err);
  }
});

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

export default router;
