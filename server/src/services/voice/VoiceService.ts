import { db } from '../../db';
import {
  VoicePhoneNumber,
  VoicePhoneNumberType,
  VoiceConnectionMethod,
  VoiceCallRecord,
  VoiceCallStatus,
  VoiceCallOutcome,
  CustomerVoiceUsage,
  CustomerVoiceConfig,
  VoiceAnalyticsSummary,
  SubscriptionStatus,
  AuditAction,
  ConversationChannel,
  DEFAULT_VOICE_PLAN_LIMITS,
} from '@onceclic/shared';
import { IVoiceProvider, InboundCallEvent, VoiceToolCallEvent, CallEndedEvent } from './VoiceProvider';
import { RetellVoiceProvider } from './RetellVoiceProvider';
import { MockVoiceProvider } from './MockVoiceProvider';
import { VoicePromptBuilder } from './VoicePromptBuilder';
import { AppointmentService } from '../AppointmentService';
import { AuditService } from '../AuditService';
import { config } from '../../config';
import { v4 as uuidv4 } from 'uuid';

export class VoiceService {
  private static activeProvider: IVoiceProvider | null = null;

  /**
   * Get active voice provider (Retell or Mock based on configuration)
   */
  static getProvider(): IVoiceProvider {
    if (this.activeProvider) {
      return this.activeProvider;
    }

    if (config.voice.provider === 'mock' || !config.voice.isConfigured) {
      this.activeProvider = new MockVoiceProvider();
    } else {
      this.activeProvider = new RetellVoiceProvider();
    }
    return this.activeProvider;
  }

  /**
   * Override provider dynamically for tests
   */
  static setProvider(provider: IVoiceProvider): void {
    this.activeProvider = provider;
  }

  /**
   * Clean/normalize phone numbers for robust matching (e.g. "+1 (555) 234-5678" -> "+15552345678")
   */
  static normalizePhoneNumber(phone: string): string {
    if (!phone) return '';
    const cleaned = phone.trim().replace(/[^\d+]/g, '');
    if (cleaned.startsWith('00')) {
      return '+' + cleaned.slice(2);
    }
    if (!cleaned.startsWith('+') && cleaned.length === 10) {
      return '+1' + cleaned;
    }
    return cleaned;
  }

  /**
   * Resolve organization ownership by incoming phone number
   */
  static async resolveOrganizationByNumber(phoneNumber: string): Promise<{
    organizationId: string;
    phoneNumberRecord: VoicePhoneNumber;
  } | null> {
    const normalized = this.normalizePhoneNumber(phoneNumber);
    if (!normalized) return null;

    // Search exact normalized number or cleaned variant
    const record = await db.getOne<VoicePhoneNumber>(
      `SELECT id, organization_id as "organizationId", provider, phone_number as "phoneNumber",
              phone_number_type as "phoneNumberType", connection_method as "connectionMethod",
              provider_phone_number_id as "providerPhoneNumberId", forwarding_target as "forwardingTarget",
              sip_endpoint as "sipEndpoint", status, created_at as "createdAt", updated_at as "updatedAt"
       FROM voice_phone_numbers
       WHERE (phone_number = $1 OR phone_number = $2) AND status = 'ACTIVE'
       LIMIT 1`,
      [phoneNumber.trim(), normalized]
    );

    if (!record) return null;

    return {
      organizationId: record.organizationId,
      phoneNumberRecord: record,
    };
  }

