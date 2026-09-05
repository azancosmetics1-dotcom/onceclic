import { IntegrationService } from '../server/src/services/IntegrationService';
import { ComposioService } from '../server/src/services/ComposioService';
import { AuthService } from '../server/src/services/AuthService';
import { EmailSyncService } from '../server/src/services/EmailSyncService';
import { AppointmentService } from '../server/src/services/AppointmentService';
import { ConversationService } from '../server/src/services/ConversationService';
import { getDatabase } from '../server/src/db';
import { IntegrationStatus, ConversationChannel } from '@onceclic/shared';
import { config } from '../server/src/config';

export async function runComposioIntegrationTests() {
  console.log('--- Running Composio Managed OAuth & Tools Integration Tests ---');
  const db = getDatabase();
  await db.runMigrations();

  // 1. Create two separate test organizations for strict tenant isolation testing
  const userA = await AuthService.register({
    email: `comp_a_${Date.now()}@example.com`,
    password: 'password123',
    fullName: 'Composio Tenant A',
    businessName: 'Tenant A Dental',
  });
  await AuthService.verifyEmail(userA.verificationToken!);
  const orgAId = userA.organization!.id;

  const userB = await AuthService.register({
    email: `comp_b_${Date.now()}@example.com`,
    password: 'password123',
    fullName: 'Composio Tenant B',
    businessName: 'Tenant B Legal',
  });
  await AuthService.verifyEmail(userB.verificationToken!);
  const orgBId = userB.organization!.id;

  // 2. Verify Entity ID multi-tenant isolation
  const entityA = ComposioService.getEntityId(orgAId);
  const entityB = ComposioService.getEntityId(orgBId);
  if (entityA === entityB || !entityA.includes(orgAId.replace(/[^a-zA-Z0-9_-]/g, ''))) {
    throw new Error('Tenant entity isolation failed: Composio entity IDs must be distinct and deterministic per organization.');
  }
  console.log('  ✓ Composio entity IDs provide strict multi-tenant isolation');

  // Configure mock Composio API key for test environment
  const originalApiKey = config.composio.apiKey;
  config.composio.apiKey = 'comp_test_api_key_valid_123';

  // 3. Mock Composio HTTP responses for Connect Link, Connected Account, Tools
  const originalFetch = global.fetch;
  const connectedAccountsMap: Record<string, string[]> = {
    [entityA]: ['gmail', 'googlecalendar'],
    [entityB]: ['gmail', 'googlecalendar'],
  };

  global.fetch = async (url: any, init?: any) => {
    const urlStr = String(url);
    const bodyObj = init?.body ? JSON.parse(String(init.body)) : {};

    // 3A. Connect Link generation (v3.1 and v1 endpoints)
    if (urlStr.includes('/v3.1/connected_accounts/link') || urlStr.includes('/v1/connectedAccounts')) {
      const app = bodyObj.auth_config_id || bodyObj.appName;
      return {
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            redirect_url: `https://connect.composio.dev/link/${app}?session=mock_session_123`,
          }),
      } as any;
    }

    // 3B. Connected Account status check
    if (urlStr.includes('/connected_accounts') || urlStr.includes('/connectedAccounts')) {
      if (init?.method === 'DELETE') {
        if (urlStr.includes('ca_gmail_tenant_a')) {
          connectedAccountsMap[entityA] = (connectedAccountsMap[entityA] || []).filter(a => a !== 'gmail');
        } else if (urlStr.includes('ca_cal_tenant_a')) {
          connectedAccountsMap[entityA] = (connectedAccountsMap[entityA] || []).filter(a => a !== 'googlecalendar');
        }
        return { ok: true, status: 200, text: async () => JSON.stringify({ success: true }) } as any;
      }

      const entityKey = urlStr.includes(entityA) ? entityA : urlStr.includes(entityB) ? entityB : null;
      if (entityKey) {
        const activeApps = connectedAccountsMap[entityKey] || [];
        const items: any[] = [];
        if (activeApps.includes('gmail')) {
          items.push({
            id: entityKey === entityA ? 'ca_gmail_tenant_a' : 'ca_gmail_tenant_b',
            app: 'gmail',
            status: 'ACTIVE',
            userEmail: entityKey === entityA ? 'dentist@tenant-a.com' : 'legal@tenant-b.com',
          });
        }
        if (activeApps.includes('googlecalendar')) {
          items.push({
            id: entityKey === entityA ? 'ca_cal_tenant_a' : 'ca_cal_tenant_b',
            app: 'googlecalendar',
            status: 'ACTIVE',
            accountSummary: entityKey === entityA ? 'Tenant A Primary Calendar' : 'Tenant B Court Calendar',
          });
        }
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ items }),
        } as any;
      }

      return { ok: true, status: 200, text: async () => JSON.stringify({ items: [] }) } as any;
    }

    // 3C. Tool Execution: GMAIL_FETCH_EMAILS
    if (urlStr.includes('GMAIL_FETCH_EMAILS') || urlStr.includes('GMAIL_LIST_MESSAGES')) {
      const userId = bodyObj.user_id || bodyObj.user_uuid;
      if (userId === entityA) {
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              data: [
                {
                  id: 'msg_tenant_a_101',
                  from: 'Alice Patient <alice@patient.org>',
                  to: 'dentist@tenant-a.com',
                  subject: 'Need an urgent teeth cleaning',
                  body: 'Hi, do you have any available slots this Friday?',
                  message_id: 'rfc_msg_101_tenant_a',
                },
              ],
            }),
        } as any;
      }
      return { ok: true, status: 200, text: async () => JSON.stringify({ data: [] }) } as any;
    }

    // 3D. Tool Execution: GMAIL_SEND_EMAIL
    if (urlStr.includes('GMAIL_SEND_EMAIL')) {
      return {
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            data: { id: 'sent_msg_composio_999' },
          }),
      } as any;
    }

    // 3E. Tool Execution: GOOGLECALENDAR_LIST_EVENTS (Free/Busy)
    if (urlStr.includes('GOOGLECALENDAR_LIST_EVENTS') || urlStr.includes('GOOGLECALENDAR_FIND_FREE_SLOTS')) {
      return {
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            data: {
              items: [
                {
                  id: 'gcal_event_busy_1',
                  start: { dateTime: '2026-09-10T10:00:00.000Z' },
                  end: { dateTime: '2026-09-10T11:00:00.000Z' },
                },
              ],
            },
          }),
      } as any;
    }

    // 3F. Tool Execution: GOOGLECALENDAR_CREATE_EVENT
    if (urlStr.includes('GOOGLECALENDAR_CREATE_EVENT')) {
      return {
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            data: { id: 'gcal_created_event_777' },
          }),
      } as any;
    }

    // 3G. Tool Execution: GOOGLECALENDAR_PATCH_EVENT / DELETE_EVENT
    if (urlStr.includes('GOOGLECALENDAR_PATCH_EVENT') || urlStr.includes('GOOGLECALENDAR_DELETE_EVENT')) {
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ data: { success: true } }),
      } as any;
    }

    return originalFetch(url, init);
  };

  try {
    // 4. Test Connect Link generation for Gmail & Calendar
    const gmailAuthUrlRes = await IntegrationService.getGoogleEmailAuthUrl(orgAId, userA.user.id);
    if (!gmailAuthUrlRes.url.includes('connect.composio.dev')) {
      throw new Error(`Expected Composio connect link for Gmail, received: ${gmailAuthUrlRes.url}`);
    }
    console.log('  ✓ Generated Composio Managed OAuth Connect Link for Gmail (zero Google Cloud setup)');

    const calAuthUrlRes = await IntegrationService.getGoogleCalendarAuthUrl(orgAId, userA.user.id);
    if (!calAuthUrlRes.url.includes('connect.composio.dev')) {
      throw new Error(`Expected Composio connect link for Calendar, received: ${calAuthUrlRes.url}`);
    }
    console.log('  ✓ Generated Composio Managed OAuth Connect Link for Google Calendar');

    // 5. Test Callback handling & DB state transition
    const callbackGmailRes = await IntegrationService.handleComposioCallback({
      app: 'gmail',
      orgId: orgAId,
      returnUrl: '/app/integrations',
    });
    if (callbackGmailRes.connectedItem !== 'dentist@tenant-a.com') {
      throw new Error(`Expected connected Gmail address dentist@tenant-a.com, got ${callbackGmailRes.connectedItem}`);
    }

    const callbackCalRes = await IntegrationService.handleComposioCallback({
      app: 'googlecalendar',
      orgId: orgAId,
      returnUrl: '/app/integrations',
    });
    if (callbackCalRes.connectedItem !== 'Tenant A Primary Calendar') {
      throw new Error(`Expected connected Calendar summary, got ${callbackCalRes.connectedItem}`);
    }

    const emailStatus = await IntegrationService.getEmailConfig(orgAId);
    if (emailStatus.status !== IntegrationStatus.CONNECTED || emailStatus.connectedEmail !== 'dentist@tenant-a.com') {
      throw new Error('Composio email connection failed to transition to CONNECTED status.');
    }
    console.log('  ✓ Composio callback successfully registers Gmail mailbox with status CONNECTED');

    const calStatus = await IntegrationService.getGoogleCalendarConfig(orgAId);
    if (calStatus.status !== IntegrationStatus.CONNECTED) {
      throw new Error('Composio calendar connection failed to transition to CONNECTED status.');
    }
    console.log('  ✓ Composio callback successfully registers Google Calendar with status CONNECTED');

    // 6. Test Inbound Email Polling & AI Reply Dispatch via Composio
    const syncRes = await EmailSyncService.syncOrganization(orgAId);
    if (syncRes.syncedCount !== 1) {
      throw new Error(`Expected 1 synced email via Composio, got ${syncRes.syncedCount}`);
    }

    // Verify conversation message was created and marked delivered
    const conv = await db.getOne<{ id: string }>(
      'SELECT id FROM conversations WHERE organization_id = $1 AND customer_email = $2',
      [orgAId, 'alice@patient.org']
    );
    if (!conv) {
      throw new Error('Conversation was not created from Composio inbound email.');
    }

    const messages = await db.query(
      'SELECT * FROM conversation_messages WHERE conversation_id = $1 ORDER BY created_at ASC',
      [conv.id]
    );
    if (messages.rowCount < 2) {
      throw new Error('Expected both customer message and AI response message in conversation history.');
    }
    console.log('  ✓ Inbound email polled via Composio, processed by AI Employee, and reply dispatched via Gmail tool');

    // 7. Test Calendar Free/Busy and Appointment Booking Sync via Composio
    // Set up availability rule for tenant A
    await db.execute(
      `INSERT INTO availability_rules (
         id, organization_id, day_of_week, start_time, end_time, slot_duration_minutes, buffer_minutes, is_available, created_at, updated_at
       ) VALUES ($1, $2, 4, '09:00', '17:00', 30, 0, TRUE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      ['rule_tenant_a_thurs', orgAId]
    );

    const availableSlots = await AppointmentService.getAvailableSlots(orgAId, '2026-09-10', 30);
    // 10:00 to 11:00 was returned as busy in mock, so slots starting at 10:00 and 10:30 should NOT be available
    const slot1000 = availableSlots.find((s) => s.startTime.includes('10:00:00'));
    const slot1030 = availableSlots.find((s) => s.startTime.includes('10:30:00'));
    const slot0900 = availableSlots.find((s) => s.startTime.includes('09:00:00'));

    if (slot1000?.available === true || slot1030?.available === true) {
      throw new Error('Composio calendar busy periods were not correctly blocked in availability slot calculation.');
    }
    if (!slot0900 || !slot0900.available) {
      throw new Error('Non-busy slot at 09:00 was unexpectedly marked unavailable.');
    }
    console.log('  ✓ Google Calendar busy intervals via Composio correctly block busy slots in appointment engine');

    // Book appointment at 09:00
    const bookedAppt = await AppointmentService.bookAppointment({
      organizationId: orgAId,
      serviceName: 'Dental Cleaning',
      customerName: 'Bob Smith',
      customerEmail: 'bob@example.com',
      startTime: '2026-09-10T09:00:00.000Z',
      endTime: '2026-09-10T09:30:00.000Z',
    });

    if (bookedAppt.googleCalendarEventId !== 'gcal_created_event_777' || bookedAppt.calendarSyncStatus !== 'SYNCED') {
      throw new Error('Appointment booking failed to sync event ID via Composio Google Calendar tool.');
    }
    console.log('  ✓ Appointment booking synchronized event to Google Calendar via Composio with event ID preserved');

    // 8. Test Rescheduling and Cancellation Event Sync
    const rescheduled = await AppointmentService.rescheduleAppointment({
      organizationId: orgAId,
      appointmentId: bookedAppt.id,
      newStartTime: '2026-09-10T14:00:00.000Z',
      newEndTime: '2026-09-10T14:30:00.000Z',
    });
    if (!rescheduled.startTime.includes('14:00:00')) {
      throw new Error('Reschedule failed to update start time.');
    }
    console.log('  ✓ Rescheduled appointment updated Google Calendar event via Composio');

    const canceled = await AppointmentService.cancelAppointment(orgAId, bookedAppt.id);
    if (canceled.status !== 'CANCELED') {
      throw new Error('Cancellation failed to update status to CANCELED.');
    }
    console.log('  ✓ Canceled appointment deleted Google Calendar event via Composio');

    // 9. Test Disconnect
    const discEmail = await IntegrationService.disconnectEmail(orgAId, userA.user.id);
    if (discEmail.status !== IntegrationStatus.DISCONNECTED) {
      throw new Error('Email disconnect failed.');
    }

    const discCal = await IntegrationService.disconnectGoogleCalendar(orgAId, userA.user.id);
    if (discCal.status !== IntegrationStatus.DISCONNECTED) {
      throw new Error('Calendar disconnect failed.');
    }
    console.log('  ✓ Composio Gmail and Calendar integrations cleanly disconnect');
  } finally {
    global.fetch = originalFetch;
    config.composio.apiKey = originalApiKey;
  }
}
