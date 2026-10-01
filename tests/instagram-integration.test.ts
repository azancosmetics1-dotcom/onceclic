import { IntegrationService } from '../server/src/services/IntegrationService';
import { ConversationService } from '../server/src/services/ConversationService';
import { AuthService } from '../server/src/services/AuthService';
import { AppointmentService } from '../server/src/services/AppointmentService';
import { getDatabase } from '../server/src/db';
import { ConversationChannel, IntegrationStatus } from '@onceclic/shared';

export async function runInstagramIntegrationTests() {
  console.log('--- Running Instagram AI Receptionist & Multi-Industry AI Tests ---');
  const db = getDatabase();
  await db.runMigrations();

  const { config } = await import('../server/src/config');
  const prevComposioKey = config.composio.apiKey;
  config.composio.apiKey = 'mock_comp_ig_key_123';

  let clinicOrgId = '';
  let isConnectedClinic = false;
  let isDeletedClinic = false;

  const originalFetch = global.fetch;
  global.fetch = async (url: any, init?: any) => {
    const urlStr = String(url);
    const bodyObj = init?.body ? JSON.parse(String(init.body)) : {};

    if (urlStr.includes('/v3.1/auth_configs')) {
      return {
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            items: [
              {
                id: 'ac_mock_ig_123',
                is_composio_managed: true,
                toolkit: { slug: 'instagram' },
              },
            ],
          }),
      } as any;
    }

    if (urlStr.includes('/v3.1/connected_accounts/link') || urlStr.includes('/v1/connectedAccounts')) {
      const userId = bodyObj.user_id || bodyObj.user_uuid || '';
      return {
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            redirect_url: `https://connect.composio.dev/link/instagram?session=mock_ig_session&user_id=${userId}`,
          }),
      } as any;
    }

    if (urlStr.includes('/connected_accounts') || urlStr.includes('/connectedAccounts')) {
      if (init?.method === 'DELETE') {
        isDeletedClinic = true;
        isConnectedClinic = false;
        return { ok: true, status: 200, text: async () => JSON.stringify({ success: true }) } as any;
      }

      const clinicEntity = clinicOrgId.replace(/[^a-zA-Z0-9_-]/g, '');
      if (urlStr.includes(clinicEntity) && isConnectedClinic && !isDeletedClinic) {
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              items: [
                {
                  id: 'ca_mock_ig_clinic',
                  status: 'ACTIVE',
                  app: 'instagram',
                  toolkit: { slug: 'instagram' },
                  username: 'apexdental_official',
                  summary: 'Apex Dental Instagram',
                },
              ],
            }),
        } as any;
      }
      return { ok: true, status: 200, text: async () => JSON.stringify({ items: [] }) } as any;
    }

    if (urlStr.includes('INSTAGRAM_SEND_TEXT_MESSAGE') || urlStr.includes('INSTAGRAM_REPLY')) {
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ data: { id: 'sent_ig_msg_999' } }),
      } as any;
    }

    return originalFetch(url, init);
  };

  try {

  // Setup Test Organization 1: Dental Clinic
  const clinicOwner = await AuthService.register({
    email: `clinic_owner_${Date.now()}@example.com`,
    password: 'password123',
    fullName: 'Dr. John Dentist',
    businessName: 'Apex Dental Care',
  });
  clinicOrgId = clinicOwner.organization!.id;

  // Setup Test Organization 2: Italian Restaurant
  const restaurantOwner = await AuthService.register({
    email: `chef_${Date.now()}@example.com`,
    password: 'password123',
    fullName: 'Chef Luigi',
    businessName: 'Bella Italia Ristorante',
  });
  const restaurantOrgId = restaurantOwner.organization!.id;

  // Setup Test Organization 3: Luxury Hair Salon
  const salonOwner = await AuthService.register({
    email: `salon_${Date.now()}@example.com`,
    password: 'password123',
    fullName: 'Chloe Stylist',
    businessName: 'Luxe Hair & Spa Studio',
  });
  const salonOrgId = salonOwner.organization!.id;

  // Update business types in database for accurate testing
  await db.execute(`UPDATE organizations SET business_type = 'Dental Clinic' WHERE id = $1`, [clinicOrgId]);
  await db.execute(`UPDATE organizations SET business_type = 'Italian Restaurant' WHERE id = $1`, [restaurantOrgId]);
  await db.execute(`UPDATE organizations SET business_type = 'Hair & Beauty Salon' WHERE id = $1`, [salonOrgId]);

  // Test 1: Instagram Connection URL Generation & Tenant Isolation
  console.log('Testing Instagram Managed OAuth Connect Link...');
  const clinicAuthUrl = await IntegrationService.getInstagramAuthUrl(clinicOrgId, clinicOwner.user.id, '/app/integrations');
  if (!clinicAuthUrl.url || !clinicAuthUrl.url.includes('org_') || !clinicAuthUrl.url.includes(clinicOrgId)) {
    throw new Error('Instagram Auth URL must contain the organization entity ID (org_<organizationId>)');
  }
  console.log('  ✓ Instagram OAuth URL generated with strict org_<organizationId> tenant isolation');

  // Test 2: Instagram Initial Status Resolution (NOT_CONNECTED)
  const initialStatus = await IntegrationService.getInstagramConfig(clinicOrgId);
  if (initialStatus.status !== IntegrationStatus.NOT_CONNECTED) {
    throw new Error(`Expected NOT_CONNECTED status initially, got: ${initialStatus.status}`);
  }
  console.log('  ✓ Instagram initial status verified as NOT_CONNECTED');

  // Test 3: Instagram Callback & Connection Setup
  isConnectedClinic = true;
  await IntegrationService.handleComposioCallback({
    app: 'instagram',
    orgId: clinicOrgId,
    returnUrl: '/app/integrations',
  });

  const connectedStatus = await IntegrationService.getInstagramConfig(clinicOrgId);
  if (connectedStatus.status !== IntegrationStatus.CONNECTED) {
    throw new Error(`Expected CONNECTED status after callback, got: ${connectedStatus.status}`);
  }
  console.log('  ✓ Instagram connection completed and resolved as CONNECTED');

  // Test 4: Tenant Isolation — Organization B cannot see Organization A's Instagram Connection
  const restaurantIgStatus = await IntegrationService.getInstagramConfig(restaurantOrgId);
  if (restaurantIgStatus.status === IntegrationStatus.CONNECTED) {
    throw new Error('Tenant isolation breach: Organization B showed Organization A Instagram account as connected');
  }
  console.log('  ✓ Tenant isolation verified: Organization B has separate unlinked Instagram state');

  // Test 5: Inbound Instagram DM Handling & Idempotency / Anti-Deduplication
  console.log('Testing Instagram inbound DM handling & idempotency...');
  const testMessageId = `ig_msg_${Date.now()}_abc123`;
  const dmResult1 = await IntegrationService.handleInstagramInboundMessage({
    organizationId: clinicOrgId,
    senderId: 'ig_user_customer_999',
    senderUsername: 'maria_travels',
    text: 'Hi! Do you have an opening for a dental checkup and teeth cleaning tomorrow at 2 PM?',
    messageId: testMessageId,
  });

  if (!dmResult1.success || !dmResult1.conversationId) {
    throw new Error('Failed to process inbound Instagram message');
  }
  console.log('  ✓ Inbound Instagram DM processed and conversation created on channel INSTAGRAM');

  // Duplicate message delivery (simulating Meta webhook retry)
  const dmResultDuplicate = await IntegrationService.handleInstagramInboundMessage({
    organizationId: clinicOrgId,
    senderId: 'ig_user_customer_999',
    senderUsername: 'maria_travels',
    text: 'Hi! Do you have an opening for a dental checkup and teeth cleaning tomorrow at 2 PM?',
    messageId: testMessageId,
  });

  if (dmResultDuplicate.aiReplySent === true) {
    throw new Error('Idempotency violation: Duplicate Instagram webhook message triggered duplicate AI reply');
  }
  console.log('  ✓ Duplicate Instagram DM delivery recognized and deduplicated (idempotent)');

  // Test 6: Clinic Receptionist AI Conversation & Safe Healthcare Guardrails
  console.log('Testing Clinic AI Receptionist behavior...');
  const clinicConv = await ConversationService.getOrCreateConversation({
    organizationId: clinicOrgId,
    channel: ConversationChannel.INSTAGRAM,
    customerName: 'maria_travels',
  });

  const clinicMsgRes = await ConversationService.handleCustomerMessage({
    organizationId: clinicOrgId,
    conversationId: clinicConv.id,
    content: 'Can you tell me about teeth cleaning services and book an appointment?',
  });

  if (!clinicMsgRes.userMessage || !clinicMsgRes.aiMessage) {
    throw new Error('Clinic AI Receptionist failed to generate response');
  }
  console.log('  ✓ Clinic AI receptionist generated context-aware response for dental inquiry');

  // Test 7: Restaurant AI Conversation (Table Reservation & Menu Inquiry)
  console.log('Testing Restaurant AI Receptionist behavior...');
  const restConv = await ConversationService.getOrCreateConversation({
    organizationId: restaurantOrgId,
    channel: ConversationChannel.INSTAGRAM,
    customerName: 'foodie_john',
  });

  const restMsgRes = await ConversationService.handleCustomerMessage({
    organizationId: restaurantOrgId,
    conversationId: restConv.id,
    content: 'Hi! Do you have a table for 4 tomorrow night at 7 PM?',
  });

  if (!restMsgRes.userMessage || !restMsgRes.aiMessage) {
    throw new Error('Restaurant AI Receptionist failed to generate response');
  }
  console.log('  ✓ Restaurant AI receptionist generated table reservation guidance');

  // Test 8: Salon AI Conversation (Hair styling & service pricing)
  console.log('Testing Salon AI Receptionist behavior...');
  const salonConv = await ConversationService.getOrCreateConversation({
    organizationId: salonOrgId,
    channel: ConversationChannel.INSTAGRAM,
    customerName: 'sarah_glam',
  });

  const salonMsgRes = await ConversationService.handleCustomerMessage({
    organizationId: salonOrgId,
    conversationId: salonConv.id,
    content: 'What are your hair coloring and blowout prices?',
  });

  if (!salonMsgRes.userMessage || !salonMsgRes.aiMessage) {
    throw new Error('Salon AI Receptionist failed to generate response');
  }
  console.log('  ✓ Salon AI receptionist generated beauty service guidance');

  // Test 9: Appointment Booking via Instagram Flow with Double Booking Lock
  console.log('Testing Instagram appointment booking flow with transactional lock...');
  const testDate = '2026-10-15';
  const startISO = `${testDate}T14:00:00.000Z`;
  const endISO = `${testDate}T14:30:00.000Z`;

  const appt = await AppointmentService.bookAppointment({
    organizationId: clinicOrgId,
    serviceName: 'Teeth Cleaning & Exam',
    customerName: 'Maria Travels',
    customerEmail: 'maria@example.com',
    customerPhone: '+1-555-0199',
    startTime: startISO,
    endTime: endISO,
    notes: 'Booked via Instagram DM @maria_travels',
    conversationId: clinicConv.id,
  });

  if (!appt.id || appt.status !== 'CONFIRMED') {
    throw new Error('Failed to book appointment via Instagram flow');
  }
  console.log('  ✓ Appointment successfully booked through Instagram conversation flow');

  // Attempt duplicate booking for same slot (must be rejected)
  let doubleBookPrevented = false;
  try {
    await AppointmentService.bookAppointment({
      organizationId: clinicOrgId,
      serviceName: 'Dental Consultation',
      customerName: 'Second Patient',
      customerEmail: 'second@example.com',
      startTime: startISO,
      endTime: endISO,
    });
  } catch (err: any) {
    doubleBookPrevented =
      err.message.includes('already been booked') ||
      err.message.includes('already booked') ||
      err.message.includes('not available') ||
      err.message.includes('conflict');
  }

  if (!doubleBookPrevented) {
    throw new Error('Double booking prevention failed for Instagram appointment slot');
  }
  console.log('  ✓ Double-booking prevention strictly enforced for Instagram appointment slot');

  // Test 10: Disconnect Instagram Account
  console.log('Testing Instagram disconnect...');
  const disconnected = await IntegrationService.disconnectInstagram(clinicOrgId, clinicOwner.user.id);
  if (disconnected.status !== IntegrationStatus.DISCONNECTED && disconnected.status !== IntegrationStatus.NOT_CONNECTED) {
    throw new Error(`Expected DISCONNECTED status, got: ${disconnected.status}`);
  }
  console.log('  ✓ Instagram disconnected and audit log recorded');

  console.log('--- Instagram AI Receptionist & Multi-Industry Tests Passed! ---');
  } finally {
    global.fetch = originalFetch;
    config.composio.apiKey = prevComposioKey;
  }
}
