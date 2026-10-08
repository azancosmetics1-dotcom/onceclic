import { Router, Request, Response } from 'express';
import { VoiceService } from '../services/voice/VoiceService';

const router = Router();

/**
 * Health check endpoint for Voice Provider Webhooks
 */
router.get('/health', (_req: Request, res: Response) => {
  const provider = VoiceService.getProvider();
  res.json({
    status: 'ok',
    provider: provider.providerName,
    timestamp: new Date().toISOString(),
  });
});

/**
 * Inbound Call Webhook: Dispatched by Voice Provider when caller dials the business number
 */
router.post('/inbound', async (req: Request, res: Response, next) => {
  try {
    const provider = VoiceService.getProvider();
    const signature = (req.headers['x-retell-signature'] || req.headers['x-voice-signature'] || req.headers['authorization']) as string | undefined;

    // Validate webhook signature
    const isValid = provider.verifyWebhookSignature(req.body, signature);
    if (!isValid) {
      return res.status(401).json({ success: false, error: 'Invalid voice webhook signature.' });
    }

    const event = provider.parseInboundCall(req.body);
    const result = await VoiceService.handleInboundCall(event);

    res.json(result.responsePayload);
  } catch (err) {
    next(err);
  }
});

/**
 * Tool / Function Calling Webhook: Dispatched by Voice Provider when LLM invokes a tool
 */
router.post('/tool', async (req: Request, res: Response, next) => {
  try {
    const provider = VoiceService.getProvider();
    const signature = (req.headers['x-retell-signature'] || req.headers['x-voice-signature'] || req.headers['authorization']) as string | undefined;

    const isValid = provider.verifyWebhookSignature(req.body, signature);
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
    const errorResponse = provider.formatErrorResponse(req.body?.tool_call_id, err.message || 'Tool execution error');
    res.status(500).json(errorResponse);
  }
});

/**
 * Call Ended Webhook: Dispatched when the call completes
 */
router.post('/call-ended', async (req: Request, res: Response, next) => {
  try {
    const provider = VoiceService.getProvider();
    const signature = (req.headers['x-retell-signature'] || req.headers['x-voice-signature'] || req.headers['authorization']) as string | undefined;

    const isValid = provider.verifyWebhookSignature(req.body, signature);
    if (!isValid) {
      return res.status(401).json({ success: false, error: 'Invalid voice webhook signature.' });
    }

    const event = provider.parseCallEnded(req.body);
    const callRecord = await VoiceService.handleCallEnded(event);

    res.json({
      success: true,
      callId: callRecord.providerCallId,
      durationMinutes: callRecord.durationMinutes,
      status: callRecord.status,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
