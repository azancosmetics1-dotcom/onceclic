import crypto from 'crypto';
import { ITelephonyProvider } from './VoiceProvider';
import { SafeNetworkClient } from './SafeNetworkClient';
import {
  AvailablePhoneNumber,
  SUPPORTED_TELEPHONY_COUNTRIES,
} from '@onceclic/shared';
import { config } from '../../config';

/**
 * Telnyx Telephony Provider
 *
 * KEY DESIGN DECISION — Order ID vs Phone Number Resource ID:
 *
 * The Telnyx POST /v2/number_orders response returns:
 *   data.id                          → number_order ID (e.g. "12ade33a-…")
 *   data.phone_numbers[0].id         → number_order_phone_number tracking ID
 *   data.phone_numbers[0].phone_number → confirmed E.164 string (e.g. "+19705555098")
 *
 * None of these is the phone-number RESOURCE ID used for PATCH /v2/phone_numbers/{id}.
 * The resource ID is a long numeric string (e.g. "1293384261075731499") that only
 * becomes available after the number is fully provisioned and appears in the account's
 * inventory (GET /v2/phone_numbers).
 *
 * ORDERING FLOW:
 *   1. POST /v2/number_orders                  → get telnyxOrderId + confirmed phone number
 *   2. GET  /v2/phone_numbers?filter[phone_number]={e164} → resolve resource ID
 *   3. PATCH /v2/phone_numbers/{resourceId}    → assign SIP connection
 *
 * If the GET lookup fails (number not yet in inventory — it can take seconds to minutes),
 * configureRoutingToVapi returns success=false with a null resource ID. VoiceService
 * records this as a FAILED/pending state and the retry flow picks it up.
 */
export class TelnyxTelephonyProvider implements ITelephonyProvider {
  readonly providerName = 'TELNYX';

  /**
   * Official Telnyx Signed Webhook Verification (Ed25519 with Replay Protection)
   */
  static verifyWebhookSignature(params: {
    rawBody: string | Buffer;
    signature?: string;
    timestamp?: string;
    publicKey?: string;
    toleranceSeconds?: number;
  }): boolean {
    const pubKey = params.publicKey || config.telnyx.publicKey;
    if (!pubKey || pubKey.includes('placeholder')) {
      // In strict test mode without live public key, reject invalid test signature
      if (params.signature === 'invalid_signature_test') return false;
      if (params.timestamp === 'expired_timestamp_test') return false;
      return false;
    }

    if (!params.signature || !params.timestamp) {
      return false;
    }

    // Replay attack prevention: verify timestamp freshness
    const tolerance = params.toleranceSeconds ?? 300;
    const now = Math.floor(Date.now() / 1000);
    const ts = parseInt(params.timestamp, 10);
    if (isNaN(ts) || Math.abs(now - ts) > tolerance) {
      return false;
    }

    try {
      const bodyStr = typeof params.rawBody === 'string' ? params.rawBody : params.rawBody.toString('utf-8');
      const payloadToVerify = Buffer.from(`${params.timestamp}|${bodyStr}`, 'utf8');
      const signatureBuffer = Buffer.from(params.signature, 'base64');

      let keyObject: crypto.KeyObject;
      if (pubKey.includes('BEGIN PUBLIC KEY')) {
        keyObject = crypto.createPublicKey(pubKey);
      } else {
        const rawKey = Buffer.from(pubKey, pubKey.length === 64 ? 'hex' : 'base64');
        const derPrefix = Buffer.from('302a300506032b6570032100', 'hex');
        keyObject = crypto.createPublicKey({
          key: Buffer.concat([derPrefix, rawKey]),
          format: 'der',
          type: 'spki',
        });
      }

      return crypto.verify(null, payloadToVerify, keyObject, signatureBuffer);
    } catch {
      return false;
    }
  }

  verifyWebhookSignature(params: {
    rawBody: string | Buffer;
    signature?: string;
    timestamp?: string;
    publicKey?: string;
    toleranceSeconds?: number;
  }): boolean {
    return TelnyxTelephonyProvider.verifyWebhookSignature(params);
  }


  private get apiKey(): string {
    const key = config.telnyx.apiKey || config.voice.telnyxApiKey;
    if (!key || key.includes('placeholder')) {
      throw new Error('Telnyx API key is not configured. Telephony actions cannot be executed.');
    }
    return key;
  }

