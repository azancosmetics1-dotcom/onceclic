import { Router, Request, Response } from 'express';
import { ComposioTriggerService, ComposioWebhookPayload } from '../services/ComposioTriggerService';
import { db } from '../db';

const router = Router();

/**
 * POST /api/webhooks/composio
 *
 * Canonical Webhook Receiver for all Composio V3 Inbound Events:
 * - Gmail Inbound Message Trigger
 * - Instagram Inbound Direct Message Trigger
 * - Facebook Page Inbound Message Trigger
 * - Connected Account Lifecycle Events
 *
 * Flow:
 * 1. Raw Body Capture
 * 2. Cryptographic HMAC Signature & Timestamp Freshness Verification
 * 3. Event Idempotency & Deduplication Check
 * 4. Channel-Agnostic Normalization & Tenant Resolution
 * 5. InboundChannelService -> Gemini AI Grounding -> Channel Outbound Dispatch
 */
router.post('/composio', async (req: Request, res: Response): Promise<void> => {
  const rawBody = (req as any).rawBody || (typeof req.body === 'string' ? req.body : JSON.stringify(req.body));

  // 1. Cryptographic HMAC Signature & Timestamp Freshness Verification
  const verification = ComposioTriggerService.verifyWebhookSignature(rawBody, req.headers);
  if (!verification.isValid) {
    console.warn(`[Composio Webhook] Signature verification failed: ${verification.error}`);
    const isStale = verification.error?.includes('Stale');
    res.status(isStale ? 400 : 401).json({
      success: false,
      error: verification.error || 'Invalid Composio webhook signature.',
      code: isStale ? 'STALE_WEBHOOK' : 'UNAUTHORIZED',
    });
    return;
  }

  // 2. Parse JSON Payload
  let payload: ComposioWebhookPayload;
  try {
    payload = typeof req.body === 'object' && req.body !== null && !Buffer.isBuffer(req.body)
      ? req.body
      : JSON.parse(rawBody);
  } catch (err: any) {
    console.warn('[Composio Webhook] Malformed JSON payload:', err.message);
    res.status(400).json({
      success: false,
      error: 'Malformed JSON payload.',
      code: 'INVALID_JSON',
    });
    return;
  }

  const eventId = payload.id || payload.data?.id || `evt_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

  // 3. Stable Idempotency Check (Never process same event twice)
  try {
    const existingEvent = await db.getOne<{ event_id: string }>(
      'SELECT event_id FROM processed_webhook_events WHERE event_id = $1',
      [eventId]
    );

    if (existingEvent) {
      console.log(`[Composio Webhook] Event ${eventId} already processed. Returning cached success.`);
      res.status(200).json({
        success: true,
        message: 'Event already processed',
        ignoredDuplicate: true,
        eventId,
      });
      return;
    }
  } catch (idempErr) {
    console.warn('[Composio Webhook] Idempotency lookup notice:', idempErr);
  }

  // 4. Process event through canonical pipeline
  try {
    const result = await ComposioTriggerService.processWebhookEvent(payload);

    if (result.ignoredDuplicate) {
      res.status(200).json({
        success: true,
        ignoredDuplicate: true,
        eventId,
      });
      return;
    }

    if (!result.success && result.error?.includes('Unable to resolve')) {
      res.status(404).json({
        success: false,
        error: result.error,
        eventId,
      });
      return;
    }

    res.status(200).json({
      success: result.success,
      channel: result.channel,
      organizationId: result.organizationId,
      aiReplySent: result.aiReplySent,
      replyText: result.replyText,
      error: result.error,
      eventId,
    });
  } catch (err: any) {
    console.error('[Composio Webhook] Processing exception:', err);
    res.status(500).json({
      success: false,
      error: err.message || 'Internal server error processing Composio webhook.',
      eventId,
    });
  }
});

export default router;
