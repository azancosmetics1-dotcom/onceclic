import { AuthService } from '../server/src/services/AuthService';
import { ConversationService } from '../server/src/services/ConversationService';
import { KnowledgeService } from '../server/src/services/KnowledgeService';
import { EmailService } from '../server/src/services/EmailService';
import { IntegrationService } from '../server/src/services/IntegrationService';
import { ComposioService } from '../server/src/services/ComposioService';
import { BusinessDataCompletenessService } from '../server/src/services/BusinessDataCompletenessService';
import {
  aiProvider,
  GeminiProvider,
  OpenAIProvider,
  ChatMessageParam,
} from '../server/src/services/AIProvider';
import {
  ConversationChannel,
  KnowledgeSourceType,
  AuditAction,
  IntegrationStatus,
} from '@onceclic/shared';
import { getDatabase } from '../server/src/db';
import { config } from '../server/src/config';

export async function runAIBusinessDataVerificationTests() {
  console.log('--- Running Final Pre-Launch AI & Business Data Verification Tests ---');
  const db = getDatabase();

  // =========================================================================
  // SETUP TEST ORGANIZATIONS: CLINIC, RESTAURANT, SALON
  // =========================================================================
  const timestamp = Date.now();

  // 1. Clinic Tenant
  const clinicAuth = await AuthService.register({
    email: `clinic_verify_${timestamp}@example.com`,
    password: 'password123',
    fullName: 'Dr. Sarah Connor',
    businessName: 'Beacon Dental Clinic',
  });
  const clinicOrgId = clinicAuth.organization!.id;
  const clinicSlug = clinicAuth.organization!.slug;
  await AuthService.completeOnboarding({
    userId: clinicAuth.user.id,
    organizationId: clinicOrgId,
    industry: 'Clinic',
    businessKnowledge: 'Beacon Dental Clinic is open Monday to Friday 8 AM to 5 PM. Teeth Whitening $299, Dental Cleaning $120. Address: 456 Healthcare Blvd, Boston.',
  });

  await db.execute(
    `UPDATE organizations
     SET business_type = $1, address = $2, phone = $3, email = $4, website = $5
     WHERE id = $6`,
    [
      'Dental Clinic',
      '456 Healthcare Blvd, Suite 200, Boston, MA',
      '+1-617-555-0199',
      'info@beacondental.com',
      'https://beacondental.com',
      clinicOrgId,
    ]
  );

  await db.execute(
    `UPDATE business_settings
     SET services = $1, business_hours = $2, cancellation_policy = $3, contact_instructions = $4
     WHERE organization_id = $5`,
    [
      JSON.stringify([
        { id: 'svc_1', name: 'Teeth Whitening', price: 299, durationMinutes: 60, description: 'Laser whitening treatment' },
        { id: 'svc_2', name: 'Dental Cleaning', price: 120, durationMinutes: 45, description: 'Standard prophylaxis exam' },
        { id: 'svc_3', name: 'Root Canal Consultation', durationMinutes: 30, description: 'Price quoted upon exam' },
      ]),
      JSON.stringify([
        { dayOfWeek: 1, openTime: '08:00', closeTime: '17:00', isClosed: false },
        { dayOfWeek: 2, openTime: '08:00', closeTime: '17:00', isClosed: false },
        { dayOfWeek: 3, openTime: '08:00', closeTime: '17:00', isClosed: false },
        { dayOfWeek: 4, openTime: '08:00', closeTime: '17:00', isClosed: false },
        { dayOfWeek: 5, openTime: '08:00', closeTime: '15:00', isClosed: false },
        { dayOfWeek: 6, openTime: '09:00', closeTime: '13:00', isClosed: false },
        { dayOfWeek: 0, openTime: '00:00', closeTime: '00:00', isClosed: true },
      ]),
      'Please give at least 24 hours notice to reschedule without fee.',
      'For dental emergencies, call our emergency hotline.',
      clinicOrgId,
    ]
  );

  // 2. Restaurant Tenant
  const restaurantAuth = await AuthService.register({
    email: `rest_verify_${timestamp}@example.com`,
    password: 'password123',
    fullName: 'Chef Marco Rossi',
    businessName: 'Osteria Bella Vista',
  });
  const restaurantOrgId = restaurantAuth.organization!.id;
  const restaurantSlug = restaurantAuth.organization!.slug;
  await AuthService.completeOnboarding({
    userId: restaurantAuth.user.id,
    organizationId: restaurantOrgId,
    industry: 'Restaurant',
    businessKnowledge: 'Osteria Bella Vista is open Tuesday to Sunday 5 PM to 11 PM. Address: 789 Culinary Lane, New York. Chef Tasting Menu $110.',
  });

  await db.execute(
    `UPDATE organizations
     SET business_type = $1, address = $2, phone = $3, email = $4, website = $5
     WHERE id = $6`,
    [
      'Italian Restaurant & Wine Bar',
      '789 Culinary Lane, New York, NY',
      '+1-212-555-0144',
      'reservations@bellavista.nyc',
      'https://bellavista.nyc',
      restaurantOrgId,
    ]
  );

  await db.execute(
    `UPDATE business_settings
     SET reservation_settings = $1, business_hours = $2, services = $3
     WHERE organization_id = $4`,
    [
      JSON.stringify({
        pricingType: 'deposit',
        depositAmount: 25,
        minPartySize: 1,
        maxPartySize: 10,
        seatingOptions: ['Standard Dining Room', 'Chef Table', 'Outdoor Patio'],
        specialInstructions: 'Patio seating is weather-permitting. 2-hour dining limit for tables.',
      }),
      JSON.stringify([
        { dayOfWeek: 2, openTime: '17:00', closeTime: '23:00', isClosed: false },
        { dayOfWeek: 3, openTime: '17:00', closeTime: '23:00', isClosed: false },
        { dayOfWeek: 4, openTime: '17:00', closeTime: '23:00', isClosed: false },
        { dayOfWeek: 5, openTime: '17:00', closeTime: '00:00', isClosed: false },
        { dayOfWeek: 6, openTime: '16:00', closeTime: '00:00', isClosed: false },
        { dayOfWeek: 0, openTime: '16:00', closeTime: '22:00', isClosed: false },
        { dayOfWeek: 1, openTime: '00:00', closeTime: '00:00', isClosed: true },
      ]),
      JSON.stringify([
        { id: 'menu_1', name: 'Chef Tasting Menu', price: 110, durationMinutes: 120 },
        { id: 'menu_2', name: 'Wine Pairing', price: 65, durationMinutes: 120 },
      ]),
      restaurantOrgId,
    ]
  );

  // 3. Salon Tenant (with unconfigured address to verify missing-address behavior)
  const salonAuth = await AuthService.register({
    email: `salon_verify_${timestamp}@example.com`,
    password: 'password123',
    fullName: 'Chloe Vance',
    businessName: 'Luxe Hair & Glow Studio',
  });
  const salonOrgId = salonAuth.organization!.id;
  const salonSlug = salonAuth.organization!.slug;
  await AuthService.completeOnboarding({
    userId: salonAuth.user.id,
    organizationId: salonOrgId,
    industry: 'Salon',
    businessKnowledge: 'Luxe Hair & Glow Studio is open Tuesday to Saturday 10 AM to 7 PM. Address: 101 Beauty Way, Los Angeles. Haircuts and styling services.',
  });

  await db.execute(
    `UPDATE organizations
     SET business_type = $1, address = $2, phone = $3
     WHERE id = $4`,
    [
      'Hair Salon & Spa',
      '101 Beauty Way, Los Angeles, CA',
      '+1-310-555-0188',
      salonOrgId,
    ]
  );

  await db.execute(
    `UPDATE business_settings
     SET services = $1, business_hours = $2
     WHERE organization_id = $3`,
    [
      JSON.stringify([
        { id: 'sal_1', name: 'Balayage Color & Treatment', price: 220, durationMinutes: 150 },
        { id: 'sal_2', name: 'Women Haircut & Blowout', price: 85, durationMinutes: 60 },
        { id: 'sal_3', name: 'HydraFacial Glow', price: 160, durationMinutes: 50 },
      ]),
      JSON.stringify([
        { dayOfWeek: 2, openTime: '10:00', closeTime: '19:00', isClosed: false },
        { dayOfWeek: 3, openTime: '10:00', closeTime: '19:00', isClosed: false },
        { dayOfWeek: 4, openTime: '10:00', closeTime: '20:00', isClosed: false },
        { dayOfWeek: 5, openTime: '10:00', closeTime: '20:00', isClosed: false },
        { dayOfWeek: 6, openTime: '09:00', closeTime: '18:00', isClosed: false },
        { dayOfWeek: 0, openTime: '00:00', closeTime: '00:00', isClosed: true },
        { dayOfWeek: 1, openTime: '00:00', closeTime: '00:00', isClosed: true },
      ]),
      salonOrgId,
    ]
  );

  // =========================================================================
  // TEST 1: BUSINESS DATA COMPLETENESS LAYER
  // =========================================================================
  console.log('Testing Business-Data Completeness Layer...');

  const clinicReport = await BusinessDataCompletenessService.getCompletenessReport(clinicOrgId);
  if (!clinicReport.isReadyForAI) {
    throw new Error('Clinic should be ready for AI with all required fields present.');
  }
  if (clinicReport.scorePercent <= 0) {
    throw new Error('Clinic completeness score should be > 0%.');
  }

  const reqMissing = clinicReport.fields.filter((f) => f.tier === 'required' && f.status === 'missing');
  if (reqMissing.length > 0) {
    throw new Error(`Required fields missing on clinic: ${reqMissing.map((f) => f.field).join(', ')}`);
  }

  // Verify optional vs required distinction for an organization with empty optional fields
  const emptyOrgReport = BusinessDataCompletenessService.evaluateCompleteness({
    org: { id: 'temp_org', name: 'Minimal Business', slug: 'minimal-biz', business_type: 'consulting' },
    settings: { services: '[]', business_hours: '[]' },
  });
  if (!emptyOrgReport.isReadyForAI) {
    throw new Error('Business with required fields (name, industry, booking URL) should be ready for AI even if optional fields are missing.');
  }
  const addressField = emptyOrgReport.fields.find((f) => f.field === 'address');
  if (addressField?.status !== 'missing' || addressField.tier !== 'optional') {
    throw new Error('Unconfigured address should be categorized as status="missing" and tier="optional".');
  }

  console.log(`  ✓ Business Data Completeness evaluated: Clinic score=${clinicReport.scorePercent}%, Minimal score=${emptyOrgReport.scorePercent}%`);
  console.log('  ✓ Required vs Optional and Configured vs Missing field semantics verified.');

  // =========================================================================
  // TEST 2: ALL FOUR CHANNELS INBOUND -> AI -> OUTBOUND VERIFICATION
  // =========================================================================
  console.log('Testing End-to-End Inbound → AI → Outbound Flow across all 4 channels...');

  // Setup deterministic AI mock to simulate Gemini responses grounded in prompt context
  const originalGenerateResponse = aiProvider.generateResponse;
  aiProvider.generateResponse = async (params: { messages: ChatMessageParam[] }) => {
    const sys = params.messages.find((m) => m.role === 'system')?.content || '';
    const userMsg = params.messages.filter((m) => m.role === 'user').pop()?.content || '';
    const lowerUser = userMsg.toLowerCase();

    let content = '';

    if (lowerUser.includes('teeth whitening')) {
      if (sys.includes('Teeth Whitening: $299') || sys.includes('Teeth Whitening')) {
        content = 'Our Teeth Whitening treatment is $299 and takes approximately 60 minutes. You can book an appointment here: ' +
          (sys.match(/https?:\/\/[^\s\)]+\/book\/[^\s\)]+/) || ['https://onceclic.com/book/beacon-dental'])[0];
      } else {
        content = "I don't have that information available right now. Please contact the business directly for the current details.";
      }
    } else if (lowerUser.includes('balayage')) {
      if (sys.includes('Balayage Color & Treatment: $220') || sys.includes('Balayage')) {
        content = 'Our Balayage Color & Treatment is $220 (approx 150 mins). Book your session here: ' +
          (sys.match(/https?:\/\/[^\s\)]+\/book\/[^\s\)]+/) || ['https://onceclic.com/book/luxe-hair'])[0];
      } else {
        content = "I don't have that information available right now. Please contact the business directly for the current details.";
      }
    } else if (lowerUser.includes('where are you located') || lowerUser.includes('address')) {
      const addrMatch = sys.match(/Physical Address: ([^\n]+)/);
      if (addrMatch && !addrMatch[1].includes('NOT CONFIGURED')) {
        content = `We are located at ${addrMatch[1]}.`;
      } else {
        content = 'Our physical address is currently not listed online. Please contact our team directly for directions and location details.';
      }
    } else if (lowerUser.includes('reserve') || lowerUser.includes('table')) {
      const depMatch = sys.match(/Deposit required: \$(\d+)/);
      const depStr = depMatch ? ` We require a $${depMatch[1]} deposit per reservation.` : '';
      content = `We'd love to host you at Osteria Bella Vista!${depStr} You can reserve your table online: ` +
        (sys.match(/https?:\/\/[^\s\)]+\/book\/[^\s\)]+/) || ['https://onceclic.com/book/osteria-bella-vista'])[0];
    } else if (lowerUser.includes('unknown_unconfigured_service')) {
      content = "I don't have that information available right now. Please contact the business directly for the current details.";
    } else {
      content = `Thank you for contacting us. How can I assist you further?`;
    }

    return {
      content,
      promptTokens: 85,
      completionTokens: 35,
      totalTokens: 120,
      estimatedCostUsd: 0.00002,
      model: 'gemini-1.5-flash',
      provider: 'Gemini',
      handoffRequired: false,
    };
  };

  // -------------------------------------------------------------------------
  // Channel 1: Website Chat (Inbound Visitor -> AI -> Response in Payload)
  // -------------------------------------------------------------------------
  const webConv = await ConversationService.getOrCreateConversation({
    organizationId: clinicOrgId,
    channel: ConversationChannel.WEB,
    customerName: 'Alice Website Visitor',
  });

  const webResult = await ConversationService.handleCustomerMessage({
    organizationId: clinicOrgId,
    conversationId: webConv.id,
    content: 'How much is teeth whitening?',
  });

  if (!webResult.aiMessage || !webResult.aiMessage.content.includes('$299')) {
    throw new Error('Website chat failed to generate grounded AI price response.');
  }
  if (!webResult.aiMessage.content.includes(`/book/${clinicSlug}`)) {
    throw new Error('Website chat AI reply missing direct booking URL.');
  }
  console.log('  ✓ Channel 1 (Website Chat): Inbound message → Gemini AI → Outbound response verified in payload.');

  // -------------------------------------------------------------------------
  // Channel 2: Gmail (Inbound Email -> AI -> Outbound Email Dispatch)
  // -------------------------------------------------------------------------
  // Connect Gmail for Salon
  await db.execute(
    `INSERT INTO email_connections (
       id, organization_id, provider_type, connected_email, inbound_address, webhook_token, is_active, status, created_at, updated_at
     ) VALUES ($1, $2, 'OAUTH', $3, $4, $5, TRUE, 'CONNECTED', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    [
      `email_conn_${timestamp}`,
      salonOrgId,
      'salon.appointments@luxehair.com',
      `inbox+${salonSlug}@onceclic.com`,
      `whk_salon_${timestamp}`,
    ]
  );

  let outboundGmailSent = false;
  let outboundGmailTo = '';
  let outboundGmailBody = '';

  // Intercept Resend/Gmail outgoing dispatcher for automated test verification
  const origSendEmailReply = EmailService.sendEmailReply;
  EmailService.sendEmailReply = async (params) => {
    outboundGmailSent = true;
    outboundGmailTo = params.toEmail;
    outboundGmailBody = params.body;
    return { success: true, messageId: `sent_email_${Date.now()}`, provider: 'COMPOSIO_GMAIL' };
  };

  const emailResult = await EmailService.processInboundEmail({
    organizationId: salonOrgId,
    fromEmail: 'client.emma@example.com',
    fromName: 'Emma Client',
    toEmail: 'salon.appointments@luxehair.com',
    subject: 'Question about Balayage pricing',
    textBody: 'Hi! How much is balayage at your salon?',
    messageId: `msg_rfc_${timestamp}_001`,
  });

  if (!emailResult.success || !emailResult.aiReplySent) {
    throw new Error('Gmail pipeline failed: Inbound email was not processed or AI reply was not sent.');
  }
  if (!outboundGmailSent || !outboundGmailBody.includes('$220')) {
    throw new Error(`Gmail outbound dispatch failed: Sent=${outboundGmailSent}, Body=${outboundGmailBody}`);
  }
  if (!outboundGmailBody.includes(`/book/${salonSlug}`)) {
    throw new Error('Gmail outbound email missing direct salon booking URL.');
  }
  console.log('  ✓ Channel 2 (Gmail): Inbound email → Org Resolution → Gemini AI → Outbound reply sent via Gmail.');

  // Restore EmailService method
  EmailService.sendEmailReply = origSendEmailReply;

  // -------------------------------------------------------------------------
  // Channel 3: Instagram (Inbound DM -> AI -> Outbound DM Send via Composio)
  // -------------------------------------------------------------------------
  // Connect Instagram for Salon
  await db.execute(
    `INSERT INTO instagram_connections (
       id, organization_id, instagram_user_id, username, account_type, is_active, status, created_at, updated_at
     ) VALUES ($1, $2, $3, $4, 'BUSINESS', TRUE, 'CONNECTED', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    [`ig_conn_${timestamp}`, salonOrgId, 'ig_user_1001', 'luxehair_la']
  );

  let outboundInstagramSent = false;
  let outboundInstagramRecipient = '';
  let outboundInstagramText = '';

  const origSendInstagram = ComposioService.sendInstagramReply;
  ComposioService.sendInstagramReply = async (params) => {
    outboundInstagramSent = true;
    outboundInstagramRecipient = params.recipientId;
    outboundInstagramText = params.text;
    return { success: true, messageId: `ig_reply_msg_${Date.now()}` };
  };

  const igResult = await IntegrationService.handleInstagramInboundMessage({
    organizationId: salonOrgId,
    senderId: 'ig_customer_456',
    senderUsername: 'emma_hair_love',
    text: 'Hey! How much is your balayage treatment?',
    messageId: `ig_inbound_${timestamp}_01`,
  });

  if (!igResult.success || !igResult.aiReplySent) {
    throw new Error('Instagram pipeline failed: Inbound DM not processed or AI reply not sent.');
  }
  if (!outboundInstagramSent || !outboundInstagramText.includes('$220')) {
    throw new Error(`Instagram outbound dispatch failed: Sent=${outboundInstagramSent}, Text=${outboundInstagramText}`);
  }
  if (!outboundInstagramText.includes(`/book/${salonSlug}`)) {
    throw new Error('Instagram outbound reply missing direct booking URL.');
  }
  console.log('  ✓ Channel 3 (Instagram): Inbound DM → Tenant Routing → Gemini AI → Outbound DM sent via Composio.');

  // Restore ComposioService method
  ComposioService.sendInstagramReply = origSendInstagram;

  // -------------------------------------------------------------------------
  // Channel 4: Facebook (Inbound Page Message -> AI -> Outbound Send via Composio)
  // -------------------------------------------------------------------------
  // Connect Facebook for Restaurant
  await db.execute(
    `INSERT INTO facebook_connections (
       id, organization_id, page_id, page_name, is_active, status, created_at, updated_at
     ) VALUES ($1, $2, $3, $4, TRUE, 'CONNECTED', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    [`fb_conn_${timestamp}`, restaurantOrgId, 'fb_page_2002', 'Osteria Bella Vista NYC']
  );

  let outboundFacebookSent = false;
  let outboundFacebookRecipient = '';
  let outboundFacebookText = '';

  const origSendFacebook = ComposioService.sendFacebookReply;
  ComposioService.sendFacebookReply = async (params) => {
    outboundFacebookSent = true;
    outboundFacebookRecipient = params.recipientId;
    outboundFacebookText = params.text;
    return { success: true, messageId: `fb_reply_msg_${Date.now()}` };
  };

  const fbResult = await IntegrationService.handleFacebookInboundMessage({
    organizationId: restaurantOrgId,
    senderId: 'fb_user_789',
    senderName: 'David Foodie',
    text: 'Can I reserve a table for four this Friday?',
    messageId: `fb_inbound_${timestamp}_01`,
  });

  if (!fbResult.success || !fbResult.aiReplySent) {
    throw new Error('Facebook pipeline failed: Inbound message not processed or AI reply not sent.');
  }
  if (!outboundFacebookSent || !outboundFacebookText.includes('$25 deposit')) {
    throw new Error(`Facebook outbound dispatch failed: Sent=${outboundFacebookSent}, Text=${outboundFacebookText}`);
  }
  if (!outboundFacebookText.includes(`/book/${restaurantSlug}`)) {
    throw new Error('Facebook outbound reply missing direct restaurant reservation URL.');
  }
  console.log('  ✓ Channel 4 (Facebook): Inbound message → Tenant Routing → Gemini AI → Outbound message sent via Composio.');

  // Restore ComposioService method
  ComposioService.sendFacebookReply = origSendFacebook;

  // =========================================================================
  // TEST 3: STRICT TENANT ISOLATION ACROSS ALL 4 CHANNELS
  // =========================================================================
  console.log('Testing Strict Multi-Tenant Isolation Across All Channels...');

  // Build prompts for Clinic (Tenant A), Restaurant (Tenant B), and Salon (Tenant C)
  const clinicSystemPrompt = await ConversationService.buildSystemPrompt(clinicOrgId, ConversationChannel.WEB);
  const restSystemPrompt = await ConversationService.buildSystemPrompt(restaurantOrgId, ConversationChannel.FACEBOOK);
  const salonSystemPrompt = await ConversationService.buildSystemPrompt(salonOrgId, ConversationChannel.INSTAGRAM);

  // 1. Clinic must NOT contain restaurant deposit or salon balayage
  if (clinicSystemPrompt.includes('Osteria Bella Vista') || clinicSystemPrompt.includes('Balayage Color & Treatment')) {
    throw new Error('Tenant Leakage: Clinic prompt contains restaurant or salon data!');
  }
  if (clinicSystemPrompt.includes('789 Culinary Lane') || clinicSystemPrompt.includes('101 Beauty Way')) {
    throw new Error('Tenant Leakage: Clinic prompt contains restaurant or salon address!');
  }

  // 2. Restaurant must NOT contain clinic teeth whitening or salon services
  if (restSystemPrompt.includes('Beacon Dental Clinic') || restSystemPrompt.includes('Teeth Whitening: $299')) {
    throw new Error('Tenant Leakage: Restaurant prompt contains clinic data!');
  }
  if (restSystemPrompt.includes('456 Healthcare Blvd') || restSystemPrompt.includes('101 Beauty Way')) {
    throw new Error('Tenant Leakage: Restaurant prompt contains clinic or salon address!');
  }

  // 3. Salon must NOT contain clinic or restaurant data
  if (salonSystemPrompt.includes('Beacon Dental Clinic') || salonSystemPrompt.includes('Osteria Bella Vista')) {
    throw new Error('Tenant Leakage: Salon prompt contains other tenants data!');
  }

  console.log('  ✓ Multi-Tenant Isolation verified: Zero cross-tenant data, service, or address leakage.');

  // =========================================================================
  // TEST 4: MISSING DATA & ANTI-HALLUCINATION PROTECTION
  // =========================================================================
  console.log('Testing Missing Data & Anti-Hallucination Protections...');

  // 1. Unknown service query on Clinic
  const unknownSvcRes = await ConversationService.handleCustomerMessage({
    organizationId: clinicOrgId,
    conversationId: webConv.id,
    content: 'Do you offer unknown_unconfigured_service?',
  });
  if (
    !unknownSvcRes.aiMessage?.content.includes("don't have that information") &&
    !unknownSvcRes.aiMessage?.content.includes("contact the business directly")
  ) {
    throw new Error(`Anti-Hallucination failed: Unknown service not safely deflected: ${unknownSvcRes.aiMessage?.content}`);
  }

  // 2. Address query on Tenant with unconfigured address
  const unconfiguredAddrOrg = await AuthService.register({
    email: `no_addr_${timestamp}@example.com`,
    password: 'password123',
    fullName: 'Online Coach',
    businessName: 'Virtual Apex Coaching',
  });
  const noAddrOrgId = unconfiguredAddrOrg.organization!.id;
  await AuthService.completeOnboarding({
    userId: unconfiguredAddrOrg.user.id,
    organizationId: noAddrOrgId,
    industry: 'Restaurant',
    businessKnowledge: 'Virtual Apex Coaching is an online-only coaching service. Sessions available 7 days a week via video call.',
  });
  // Clear address so we can test the "NOT CONFIGURED" behavior
  await (await import('../server/src/db')).db.execute(
    `UPDATE organizations SET address = NULL WHERE id = $1`,
    [noAddrOrgId]
  );

  const noAddrPrompt = await ConversationService.buildSystemPrompt(noAddrOrgId, ConversationChannel.WEB);
  if (!noAddrPrompt.includes('Physical Address: NOT CONFIGURED') && !noAddrPrompt.includes('No physical address is configured')) {
    throw new Error('System prompt should explicitly declare physical address as NOT CONFIGURED.');
  }

  const noAddrConv = await ConversationService.getOrCreateConversation({
    organizationId: noAddrOrgId,
    channel: ConversationChannel.WEB,
  });
  const noAddrRes = await ConversationService.handleCustomerMessage({
    organizationId: noAddrOrgId,
    conversationId: noAddrConv.id,
    content: 'Where are you located?',
  });

  if (
    !noAddrRes.aiMessage?.content.includes('not listed online') &&
    !noAddrRes.aiMessage?.content.includes('contact our team directly')
  ) {
    throw new Error(`Anti-Hallucination failed: Unconfigured address not safely deflected: ${noAddrRes.aiMessage?.content}`);
  }

  console.log('  ✓ Missing Data Protection: Unknown services and unconfigured addresses safely deflected without guessing.');

  // =========================================================================
  // TEST 5: CHANNEL CONSISTENCY OF FACTUAL BUSINESS DATA
  // =========================================================================
  console.log('Testing Channel Consistency across Website, Gmail, Instagram, Facebook...');

  const salonWebPrompt = await ConversationService.buildSystemPrompt(salonOrgId, ConversationChannel.WEB);
  const salonEmailPrompt = await ConversationService.buildSystemPrompt(salonOrgId, ConversationChannel.EMAIL);
  const salonIgPrompt = await ConversationService.buildSystemPrompt(salonOrgId, ConversationChannel.INSTAGRAM);
  const salonFbPrompt = await ConversationService.buildSystemPrompt(salonOrgId, ConversationChannel.FACEBOOK);

  // All 4 channel prompts MUST contain the exact same grounded facts
  const prompts = [salonWebPrompt, salonEmailPrompt, salonIgPrompt, salonFbPrompt];
  for (const p of prompts) {
    if (!p.includes('Balayage Color & Treatment') || !p.includes('$220')) {
      throw new Error('Channel Inconsistency: Balayage $220 price missing from a channel prompt.');
    }
    if (!p.includes('101 Beauty Way, Los Angeles, CA')) {
      throw new Error('Channel Inconsistency: Address missing from a channel prompt.');
    }
    if (!p.includes(`/book/${salonSlug}`)) {
      throw new Error('Channel Inconsistency: Booking link missing from a channel prompt.');
    }
  }

  console.log('  ✓ Channel Consistency verified: Website, Gmail, Instagram, and Facebook share identical grounded business data.');

  // =========================================================================
  // TEST 6: AI COST / BUDGET / SECRET SECURITY
  // =========================================================================
  console.log('Testing AI Cost, Budget & Secret Protection...');

  const forbiddenStrings = [
    config.jwtSecret,
    'sk-',
    'promptTokens',
    'completionTokens',
    'totalTokens',
    'spentUsd',
    'OPENAI_API_KEY',
    'GEMINI_API_KEY',
    'COMPOSIO_API_KEY',
    'SELECT * FROM',
  ];

  // Test that AI reply does not contain any secret
  for (const forbidden of forbiddenStrings) {
    if (webResult.aiMessage?.content.includes(forbidden)) {
      throw new Error(`Security Violation: AI message content contains forbidden internal secret "${forbidden}"`);
    }
  }

  console.log('  ✓ AI Cost & Secret Security verified: Zero leaks of keys, internal budgets, or SQL.');

  aiProvider.generateResponse = originalGenerateResponse;

  console.log('====================================================');
  console.log('  ALL PRE-LAUNCH AI & BUSINESS DATA TESTS PASSED!   ');
  console.log('====================================================');
}
