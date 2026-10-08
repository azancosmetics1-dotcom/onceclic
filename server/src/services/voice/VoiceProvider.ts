export interface InboundCallEvent {
  callId: string;
  fromNumber: string;
  toNumber: string;
  provider: string;
  metadata?: Record<string, any>;
}

export interface VoiceToolCallEvent {
  callId: string;
  toolCallId?: string;
  toolName: string;
  args: Record<string, any>;
}

export interface CallEndedEvent {
  callId: string;
  fromNumber?: string;
  toNumber?: string;
  startedAt?: string;
  endedAt?: string;
  durationSeconds: number;
  durationMinutes: number;
  transcript?: string;
  recordingUrl?: string;
  disconnectionReason?: string;
  metadata?: Record<string, any>;
}

export interface VoiceAgentConfig {
  agentName: string;
  systemPrompt: string;
  greeting?: string;
  voiceId?: string;
  temperature?: number;
  tools?: any[];
}

export interface IVoiceProvider {
  readonly providerName: string;
  
  verifyWebhookSignature(rawBody: string | Buffer, signature: string | undefined, secret?: string): boolean;
  
  parseInboundCall(payload: any): InboundCallEvent;
  
  parseToolCall(payload: any): VoiceToolCallEvent;
  
  parseCallEnded(payload: any): CallEndedEvent;
  
  formatInboundResponse(config: VoiceAgentConfig): any;
  
  formatToolResponse(toolCallId: string | undefined, result: any): any;
  
  formatErrorResponse(toolCallId: string | undefined, errorMessage: string): any;

  provisionNumber?(params: { areaCode?: string; country?: string }): Promise<{ phoneNumber: string; providerPhoneNumberId: string }>;
}
