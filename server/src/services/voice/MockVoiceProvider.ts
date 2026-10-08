import { IVoiceProvider, InboundCallEvent, VoiceToolCallEvent, CallEndedEvent, VoiceAgentConfig } from './VoiceProvider';

export class MockVoiceProvider implements IVoiceProvider {
  readonly providerName = 'MOCK_VOICE';

  private mockPhoneCounter = 1000;
  public lastInboundConfig: VoiceAgentConfig | null = null;
  public lastToolExecutionResult: any = null;

  verifyWebhookSignature(_rawBody: string | Buffer, _signature: string | undefined, _secret?: string): boolean {
    // In mock mode for testing, permit test calls unless signature is explicitly 'invalid_sig'
    if (_signature === 'invalid_signature_test') {
      return false;
    }
    return true;
  }

  parseInboundCall(payload: any): InboundCallEvent {
    return {
      callId: payload.call_id || payload.callId || `mock_call_${Date.now()}`,
      fromNumber: payload.from_number || payload.fromNumber || '+15550001111',
      toNumber: payload.to_number || payload.toNumber || '+15550009999',
      provider: this.providerName,
      metadata: payload.metadata || {},
    };
  }

  parseToolCall(payload: any): VoiceToolCallEvent {
    return {
      callId: payload.call_id || payload.callId || `mock_call_${Date.now()}`,
      toolCallId: payload.tool_call_id || payload.toolCallId || `tc_${Date.now()}`,
      toolName: payload.name || payload.tool_name || payload.toolName || '',
      args: payload.args || payload.parameters || payload.arguments || {},
    };
  }

  parseCallEnded(payload: any): CallEndedEvent {
    const durationSec = payload.duration_seconds ?? payload.durationSeconds ?? 90;
    const durationMin = Math.round((durationSec / 60) * 100) / 100;

    return {
      callId: payload.call_id || payload.callId || `mock_call_${Date.now()}`,
      fromNumber: payload.from_number || payload.fromNumber || '+15550001111',
      toNumber: payload.to_number || payload.toNumber || '+15550009999',
      startedAt: payload.started_at || payload.startedAt || new Date(Date.now() - durationSec * 1000).toISOString(),
      endedAt: payload.ended_at || payload.endedAt || new Date().toISOString(),
      durationSeconds: durationSec,
      durationMinutes: durationMin,
      transcript: payload.transcript || 'AI: Hello! How can I help you?\nCustomer: I want to book an appointment.',
      recordingUrl: payload.recording_url || payload.recordingUrl || 'https://mock.voice.onceclic.com/recordings/mock_123.mp3',
      disconnectionReason: payload.disconnection_reason || 'user_hangup',
      metadata: payload.metadata,
    };
  }

  formatInboundResponse(agentConfig: VoiceAgentConfig): any {
    this.lastInboundConfig = agentConfig;
    return {
      success: true,
      provider: this.providerName,
      agent_name: agentConfig.agentName,
      prompt: agentConfig.systemPrompt,
      begin_message: agentConfig.greeting,
      tools: agentConfig.tools || [],
    };
  }

  formatToolResponse(toolCallId: string | undefined, result: any): any {
    this.lastToolExecutionResult = result;
    return {
      success: true,
      tool_call_id: toolCallId,
      result,
    };
  }

  formatErrorResponse(toolCallId: string | undefined, errorMessage: string): any {
    return {
      success: false,
      tool_call_id: toolCallId,
      error: errorMessage,
    };
  }

  async provisionNumber(params: { areaCode?: string; country?: string }): Promise<{ phoneNumber: string; providerPhoneNumberId: string }> {
    const area = params.areaCode || '415';
    this.mockPhoneCounter++;
    const num = `+1${area}555${this.mockPhoneCounter.toString().padStart(4, '0')}`;
    return {
      phoneNumber: num,
      providerPhoneNumberId: `mock_pn_${Date.now()}_${this.mockPhoneCounter}`,
    };
  }
}
