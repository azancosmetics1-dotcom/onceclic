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
  }): Promise<{ vapiPhoneNumberId: string; phoneNumber: string; assistantId?: string }>;

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
    /**
     * The Telnyx number ORDER ID (data.id from POST /v2/number_orders).
     * Used for order tracking and status polling only.
     * NOT valid as a path parameter for PATCH /v2/phone_numbers/{id}.
     */
    telnyxOrderId: string;
    /**
     * The confirmed E.164 phone number string from the order response
     * (data.phone_numbers[0].phone_number). Used for all downstream routing.
     */
    phoneNumber: string;
    /**
     * The Telnyx phone-number RESOURCE ID, required for PATCH /v2/phone_numbers/{id}.
     * This is resolved by calling GET /v2/phone_numbers after the order completes.
     * May be null if the number is still being provisioned; in that case,
     * configureRoutingToVapi will attempt to resolve it via API lookup.
     */
    telnyxPhoneNumberResourceId: string | null;
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
    /**
     * The Telnyx phone-number RESOURCE ID (from GET /v2/phone_numbers lookup).
     * If not yet known, pass null and provide phoneNumber for lookup.
     */
    telnyxPhoneNumberId: string | null;
    /** The E.164 phone number string (used for resource ID lookup if telnyxPhoneNumberId is null). */
    phoneNumber: string;
    vapiSipUri?: string;
  }): Promise<{ success: boolean; telnyxPhoneNumberResourceId: string | null }>;

  verifyWebhookSignature?(params: {
    rawBody: string | Buffer;
    signature?: string;
    timestamp?: string;
    publicKey?: string;
  }): boolean;
}
