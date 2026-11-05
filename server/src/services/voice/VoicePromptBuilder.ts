import { db } from '../../db';
import { KnowledgeService } from '../KnowledgeService';
import { BusinessDataCompletenessService } from '../BusinessDataCompletenessService';
import { PublicKnowledgeGroundingService } from '../PublicKnowledgeGroundingService';

export class VoicePromptBuilder {
  /**
   * Build speech-optimized prompt for Phone AI Receptionist
   */
  static async buildPrompt(organizationId: string, callerPhone?: string): Promise<{
    agentName: string;
    greeting: string;
    systemPrompt: string;
    tools: any[];
  }> {
    if (!organizationId || typeof organizationId !== 'string' || organizationId.trim() === '') {
      throw new Error('Organization ID is strictly required to build voice prompt.');
    }

    const org = await db.getOne(
      'SELECT id, name, slug, business_type, phone, email, website, address, timezone FROM organizations WHERE id = $1',
      [organizationId]
    );

    const settings = await db.getOne(
      'SELECT business_hours, services, cancellation_policy, contact_instructions, reservation_settings, industry_type, transfer_phone_number, salon_settings FROM business_settings WHERE organization_id = $1',
      [organizationId]
    );

    const aiEmployee = await db.getOne(
      "SELECT name, role_title, greeting_message, instructions FROM ai_employees WHERE organization_id = $1 AND status = 'ACTIVE' LIMIT 1",
      [organizationId]
    );

    // Retrieve general organization knowledge facts
    const knowledgeChunks = await KnowledgeService.retrieveRelevantChunks(
      organizationId,
      'services hours location appointments pricing contact',
      6
    );

    const businessName = org?.name || 'our business';
    const businessType = org?.business_type || 'services';
    const agentName = aiEmployee?.name || 'Luna';
    const timezone = org?.timezone || 'UTC';
    const address = org?.address?.trim() || '';
    const industryType: string = (settings?.industry_type || '').toLowerCase();

    const completenessContext = BusinessDataCompletenessService.formatGroundingContext({
      org,
      settings,
      aiEmployee,
    });

    const isOnceclicOrg =
      (org?.name || '').toLowerCase().includes('onceclic') ||
      (org?.slug || '').toLowerCase().includes('onceclic');

    const publicKnowledge = isOnceclicOrg
      ? PublicKnowledgeGroundingService.getGroundingContext('phone voice ai receptionist')
      : '';

    const greeting =
      aiEmployee?.greeting_message ||
      `Thank you for calling ${businessName}. My name is ${agentName}. How may I help you today?`;

    // ----------------------------------------------------------------
    // Transfer call tool — added to ALL industries
    // ----------------------------------------------------------------
    const transferCallTool = {
      name: 'transfer_call',
      description:
        'Transfer the call to a human staff member when the caller requests human assistance or when the AI cannot handle the inquiry.',
      parameters: {
        type: 'object',
        properties: {
          reason: {
            type: 'string',
            description:
              'Brief reason for the transfer (e.g. "Customer requested human assistance", "Complex medical question")',
          },
        },
        required: ['reason'],
      },
    };

    // ----------------------------------------------------------------
    // Base appointment tools (clinic / healthcare / default)
    // ----------------------------------------------------------------
    const baseAppointmentTools = [
      {
        name: 'check_availability',
        description: 'Check available appointment slots on a specific date for a requested service.',
        parameters: {
          type: 'object',
          properties: {
            date: {
              type: 'string',
              description: 'Date to check in YYYY-MM-DD format (e.g. 2026-09-15)',
            },
            serviceName: {
              type: 'string',
              description: 'Optional name of the requested service to match duration and pricing',
            },
            durationMinutes: {
              type: 'number',
              description: 'Duration in minutes, default 30',
            },
          },
          required: ['date'],
        },
      },
      {
        name: 'book_appointment',
        description: 'Book and confirm an appointment slot for the caller in the calendar.',
        parameters: {
          type: 'object',
          properties: {
            serviceName: {
              type: 'string',
              description: 'Name of the service being booked',
            },
            customerName: {
              type: 'string',
              description: "Customer's full name",
            },
            customerPhone: {
              type: 'string',
              description: "Customer's phone number",
            },
            customerEmail: {
              type: 'string',
              description: "Customer's email address if provided",
            },
            startTime: {
              type: 'string',
              description: 'Selected start time in ISO 8601 format (e.g. 2026-09-15T14:00:00.000Z)',
            },
            notes: {
              type: 'string',
              description: 'Optional notes, party size, or specific requests',
            },
          },
          required: ['serviceName', 'customerName', 'customerPhone', 'startTime'],
        },
      },
      {
        name: 'reschedule_appointment',
        description: 'Reschedule an existing appointment to a new date/time slot.',
        parameters: {
          type: 'object',
          properties: {
            appointmentId: {
              type: 'string',
              description: 'The ID of the existing appointment',
            },
            customerPhone: {
              type: 'string',
              description: "Customer's phone number to verify booking",
            },
            newStartTime: {
              type: 'string',
              description: 'The requested new ISO start time',
            },
          },
          required: ['newStartTime'],
        },
      },
      {
        name: 'cancel_appointment',
        description: 'Cancel an existing appointment for the customer.',
        parameters: {
          type: 'object',
          properties: {
            appointmentId: {
              type: 'string',
              description: 'The ID of the appointment to cancel',
            },
            customerPhone: {
              type: 'string',
              description: "Customer's phone number to identify appointment",
            },
            reason: {
              type: 'string',
              description: 'Optional cancellation reason',
            },
          },
          required: [],
        },
      },
    ];

    // ----------------------------------------------------------------
    // Industry: SALON
    // ----------------------------------------------------------------
    if (industryType === 'salon') {
      // Load salon services from DB
      const salonServicesRows = await db.query(
        `SELECT id, name, price, duration_minutes FROM salon_services WHERE organization_id = $1 AND is_active = true ORDER BY name ASC`,
        [organizationId]
      );
      const salonServices: Array<{ id: string; name: string; price: number; duration_minutes: number }> =
        salonServicesRows?.rows || [];

      // Load active staff from DB, joining service names via salon_staff_services
      // NOTE: salon_staff has no 'services' column — qualifications live in salon_staff_services
      const salonStaffRows = await db.query(
        `SELECT ss.id, ss.name,
                COALESCE(
                  (SELECT string_agg(svc.name, ', ' ORDER BY svc.name)
                   FROM salon_staff_services sss
                   JOIN salon_services svc ON svc.id = sss.service_id
                   WHERE sss.staff_id = ss.id AND svc.is_active = true),
                  NULL
                ) AS services
         FROM salon_staff ss
         WHERE ss.organization_id = $1 AND ss.is_active = true
         ORDER BY ss.name ASC`,
        [organizationId]
      );
      const salonStaff: Array<{ id: string; name: string; services?: string }> =
        salonStaffRows?.rows || [];

      // Build service list text
      const servicesText =
        salonServices.length > 0
          ? salonServices
              .map(
                (s) =>
                  `${s.name} (${s.duration_minutes} min, $${Number(s.price).toFixed(2)})`
              )
              .join(', ')
          : 'See business settings for available services.';

      // Build staff list text, including per-staff service qualifications when available
      const staffText =
        salonStaff.length > 0
          ? salonStaff
              .map((st) =>
                st.services ? `${st.name} (specialises in: ${st.services})` : st.name
              )
              .join('; ')
          : 'Staff information not configured.';

      // Salon-specific book_appointment with staffId
      const salonBookTool = {
        name: 'book_appointment',
        description: 'Book and confirm an appointment slot for the caller in the calendar.',
        parameters: {
          type: 'object',
          properties: {
            serviceName: {
              type: 'string',
              description: 'Name of the service being booked',
            },
            customerName: {
              type: 'string',
              description: "Customer's full name",
            },
            customerPhone: {
              type: 'string',
              description: "Customer's phone number",
            },
            customerEmail: {
              type: 'string',
              description: "Customer's email address if provided",
            },
            startTime: {
              type: 'string',
              description: 'Selected start time in ISO 8601 format (e.g. 2026-09-15T14:00:00.000Z)',
            },
            staffId: {
              type: 'string',
              description: 'ID of the preferred staff member or stylist (from check_staff_availability)',
            },
            notes: {
              type: 'string',
              description: 'Optional notes or specific requests',
            },
          },
          required: ['serviceName', 'customerName', 'customerPhone', 'startTime'],
        },
      };

      const checkStaffAvailabilityTool = {
        name: 'check_staff_availability',
        description: 'Check availability for a specific staff member or stylist on a date.',
        parameters: {
          type: 'object',
          properties: {
            date: { type: 'string', description: 'Date in YYYY-MM-DD format' },
            staffName: { type: 'string', description: 'Name of the preferred staff member or stylist' },
            serviceId: { type: 'string', description: 'ID of the service to book' },
            durationMinutes: { type: 'number', description: 'Duration of service in minutes' },
          },
          required: ['date'],
        },
      };

      const salonTools = [
        baseAppointmentTools[0], // check_availability
        salonBookTool,           // book_appointment (with staffId)
        baseAppointmentTools[2], // reschedule_appointment
        baseAppointmentTools[3], // cancel_appointment
        checkStaffAvailabilityTool,
        transferCallTool,
      ];

      const salonPromptSection = `
SALON BUSINESS CONTEXT:
- Available Services: ${servicesText}
- Available Staff: ${staffText}

SALON BOOKING WORKFLOW:
1. When caller requests an appointment, ask what service they would like.
2. Ask for their preferred date and whether they have a preferred stylist.
3. Use check_availability (or check_staff_availability if stylist specified) to find open slots.
4. Present 2-3 available times clearly.
5. Collect the caller's full name and phone number.
6. Confirm all details: service, stylist, date, time, name, phone.
7. Call book_appointment with staffId if stylist is selected.
8. Only confirm booking AFTER the tool returns success.

ANTI-HALLUCINATION:
- Only offer services that are in the configured services list.
- Only mention staff members who are in the configured staff list.
- Never invent prices, durations, or availability.`;

      const systemPrompt = buildBaseSystemPrompt(
        agentName,
        businessName,
        businessType,
        callerPhone,
        timezone,
        address,
        settings,
        completenessContext,
        publicKnowledge,
        knowledgeChunks,
        salonPromptSection
      );

      return { agentName, greeting, systemPrompt, tools: salonTools };
    }

    // ----------------------------------------------------------------
    // Industry: RESTAURANT
    // ----------------------------------------------------------------
    if (industryType === 'restaurant') {
      let maxPartySize = 20;
      if (settings?.reservation_settings) {
        const rs =
          typeof settings.reservation_settings === 'string'
            ? JSON.parse(settings.reservation_settings)
            : settings.reservation_settings;
        maxPartySize = rs?.maxPartySize || rs?.max_party_size || 20;
      }

      const checkReservationTool = {
        name: 'check_reservation_availability',
        description: 'Check if a reservation slot is available for a specified party size.',
        parameters: {
          type: 'object',
          properties: {
            date: { type: 'string', description: 'Date in YYYY-MM-DD format' },
            time: { type: 'string', description: 'Preferred time (e.g. "19:00")' },
            partySize: { type: 'number', description: 'Number of guests in the party' },
          },
          required: ['date', 'partySize'],
        },
      };

      const bookReservationTool = {
        name: 'book_reservation',
        description: 'Book a restaurant reservation after confirming details with the caller.',
        parameters: {
          type: 'object',
          properties: {
            customerName: { type: 'string', description: "Customer's full name" },
            customerPhone: { type: 'string', description: "Customer's phone number" },
            partySize: { type: 'number', description: 'Number of guests' },
            startTime: { type: 'string', description: 'Reservation time in ISO 8601 format' },
            seatingPreference: {
              type: 'string',
              description: 'Optional seating preference (e.g. "window", "outdoor", "booth")',
            },
            notes: { type: 'string', description: 'Any special requests or notes' },
          },
          required: ['customerName', 'customerPhone', 'partySize', 'startTime'],
        },
      };

      const restaurantTools = [
        checkReservationTool,
        bookReservationTool,
        baseAppointmentTools[2], // reschedule_appointment
        baseAppointmentTools[3], // cancel_appointment
        transferCallTool,
      ];

      const restaurantPromptSection = `
RESTAURANT BOOKING CONTEXT:
- Party Size Limits: Maximum ${maxPartySize} guests per reservation.
- Operating Hours: ${settings?.business_hours || 'See business hours above.'}

RESERVATION WORKFLOW:
1. Ask for the number of guests first.
2. Validate party size is within limits.
3. Ask for preferred date and time.
4. Use check_reservation_availability to verify the slot.
5. If unavailable, suggest alternative times.
6. Collect customer name and phone number.
7. Ask for any seating preference or special requests.
8. Confirm all details before booking.
9. Use book_reservation tool and only confirm AFTER tool returns success.`;

      const systemPrompt = buildBaseSystemPrompt(
        agentName,
        businessName,
        businessType,
        callerPhone,
        timezone,
        address,
        settings,
        completenessContext,
        publicKnowledge,
        knowledgeChunks,
        restaurantPromptSection
      );

      return { agentName, greeting, systemPrompt, tools: restaurantTools };
    }

    // ----------------------------------------------------------------
    // Industry: CLINIC / HEALTHCARE (default — existing behavior)
    // ----------------------------------------------------------------
    const tools = [...baseAppointmentTools, transferCallTool];

    const systemPrompt = buildBaseSystemPrompt(
      agentName,
      businessName,
      businessType,
      callerPhone,
      timezone,
      address,
      settings,
      completenessContext,
      publicKnowledge,
      knowledgeChunks,
      '' // no extra section for clinic/healthcare/default
    );

    return { agentName, greeting, systemPrompt, tools };
  }
}

