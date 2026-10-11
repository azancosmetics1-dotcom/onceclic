import {
  ITelephonyProvider,
} from './VoiceProvider';
import {
  AvailablePhoneNumber,
  SUPPORTED_TELEPHONY_COUNTRIES,
  VoicePhoneNumberType,
} from '@onceclic/shared';

export class MockTelephonyProvider implements ITelephonyProvider {
  readonly providerName = 'MOCK_TELNYX';

  // In-memory registry to test idempotency and duplicate prevention
  private provisionedNumbers: Map<string, any> = new Map();
  private idempotencyCache: Map<string, any> = new Map();
  private mockCounter = 5000;

  // Verification codes for existing numbers
  private verificationCodes: Map<string, string> = new Map();

  // Simulated failure flag for test purposes
  public simulateProvisionFailure: boolean = false;
  public simulateVapiRoutingFailure: boolean = false;

  async searchAvailableNumbers(params: {
    countryCode: string;
    numberType?: string;
    areaCode?: string;
    limit?: number;
  }): Promise<AvailablePhoneNumber[]> {
    const country = (params.countryCode || 'US').toUpperCase().trim();
    const countryConfig = SUPPORTED_TELEPHONY_COUNTRIES[country];

    if (!countryConfig) {
      throw new Error(`Country "${country}" is currently not supported for direct phone provisioning. Supported countries: ${Object.keys(SUPPORTED_TELEPHONY_COUNTRIES).join(', ')}.`);
    }

    const type = (params.numberType || countryConfig.supportedNumberTypes[0]).toLowerCase() as 'local' | 'toll_free' | 'national' | 'mobile';
    if (!countryConfig.supportedNumberTypes.includes(type)) {
      throw new Error(`Number type "${type}" is not supported in ${countryConfig.countryName}. Supported types: ${countryConfig.supportedNumberTypes.join(', ')}.`);
    }

    const limit = Math.min(params.limit || 5, 20);
    const results: AvailablePhoneNumber[] = [];
    const monthlyCost = countryConfig.monthlyCostUsd[type] || 2.00;
    const setupCost = countryConfig.setupCostUsd[type] || 0.00;

    const baseArea = params.areaCode || (country === 'US' ? '415' : country === 'CA' ? '416' : country === 'GB' ? '20' : country === 'DE' ? '30' : country === 'AU' ? '2' : '1');

    for (let i = 0; i < limit; i++) {
      this.mockCounter++;
      let e164 = '';
      let nationalFormat = '';

      if (country === 'US') {
        const area = params.areaCode || '415';
        e164 = `+1${area}555${this.mockCounter.toString().padStart(4, '0')}`;
        nationalFormat = `(${area}) 555-${this.mockCounter.toString().padStart(4, '0')}`;
      } else if (country === 'CA') {
        const area = params.areaCode || '416';
        e164 = `+1${area}555${this.mockCounter.toString().padStart(4, '0')}`;
        nationalFormat = `(${area}) 555-${this.mockCounter.toString().padStart(4, '0')}`;
      } else if (country === 'GB') {
        e164 = `+44207946${(this.mockCounter % 1000).toString().padStart(4, '0')}`;
        nationalFormat = `020 7946 ${(this.mockCounter % 1000).toString().padStart(4, '0')}`;
      } else if (country === 'DE') {
        e164 = `+49302${(this.mockCounter % 10000).toString().padStart(5, '0')}`;
        nationalFormat = `030 2${(this.mockCounter % 10000).toString().padStart(5, '0')}`;
      } else if (country === 'AU') {
        e164 = `+6129876${(this.mockCounter % 1000).toString().padStart(4, '0')}`;
        nationalFormat = `(02) 9876 ${(this.mockCounter % 1000).toString().padStart(4, '0')}`;
      } else if (country === 'FR') {
        e164 = `+3314050${(this.mockCounter % 1000).toString().padStart(4, '0')}`;
        nationalFormat = `01 40 50 ${(this.mockCounter % 1000).toString().padStart(4, '0')}`;
      } else {
        e164 = `${countryConfig.dialCode}${baseArea}${this.mockCounter}`;
        nationalFormat = `${baseArea} ${this.mockCounter}`;
      }

      results.push({
        phoneNumber: e164,
        nationalFormat,
        countryCode: country,
        numberType: type,
        region: countryConfig.countryName,
        monthlyCostUsd: monthlyCost,
        setupCostUsd: setupCost,
        regulatoryRequirement: countryConfig.regulatoryNotice,
        requiresDocuments: countryConfig.regulatoryLevel !== 'NONE',
        requiredDocuments: countryConfig.requiredDocuments,
      });
    }

    return results;
  }

