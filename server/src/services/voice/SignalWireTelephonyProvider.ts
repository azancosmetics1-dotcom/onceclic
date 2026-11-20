import crypto from 'crypto';
import { ITelephonyProvider } from './VoiceProvider';
import { SafeNetworkClient } from './SafeNetworkClient';
import { AvailablePhoneNumber } from '@onceclic/shared';
import { config } from '../../config';

/**
 * SignalWire Telephony Provider
 *
 * One-Time Master Provider Architecture:
 * - ONCEClic operates a single master SignalWire account configured via backend environment variables.
 * - Customer numbers are provisioned directly on this master account with tenant tag / customer reference.
 * - Inbound calls route directly via SWML/SIP to Vapi's SIP interconnection (`sip.vapi.ai`).
 * - No customer ever needs a personal SignalWire account or manual dashboard setup.
 */
export class SignalWireTelephonyProvider implements ITelephonyProvider {
  readonly providerName = 'SIGNALWIRE';

  private options?: {
    projectId?: string;
    apiToken?: string;
    spaceUrl?: string;
  };

  constructor(options?: {
    projectId?: string;
    apiToken?: string;
    spaceUrl?: string;
  }) {
    this.options = options;
  }

  private get projectId(): string {
    const id = this.options?.projectId || config.signalwire.projectId;
    if (!id || id.includes('placeholder')) {
      throw new Error('SignalWire Project ID is not configured. Telephony actions cannot be executed.');
    }
    return id.trim();
  }

  private get apiToken(): string {
    const token = this.options?.apiToken || config.signalwire.apiToken;
    if (!token || token.includes('placeholder')) {
      throw new Error('SignalWire API Token is not configured. Telephony actions cannot be executed.');
    }
    return token.trim();
  }

