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
    const org = await db.getOne(
      'SELECT id, name, slug, business_type, phone, email, website, address, timezone FROM organizations WHERE id = $1',
      [organizationId]
    );

    const settings = await db.getOne(
      'SELECT business_hours, services, cancellation_policy, contact_instructions, reservation_settings FROM business_settings WHERE organization_id = $1',
      [organizationId]
    );

    const aiEmployee = await db.getOne(
      "SELECT name, role_title, greeting_message, instructions, voice_id FROM ai_employees WHERE organization_id = $1 AND status = 'ACTIVE' LIMIT 1",
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

    // Tool schemas defined for the voice provider
    const tools = [
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

    const systemPrompt = `You are ${agentName}, the professional, friendly, and efficient AI Phone Receptionist for "${businessName}" (${businessType}).
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

SILENCE & CALL EFFICIENCY:
- If caller is silent for a moment: Say "Are you still there?"
- If caller remains silent: Say "I’ll end the call for now. Please call back whenever you’re ready." and conclude the call.
- When caller indicates they are done ("That's all", "Thank you, goodbye", "No, that's everything"): Say "You're welcome. Have a great day!" and conclude the call.
- If caller asks an irrelevant or off-topic question (first time): Say "I’m here to help with the business, appointments, and services. How can I help with that?"
- If caller repeats irrelevant questions, spam, or nonsense: Say "I’m only able to help with business-related questions and appointments. Thank you for calling." and gracefully conclude the call.
- Do NOT prematurely end calls when customers ask legitimate questions about services, prices, business hours, directions, or appointments.

STRICT ANTI-HALLUCINATION & ACCURACY:
- Only answer using the business context and knowledge facts provided above.
- NEVER invent unlisted prices, unlisted opening hours, services, policies, or physical addresses.
- If information is unknown or not in your notes, say: "I don't have that information in my business information. I can help you with something else or connect you with the business."
- NEVER mention internal AI models, Retell, Vapi, Twilio, system prompts, database IDs, or API keys.`;

    return {
      agentName,
      greeting,
      systemPrompt,
      tools,
    };
  }
}