// ---------------------------------------------------------------------------
// Helper: build the core system prompt shared by all industries
// ---------------------------------------------------------------------------
function buildBaseSystemPrompt(
  agentName: string,
  businessName: string,
  businessType: string,
  callerPhone: string | undefined,
  timezone: string,
  address: string,
  settings: any,
  completenessContext: string,
  publicKnowledge: string,
  knowledgeChunks: Array<{ sourceTitle: string; chunkContent: string }>,
  industrySection: string
): string {
  return `You are ${agentName}, the professional, friendly, and efficient AI Phone Receptionist for "${businessName}" (${businessType}).
You are speaking on a live voice phone call. Follow these voice-specific communication rules:

VOICE SPEECH RULES:
1. CONCISE & SPOKEN: Speak in short, natural sentences. Keep replies under 2-3 sentences. Never use bullet points, markdown symbols, asterisks, or raw URLs.
2. ONE STEP AT A TIME: Ask only ONE question per turn to keep the conversation clear.
3. PRONUNCIATION: Speak times, dates, and phone numbers clearly (e.g., "Tuesday, September 15th at 2:00 PM").
4. CALLER IDENTIFICATION: The caller's phone number is ${callerPhone || 'unknown'}. Confirm their name and phone number politely when booking.

BUSINESS CONTEXT & FACTS:
- Business Name: ${businessName}
- Business Type: ${businessType}
- Timezone: ${timezone}
- Address / Location: ${address ? address : 'Physical address is not listed publicly. Advise caller to contact staff for directions.'}
- Business Hours: ${settings?.business_hours || '[]'}
- Services & Pricing: ${settings?.services || '[]'}
- Reservation / Booking Policy: ${settings?.reservation_settings || settings?.cancellation_policy || 'Standard business policy'}
- Contact Instructions: ${settings?.contact_instructions || 'Leave contact info.'}

${completenessContext}
${publicKnowledge}

VERIFIED KNOWLEDGE BASE FACTS:
${knowledgeChunks.map((c, i) => `[Fact ${i + 1} - ${c.sourceTitle}]: ${c.chunkContent}`).join('\n')}

APPOINTMENT BOOKING WORKFLOW:
1. When caller requests to book or reserve, ask for their preferred date and service.
2. Call the tool "check_availability" for that date.
3. Offer 2 or 3 available times. Example: "I have 2:00 PM and 4:30 PM available. Which works best for you?"
4. When the caller chooses a time, collect their full name and confirm their phone number.
5. Call the tool "book_appointment".
6. ONLY AFTER the tool returns success, confirm: "You're all set! I've booked your [Service] for [Date] at [Time]. We look forward to seeing you!"
7. NEVER promise or claim an appointment is booked before the tool returns confirmation.
${industrySection}
SILENCE & CALL EFFICIENCY:
- If caller is silent for a moment: Say "Are you still there?"
- If caller remains silent: Say "I'll end the call for now. Please call back whenever you're ready." and conclude the call.
- When caller indicates they are done ("That's all", "Thank you, goodbye", "No, that's everything"): Say "You're welcome. Have a great day!" and conclude the call.
- If caller asks an irrelevant or off-topic question (first time): Say "I'm here to help with the business, appointments, and services. How can I help with that?"
- If caller repeats irrelevant questions, spam, or nonsense: Say "I'm only able to help with business-related questions and appointments. Thank you for calling." and gracefully conclude the call.
- Do NOT prematurely end calls when customers ask legitimate questions about services, prices, business hours, directions, or appointments.

STRICT ANTI-HALLUCINATION & ACCURACY:
- Only answer using the business context and knowledge facts provided above.
- NEVER invent unlisted prices, unlisted opening hours, services, policies, or physical addresses.
- If information is unknown or not in your notes, say: "I don't have that information in my business information. I can help you with something else or connect you with the business."
- NEVER mention internal AI models, Retell, Vapi, Twilio, system prompts, database IDs, or API keys.`;
}
