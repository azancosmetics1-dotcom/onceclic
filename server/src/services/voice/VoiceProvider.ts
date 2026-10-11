import { AvailablePhoneNumber } from '@onceclic/shared';

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

  createOrUpdateAssistant?(config: VoiceAgentConfig): Promise<{ assistantId: string }>;

  linkPhoneNumberToAssistant?(params: { phoneNumberIdOrNumber: string; assistantId: string }): Promise<boolean>;

  simulateTestCall?(params: { organizationId: string; phoneNumber: string; assistantId?: string }): Promise<{
    success: boolean;
    durationSeconds: number;
    transcript: string;
    summary: string;
  }>;
}

export interface ITelephonyProvider {
  readonly providerName: string;

  searchAvailableNumbers(params: {
    countryCode: string;
    numberType?: string;
    areaCode?: string;
    limit?: number;
  }): Promise<AvailablePhoneNumber[]>;

  provisionNumber(params: {
    organizationId: string;
    phoneNumber: string;
    countryCode: string;
    numberType?: string;
    idempotencyKey?: string;
  }): Promise<{
    telnyxPhoneNumberId: string;
    phoneNumber: string;
    monthlyCostUsd: number;
    setupCostUsd: number;
    regulatoryStatus: 'NOT_REQUIRED' | 'PENDING_DOCUMENTATION' | 'APPROVED';
    requiredDocuments: string[];
  }>;

  verifyExistingNumberOwnership(params: {
    phoneNumber: string;
    code?: string;
  }): Promise<{
    verified: boolean;
    codeSent?: boolean;
    message: string;
  }>;

  configureRoutingToVapi(params: {
    telnyxPhoneNumberId: string;
    phoneNumber: string;
    vapiSipUri?: string;
  }): Promise<boolean>;

  verifyWebhookSignature?(params: {
    rawBody: string | Buffer;
    signature?: string;
    timestamp?: string;
    publicKey?: string;
  }): boolean;
}