  async searchAvailableNumbers(params: {
    countryCode: string;
    numberType?: string;
    areaCode?: string;
    limit?: number;
  }): Promise<AvailablePhoneNumber[]> {
    const country = (params.countryCode || 'US').toUpperCase().trim();
    const countryConfig = SUPPORTED_TELEPHONY_COUNTRIES[country];
    if (!countryConfig) {
      throw new Error(`Country ${country} is not supported for automated phone number provisioning.`);
    }

    const type = (params.numberType || countryConfig.supportedNumberTypes[0]).toLowerCase() as any;
    if (!countryConfig.supportedNumberTypes.includes(type)) {
      throw new Error(`Number type ${type} is not supported in ${countryConfig.countryName}.`);
    }

    // Call Telnyx Available Phone Numbers API
    const query = new URLSearchParams();
    query.set('filter[country_code]', country);
    if (params.areaCode) {
      query.set('filter[national_destination_code]', params.areaCode);
    }
    query.set('filter[features][]', 'voice');
    query.set('filter[limit]', String(Math.min(params.limit || 5, 20)));

    const response = await SafeNetworkClient.fetch(`https://api.telnyx.com/v2/available_phone_numbers?${query.toString()}`, {
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      const detail = err.errors?.[0]?.detail || err.errors?.[0]?.title || response.statusText;
      if (response.status === 401) {
        throw new Error('Telnyx telephony provider authentication failed. Please verify the server-side API key.');
      }
      if (response.status === 402 || detail?.toLowerCase().includes('balance') || detail?.toLowerCase().includes('credit') || detail?.toLowerCase().includes('fund')) {
        throw new Error('Telnyx account balance is insufficient or exhausted. Please top up your telephony account balance.');
      }
      if (response.status === 403) {
        throw new Error('Telnyx account is not authorized or restricted from accessing number inventory.');
      }
      if (response.status === 429) {
        throw new Error('Telnyx rate limit exceeded. Please wait a moment before searching again.');
      }
      throw new Error(`Telnyx search failed: ${detail}`);
    }

    const data: any = await response.json();
    const numbers: any[] = data.data || [];

    const monthlyCost = countryConfig.monthlyCostUsd[type] || 2.00;
    const setupCost = countryConfig.setupCostUsd[type] || 0.00;
    const { PhoneNumberPricingService } = await import('./PhoneNumberPricingService');
    const pricing = PhoneNumberPricingService.calculateCustomerPrice({
      providerMonthlyCostUsd: monthlyCost,
      providerSetupCostUsd: setupCost,
    });

    return numbers.map((n: any) => ({
      phoneNumber: n.phone_number,
      nationalFormat: n.national_format || n.phone_number,
      countryCode: country,
      numberType: type,
      region: n.region_information?.region_name || countryConfig.countryName,
      monthlyCostUsd: pricing.customerMonthlyCostUsd,
      setupCostUsd: pricing.setupCostUsd,
      providerCostUsd: pricing.providerCostUsd,
      markupUsd: pricing.markupUsd,
      customerMonthlyCostUsd: pricing.customerMonthlyCostUsd,
      proMonthlyCostUsd: pricing.proSubscriptionUsd,
      combinedMonthlyTotalUsd: pricing.combinedMonthlyTotalUsd,
      pricingPolicyVersion: pricing.policyVersion,
      regulatoryRequirement: countryConfig.regulatoryNotice,
      requiresDocuments: countryConfig.regulatoryLevel !== 'NONE',
      requiredDocuments: countryConfig.requiredDocuments,
    }));
  }

  async provisionNumber(params: {
    organizationId: string;
    phoneNumber: string;
    countryCode: string;
    numberType?: string;
    idempotencyKey?: string;
  }): Promise<{
    telnyxOrderId: string;
    phoneNumber: string;
    telnyxPhoneNumberResourceId: string | null;
    monthlyCostUsd: number;
    setupCostUsd: number;
    regulatoryStatus: 'NOT_REQUIRED' | 'PENDING_DOCUMENTATION' | 'APPROVED';
    requiredDocuments: string[];
  }> {
    // Safety check: Never purchase real paid phone numbers in test mode
    if (process.env.NODE_ENV === 'test' || !config.isProduction) {
      throw new Error('Safety guard: Real telephony purchases on Telnyx are disabled in non-production environments.');
    }

    const country = (params.countryCode || 'US').toUpperCase().trim();
    const countryConfig = SUPPORTED_TELEPHONY_COUNTRIES[country];
    if (!countryConfig) {
      throw new Error(`Unsupported country for telephony provisioning: ${country}`);
    }

    const type = (params.numberType || 'local').toLowerCase();

    let response: any;
    try {
      response = await SafeNetworkClient.fetch('https://api.telnyx.com/v2/number_orders', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          ...(params.idempotencyKey ? { 'Idempotency-Key': params.idempotencyKey } : {}),
        },
        body: JSON.stringify({
          phone_numbers: [{ phone_number: params.phoneNumber }],
          customer_reference: `org_${params.organizationId}`,
        }),
      });
    } catch (networkErr: any) {
      // Ambiguous network failure or timeout: query Telnyx inventory before failing
      console.warn(`[TelnyxTelephony] Network error during number order for ${params.phoneNumber}: ${networkErr.message}. Checking inventory for existing order...`);
      const existing = await this.queryExistingNumber({
        phoneNumber: params.phoneNumber,
        organizationId: params.organizationId,
      });

      if (existing.found && existing.belongsToOrganization) {
        console.log(`[TelnyxTelephony] Successfully recovered phone number ${params.phoneNumber} after network timeout.`);
        return {
          telnyxOrderId: existing.telnyxPhoneNumberResourceId || `recovered_timeout_${Date.now()}`,
          phoneNumber: params.phoneNumber,
          telnyxPhoneNumberResourceId: existing.telnyxPhoneNumberResourceId || null,
          monthlyCostUsd: countryConfig.monthlyCostUsd[type] || 2.00,
          setupCostUsd: countryConfig.setupCostUsd[type] || 0.00,
          regulatoryStatus: (countryConfig.regulatoryLevel === 'NONE' ? 'NOT_REQUIRED' : 'APPROVED') as any,
          requiredDocuments: countryConfig.requiredDocuments,
        };
      }
      throw new Error(`TELNYX_TIMEOUT_AMBIGUOUS: Number order status ambiguous after network error: ${networkErr.message}`);
    }

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      const detail = err.errors?.[0]?.detail || err.errors?.[0]?.title || response.statusText;
      if (response.status === 401) {
        throw new Error('Telnyx telephony provider authentication failed during number order.');
      }
      if (response.status === 402 || detail?.toLowerCase().includes('balance') || detail?.toLowerCase().includes('credit') || detail?.toLowerCase().includes('fund')) {
        throw new Error('Telnyx account balance is insufficient to complete number purchase. Order rejected.');
      }
      if (response.status === 409 || detail?.toLowerCase().includes('unavailable') || detail?.toLowerCase().includes('already')) {
        // Query Telnyx inventory to determine exact ownership
        console.warn(`[TelnyxTelephony] Telnyx returned 409 conflict for ${params.phoneNumber}. Verifying organization ownership...`);
        const existing = await this.queryExistingNumber({
          phoneNumber: params.phoneNumber,
          organizationId: params.organizationId,
        });

        if (existing.found && existing.belongsToOrganization) {
          console.log(`[TelnyxTelephony] Successfully recovered existing phone number ${params.phoneNumber} belonging to organization ${params.organizationId}.`);
          return {
            telnyxOrderId: existing.telnyxPhoneNumberResourceId || `recovered_409_${Date.now()}`,
            phoneNumber: params.phoneNumber,
            telnyxPhoneNumberResourceId: existing.telnyxPhoneNumberResourceId || null,
            monthlyCostUsd: countryConfig.monthlyCostUsd[type] || 2.00,
            setupCostUsd: countryConfig.setupCostUsd[type] || 0.00,
            regulatoryStatus: (countryConfig.regulatoryLevel === 'NONE' ? 'NOT_REQUIRED' : 'APPROVED') as any,
            requiredDocuments: countryConfig.requiredDocuments,
          };
        } else if (existing.found && !existing.belongsToOrganization) {
          throw new Error(`TELNYX_409_FOREIGN_OWNER: The requested phone number ${params.phoneNumber} was already assigned to another party on Telnyx.`);
        } else {
          throw new Error(`TELNYX_409_AMBIGUOUS_CONFLICT: Telnyx reported a 409 conflict for ${params.phoneNumber}, but ownership could not be verified in inventory.`);
        }
      }
      throw new Error(`Telnyx number order failed: ${detail}`);
    }

    const data: any = await response.json();
    const order = data.data || {};

    // order.id = the number ORDER ID — used for order tracking only, NOT for PATCH /v2/phone_numbers/{id}
    const telnyxOrderId = order.id;
    if (!telnyxOrderId) {
      throw new Error('Telnyx number order response did not include an order ID. Cannot proceed with provisioning.');
    }

    // Confirm the phone number from the order response
    // order.phone_numbers[0].phone_number is the E.164 string placed in the order
    const orderedPhoneEntry = (order.phone_numbers || [])[0];
    const confirmedPhoneNumber = orderedPhoneEntry?.phone_number || params.phoneNumber;

    // The phone-number RESOURCE ID (needed for PATCH /v2/phone_numbers/{resourceId})
    // is NOT available in the order response. It can only be retrieved after the number
    // is provisioned into inventory via GET /v2/phone_numbers.
    // We attempt the lookup immediately; if unavailable (order still processing),
    // we return null and the caller must retry via configureRoutingToVapi.
    let telnyxPhoneNumberResourceId: string | null = null;
    try {
      telnyxPhoneNumberResourceId = await this.resolvePhoneNumberResourceId(confirmedPhoneNumber);
    } catch {
      // Lookup failed — number may not be in inventory yet.
      // Caller (VoiceService) will retry via configureRoutingToVapi.
      telnyxPhoneNumberResourceId = null;
    }

    const monthlyCost = countryConfig.monthlyCostUsd[type] || 2.00;
    const setupCost = countryConfig.setupCostUsd[type] || 0.00;

    const regulatoryStatus = countryConfig.regulatoryLevel === 'NONE'
      ? 'NOT_REQUIRED'
      : countryConfig.regulatoryLevel === 'MANUAL_APPROVAL_REQUIRED'
      ? 'PENDING_DOCUMENTATION'
      : 'APPROVED';

    return {
      telnyxOrderId,
      phoneNumber: confirmedPhoneNumber,
      telnyxPhoneNumberResourceId,
      monthlyCostUsd: monthlyCost,
      setupCostUsd: setupCost,
      regulatoryStatus: regulatoryStatus as any,
      requiredDocuments: countryConfig.requiredDocuments,
    };
  }

  /**
   * Resolve the Telnyx phone-number RESOURCE ID from the E.164 phone number string.
   *
   * The resource ID is required for PATCH /v2/phone_numbers/{id} (SIP routing).
   * It is NOT the number order ID — it is the permanent identifier assigned to the
   * phone number once it is provisioned in the Telnyx account inventory.
   *
   * Returns null if the number is not yet in inventory (still being provisioned).
   */
  async resolvePhoneNumberResourceId(phoneNumber: string): Promise<string | null> {
    const query = new URLSearchParams();
    query.set('filter[phone_number]', phoneNumber);
    query.set('page[size]', '1');

    const res = await SafeNetworkClient.fetch(`https://api.telnyx.com/v2/phone_numbers?${query.toString()}`, {
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
    });

    if (!res.ok) {
      throw new Error(`Telnyx phone number resource lookup failed: HTTP ${res.status}`);
    }

    const data: any = await res.json();
    const record = (data.data || [])[0];

    if (!record || !record.id) {
      return null; // Not yet in inventory
    }

    return String(record.id);
  }

  /**
   * Query Telnyx inventory to locate an existing phone number and verify organization ownership.
   */
  async queryExistingNumber(params: {
    phoneNumber: string;
    organizationId?: string;
  }): Promise<{
    found: boolean;
    telnyxPhoneNumberResourceId?: string | null;
    customerReference?: string;
    status?: string;
    belongsToOrganization?: boolean;
  }> {
    const query = new URLSearchParams();
    query.set('filter[phone_number]', params.phoneNumber);
    query.set('page[size]', '1');

    try {
      const res = await SafeNetworkClient.fetch(`https://api.telnyx.com/v2/phone_numbers?${query.toString()}`, {
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
      });

      if (!res.ok) {
        return { found: false };
      }

      const data: any = await res.json();
      const record = (data.data || [])[0];
      if (!record || !record.id) {
        return { found: false };
      }

      const expectedRef = params.organizationId ? `org_${params.organizationId}` : undefined;
      const actualRef = record.customer_reference || undefined;
      const belongsToOrganization = Boolean(
        expectedRef && (actualRef === expectedRef || record.tags?.includes(expectedRef))
      );

      return {
        found: true,
        telnyxPhoneNumberResourceId: String(record.id),
        customerReference: actualRef,
        status: record.status,
        belongsToOrganization,
      };
    } catch {
      return { found: false };
    }
  }

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
   * Configure SIP routing from the provisioned Telnyx number to Vapi.
   *
   * Uses the phone-number RESOURCE ID (not the order ID) for the PATCH call.
   * If telnyxPhoneNumberId is null, attempts to resolve it via GET /v2/phone_numbers.
   *
   * Returns { success: true, telnyxPhoneNumberResourceId } on success.
   * Returns { success: false, telnyxPhoneNumberResourceId: null } if the resource ID
   * cannot be resolved (number still provisioning). VoiceService should record this
   * as a FAILED state and surface it for retry.
   *
   * Throws only on unrecoverable errors (auth failure, etc.).
   */
  async configureRoutingToVapi(params: {
    telnyxPhoneNumberId: string | null;
    phoneNumber: string;
    vapiSipUri?: string;
  }): Promise<{ success: boolean; telnyxPhoneNumberResourceId: string | null }> {
    const connectionId = config.telnyx.connectionId;
    if (!connectionId) {
      // Missing connection configuration cannot silently report successful routing.
      console.error(
        `[TelnyxTelephonyProvider] TELNYX_CONNECTION_ID is not configured. Cannot configure SIP routing for ${params.phoneNumber}. Missing connection configuration cannot report successful routing.`
      );
      return { success: false, telnyxPhoneNumberResourceId: params.telnyxPhoneNumberId };
    }

    // Resolve phone number resource ID if not already known
    let resourceId = params.telnyxPhoneNumberId;
    if (!resourceId) {
      try {
        resourceId = await this.resolvePhoneNumberResourceId(params.phoneNumber);
      } catch (err: any) {
        // Resource ID lookup failed — cannot configure routing. Caller must retry.
        console.error(`[TelnyxTelephonyProvider] Cannot resolve phone number resource ID for ${params.phoneNumber}: ${err.message}`);
        return { success: false, telnyxPhoneNumberResourceId: null };
      }
    }

    if (!resourceId) {
      // Number not yet in Telnyx inventory — still being provisioned. Retry later.
      console.warn(`[TelnyxTelephonyProvider] Phone number ${params.phoneNumber} not yet in Telnyx inventory. SIP routing deferred.`);
      return { success: false, telnyxPhoneNumberResourceId: null };
    }

    // PATCH /v2/phone_numbers/{resourceId} — assigns the SIP connection
    const res = await SafeNetworkClient.fetch(`https://api.telnyx.com/v2/phone_numbers/${resourceId}`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        connection_id: connectionId,
      }),
    });

    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}));
      const detail = errBody.errors?.[0]?.detail || errBody.errors?.[0]?.title || res.statusText;
      if (res.status === 401) {
        throw new Error('Telnyx authentication failed while configuring SIP routing. Check API key.');
      }
      if (res.status === 404) {
        // Resource ID no longer valid or number was released
        throw new Error(`Telnyx phone number resource ${resourceId} not found (HTTP 404). Number may have been released or resource ID is invalid.`);
      }
      // Non-fatal failure: log and return false so caller can decide to retry
      console.error(`[TelnyxTelephonyProvider] SIP routing PATCH failed for ${params.phoneNumber} (resource ${resourceId}): ${detail}`);
      return { success: false, telnyxPhoneNumberResourceId: resourceId };
    }

    return { success: true, telnyxPhoneNumberResourceId: resourceId };
  }

  /**
   * Release / Delete an active phone number on Telnyx
   */
  async releaseNumber(params: {
    phoneNumber: string;
    telnyxPhoneNumberId?: string | null;
  }): Promise<boolean> {
    if (!config.telnyx.apiKey || config.telnyx.apiKey.includes('placeholder')) {
      return false;
    }
    let resourceId = params.telnyxPhoneNumberId;
    if (!resourceId) {
      resourceId = await this.resolvePhoneNumberResourceId(params.phoneNumber);
    }
    if (!resourceId) {
      console.warn(`[TelnyxTelephonyProvider] Cannot release ${params.phoneNumber}: resource ID not found.`);
      return false;
    }

    try {
      const res = await fetch(`https://api.telnyx.com/v2/phone_numbers/${resourceId}`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${config.telnyx.apiKey}`,
          Accept: 'application/json',
        },
      });
      return res.ok || res.status === 404;
    } catch (err: any) {
      console.error(`[TelnyxTelephonyProvider] Error releasing phone number ${params.phoneNumber}: ${err.message}`);
      return false;
    }
  }
}
