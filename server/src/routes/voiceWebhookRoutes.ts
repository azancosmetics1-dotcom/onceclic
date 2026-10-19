import { Router, Request, Response } from 'express';
import { VoiceService } from '../services/voice/VoiceService';
import { db } from '../db';

const router = Router();

/**
 * Helper to check and record webhook idempotency using processed_webhook_events
 */
async function checkAndRecordWebhookIdempotency(eventId: string, eventType: string): Promise<boolean> {
  if (!eventId) return false;

  const existing = await db.getOne(
    'SELECT event_id FROM processed_webhook_events WHERE event_id = $1',
    [eventId]
  );

  if (existing) {
    return true; // Already processed
  }

  await db.execute(
    `INSERT INTO processed_webhook_events (event_id, event_type, occurred_at, processed_at)
     VALUES ($1, $2, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    [eventId, eventType]
  );

  return false;
}

/**
 * Health check endpoint for Voice Provider Webhooks
 */
router.get('/health', (_req: Request, res: Response) => {
  const provider = VoiceService.getProvider();
  const telephony = VoiceService.getTelephonyProvider();
  res.json({
    status: 'ok',
    voiceProvider: provider.providerName,
    telephonyProvider: telephony.providerName,
    timestamp: new Date().toISOString(),
  });
});

/**
 * Telnyx Official Webhook Endpoint (/telnyx or /webhooks/telnyx)
 * Signed with Ed25519 headers: telnyx-signature-ed25519 and telnyx-timestamp
 */
router.post(['/telnyx', '/webhooks/telnyx'], async (req: Request, res: Response) => {
  try {
    const telephony = VoiceService.getTelephonyProvider();
    const signature = (req.headers['telnyx-signature-ed25519'] || req.headers['x-telnyx-signature']) as string | undefined;
    const timestamp = (req.headers['telnyx-timestamp'] || req.headers['x-telnyx-timestamp']) as string | undefined;
    const rawBody = (req as any).rawBody || JSON.stringify(req.body);

    if (telephony.verifyWebhookSignature) {
      const isValid = telephony.verifyWebhookSignature({
        rawBody,
        signature,
        timestamp,
      });

      if (!isValid) {
        return res.status(401).json({
          success: false,
          error: 'Invalid or missing Telnyx webhook signature.',
        });
      }
    }

    const payload = req.body || {};
    const eventData = payload.data || {};
    const eventId = eventData.id || payload.id;
    const eventType = eventData.event_type || payload.event_type || 'telnyx.event';

    // Deduplication / Idempotency
    if (eventId) {
      const isDuplicate = await checkAndRecordWebhookIdempotency(eventId, eventType);
      if (isDuplicate) {
        return res.json({ success: true, message: 'Event already processed (idempotent).' });
      }
    }

    // Telnyx call event handling (e.g. call.initiated, call.hangup)
    const callPayload = eventData.payload || {};
    const callId = callPayload.call_control_id || callPayload.call_leg_id;
    const from = callPayload.from;
    const to = callPayload.to;

    if (eventType === 'call.initiated' && to) {
      const inboundRes = await VoiceService.handleInboundCall({
        callId: callId || `telnyx_${Date.now()}`,
        fromNumber: from || '',
        toNumber: to,
        provider: 'TELNYX',
      });
      return res.json({ success: true, allowed: inboundRes.allowed });
    }

    if (eventType === 'call.hangup' && callId) {
      return res.json({ success: true, status: 'call.hangup recorded' });
    }

    res.json({ success: true, eventType });
  } catch (err: any) {
    // Fail safely without leaking internal stack traces or secrets
    res.status(500).json({ success: false, error: 'Internal webhook processing error' });
  }
});

/**
 * Vapi Official Webhook Endpoint (/vapi, /webhook, or /)
 * Signed with x-vapi-secret, x-vapi-signature, or Authorization header
 */
router.post(['/', '/vapi', '/webhook'], async (req: Request, res: Response) => {
  try {
    const provider = VoiceService.getVoiceProvider();
    const signature = (
      req.headers['x-vapi-secret'] ||
      req.headers['x-vapi-signature'] ||
      req.headers['authorization'] ||
      req.headers['x-voice-signature']
    ) as string | undefined;

    const rawBody = (req as any).rawBody || JSON.stringify(req.body);
    const isValid = provider.verifyWebhookSignature(rawBody, signature);
    if (!isValid) {
      return res.status(401).json({ success: false, error: 'Invalid or missing Vapi webhook signature.' });
    }

    const body = req.body || {};
    const messageType = body.message?.type || body.type || 'unknown';
    const callId = body.message?.call?.id || body.call?.id || body.call_id;

    // Idempotency check for call ended or tool call events
    if (callId && (messageType === 'end-of-call-report' || messageType === 'status-update')) {
      const eventKey = `vapi_${callId}_${messageType}`;
      const isDuplicate = await checkAndRecordWebhookIdempotency(eventKey, messageType);
      if (isDuplicate) {
        return res.json({ success: true, message: 'Event already processed (idempotent).' });
      }
    }

    // 1. Assistant Request / Inbound Call
    if (messageType === 'assistant-request' || messageType === 'inbound-call') {
      const event = provider.parseInboundCall(body);
      const result = await VoiceService.handleInboundCall(event);
      return res.json(result.responsePayload);
    }

    // 2. Tool / Function Calls
    if (messageType === 'tool-calls' || messageType === 'function-call') {
      const toolEvent = provider.parseToolCall(body);
      const result = await VoiceService.executeVoiceTool({
        callId: toolEvent.callId,
        toolCallId: toolEvent.toolCallId,
        toolName: toolEvent.toolName,
        args: toolEvent.args,
      });
      const response = provider.formatToolResponse(toolEvent.toolCallId, result);
      return res.json(response);
    }

    // 3. End of Call Report
    if (messageType === 'end-of-call-report' || messageType === 'call-ended') {
      const event = provider.parseCallEnded(body);
      try {
        const callRecord = await VoiceService.handleCallEnded(event);
        return res.json({
          success: true,
          callId: callRecord.providerCallId,
          durationMinutes: callRecord.durationMinutes,
          status: callRecord.status,
        });
      } catch (endErr: any) {
        if (endErr?.message?.startsWith('Tenant isolation')) {
          // Acknowledge the event so the provider does not retry, but record the skip
          console.warn('[voiceWebhookRoutes] Tenant isolation skip for call-ended event:', endErr.message);
          return res.json({ success: false, skipped: true, reason: 'unresolvable_org' });
        }
        throw endErr; // let the outer catch return 500
      }
    }

    res.json({ success: true, messageType });
  } catch (err: any) {
    res.status(500).json({ success: false, error: 'Internal voice webhook error' });
  }
});

/**
 * Inbound Call Webhook: Dispatched by Voice Provider when caller dials the business number
 */
router.post('/inbound', async (req: Request, res: Response) => {
  try {
    const provider = VoiceService.getProvider();
    const signature = (
      req.headers['x-vapi-secret'] ||
      req.headers['x-vapi-signature'] ||
      req.headers['x-retell-signature'] ||
      req.headers['x-voice-signature'] ||
      req.headers['authorization']
    ) as string | undefined;

    const rawBody = (req as any).rawBody || JSON.stringify(req.body);
    const isValid = provider.verifyWebhookSignature(rawBody, signature);
    if (!isValid) {
      return res.status(401).json({ success: false, error: 'Invalid voice webhook signature.' });
    }

    const event = provider.parseInboundCall(req.body);
    const result = await VoiceService.handleInboundCall(event);

    res.json(result.responsePayload);
  } catch (err: any) {
    res.status(500).json({ success: false, error: 'Inbound call processing error' });
  }
});

/**
 * Tool / Function Calling Webhook: Dispatched by Voice Provider when LLM invokes a tool
 */
router.post('/tool', async (req: Request, res: Response) => {
  try {
    const provider = VoiceService.getProvider();
    const signature = (
      req.headers['x-vapi-secret'] ||
      req.headers['x-vapi-signature'] ||
      req.headers['x-retell-signature'] ||
      req.headers['x-voice-signature'] ||
      req.headers['authorization']
    ) as string | undefined;

    const rawBody = (req as any).rawBody || JSON.stringify(req.body);
    const isValid = provider.verifyWebhookSignature(rawBody, signature);
    if (!isValid) {
      return res.status(401).json({ success: false, error: 'Invalid voice webhook signature.' });
    }

    const toolEvent = provider.parseToolCall(req.body);
    const result = await VoiceService.executeVoiceTool({
      callId: toolEvent.callId,
      toolCallId: toolEvent.toolCallId,
      toolName: toolEvent.toolName,
      args: toolEvent.args,
    });

    const response = provider.formatToolResponse(toolEvent.toolCallId, result);
    res.json(response);
  } catch (err: any) {
    const provider = VoiceService.getProvider();
    const errorResponse = provider.formatErrorResponse(req.body?.tool_call_id, 'Tool execution error');
    res.status(500).json(errorResponse);
  }
});

/**
 * Call Ended Webhook: Dispatched when the call completes
 */
router.post('/call-ended', async (req: Request, res: Response) => {
  try {
    const provider = VoiceService.getProvider();
    const signature = (
      req.headers['x-vapi-secret'] ||
      req.headers['x-vapi-signature'] ||
      req.headers['x-retell-signature'] ||
      req.headers['x-voice-signature'] ||
      req.headers['authorization']
    ) as string | undefined;

    const rawBody = (req as any).rawBody || JSON.stringify(req.body);
    const isValid = provider.verifyWebhookSignature(rawBody, signature);
    if (!isValid) {
      return res.status(401).json({ success: false, error: 'Invalid voice webhook signature.' });
    }

    const event = provider.parseCallEnded(req.body);
    try {
      const callRecord = await VoiceService.handleCallEnded(event);
      res.json({
        success: true,
        callId: callRecord.providerCallId,
        durationMinutes: callRecord.durationMinutes,
        status: callRecord.status,
      });
    } catch (endErr: any) {
      if (endErr?.message?.startsWith('Tenant isolation')) {
        console.warn('[voiceWebhookRoutes] Tenant isolation skip for call-ended event:', endErr.message);
        return res.json({ success: false, skipped: true, reason: 'unresolvable_org' });
      }
      throw endErr;
    }
  } catch (err: any) {
    res.status(500).json({ success: false, error: 'Call ended processing error' });
  }
});

export default router;