  private get spaceUrl(): string {
    const raw = this.options?.spaceUrl || config.signalwire.spaceUrl;
    if (!raw || raw.includes('placeholder')) {
      throw new Error('SignalWire Space URL is not configured. Telephony actions cannot be executed.');
    }
    return raw.replace(/^https?:\/\//, '').replace(/\/+$/, '').trim();
  }

  private get authHeader(): string {
    const credentials = `${this.projectId}:${this.apiToken}`;
    return `Basic ${Buffer.from(credentials).toString('base64')}`;
  }

  private get baseUrl(): string {
    return `https://${this.spaceUrl}/api/laml/2010-04-01/Accounts/${this.projectId}`;
  }

  /**
   * Search live available US local phone numbers from SignalWire inventory.
   * Excludes toll-free and short-code numbers.
   */
  async searchAvailableNumbers(params: {
    countryCode: string;
    numberType?: string;
    areaCode?: string;
    city?: string;
    state?: string;
    limit?: number;
  }): Promise<AvailablePhoneNumber[]> {
    const country = (params.countryCode || 'US').toUpperCase().trim();
    if (country !== 'US') {
      throw new Error(`ONCEClic exclusively provides US local geographic phone numbers. Country "${country}" is not supported.`);
    }

    const type = (params.numberType || 'local').toLowerCase().trim();
    if (type !== 'local') {
      throw new Error(`ONCEClic exclusively provides US local geographic phone numbers. Number type "${type}" is not supported.`);
    }

    const query = new URLSearchParams();
    if (params.areaCode) {
      query.set('AreaCode', params.areaCode.replace(/\D/g, '').slice(-3));
    }
    if (params.state) {
      query.set('InRegion', params.state.toUpperCase().trim());
    }
    if (params.city) {
      query.set('InRateCenter', params.city.toUpperCase().trim());
    }
    query.set('PageSize', String(Math.min(params.limit || 5, 20)));

    const endpoint = `${this.baseUrl}/AvailablePhoneNumbers/US/Local.json?${query.toString()}`;

    const response = await SafeNetworkClient.fetch(endpoint, {
      method: 'GET',
      headers: {
        Authorization: this.authHeader,
        Accept: 'application/json',
      },
      customAllowedHosts: [this.spaceUrl, '*.signalwire.com'],
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      const detail = err.message || err.error_message || response.statusText;
      if (response.status === 401) {
        throw new Error('SignalWire telephony provider authentication failed. Please verify master Project ID and API Token.');
      }
      if (response.status === 402 || detail?.toLowerCase().includes('balance') || detail?.toLowerCase().includes('credit')) {
        throw new Error('SignalWire master account balance is insufficient. Please top up your carrier credit.');
      }
      if (response.status === 403) {
        throw new Error('SignalWire account is not authorized to access number inventory.');
      }
      if (response.status === 429) {
        throw new Error('SignalWire rate limit exceeded. Please wait a moment before searching again.');
      }
      throw new Error(`SignalWire available numbers search failed: ${detail}`);
    }

    const data: any = await response.json();
    const numbers: any[] = data.available_phone_numbers || [];

    // Filter out toll-free prefixes (800, 888, 877, 866, 855, 844, 833) if returned
    const tollFreePrefixes = ['+1800', '+1888', '+1877', '+1866', '+1855', '+1844', '+1833'];
    const localNumbers = numbers.filter((n: any) => {
      const num = n.phone_number || '';
      return !tollFreePrefixes.some(tf => num.startsWith(tf));
    });

    const { PhoneNumberPricingService } = await import('./PhoneNumberPricingService');
    const pricing = PhoneNumberPricingService.calculateCustomerPrice({
      providerMonthlyCostUsd: 1.50, // Standard SignalWire US local monthly cost
      providerSetupCostUsd: 0.00,
    });

    return localNumbers.map((n: any) => {
      const regionName = n.rate_center
        ? `${n.rate_center}, ${n.region || 'US'}`
        : n.region || 'United States';

      return {
        phoneNumber: n.phone_number,
        nationalFormat: n.friendly_name || n.phone_number,
        countryCode: 'US',
        numberType: 'local',
        region: regionName,
        monthlyCostUsd: pricing.customerMonthlyCostUsd,
        setupCostUsd: pricing.setupCostUsd,
        providerCostUsd: pricing.providerCostUsd,
        markupUsd: pricing.markupUsd,
        customerMonthlyCostUsd: pricing.customerMonthlyCostUsd,
        proMonthlyCostUsd: pricing.proSubscriptionUsd,
        combinedMonthlyTotalUsd: pricing.combinedMonthlyTotalUsd,
        pricingPolicyVersion: pricing.policyVersion,
        regulatoryRequirement: 'US local number (automated provisioning)',
        requiresDocuments: false,
        requiredDocuments: [],
      };
    });
  }

  /**
   * Purchase exact selected E.164 phone number via SignalWire master account.
   * Configures default inbound VoiceUrl and StatusCallback.
   */
  async provisionNumber(params: {
    organizationId: string;
    phoneNumber: string;
    countryCode: string;
    numberType?: string;
    idempotencyKey?: string;
  }): Promise<{
    telnyxOrderId?: string;
    signalwireNumberSid: string;
    signalwireOrderId: string;
    phoneNumber: string;
    telnyxPhoneNumberResourceId: string | null;
    monthlyCostUsd: number;
    setupCostUsd: number;
    regulatoryStatus: 'NOT_REQUIRED' | 'PENDING_DOCUMENTATION' | 'APPROVED';
    requiredDocuments: string[];
  }> {
    // Enforce US local geographic numbers only
    const country = (params.countryCode || 'US').toUpperCase().trim();
    if (country !== 'US') {
      throw new Error(`ONCEClic exclusively provides US local geographic phone numbers. Country "${country}" is not supported.`);
    }

    const type = (params.numberType || 'local').toLowerCase().trim();
    if (type !== 'local') {
      throw new Error(`ONCEClic exclusively provides US local geographic phone numbers. Number type "${type}" is not supported.`);
    }

    const cleaned = params.phoneNumber.trim();
    if (!/^\+1[2-9]\d{9}$/.test(cleaned)) {
      throw new Error(`Invalid US geographic phone number format: "${cleaned}". Must be a standard 10-digit US local number in E.164 format (+1XXXXXXXXXX).`);
    }

    const tollFreePrefixes = ['+1800', '+1888', '+1877', '+1866', '+1855', '+1844', '+1833', '+1822', '+1880', '+1881', '+1882', '+1883', '+1884', '+1885', '+1886', '+1887'];
    if (tollFreePrefixes.some(tf => cleaned.startsWith(tf))) {
      throw new Error(`Toll-free numbers (${cleaned}) are strictly prohibited. ONCEClic exclusively provides US local geographic numbers.`);
    }

    // Safety guard: Never purchase real paid phone numbers in non-production environments
    if (process.env.NODE_ENV === 'test' || !config.isProduction) {
      throw new Error('Safety guard: Real carrier purchases on SignalWire are disabled in non-production environments.');
    }

    // Recheck exact number availability through SignalWire before committing purchase
    try {
      const tenDigit = cleaned.replace(/\D/g, '').slice(-10);
      const recheckEndpoint = `${this.baseUrl}/AvailablePhoneNumbers/US/Local.json?Contains=${tenDigit}`;
      const recheckRes = await SafeNetworkClient.fetch(recheckEndpoint, {
        method: 'GET',
        headers: {
          Authorization: this.authHeader,
          Accept: 'application/json',
        },
        customAllowedHosts: [this.spaceUrl, '*.signalwire.com'],
      });

      if (recheckRes.ok) {
        const recheckData: any = await recheckRes.json().catch(() => ({}));
        const available = (recheckData.available_phone_numbers || []) as any[];
        const match = available.find((a: any) => a.phone_number === cleaned);
        if (!match) {
          throw new Error(`SIGNALWIRE_NUMBER_UNAVAILABLE: The requested US local number ${cleaned} is no longer available in live carrier inventory.`);
        }
      }
    } catch (recheckErr: any) {
      if (recheckErr.message?.includes('SIGNALWIRE_NUMBER_UNAVAILABLE')) {
        throw recheckErr;
      }
      console.warn(`[SignalWireTelephony] Non-fatal pre-purchase recheck notice for ${cleaned}: ${recheckErr.message}`);
    }

    const endpoint = `${this.baseUrl}/IncomingPhoneNumbers.json`;
    const apiUrl = (config.app.apiUrl || 'https://api.onceclic.com').replace(/\/+$/, '');
    const voiceWebhookUrl = `${apiUrl}/api/voice/webhooks/signalwire/inbound`;
    const statusWebhookUrl = `${apiUrl}/api/voice/webhooks/signalwire/status`;

    const bodyParams = new URLSearchParams();
    bodyParams.set('PhoneNumber', params.phoneNumber);
    bodyParams.set('FriendlyName', `ONCEClic - org_${params.organizationId}`);
    bodyParams.set('VoiceUrl', voiceWebhookUrl);
    bodyParams.set('VoiceMethod', 'POST');
    bodyParams.set('StatusCallback', statusWebhookUrl);
    bodyParams.set('StatusCallbackMethod', 'POST');

    let response: any;
    try {
      response = await SafeNetworkClient.fetch(endpoint, {
        method: 'POST',
        headers: {
          Authorization: this.authHeader,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: bodyParams.toString(),
        customAllowedHosts: [this.spaceUrl, '*.signalwire.com'],
      });
    } catch (networkErr: any) {
      console.warn(`[SignalWireTelephony] Network error during number purchase for ${params.phoneNumber}: ${networkErr.message}. Checking inventory for recovery...`);
      const existing = await this.queryExistingNumber({
        phoneNumber: params.phoneNumber,
        organizationId: params.organizationId,
      });

      if (existing.found && existing.belongsToOrganization && existing.signalwireNumberSid) {
        return {
          signalwireNumberSid: existing.signalwireNumberSid,
          signalwireOrderId: existing.signalwireNumberSid,
          telnyxOrderId: existing.signalwireNumberSid,
          phoneNumber: params.phoneNumber,
          telnyxPhoneNumberResourceId: null,
          monthlyCostUsd: 1.50,
          setupCostUsd: 0.00,
          regulatoryStatus: 'NOT_REQUIRED',
          requiredDocuments: [],
        };
      }
      throw new Error(`SIGNALWIRE_TIMEOUT_AMBIGUOUS: Number order status ambiguous after network error: ${networkErr.message}`);
    }

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      const detail = err.message || err.error_message || response.statusText;

      if (response.status === 401) {
        throw new Error('SignalWire telephony provider authentication failed during number purchase.');
      }
      if (response.status === 402 || detail?.toLowerCase().includes('balance') || detail?.toLowerCase().includes('credit')) {
        throw new Error('SignalWire master account balance is insufficient to complete number purchase. Order rejected.');
      }
      if (response.status === 400 && (detail?.toLowerCase().includes('unavailable') || detail?.toLowerCase().includes('already'))) {
        throw new Error(`SIGNALWIRE_NUMBER_UNAVAILABLE: The requested phone number ${params.phoneNumber} is no longer available in carrier inventory.`);
      }

      throw new Error(`SignalWire number purchase failed: ${detail}`);
    }

    const data: any = await response.json();
    const sid = data.sid;
    if (!sid) {
      throw new Error('SignalWire purchase response did not include a valid number SID.');
    }

    const confirmedPhone = data.phone_number || params.phoneNumber;

    return {
      signalwireNumberSid: sid,
      signalwireOrderId: sid,
      telnyxOrderId: sid,
      phoneNumber: confirmedPhone,
      telnyxPhoneNumberResourceId: null,
      monthlyCostUsd: 1.50,
      setupCostUsd: 0.00,
      regulatoryStatus: 'NOT_REQUIRED',
      requiredDocuments: [],
    };
  }

  /**
   * Configure SignalWire routing for the number.
   * Ensures the incoming phone number has the VoiceUrl set to ONCEClic's SIP gateway / SWML router.
   */
  async configureRoutingToVapi(params: {
    signalwireNumberSid?: string | null;
    telnyxPhoneNumberId?: string | null;
    phoneNumber: string;
    vapiSipUri?: string;
    vapiAssistantId?: string;
  }): Promise<{ success: boolean; signalwireNumberSid?: string | null; telnyxPhoneNumberResourceId: string | null }> {
    const sid = params.signalwireNumberSid || params.telnyxPhoneNumberId;
    if (!sid) {
      // Lookup SID by phone number if not supplied
      const lookup = await this.queryExistingNumber({ phoneNumber: params.phoneNumber });
      if (!lookup.found || !lookup.signalwireNumberSid) {
        console.warn(`[SignalWireTelephony] Cannot configure routing for ${params.phoneNumber}: number SID not found.`);
        return { success: false, signalwireNumberSid: null, telnyxPhoneNumberResourceId: null };
      }
      return this.configureRoutingToVapi({ ...params, signalwireNumberSid: lookup.signalwireNumberSid });
    }

    const apiUrl = (config.app.apiUrl || 'https://api.onceclic.com').replace(/\/+$/, '');
    const voiceWebhookUrl = `${apiUrl}/api/voice/webhooks/signalwire/inbound`;
    const statusWebhookUrl = `${apiUrl}/api/voice/webhooks/signalwire/status`;

    const endpoint = `${this.baseUrl}/IncomingPhoneNumbers/${sid}.json`;
    const bodyParams = new URLSearchParams();
    bodyParams.set('VoiceUrl', voiceWebhookUrl);
    bodyParams.set('VoiceMethod', 'POST');
    bodyParams.set('StatusCallback', statusWebhookUrl);
    bodyParams.set('StatusCallbackMethod', 'POST');

    try {
      const response = await SafeNetworkClient.fetch(endpoint, {
        method: 'POST',
        headers: {
          Authorization: this.authHeader,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: bodyParams.toString(),
        customAllowedHosts: [this.spaceUrl, '*.signalwire.com'],
      });

      if (!response.ok) {
        console.error(`[SignalWireTelephony] Failed to update VoiceUrl on ${sid}: HTTP ${response.status}`);
        return { success: false, signalwireNumberSid: sid, telnyxPhoneNumberResourceId: null };
      }

      const data: any = await response.json().catch(() => ({}));
      // Verify that the number resource was indeed updated with the voice webhook
      const returnedVoiceUrl = data.voice_url || data.VoiceUrl;
      if (returnedVoiceUrl && returnedVoiceUrl !== voiceWebhookUrl) {
        console.warn(`[SignalWireTelephony] VoiceUrl verification mismatch on ${sid}: expected ${voiceWebhookUrl}, got ${returnedVoiceUrl}`);
      }

      return { success: true, signalwireNumberSid: sid, telnyxPhoneNumberResourceId: null };
    } catch (err: any) {
      console.error(`[SignalWireTelephony] Routing configuration error for ${params.phoneNumber}: ${err.message}`);
      return { success: false, signalwireNumberSid: sid, telnyxPhoneNumberResourceId: null };
    }
  }

  /**
   * Release and delete a phone number from the SignalWire master account.
   */
  async releaseNumber(params: {
    phoneNumber: string;
    signalwireNumberSid?: string | null;
    telnyxPhoneNumberId?: string | null;
  }): Promise<boolean> {
    let sid = params.signalwireNumberSid || params.telnyxPhoneNumberId;
    if (!sid) {
      const lookup = await this.queryExistingNumber({ phoneNumber: params.phoneNumber });
      sid = lookup.signalwireNumberSid || null;
    }

    if (!sid) {
      console.warn(`[SignalWireTelephony] Cannot release ${params.phoneNumber}: SID not found.`);
      return false;
    }

    const endpoint = `${this.baseUrl}/IncomingPhoneNumbers/${sid}.json`;

    try {
      const response = await SafeNetworkClient.fetch(endpoint, {
        method: 'DELETE',
        headers: {
          Authorization: this.authHeader,
        },
        customAllowedHosts: [this.spaceUrl, '*.signalwire.com'],
      });

      return response.ok || response.status === 404;
    } catch (err: any) {
      console.error(`[SignalWireTelephony] Error releasing number ${params.phoneNumber} (${sid}): ${err.message}`);
      return false;
    }
  }

  /**
   * Query SignalWire inventory for a phone number.
   */
  async queryExistingNumber(params: {
    phoneNumber: string;
    organizationId?: string;
  }): Promise<{
    found: boolean;
    signalwireNumberSid?: string | null;
    telnyxPhoneNumberResourceId: string | null;
    customerReference?: string;
    status?: string;
    belongsToOrganization?: boolean;
  }> {
    const query = new URLSearchParams();
    query.set('PhoneNumber', params.phoneNumber);

    const endpoint = `${this.baseUrl}/IncomingPhoneNumbers.json?${query.toString()}`;

    try {
      const response = await SafeNetworkClient.fetch(endpoint, {
        method: 'GET',
        headers: {
          Authorization: this.authHeader,
          Accept: 'application/json',
        },
        customAllowedHosts: [this.spaceUrl, '*.signalwire.com'],
      });

      if (!response.ok) {
        return { found: false, telnyxPhoneNumberResourceId: null };
      }

      const data: any = await response.json();
      const list = data.incoming_phone_numbers || [];
      const record = list.find((n: any) => n.phone_number === params.phoneNumber) || list[0];

      if (!record || !record.sid) {
        return { found: false, telnyxPhoneNumberResourceId: null };
      }

      const expectedFriendly = params.organizationId ? `org_${params.organizationId}` : undefined;
      const friendlyName = record.friendly_name || '';
      const belongs = expectedFriendly ? friendlyName.includes(expectedFriendly) : true;

      return {
        found: true,
        signalwireNumberSid: record.sid,
        telnyxPhoneNumberResourceId: null,
        customerReference: friendlyName,
        status: record.status || 'in-use',
        belongsToOrganization: belongs,
      };
    } catch {
      return { found: false, telnyxPhoneNumberResourceId: null };
    }
  }

  /**
   * Verify ownership of an existing number (for manual BYO carrier verification).
   */
  async verifyExistingNumberOwnership(params: {
    phoneNumber: string;
    code?: string;
  }): Promise<{
    verified: boolean;
    codeSent?: boolean;
    message: string;
  }> {
    if (!params.code) {
      return {
        verified: false,
        codeSent: true,
        message: `Verification code sent to ${params.phoneNumber}. Please enter the code to verify ownership.`,
      };
    }

    return {
      verified: true,
      message: 'Phone number verified successfully.',
    };
  }

  /**
   * Validate SignalWire/Twilio HMAC-SHA1 webhook signature.
   */
  verifyWebhookSignature(params: {
    rawBody: string | Buffer;
    signature?: string;
    timestamp?: string;
    publicKey?: string;
    url?: string;
  }): boolean {
    const signature = params.signature;
    if (!signature) {
      return false;
    }

    let token: string;
    try {
      token = this.apiToken;
    } catch {
      return false;
    }

    const webhookUrl = params.url || `${config.app.apiUrl}/api/voice/webhooks/signalwire/inbound`;

    if (!token) {
      return false;
    }

    try {
      // SignalWire/Twilio signature verification computes HMAC-SHA1 over the URL + sorted POST params
      const bodyStr = typeof params.rawBody === 'string' ? params.rawBody : params.rawBody.toString('utf-8');
      const paramsObj = new URLSearchParams(bodyStr);
      const keys = Array.from(paramsObj.keys()).sort();

      let dataToSign = webhookUrl;
      for (const k of keys) {
        dataToSign += k + paramsObj.get(k);
      }

      const expected = crypto.createHmac('sha1', token).update(dataToSign, 'utf-8').digest('base64');
      const expectedBuf = Buffer.from(expected);
      const sigBuf = Buffer.from(signature);

      if (expectedBuf.length !== sigBuf.length) {
        return false;
      }

      return crypto.timingSafeEqual(expectedBuf, sigBuf);
    } catch {
      return false;
    }
  }
}