  async provisionNumber(params: {
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
  }> {
    if (this.simulateProvisionFailure) {
      throw new Error('Simulated Telnyx telephony provisioning failure: Number unavailable or carrier timeout.');
    }

    // Idempotency check: if request was already executed, return cached order
    if (params.idempotencyKey && this.idempotencyCache.has(params.idempotencyKey)) {
      return this.idempotencyCache.get(params.idempotencyKey);
    }

    // Duplicate purchase prevention: cannot purchase a number that is already provisioned
    if (this.provisionedNumbers.has(params.phoneNumber)) {
      throw new Error(`Phone number ${params.phoneNumber} has already been provisioned and is active. Duplicate purchase blocked.`);
    }

    const country = (params.countryCode || 'US').toUpperCase().trim();
    const countryConfig = SUPPORTED_TELEPHONY_COUNTRIES[country];
    if (!countryConfig) {
      throw new Error(`Unsupported country for telephony provisioning: ${country}`);
    }

    const type = (params.numberType || 'local').toLowerCase();
    const monthlyCost = countryConfig.monthlyCostUsd[type] || 2.00;
    const setupCost = countryConfig.setupCostUsd[type] || 0.00;

    const regulatoryStatus = countryConfig.regulatoryLevel === 'NONE'
      ? 'NOT_REQUIRED'
      : countryConfig.regulatoryLevel === 'MANUAL_APPROVAL_REQUIRED'
      ? 'PENDING_DOCUMENTATION'
      : 'APPROVED';

    const result = {
      telnyxPhoneNumberId: `telnyx_order_${Date.now()}_${Math.floor(Math.random() * 10000)}`,
      phoneNumber: params.phoneNumber,
      monthlyCostUsd: monthlyCost,
      setupCostUsd: setupCost,
      regulatoryStatus: regulatoryStatus as 'NOT_REQUIRED' | 'PENDING_DOCUMENTATION' | 'APPROVED',
      requiredDocuments: countryConfig.requiredDocuments,
    };

    this.provisionedNumbers.set(params.phoneNumber, result);
    if (params.idempotencyKey) {
      this.idempotencyCache.set(params.idempotencyKey, result);
    }

    return result;
  }

  async verifyExistingNumberOwnership(params: {
    phoneNumber: string;
    code?: string;
  }): Promise<{
    verified: boolean;
    codeSent?: boolean;
    message: string;
  }> {
    const num = params.phoneNumber.trim();

    if (!params.code) {
      // Generate a mock verification challenge code (default '123456' for predictable tests)
      const mockCode = '123456';
      this.verificationCodes.set(num, mockCode);
      return {
        verified: false,
        codeSent: true,
        message: `Verification code sent to ${num}. (Test mode code: ${mockCode})`,
      };
    }

    const expectedCode = this.verificationCodes.get(num) || '123456';
    if (params.code === expectedCode) {
      return {
        verified: true,
        message: 'Phone number ownership verified successfully.',
      };
    }

    return {
      verified: false,
      message: 'Invalid verification code. Please check the code and try again.',
    };
  }

  async configureRoutingToVapi(params: {
    telnyxPhoneNumberId: string;
    phoneNumber: string;
    vapiSipUri?: string;
  }): Promise<boolean> {
    if (this.simulateVapiRoutingFailure) {
      throw new Error('Simulated failure: Telnyx SIP routing to Vapi assistant could not be established.');
    }
    return true;
  }

  verifyWebhookSignature(params: {
    rawBody: string | Buffer;
    signature?: string;
    timestamp?: string;
    publicKey?: string;
  }): boolean {
    if (params.signature === 'invalid_signature_test') return false;
    if (params.timestamp === 'expired_timestamp_test') return false;
    if (!params.signature || !params.timestamp) return false;
    return true;
  }
}