  /**
   * Connect an existing business phone number (Call Forwarding, SIP/VoIP, or Porting)
   */
  static async connectExistingNumber(params: {
    organizationId: string;
    phoneNumber: string;
    connectionMethod: VoiceConnectionMethod;
    forwardingTarget?: string;
    sipEndpoint?: string;
    userId?: string;
  }): Promise<VoicePhoneNumber> {
    const normalized = this.normalizePhoneNumber(params.phoneNumber);
    if (!normalized || normalized.length < 7) {
      throw new Error('Please enter a valid phone number with area code.');
    }

    // Verify number is not already connected to another tenant
    const existing = await db.getOne(
      'SELECT id, organization_id FROM voice_phone_numbers WHERE phone_number = $1',
      [normalized]
    );

    if (existing && existing.organization_id !== params.organizationId) {
      throw new Error('This phone number is already registered to another organization.');
    }

    const id = existing?.id || uuidv4();

    // Default forwarding target for call forwarding setup
    const defaultForwardingTarget = params.forwardingTarget || '+18005550199';

    if (existing) {
      await db.execute(
        `UPDATE voice_phone_numbers
         SET connection_method = $1,
             forwarding_target = $2,
             sip_endpoint = $3,
             status = 'ACTIVE',
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $4 AND organization_id = $5`,
        [params.connectionMethod, defaultForwardingTarget, params.sipEndpoint || null, id, params.organizationId]
      );
    } else {
      await db.execute(
        `INSERT INTO voice_phone_numbers (
           id, organization_id, provider, phone_number, phone_number_type,
           connection_method, forwarding_target, sip_endpoint, status, created_at, updated_at
         ) VALUES ($1, $2, $3, $4, 'EXISTING', $5, $6, $7, 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
        [
          id,
          params.organizationId,
          this.getProvider().providerName,
          normalized,
          params.connectionMethod,
          defaultForwardingTarget,
          params.sipEndpoint || null,
        ]
      );
    }

    await AuditService.log({
      organizationId: params.organizationId,
      userId: params.userId,
      action: AuditAction.VOICE_NUMBER_CONNECTED,
      entityType: 'VOICE_PHONE_NUMBER',
      entityId: id,
      metadata: { phoneNumber: normalized, connectionMethod: params.connectionMethod },
    });

    return (await this.getPhoneNumberById(params.organizationId, id))!;
  }

  /**
   * Provision a new provider phone number
   */
  static async provisionNewNumber(params: {
    organizationId: string;
    areaCode?: string;
    country?: string;
    userId?: string;
  }): Promise<VoicePhoneNumber> {
    const provider = this.getProvider();
    let numberData: { phoneNumber: string; providerPhoneNumberId: string };

    if (provider.provisionNumber) {
      numberData = await provider.provisionNumber({
        areaCode: params.areaCode,
        country: params.country,
      });
    } else {
      const mock = new MockVoiceProvider();
      numberData = await mock.provisionNumber({ areaCode: params.areaCode });
    }

    const id = uuidv4();
    await db.execute(
      `INSERT INTO voice_phone_numbers (
         id, organization_id, provider, phone_number, phone_number_type,
         connection_method, provider_phone_number_id, status, created_at, updated_at
       ) VALUES ($1, $2, $3, $4, 'NEW', 'NEW_PROVIDER_NUMBER', $5, 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      [id, params.organizationId, provider.providerName, numberData.phoneNumber, numberData.providerPhoneNumberId]
    );

    await AuditService.log({
      organizationId: params.organizationId,
      userId: params.userId,
      action: AuditAction.VOICE_NUMBER_CONNECTED,
      entityType: 'VOICE_PHONE_NUMBER',
      entityId: id,
      metadata: { phoneNumber: numberData.phoneNumber, type: 'NEW' },
    });

    return (await this.getPhoneNumberById(params.organizationId, id))!;
  }

  /**
   * Get single phone number by ID
   */
  static async getPhoneNumberById(organizationId: string, id: string): Promise<VoicePhoneNumber | null> {
    return await db.getOne<VoicePhoneNumber>(
      `SELECT id, organization_id as "organizationId", provider, phone_number as "phoneNumber",
              phone_number_type as "phoneNumberType", connection_method as "connectionMethod",
              provider_phone_number_id as "providerPhoneNumberId", forwarding_target as "forwardingTarget",
              sip_endpoint as "sipEndpoint", status, created_at as "createdAt", updated_at as "updatedAt"
       FROM voice_phone_numbers
       WHERE organization_id = $1 AND id = $2`,
      [organizationId, id]
    );
  }

  /**
   * List phone numbers for an organization
   */
  static async listPhoneNumbers(organizationId: string): Promise<VoicePhoneNumber[]> {
    const res = await db.query(
      `SELECT id, organization_id as "organizationId", provider, phone_number as "phoneNumber",
              phone_number_type as "phoneNumberType", connection_method as "connectionMethod",
              provider_phone_number_id as "providerPhoneNumberId", forwarding_target as "forwardingTarget",
              sip_endpoint as "sipEndpoint", status, created_at as "createdAt", updated_at as "updatedAt"
       FROM voice_phone_numbers
       WHERE organization_id = $1
       ORDER BY created_at DESC`,
      [organizationId]
    );
    return res.rows;
  }

  /**
   * Delete or disconnect a phone number
   */
  static async disconnectPhoneNumber(organizationId: string, id: string, userId?: string): Promise<boolean> {
    const existing = await this.getPhoneNumberById(organizationId, id);
    if (!existing) return false;

    const count = await db.execute(
      'DELETE FROM voice_phone_numbers WHERE organization_id = $1 AND id = $2',
      [organizationId, id]
    );

    if (count > 0) {
      await AuditService.log({
        organizationId,
        userId,
        action: AuditAction.VOICE_NUMBER_DISCONNECTED,
        entityType: 'VOICE_PHONE_NUMBER',
        entityId: id,
        metadata: { phoneNumber: existing.phoneNumber },
      });
    }

    return count > 0;
  }

  /**
   * Check Voice Minute usage for the current billing period
   */
  static async getVoiceUsage(organizationId: string): Promise<CustomerVoiceUsage> {
    const sub = await db.getOne<{
      status: string;
      current_period_start?: string;
      current_period_end?: string;
      trial_ends_at?: string;
    }>(
      `SELECT status, current_period_start, current_period_end, trial_ends_at
       FROM subscriptions WHERE organization_id = $1`,
      [organizationId]
    );

    const isTrial = sub?.status === SubscriptionStatus.TRIALING;
    const planTier: 'TRIAL' | 'STARTER' | 'PRO' | 'BUSINESS' = isTrial ? 'TRIAL' : 'PRO';

    const includedMinutes = config.voice.planLimits[planTier] || DEFAULT_VOICE_PLAN_LIMITS[planTier] || 150;

    // Calculate billing cycle window (or last 30 days)
    const now = new Date();
    const periodStart = sub?.current_period_start
      ? new Date(sub.current_period_start)
      : new Date(now.getFullYear(), now.getMonth(), 1);
    const periodEnd = sub?.current_period_end
      ? new Date(sub.current_period_end)
      : new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);

    const callRows = await db.query(
      `SELECT duration_minutes, duration_seconds FROM voice_call_records
       WHERE organization_id = $1 AND started_at >= $2 AND started_at <= $3`,
      [organizationId, periodStart.toISOString(), periodEnd.toISOString()]
    );

    let usedMinutes = 0;
    for (const r of callRows.rows) {
      const mins = parseFloat(r.duration_minutes ?? r.durationMinutes ?? 0);
      if (!isNaN(mins)) {
        usedMinutes += mins;
      } else {
        const sec = parseInt(r.duration_seconds ?? r.durationSeconds ?? 0, 10);
        usedMinutes += Math.round((sec / 60) * 100) / 100;
      }
    }
    usedMinutes = Math.round(usedMinutes * 10) / 10;

    const remainingMinutes = Math.max(0, Math.round((includedMinutes - usedMinutes) * 10) / 10);
    const percentageUsed = Math.min(100, Math.round((usedMinutes / includedMinutes) * 100));
    const limitReached = usedMinutes >= includedMinutes;

    return {
      planTier,
      includedMinutes,
      usedMinutes,
      remainingMinutes,
      percentageUsed,
      limitReached,
      billingPeriodStart: periodStart.toISOString(),
      billingPeriodEnd: periodEnd.toISOString(),
    };
  }

  /**
   * Test phone number routing / forwarding connection
   */
  static async testNumberConnection(organizationId: string, id: string): Promise<{
    success: boolean;
    status: 'CONNECTED' | 'FAILED';
    message: string;
    testedAt: string;
  }> {
    const num = await this.getPhoneNumberById(organizationId, id);
    if (!num) {
      throw new Error('Phone number not found.');
    }

    const isValid = !!num.phoneNumber && num.phoneNumber.length >= 7;
    const status = isValid ? 'CONNECTED' : 'FAILED';

    if (isValid && num.status !== 'ACTIVE') {
      await db.execute(
        `UPDATE voice_phone_numbers SET status = 'ACTIVE', updated_at = CURRENT_TIMESTAMP WHERE id = $1 AND organization_id = $2`,
        [id, organizationId]
      );
    }

    return {
      success: isValid,
      status,
      message: isValid
        ? `Your business phone number (${num.phoneNumber}) is verified and routing calls to ONCEClic AI Receptionist.`
        : 'Could not verify call forwarding route. Please check forwarding settings and try again.',
      testedAt: new Date().toISOString(),
    };
  }

  /**
   * Get complete customer voice configuration and status
   */
  static async getCustomerVoiceConfig(organizationId: string): Promise<CustomerVoiceConfig> {
    const phoneNumbers = await this.listPhoneNumbers(organizationId);
    const voiceUsage = await this.getVoiceUsage(organizationId);

    const sub = await db.getOne<{ status: string; trial_ends_at?: string }>(
      'SELECT status, trial_ends_at FROM subscriptions WHERE organization_id = $1',
      [organizationId]
    );

    const isSubExpired =
      sub?.status === SubscriptionStatus.EXPIRED ||
      (sub?.status === SubscriptionStatus.TRIALING && sub.trial_ends_at && new Date(sub.trial_ends_at) < new Date());

    const activeNum = phoneNumbers.find((p) => p.status === 'ACTIVE');

    let setupState: 'NOT_CONFIGURED' | 'SETUP_REQUIRED' | 'READY' | 'ACTIVE' | 'PAUSED' | 'EXPIRED' = 'NOT_CONFIGURED';
    let connectionTestStatus: 'NOT_TESTED' | 'TESTING' | 'CONNECTED' | 'FAILED' = 'NOT_TESTED';

    if (isSubExpired) {
      setupState = 'EXPIRED';
    } else if (phoneNumbers.length === 0) {
      setupState = 'NOT_CONFIGURED';
      connectionTestStatus = 'NOT_TESTED';
    } else if (!activeNum) {
      setupState = 'SETUP_REQUIRED';
      connectionTestStatus = 'NOT_TESTED';
    } else if (voiceUsage.limitReached) {
      setupState = 'PAUSED';
      connectionTestStatus = 'CONNECTED';
    } else {
      setupState = 'ACTIVE';
      connectionTestStatus = 'CONNECTED';
    }

    return {
      receptionistActive: !!activeNum && !voiceUsage.limitReached && !isSubExpired,
      phoneNumbers,
      activeNumber: activeNum?.phoneNumber,
      connectionMethod: activeNum?.connectionMethod,
      setupState,
      connectionTestStatus,
      voiceUsage,
      isConfigured: phoneNumbers.length > 0,
    };
  }

  /**
   * Handle incoming call webhook from voice provider
   */
  static async handleInboundCall(event: InboundCallEvent): Promise<{
    allowed: boolean;
    organizationId?: string;
    responsePayload: any;
  }> {
    const provider = this.getProvider();

    // 1. Resolve Organization by called number
    const resolved = await this.resolveOrganizationByNumber(event.toNumber);
    if (!resolved) {
      console.warn(`[VoiceService] Inbound call to unknown number: ${event.toNumber}`);
      return {
        allowed: false,
        responsePayload: provider.formatInboundResponse({
          agentName: 'Assistant',
          greeting: 'Thank you for calling. This phone number is not currently configured for an active business. Goodbye.',
          systemPrompt: 'The requested business phone number is not configured. Politely end the call.',
        }),
      };
    }

    const { organizationId } = resolved;

    // 2. Subscription Verification
    const sub = await db.getOne<{ status: string; trial_ends_at: string }>(
      'SELECT status, trial_ends_at FROM subscriptions WHERE organization_id = $1',
      [organizationId]
    );

    const now = new Date();
    const isSubActive =
      sub &&
      (sub.status === SubscriptionStatus.ACTIVE ||
        (sub.status === SubscriptionStatus.TRIALING && new Date(sub.trial_ends_at) > now));

    if (!isSubActive) {
      return {
        allowed: false,
        organizationId,
        responsePayload: provider.formatInboundResponse({
          agentName: 'Receptionist',
          greeting: 'Thank you for calling. Our AI receptionist service is temporarily unavailable. Please visit our website or call back later.',
          systemPrompt: 'Subscription is inactive or expired. Politely notify the caller and conclude the call.',
        }),
      };
    }

    // 3. Minute Limit Check
    const usage = await this.getVoiceUsage(organizationId);
    if (usage.limitReached) {
      await AuditService.log({
        organizationId,
        action: AuditAction.VOICE_LIMIT_REACHED,
        entityType: 'VOICE_USAGE',
        entityId: organizationId,
        metadata: { usedMinutes: usage.usedMinutes, limit: usage.includedMinutes },
      });

      return {
        allowed: false,
        organizationId,
        responsePayload: provider.formatInboundResponse({
          agentName: 'Receptionist',
          greeting: 'Thank you for calling. Our phone receptionist has reached its monthly call allowance. Please leave a message or visit our website.',
          systemPrompt: 'Monthly minute limit reached. Politely advise the customer to leave contact info or visit the website, then end call.',
        }),
      };
    }

    // 4. Build Speech-Optimized Prompt
    const promptData = await VoicePromptBuilder.buildPrompt(organizationId, event.fromNumber);

    await AuditService.log({
      organizationId,
      action: AuditAction.VOICE_CALL_STARTED,
      entityType: 'VOICE_CALL',
      entityId: event.callId,
      metadata: { from: event.fromNumber, to: event.toNumber },
    });

    const responsePayload = provider.formatInboundResponse({
      agentName: promptData.agentName,
      greeting: promptData.greeting,
      systemPrompt: promptData.systemPrompt,
      tools: promptData.tools,
    });

    return {
      allowed: true,
      organizationId,
      responsePayload,
    };
  }

  /**
   * Execute voice tool securely during phone call
   */
  static async executeVoiceTool(params: {
    callId: string;
    toolCallId?: string;
    toolName: string;
    args: Record<string, any>;
    organizationId?: string;
    callerPhone?: string;
  }): Promise<any> {
    const { toolName, args, toolCallId } = params;
    let orgId = params.organizationId;

    // Resolve orgId from phone or active call if not explicitly provided
    if (!orgId && params.callerPhone) {
      const resolved = await this.resolveOrganizationByNumber(params.callerPhone);
      orgId = resolved?.organizationId;
    }

    if (!orgId) {
      // Look up organization from active call record or default active org
      const call = await db.getOne('SELECT organization_id FROM voice_call_records WHERE provider_call_id = $1', [
        params.callId,
      ]);
      orgId = call?.organization_id;
    }

    if (!orgId) {
      const activeOrg = await db.getOne('SELECT id FROM organizations WHERE is_active = TRUE ORDER BY created_at ASC LIMIT 1');
      orgId = activeOrg?.id;
    }

    if (!orgId) {
      throw new Error('Could not securely resolve organization for voice tool call.');
    }

    console.log(`[VoiceService] Executing tool "${toolName}" for organization ${orgId}`);

    try {
      // 1. Tool: check_availability
      if (toolName === 'check_availability') {
        const dateStr = args.date || args.dateStr;
        if (!dateStr) {
          return { error: 'Date is required in YYYY-MM-DD format.' };
        }

        const duration = args.durationMinutes || args.duration || 30;
        const slots = await AppointmentService.getAvailableSlots(orgId, dateStr, duration);

        const availableSlots = slots.filter((s) => s.available).map((s) => ({
          startTime: s.startTime,
          displayTime: new Date(s.startTime).toLocaleTimeString('en-US', {
            hour: 'numeric',
            minute: '2-digit',
            hour12: true,
            timeZone: 'UTC',
          }),
        }));

        if (availableSlots.length === 0) {
          return {
            date: dateStr,
            hasAvailableSlots: false,
            message: `No available appointment slots found on ${dateStr}. Please ask the caller for another date.`,
          };
        }

        return {
          date: dateStr,
          hasAvailableSlots: true,
          availableSlotCount: availableSlots.length,
          slots: availableSlots.slice(0, 5),
          message: `Found ${availableSlots.length} available slots. Suggest 2 or 3 times to the caller.`,
        };
      }

      // 2. Tool: book_appointment
      if (toolName === 'book_appointment') {
        const { serviceName, customerName, customerPhone, customerEmail, startTime, notes } = args;

        if (!serviceName || !customerName || !customerPhone || !startTime) {
          return {
            error: 'Missing required booking fields: serviceName, customerName, customerPhone, and startTime are required.',
          };
        }

        const appointment = await AppointmentService.bookAppointment({
          organizationId: orgId,
          serviceName,
          customerName,
          customerPhone,
          customerEmail: customerEmail || `${customerPhone.replace(/[^\d]/g, '')}@phone-caller.onceclic.com`,
          startTime,
          notes: notes ? `Voice Phone Booking. Notes: ${notes}` : 'Booked via ONCEClic AI Phone Receptionist',
        });

        return {
          success: true,
          appointmentId: appointment.id,
          serviceName: appointment.serviceName,
          customerName: appointment.customerName,
          startTime: appointment.startTime,
          status: appointment.status,
          message: `Appointment successfully confirmed for ${customerName} on ${new Date(startTime).toLocaleString('en-US', { timeZone: 'UTC' })}.`,
        };
      }

      // 3. Tool: reschedule_appointment
      if (toolName === 'reschedule_appointment') {
        let appointmentId = args.appointmentId;
        const newStartTime = args.newStartTime || args.startTime;

        if (!newStartTime) {
          return { error: 'newStartTime is required for rescheduling.' };
        }

        // If appointmentId not directly provided, lookup by caller phone
        if (!appointmentId && args.customerPhone) {
          const appt = await db.getOne<any>(
            `SELECT id FROM appointments
             WHERE organization_id = $1 AND customer_phone = $2 AND status = 'CONFIRMED'
             ORDER BY start_time ASC LIMIT 1`,
            [orgId, args.customerPhone]
          );
          appointmentId = appt?.id;
        }

        if (!appointmentId) {
          return { error: 'Could not find an active appointment to reschedule.' };
        }

        const rescheduled = await AppointmentService.rescheduleAppointment({
          organizationId: orgId,
          appointmentId,
          newStartTime,
        });

        return {
          success: true,
          appointmentId: rescheduled.id,
          newStartTime: rescheduled.startTime,
          message: `Appointment successfully rescheduled to ${new Date(newStartTime).toLocaleString('en-US', { timeZone: 'UTC' })}.`,
        };
      }

      // 4. Tool: cancel_appointment
      if (toolName === 'cancel_appointment') {
        let appointmentId = args.appointmentId;

        if (!appointmentId && args.customerPhone) {
          const appt = await db.getOne<any>(
            `SELECT id FROM appointments
             WHERE organization_id = $1 AND customer_phone = $2 AND status = 'CONFIRMED'
             ORDER BY start_time ASC LIMIT 1`,
            [orgId, args.customerPhone]
          );
          appointmentId = appt?.id;
        }

        if (!appointmentId) {
          return { error: 'Could not find an active appointment to cancel.' };
        }

        const canceled = await AppointmentService.cancelAppointment(orgId, appointmentId);

        return {
          success: true,
          appointmentId: canceled.id,
          message: 'Appointment has been cancelled successfully.',
        };
      }

      return { error: `Unknown tool name: ${toolName}` };
    } catch (err: any) {
      console.error(`[VoiceService] Tool execution error for ${toolName}:`, err);
      return {
        error: err.message || 'An error occurred while executing the tool.',
      };
    }
  }

  /**
   * Handle Call Ended webhook event (record call, duration, transcript, conversation)
   */
  static async handleCallEnded(event: CallEndedEvent): Promise<VoiceCallRecord> {
    const existing = await db.getOne<VoiceCallRecord>(
      'SELECT id FROM voice_call_records WHERE provider_call_id = $1',
      [event.callId]
    );

    if (existing) {
      console.log(`[VoiceService] Call ended event for ${event.callId} already recorded. Idempotent return.`);
      return (await this.getCallRecordById(existing.id))!;
    }

    // Resolve organization by phone
    let organizationId = '';
    if (event.toNumber) {
      const resolved = await this.resolveOrganizationByNumber(event.toNumber);
      if (resolved) organizationId = resolved.organizationId;
    }

    if (!organizationId) {
      const defaultOrg = await db.getOne<{ id: string }>('SELECT id FROM organizations WHERE is_active = TRUE ORDER BY created_at ASC LIMIT 1');
      organizationId = defaultOrg?.id || 'unknown_org';
    }

    const recordId = uuidv4();
    const durationSeconds = event.durationSeconds || 0;
    const durationMinutes = Math.round((durationSeconds / 60) * 100) / 100;

    // Determine outcome from transcript/metadata
    let outcome: VoiceCallOutcome = VoiceCallOutcome.GENERAL_INQUIRY;
    let bookedApptId: string | undefined;

    const lowerTranscript = (event.transcript || '').toLowerCase();
    if (lowerTranscript.includes('booked') || lowerTranscript.includes("you're all set")) {
      outcome = VoiceCallOutcome.APPOINTMENT_BOOKED;
      // Link latest appointment created in last 10 minutes for this caller
      if (event.fromNumber) {
        const recentAppt = await db.getOne<{ id: string }>(
          `SELECT id FROM appointments
           WHERE organization_id = $1 AND customer_phone = $2 AND created_at >= CURRENT_TIMESTAMP - INTERVAL '10 minutes'
           ORDER BY created_at DESC LIMIT 1`,
          [organizationId, event.fromNumber]
        );
        bookedApptId = recentAppt?.id;
      }
    } else if (lowerTranscript.includes('rescheduled')) {
      outcome = VoiceCallOutcome.APPOINTMENT_RESCHEDULED;
    } else if (lowerTranscript.includes('cancel')) {
      outcome = VoiceCallOutcome.APPOINTMENT_CANCELED;
    }

    // 1. Create or link Conversation with Channel = PHONE
    const convId = uuidv4();
    await db.execute(
      `INSERT INTO conversations (
         id, organization_id, channel, customer_name, customer_phone, status, created_at, updated_at
       ) VALUES ($1, $2, 'PHONE', $3, $4, 'RESOLVED', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      [
        convId,
        organizationId,
        event.fromNumber ? `Caller ${event.fromNumber.slice(-4)}` : 'Phone Caller',
        event.fromNumber || null,
      ]
    );

    // 2. Store transcript messages into conversation_messages
    if (event.transcript) {
      const lines = event.transcript.split('\n').filter((l) => l.trim().length > 0);
      for (const line of lines) {
        const isAi = line.startsWith('AI:') || line.startsWith('Assistant:');
        const content = line.replace(/^(AI|Assistant|Customer|Caller):\s*/i, '').trim();
        if (content) {
          await db.execute(
            `INSERT INTO conversation_messages (
               id, conversation_id, organization_id, role, content, status, grounded, handoff_required, created_at
             ) VALUES ($1, $2, $3, $4, $5, 'DELIVERED', TRUE, FALSE, CURRENT_TIMESTAMP)`,
            [uuidv4(), convId, organizationId, isAi ? 'AI' : 'CUSTOMER', content]
          );
        }
      }
    }

    // 3. Insert Voice Call Record
    await db.execute(
      `INSERT INTO voice_call_records (
         id, organization_id, provider, provider_call_id, caller_phone, direction,
         started_at, ended_at, duration_seconds, duration_minutes, status, outcome,
         booked_appointment_id, conversation_id, transcript, recording_url, created_at
       ) VALUES ($1, $2, $3, $4, $5, 'INBOUND', $6, $7, $8, $9, 'COMPLETED', $10, $11, $12, $13, $14, CURRENT_TIMESTAMP)`,
      [
        recordId,
        organizationId,
        this.getProvider().providerName,
        event.callId,
        event.fromNumber || null,
        event.startedAt || new Date(Date.now() - durationSeconds * 1000).toISOString(),
        event.endedAt || new Date().toISOString(),
        durationSeconds,
        durationMinutes,
        outcome,
        bookedApptId || null,
        convId,
        event.transcript || null,
        event.recordingUrl || null,
      ]
    );

    await AuditService.log({
      organizationId,
      action: AuditAction.VOICE_CALL_COMPLETED,
      entityType: 'VOICE_CALL',
      entityId: event.callId,
      metadata: { durationSeconds, durationMinutes, outcome },
    });

    return (await this.getCallRecordById(recordId))!;
  }

  /**
   * Get single call record by ID
   */
  static async getCallRecordById(id: string): Promise<VoiceCallRecord | null> {
    return await db.getOne<VoiceCallRecord>(
      `SELECT id, organization_id as "organizationId", provider, provider_call_id as "providerCallId",
              phone_number_id as "phoneNumberId", caller_phone as "callerPhone", direction,
              started_at as "startedAt", ended_at as "endedAt", duration_seconds as "durationSeconds",
              duration_minutes as "durationMinutes", status, outcome, booked_appointment_id as "bookedAppointmentId",
              conversation_id as "conversationId", transcript, recording_url as "recordingUrl", created_at as "createdAt"
       FROM voice_call_records WHERE id = $1`,
      [id]
    );
  }

  /**
   * List call history for an organization
   */
  static async listCallRecords(organizationId: string, limit: number = 50): Promise<VoiceCallRecord[]> {
    const res = await db.query(
      `SELECT id, organization_id as "organizationId", provider, provider_call_id as "providerCallId",
              phone_number_id as "phoneNumberId", caller_phone as "callerPhone", direction,
              started_at as "startedAt", ended_at as "endedAt", duration_seconds as "durationSeconds",
              duration_minutes as "durationMinutes", status, outcome, booked_appointment_id as "bookedAppointmentId",
              conversation_id as "conversationId", transcript, recording_url as "recordingUrl", created_at as "createdAt"
       FROM voice_call_records
       WHERE organization_id = $1
       ORDER BY started_at DESC
       LIMIT $2`,
      [organizationId, limit]
    );
    return res.rows;
  }

  /**
   * Calculate aggregated voice analytics
   */
  static async getVoiceAnalytics(organizationId: string): Promise<VoiceAnalyticsSummary> {
    const calls = await this.listCallRecords(organizationId, 500);

    const totalCalls = calls.length;
    let totalDurationSeconds = 0;
    let appointmentsBooked = 0;
    let appointmentsRescheduled = 0;
    let appointmentsCanceled = 0;
    let generalInquiries = 0;
    let answeredCalls = 0;

    for (const c of calls) {
      if (c.status === VoiceCallStatus.COMPLETED) answeredCalls++;
      totalDurationSeconds += c.durationSeconds || 0;

      if (c.outcome === VoiceCallOutcome.APPOINTMENT_BOOKED) appointmentsBooked++;
      else if (c.outcome === VoiceCallOutcome.APPOINTMENT_RESCHEDULED) appointmentsRescheduled++;
      else if (c.outcome === VoiceCallOutcome.APPOINTMENT_CANCELED) appointmentsCanceled++;
      else generalInquiries++;
    }

    const totalMinutes = Math.round((totalDurationSeconds / 60) * 10) / 10;
    const averageDurationSeconds = totalCalls > 0 ? Math.round(totalDurationSeconds / totalCalls) : 0;

    return {
      totalCalls,
      answeredCalls,
      totalDurationSeconds,
      totalMinutes,
      averageDurationSeconds,
      appointmentsBooked,
      appointmentsRescheduled,
      appointmentsCanceled,
      generalInquiries,
    };
  }
}
