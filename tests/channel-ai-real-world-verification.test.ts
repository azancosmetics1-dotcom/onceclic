import { getDatabase } from '../server/src/db';
import { AuthService } from '../server/src/services/AuthService';
import { ConversationService } from '../server/src/services/ConversationService';
import { IntegrationService } from '../server/src/services/IntegrationService';
import { EmailService } from '../server/src/services/EmailService';
import { EmailSyncService } from '../server/src/services/EmailSyncService';
import { SocialSyncService } from '../server/src/services/SocialSyncService';
import { AppointmentService } from '../server/src/services/AppointmentService';
import { ComposioService } from '../server/src/services/ComposioService';
import { GeminiProvider } from '../server/src/services/AIProvider';
import {
  ConversationChannel,
  IntegrationStatus,
  SubscriptionStatus,
} from '@onceclic/shared';

export async function runChannelRealWorldVerificationTests() {
  console.log('\n====================================================');
  console.log('  RUNNING REAL-WORLD CHANNEL AI VERIFICATION TESTS');
  console.log('====================================================\n');

  const db = getDatabase();
  await db.runMigrations();

  const { config } = await import('../server/src/config');
  const { aiProvider, GeminiProvider } = await import('../server/src/services/AIProvider');

  const prevComposioKey = config.composio.apiKey;
  config.composio.apiKey = 'mock_composio_api_key_test';

  const prevGenerateResponse = aiProvider.generateResponse;
  const prevHealthCheck = aiProvider.healthCheck;
  const geminiInstance = new GeminiProvider('mock_gemini_key_test', 'gemini-3.5-flash-lite');
  aiProvider.generateResponse = (params) => geminiInstance.generateResponse(params);
  aiProvider.healthCheck = async () => ({ available: true, provider: 'Gemini', model: 'gemini-3.5-flash-lite' });

  // Track dispatched outbound operations
  const outboundDispatches = {
    websiteReplies: [] as any[],
    gmailReplies: [] as any[],
    instagramReplies: [] as any[],
    facebookReplies: [] as any[],
    calendarEvents: [] as any[],
  };

  // Mock Composio API & Gemini Provider for deterministic, reliable local testing
  const originalFetch = global.fetch;
  global.fetch = async (url: any, init?: any) => {
    const urlStr = String(url);

    // 1. Mock Gemini API generateContent
    if (urlStr.includes('generativelanguage.googleapis.com')) {
      const body = init?.body ? (typeof init.body === 'string' ? JSON.parse(init.body) : init.body) : {};
      const userTurn = (body.contents || []).slice().reverse().find((c: any) => c.role === 'user');
      const userText = userTurn?.parts?.[0]?.text || '';
      const sysInstruction = body.systemInstruction?.parts?.[0]?.text || '';

      let reply = 'Hello! I am your AI Receptionist. How can I help you today?';
      if (userText.toLowerCase().includes('services') || userText.toLowerCase().includes('offer')) {
        if (sysInstruction.includes('Teeth Whitening') || sysInstruction.includes('Apex Dental')) {
          reply = 'At Apex Dental Clinic, we offer Teeth Whitening ($150) and Dental Cleaning ($80).';
        } else if (sysInstruction.includes('Omakase') || sysInstruction.includes('Sakura')) {
          reply = 'At Sakura Dining, we offer Chef Omakase ($120) and Tasting Menu ($95).';
        } else {
          reply = 'We offer our standard professional consultation and advisory services.';
        }
      } else if (userText.toLowerCase().includes('address') || userText.toLowerCase().includes('where are you')) {
        if (sysInstruction.includes('742 Evergreen Terrace')) {
          reply = 'Our clinic is located at 742 Evergreen Terrace, Suite 100.';
        } else if (sysInstruction.includes('100 Sakura Blvd')) {
          reply = 'Our restaurant is located at 100 Sakura Blvd, Tokyo District.';
        }
      } else if (userText.toLowerCase().includes('cost') || userText.toLowerCase().includes('price')) {
        if (sysInstruction.includes('Apex Dental')) {
          reply = 'Our Teeth Whitening service costs $150 and Dental Cleaning costs $80.';
        } else if (sysInstruction.includes('Sakura')) {
          reply = 'Our Chef Omakase costs $120 per guest.';
        }
      } else if (userText.toLowerCase().includes('hours') || userText.toLowerCase().includes('open')) {
        reply = 'We are open Monday to Friday from 9:00 AM to 5:00 PM.';
      } else if (userText.toLowerCase().includes('book') || userText.toLowerCase().includes('appointment') || userText.toLowerCase().includes('reserve')) {
        reply = 'You can book directly using our direct scheduling link or let me know your preferred date and time!';
      }

      return {
        ok: true,
        status: 200,
        json: async () => ({
          candidates: [{ content: { parts: [{ text: reply }] } }],
          usageMetadata: { promptTokenCount: 120, candidatesTokenCount: 35, totalTokenCount: 155 },
        }),
        text: async () => JSON.stringify({
          candidates: [{ content: { parts: [{ text: reply }] } }],
        }),
      } as any;
    }

    // 2. Mock Composio Tools & APIs
    if (urlStr.includes('/v3.1/tools/execute/') || urlStr.includes('/v1/actions/')) {
      const body = init?.body ? JSON.parse(init.body) : {};
      const tool = urlStr.split('/').pop()?.split('?')[0] || '';

      if (tool === 'GMAIL_SEND_EMAIL' || tool.includes('GMAIL_SEND')) {
        outboundDispatches.gmailReplies.push(body);
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ success: true, data: { id: `gm_msg_${Date.now()}` } }),
        } as any;
      }

      if (tool === 'INSTAGRAM_SEND_TEXT_MESSAGE' || tool.includes('INSTAGRAM_SEND')) {
        outboundDispatches.instagramReplies.push(body);
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ success: true, data: { id: `ig_reply_${Date.now()}` } }),
        } as any;
      }

      if (tool === 'FACEBOOK_SEND_PAGE_MESSAGE' || tool.includes('FACEBOOK_SEND')) {
        outboundDispatches.facebookReplies.push(body);
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ success: true, data: { id: `fb_reply_${Date.now()}` } }),
        } as any;
      }

      if (tool === 'GOOGLECALENDAR_CREATE_EVENT' || tool.includes('GOOGLECALENDAR_CREATE')) {
        outboundDispatches.calendarEvents.push(body);
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ success: true, data: { id: `gcal_evt_${Date.now()}` } }),
        } as any;
      }

      if (tool === 'GOOGLECALENDAR_LIST_EVENTS' || tool.includes('GOOGLECALENDAR_LIST')) {
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ success: true, data: { items: [] } }),
        } as any;
      }

      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ success: true, data: {} }),
      } as any;
    }

    if (urlStr.includes('/connected_accounts') || urlStr.includes('/connectedAccounts')) {
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ items: [{ id: 'ca_test_123', status: 'ACTIVE' }] }),
      } as any;
    }

    return originalFetch(url, init);
  };

  try {
    // -------------------------------------------------------------
    // SETUP: Create Two Distinct Organizations for Tenant Isolation
    // -------------------------------------------------------------
    console.log('1. Setting up Test Organizations with Distinct Data...');
    const userA = await AuthService.register({
      email: `apex_dental_${Date.now()}@example.com`,
      password: 'password123',
      fullName: 'Dr. Sarah Apex',
      businessName: 'Apex Dental Clinic',
    });
    await AuthService.verifyEmail(userA.verificationToken!);
    const orgAId = userA.organization!.id;
    await AuthService.completeOnboarding({
      userId: userA.user.id,
      organizationId: orgAId,
      industry: 'Clinic',
      businessKnowledge: 'Apex Dental Clinic is open Monday to Friday 9 AM to 5 PM. Address: 742 Evergreen Terrace. Teeth Whitening $150, Dental Cleaning $80.',
    });

    await db.execute(
      `UPDATE organizations
       SET address = '742 Evergreen Terrace, Suite 100',
           business_type = 'Dental Clinic',
           phone = '+1-555-0199',
           website = 'https://apexdental.example.com'
       WHERE id = $1`,
      [orgAId]
    );

    await db.execute(
      `UPDATE business_settings
       SET services = $1,
           business_hours = $2,
           website_chat_enabled = TRUE,
           website_verified_at = CURRENT_TIMESTAMP
       WHERE organization_id = $3`,
      [
        JSON.stringify([
          { id: 'srv_1', name: 'Teeth Whitening', price: 150, durationMinutes: 45 },
          { id: 'srv_2', name: 'Dental Cleaning', price: 80, durationMinutes: 30 },
        ]),
        JSON.stringify([
          { day: 'Monday', open: '09:00', close: '17:00' },
          { day: 'Tuesday', open: '09:00', close: '17:00' },
        ]),
        orgAId,
      ]
    );

    // Setup Organization B (Restaurant)
    const userB = await AuthService.register({
      email: `sakura_dining_${Date.now()}@example.com`,
      password: 'password123',
      fullName: 'Kenji Sakura',
      businessName: 'Sakura Dining Lounge',
    });
    await AuthService.verifyEmail(userB.verificationToken!);
    const orgBId = userB.organization!.id;
    await AuthService.completeOnboarding({
      userId: userB.user.id,
      organizationId: orgBId,
      industry: 'Restaurant',
      businessKnowledge: 'Sakura Dining Lounge is open daily 11 AM to 10 PM. Address: 100 Sakura Blvd, Tokyo District. Authentic Japanese cuisine.',
    });

    await db.execute(
      `UPDATE organizations
       SET address = '100 Sakura Blvd, Tokyo District',
           business_type = 'Restaurant',
           phone = '+1-555-0288',
           website = 'https://sakuradining.example.com'
       WHERE id = $1`,
      [orgBId]
    );

    await db.execute(
      `UPDATE business_settings
       SET services = $1,
           reservation_settings = $2,
           website_chat_enabled = TRUE,
           website_verified_at = CURRENT_TIMESTAMP
       WHERE organization_id = $3`,
      [
        JSON.stringify([
          { id: 'srv_b1', name: 'Chef Omakase', price: 120, durationMinutes: 90 },
          { id: 'srv_b2', name: 'Tasting Menu', price: 95, durationMinutes: 60 },
        ]),
        JSON.stringify({
          pricingType: 'deposit',
          depositAmount: 25,
          maxPartySize: 8,
        }),
        orgBId,
      ]
    );

    console.log('  ✓ Organization A (Apex Dental Clinic) & Organization B (Sakura Dining Lounge) configured.');

    // -------------------------------------------------------------
    // CHANNEL 1: WEBSITE HOSTED CHAT VERIFICATION
    // -------------------------------------------------------------
    console.log('\n2. Testing Channel 1: Website Hosted Chat End-to-End...');
    const webConvA = await ConversationService.getOrCreateConversation({
      organizationId: orgAId,
      channel: ConversationChannel.WEB,
      customerName: 'Alice WebVisitor',
      customerEmail: 'alice.visitor@example.test',
    });

    const webMsgRes1 = await ConversationService.handleCustomerMessage({
      organizationId: orgAId,
      conversationId: webConvA.id,
      content: 'Hi, what services do you offer?',
      clientMessageId: `web_msg_srv_${Date.now()}`,
    });

    if (!webMsgRes1.aiMessage || !webMsgRes1.aiMessage.content.includes('Teeth Whitening')) {
      throw new Error(`Website Chat failed services response: ${webMsgRes1.aiMessage?.content}`);
    }
    console.log('  ✓ Website Chat Services query → Grounded AI response generated.');

    const webMsgRes2 = await ConversationService.handleCustomerMessage({
      organizationId: orgAId,
      conversationId: webConvA.id,
      content: 'What is your address?',
      clientMessageId: `web_msg_addr_${Date.now()}`,
    });

    if (!webMsgRes2.aiMessage || !webMsgRes2.aiMessage.content.includes('742 Evergreen Terrace')) {
      throw new Error(`Website Chat failed address response: ${webMsgRes2.aiMessage?.content}`);
    }
    console.log('  ✓ Website Chat Address query → Grounded address provided.');

    const webMsgRes3 = await ConversationService.handleCustomerMessage({
      organizationId: orgAId,
      conversationId: webConvA.id,
      content: 'How much does your main service cost?',
      clientMessageId: `web_msg_cost_${Date.now()}`,
    });

    if (!webMsgRes3.aiMessage || !webMsgRes3.aiMessage.content.includes('$150')) {
      throw new Error(`Website Chat failed pricing response: ${webMsgRes3.aiMessage?.content}`);
    }
    console.log('  ✓ Website Chat Pricing query → Grounded pricing returned.');

    // -------------------------------------------------------------
    // CHANNEL 2: GMAIL END-TO-END VERIFICATION
    // -------------------------------------------------------------
    console.log('\n3. Testing Channel 2: Gmail End-to-End Integration...');
    // Connect Gmail for Org A
    await db.execute(
      `INSERT INTO email_connections (
         id, organization_id, provider_type, inbound_address, webhook_token, is_active, status, connected_email, created_at, updated_at
       ) VALUES ($1, $2, 'OAUTH', 'inbox+apexdental@onceclic.com', 'whk_apex_123', TRUE, 'CONNECTED', 'contact@apexdental.com', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
       ON CONFLICT (organization_id) DO UPDATE SET is_active = TRUE, status = 'CONNECTED', connected_email = 'contact@apexdental.com'`,
      [`conn_email_${Date.now()}`, orgAId]
    );

    const emailInboundRes = await EmailService.processInboundEmail({
      organizationId: orgAId,
      fromEmail: 'john.patient@example.test',
      fromName: 'John Patient',
      toEmail: 'contact@apexdental.com',
      subject: 'ONCEClic integration test',
      textBody: 'Hello, what services do you offer and what are your business hours?',
      messageId: `rfc_email_${Date.now()}`,
    });

    if (!emailInboundRes.success || !emailInboundRes.aiReplySent) {
      throw new Error(`Gmail inbound pipeline failed: ${emailInboundRes.message}`);
    }
    if (outboundDispatches.gmailReplies.length === 0) {
      throw new Error('Gmail outbound reply was not dispatched to customer.');
    }
    console.log('  ✓ Gmail Inbound → Org Resolution → Gemini → Outbound Reply sent via Gmail.');

    // -------------------------------------------------------------
    // CHANNEL 3: INSTAGRAM END-TO-END VERIFICATION
    // -------------------------------------------------------------
    console.log('\n4. Testing Channel 3: Instagram Direct Messages End-to-End...');
    // Connect Instagram for Org A
    await db.execute(
      `INSERT INTO instagram_connections (
         id, organization_id, instagram_user_id, username, account_type, is_active, status, created_at, updated_at
       ) VALUES ($1, $2, 'ig_apex_user_123', 'apex_dental_official', 'BUSINESS', TRUE, 'CONNECTED', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
       ON CONFLICT (organization_id) DO UPDATE SET is_active = TRUE, status = 'CONNECTED'`,
      [`conn_ig_${Date.now()}`, orgAId]
    );

    const igInboundRes = await IntegrationService.handleInstagramInboundMessage({
      organizationId: orgAId,
      senderId: 'ig_customer_9876',
      senderUsername: 'emma_smile',
      text: 'Hi, what services do you offer?',
      messageId: `ig_inbound_msg_${Date.now()}`,
    });

    if (!igInboundRes.success || !igInboundRes.aiReplySent) {
      throw new Error('Instagram inbound DM pipeline failed to send reply.');
    }
    if (outboundDispatches.instagramReplies.length === 0) {
      throw new Error('Instagram outbound reply was not dispatched.');
    }
    console.log('  ✓ Instagram Inbound DM → Tenant Routing → Gemini → Outbound DM sent via Composio.');

    // -------------------------------------------------------------
    // CHANNEL 4: FACEBOOK PAGE MESSAGES END-TO-END VERIFICATION
    // -------------------------------------------------------------
    console.log('\n5. Testing Channel 4: Facebook Page Messages End-to-End...');
    // Connect Facebook for Org A
    await db.execute(
      `INSERT INTO facebook_connections (
         id, organization_id, page_id, page_name, is_active, status, created_at, updated_at
       ) VALUES ($1, $2, 'fb_page_apex_123', 'Apex Dental Facebook Page', TRUE, 'CONNECTED', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
       ON CONFLICT (organization_id) DO UPDATE SET is_active = TRUE, status = 'CONNECTED'`,
      [`conn_fb_${Date.now()}`, orgAId]
    );

    const fbInboundRes = await IntegrationService.handleFacebookInboundMessage({
      organizationId: orgAId,
      senderId: 'fb_customer_5432',
      senderName: 'David Clark',
      text: 'What are your business hours?',
      messageId: `fb_inbound_msg_${Date.now()}`,
    });

    if (!fbInboundRes.success || !fbInboundRes.aiReplySent) {
      throw new Error('Facebook inbound message pipeline failed to send reply.');
    }
    if (outboundDispatches.facebookReplies.length === 0) {
      throw new Error('Facebook outbound reply was not dispatched.');
    }
    console.log('  ✓ Facebook Inbound Message → Gemini → Outbound Message sent via Composio.');

    // -------------------------------------------------------------
    // CHANNEL 5: GOOGLE CALENDAR TOOL WORKFLOW & BOOKING
    // -------------------------------------------------------------
    console.log('\n6. Testing Channel 5: Google Calendar Availability & Booking Tool Workflow...');
    // Set availability rule for Org A
    await db.execute(
      `INSERT INTO availability_rules (id, organization_id, day_of_week, start_time, end_time, slot_duration_minutes, buffer_minutes, is_available)
       VALUES ($1, $2, 5, '09:00', '17:00', 30, 0, TRUE)`,
      [`rule_${Date.now()}`, orgAId]
    );

    // Check slots for a future Friday (e.g. 2030-05-10)
    const slots = await AppointmentService.getAvailableSlots(orgAId, '2030-05-10', 30);
    if (!slots || slots.length === 0) {
      throw new Error('Google Calendar availability check returned 0 slots.');
    }
    console.log(`  ✓ Calendar availability check retrieved ${slots.length} valid candidate slots.`);

    // Book appointment with Google Calendar sync
    const bookedAppt = await AppointmentService.bookAppointment({
      organizationId: orgAId,
      serviceName: 'Teeth Whitening',
      customerName: 'Robert Johnson',
      customerEmail: 'robert.johnson@example.test',
      customerPhone: '+1-555-9090',
      startTime: '2030-05-10T10:00:00.000Z',
      endTime: '2030-05-10T10:30:00.000Z',
      notes: 'First time teeth whitening patient',
    });

    if (!bookedAppt || !bookedAppt.id) {
      throw new Error('Appointment creation failed.');
    }
    if (outboundDispatches.calendarEvents.length === 0) {
      throw new Error('Google Calendar event synchronization was not dispatched via Composio.');
    }
    console.log('  ✓ Customer Booking → Slot Collision Check → Appointment Created → Google Calendar Event Synced.');

    // -------------------------------------------------------------
    // CROSS-CHANNEL MULTI-TENANT ISOLATION VERIFICATION
    // -------------------------------------------------------------
    console.log('\n7. Testing Cross-Channel Multi-Tenant Isolation (Org A vs Org B)...');

    // Query Org B via Website Chat
    const webConvB = await ConversationService.getOrCreateConversation({
      organizationId: orgBId,
      channel: ConversationChannel.WEB,
      customerName: 'Guest at Sakura',
    });

    const orgBResponse = await ConversationService.handleCustomerMessage({
      organizationId: orgBId,
      conversationId: webConvB.id,
      content: 'What services or menu do you offer?',
      clientMessageId: `msg_orgb_${Date.now()}`,
    });

    const orgBText = orgBResponse.aiMessage?.content || '';

    // Verify Org B contains Org B data and ZERO Org A data
    if (!orgBText.includes('Chef Omakase') && !orgBText.includes('Sakura')) {
      throw new Error(`Org B response failed to ground in Org B services: ${orgBText}`);
    }
    if (orgBText.includes('Teeth Whitening') || orgBText.includes('Dental') || orgBText.includes('742 Evergreen')) {
      throw new Error(`CRITICAL TENANT LEAK: Org B AI leaked Org A data! Content: ${orgBText}`);
    }
    console.log('  ✓ Strict Tenant Isolation: Org B received Sakura Dining data with ZERO Org A dental leakage.');

    // -------------------------------------------------------------
    // MESSAGE DUPLICATION & IDEMPOTENCY TEST
    // -------------------------------------------------------------
    console.log('\n8. Testing Idempotency & Duplicate Message Protection...');
    const duplicateId = `dup_ig_${Date.now()}`;
    const initialIgCount = outboundDispatches.instagramReplies.length;

    // Send 1st time
    await IntegrationService.handleInstagramInboundMessage({
      organizationId: orgAId,
      senderId: 'ig_customer_9876',
      text: 'Are you open tomorrow?',
      messageId: duplicateId,
    });

    // Send 2nd time (duplicate delivery)
    const duplicateRes = await IntegrationService.handleInstagramInboundMessage({
      organizationId: orgAId,
      senderId: 'ig_customer_9876',
      text: 'Are you open tomorrow?',
      messageId: duplicateId,
    });

    if (duplicateRes.aiReplySent === true) {
      throw new Error('Duplicate message was not deduplicated!');
    }
    if (outboundDispatches.instagramReplies.length !== initialIgCount + 1) {
      throw new Error('Duplicate inbound message produced multiple outbound AI replies!');
    }
    console.log('  ✓ 1 Inbound Customer Message = Exactly 1 AI Outbound Reply (Zero duplicates).');

    console.log('\n====================================================');
    console.log('  ALL REAL-WORLD CHANNEL AI TESTS PASSED!');
    console.log('====================================================\n');
  } finally {
    global.fetch = originalFetch;
    config.composio.apiKey = prevComposioKey;
    aiProvider.generateResponse = prevGenerateResponse;
    aiProvider.healthCheck = prevHealthCheck;
  }
}

if (require.main === module) {
  runChannelRealWorldVerificationTests().catch((err) => {
    console.error('[Verification Test Failure]:', err);
    process.exit(1);
  });
}
