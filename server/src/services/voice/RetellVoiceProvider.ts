import crypto from 'crypto';
import { IVoiceProvider, InboundCallEvent, VoiceToolCallEvent, CallEndedEvent, VoiceAgentConfig } from './VoiceProvider';
import { config } from '../../config';

export class RetellVoiceProvider implements IVoiceProvider {
  readonly providerName = 'RETELL';

  /**
   * Verify Retell webhook signature using HMAC-SHA256
   */
  verifyWebhookSignature(rawBody: string | Buffer, signature: string | undefined, secret?: string): boolean {
    const webhookSecret = secret || config.voice.retellWebhookSecret;
    if (!webhookSecret || webhookSecret.includes('placeholder')) {
      // In dev mode when secret is not configured, permit if signature exists or dev bypass
      return true;
    }

    if (!signature) {
      return false;
    }

    try {
      const bodyStr = typeof rawBody === 'string' ? rawBody : rawBody.toString('utf-8');
      const expectedSignature = crypto
        .createHmac('sha256', webhookSecret)
        .update(bodyStr)
        .digest('hex');

      // Secure timing safe comparison
      const sigBuffer = Buffer.from(signature, 'hex');
      const expBuffer = Buffer.from(expectedSignature, 'hex');
      if (sigBuffer.length !== expBuffer.length) {
        return false;
      }
      return crypto.timingSafeEqual(sigBuffer, expBuffer);
    } catch (err) {
      console.warn('[RetellVoiceProvider] Webhook signature verification failed:', err);
      return false;
    }
  }

  parseInboundCall(payload: any): InboundCallEvent {
    const call = payload.call || payload;
    const callId = call.call_id || call.id || `call_${Date.now()}`;
    const fromNumber = call.from_number || call.caller_phone || call.from || '';
    const toNumber = call.to_number || call.called_phone || call.to || '';

    return {
      callId,
      fromNumber,
      toNumber,
      provider: this.providerName,
      metadata: call.metadata || {},
    };
  }

  parseToolCall(payload: any): VoiceToolCallEvent {
    const callId = payload.call_id || payload.callId || '';
    const toolCallId = payload.tool_call_id || payload.id;
    const toolName = payload.name || payload.tool_name || payload.toolName || '';
    const args = payload.args || payload.parameters || payload.arguments || {};

    const parsedArgs = typeof args === 'string' ? JSON.parse(args) : args;

    return {
      callId,
      toolCallId,
      toolName,
      args: parsedArgs,
    };
  }

  parseCallEnded(payload: any): CallEndedEvent {
    const call = payload.call || payload;
    const callId = call.call_id || call.id || '';
    const fromNumber = call.from_number || call.caller_phone || '';
    const toNumber = call.to_number || call.called_phone || '';

    let durationSeconds = 0;
    if (call.duration_ms) {
      durationSeconds = Math.round(call.duration_ms / 1000);
    } else if (call.duration_seconds) {
      durationSeconds = call.duration_seconds;
    } else if (call.start_timestamp && call.end_timestamp) {
      durationSeconds = Math.round((call.end_timestamp - call.start_timestamp) / 1000);
    }

    const durationMinutes = Math.round((durationSeconds / 60) * 100) / 100;

    let transcript = call.transcript || '';
    if (!transcript && Array.isArray(call.transcript_object)) {
      transcript = call.transcript_object
        .map((t: any) => `${t.role === 'agent' ? 'AI' : 'Customer'}: ${t.content}`)
        .join('\n');
    }

    return {
      callId,
      fromNumber,
      toNumber,
      startedAt: call.start_timestamp ? new Date(call.start_timestamp).toISOString() : new Date().toISOString(),
      endedAt: call.end_timestamp ? new Date(call.end_timestamp).toISOString() : new Date().toISOString(),
      durationSeconds,
      durationMinutes,
      transcript,
      recordingUrl: call.recording_url,
      disconnectionReason: call.disconnection_reason,
      metadata: call.metadata,
    };
  }

  formatInboundResponse(agentConfig: VoiceAgentConfig): any {
    return {
      override_agent: {
        agent_name: agentConfig.agentName,
        prompt: agentConfig.systemPrompt,
        begin_message: agentConfig.greeting || 'Hello! How can I help you today?',
        voice_id: agentConfig.voiceId || '11labs-Adrian',
        temperature: agentConfig.temperature ?? 0.3,
        tools: agentConfig.tools || [],
      },
    };
  }

  formatToolResponse(toolCallId: string | undefined, result: any): any {
    return {
      tool_call_id: toolCallId,
      result: typeof result === 'string' ? result : JSON.stringify(result),
    };
  }

  formatErrorResponse(toolCallId: string | undefined, errorMessage: string): any {
    return {
      tool_call_id: toolCallId,
      error: errorMessage,
    };
  }

  async provisionNumber(params: { areaCode?: string; country?: string }): Promise<{ phoneNumber: string; providerPhoneNumberId: string }> {
    if (!config.voice.retellApiKey || config.voice.retellApiKey.includes('placeholder')) {
      throw new Error('Retell API is not configured. Please set RETELL_API_KEY in environment variables.');
    }

    // Official Retell Number Purchase API call
    const res = await fetch('https://api.retellai.com/create-phone-number', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.voice.retellApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        area_code: params.areaCode ? parseInt(params.areaCode, 10) : undefined,
        country: params.country || 'US',
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(`Retell phone number creation failed: ${err.message || res.statusText}`);
    }

    const data: any = await res.json();
    return {
      phoneNumber: data.phone_number,
      providerPhoneNumberId: data.phone_number_id || data.id,
    };
  }
}
