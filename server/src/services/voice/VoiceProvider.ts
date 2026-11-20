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
  durationMinutes?: number;
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
  maxDurationSeconds?: number;
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

  terminateCall?(callId: string): Promise<boolean>;

  provisionNumber?(params: { areaCode?: string; country?: string }): Promise<{ phoneNumber: string; providerPhoneNumberId: string }>;

  createOrUpdateAssistant?(config: VoiceAgentConfig): Promise<{ assistantId: string }>;

  importPhoneNumber?(params: {
    phoneNumber: string;
    assistantId?: string;
    name?: string;
    telephonyProvider?: 'telnyx' | 'byo-phone-number' | string;
    telnyxApiKey?: string;
    credentialId?: string;
  }): Promise<{ vapiPhoneNumberId: string; phoneNumber: string; assistantId?: string }>;

  linkPhoneNumberToAssistant?(params: { phoneNumberIdOrNumber: string; assistantId: string }): Promise<boolean>;

  deletePhoneNumber?(phoneNumberId: string): Promise<boolean>;

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
    city?: string;
    state?: string;
    limit?: number;
  }): Promise<AvailablePhoneNumber[]>;

  provisionNumber(params: {
    organizationId: string;
    phoneNumber: string;
    countryCode: string;
    numberType?: string;
    idempotencyKey?: string;
  }): Promise<{
    telnyxOrderId?: string;
    signalwireNumberSid?: string;
    signalwireOrderId?: string;
    phoneNumber: string;
    telnyxPhoneNumberResourceId?: string | null;
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
    telnyxPhoneNumberId?: string | null;
    signalwireNumberSid?: string | null;
    phoneNumber: string;
    vapiSipUri?: string;
    vapiAssistantId?: string;
  }): Promise<{ success: boolean; telnyxPhoneNumberResourceId?: string | null; signalwireNumberSid?: string | null }>;

  releaseNumber?(params: {
    phoneNumber: string;
    telnyxPhoneNumberId?: string | null;
    signalwireNumberSid?: string | null;
  }): Promise<boolean>;

  queryExistingNumber?(params: {
    phoneNumber: string;
    organizationId?: string;
  }): Promise<{
    found: boolean;
    telnyxPhoneNumberResourceId?: string | null;
    signalwireNumberSid?: string | null;
    customerReference?: string;
    status?: string;
    belongsToOrganization?: boolean;
  }>;

  verifyWebhookSignature?(params: {
    rawBody: string | Buffer;
    signature?: string;
    timestamp?: string;
    publicKey?: string;
    url?: string;
  }): boolean;
}
