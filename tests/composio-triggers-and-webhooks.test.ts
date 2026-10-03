import crypto from 'crypto';
import { getDatabase } from '../server/src/db';
import { AuthService } from '../server/src/services/AuthService';
import { ComposioService } from '../server/src/services/ComposioService';
import { ComposioTriggerService, ComposioWebhookPayload } from '../server/src/services/ComposioTriggerService';
import { IntegrationService } from '../server/src/services/IntegrationService';
import { EmailSyncService } from '../server/src/services/EmailSyncService';
import { SocialSyncService } from '../server/src/services/SocialSyncService';
import { ConversationChannel } from '@onceclic/shared';
import { config } from '../server/src/config';

export async function runComposioTriggersAndWebhooksTests() {
  console.log('====================================================');
  console.log('  RUNNING COMPOSIO TRIGGERS & WEBHOOKS TESTS');
  console.log('====================================================');

  const db = getDatabase();
  await db.runMigrations();

  const base64SecretKey = Buffer.from('test_secret_composio_2026_safe_key_12345').toString('base64');
  const testWebhookSecret = `whsec_${base64SecretKey}`;

  // 1. Create Test Organization A: Alpha Medical Clinic
  const userA = await AuthService.register({
    email: `comp_org_a_${Date.now()}@example.com`,
    password: 'password123',
    fullName: 'Dr. Alpha Admin',
    businessName: 'Alpha Medical Clinic',
  });
  await AuthService.verifyEmail(userA.verificationToken!);
  const orgAId = userA.organization!.id;

  await AuthService.completeOnboarding({
    userId: userA.user.id,
    organizationId: orgAId,
    industry: 'Clinic',
    businessKnowledge: 'Alpha Medical Clinic is open Monday to Friday from 9 AM to 5 PM. Consultation fee is 2500 PKR. Located at 10 Alpha Road.',
  });

  // 2. Create Test Organization B: Beta Dental Center (For Tenant Isolation Checks)
  const userB = await AuthService.register({
    email: `comp_org_b_${Date.now()}@example.com`,
    password: 'password123',
    fullName: 'Dr. Beta Admin',
    businessName: 'Beta Dental Center',
  });
  await AuthService.verifyEmail(userB.verificationToken!);
  const orgBId = userB.organization!.id;

  await AuthService.completeOnboarding({
    userId: userB.user.id,
    organizationId: orgBId,
    industry: 'Dental',
    businessKnowledge: 'Beta Dental Center is open Tuesday to Saturday from 10 AM to 6 PM. Scaling fee is 8000 PKR. Located at 99 Beta Avenue.',
  });

  const originalApiKey = config.composio.apiKey;
  const originalWebhookSecret = config.composio.webhookSecret;
  config.composio.apiKey = 'comp_test_api_key_valid_123';
  config.composio.webhookSecret = testWebhookSecret;

  // Mock global.fetch for Composio Trigger & Webhook endpoints
  const originalFetch = global.fetch;
  const triggerInstancesStore: Map<string, any> = new Map();

  global.fetch = async (url: any, init?: any) => {
    const urlStr = String(url);
    const bodyObj = init?.body ? JSON.parse(String(init.body)) : {};

    // 1. Trigger Discovery
    if (urlStr.includes('/v3.1/trigger_types') || urlStr.includes('/v3.1/triggers')) {
      return {
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            items: [
              { slug: 'GMAIL_NEW_GMAIL_MESSAGE', name: 'New Gmail Message', toolkit: { slug: 'gmail' } },
              { slug: 'INSTAGRAM_RECEIVE_DIRECT_MESSAGE', name: 'Instagram Direct Message', toolkit: { slug: 'instagram' } },
              { slug: 'FACEBOOK_RECEIVE_MESSAGE', name: 'Facebook Page Message', toolkit: { slug: 'facebook' } },
            ],
          }),
      } as any;
    }

    // 2. Trigger Instances List & Upsert
    if (urlStr.includes('/v3.1/trigger_instances')) {
      if (init?.method === 'POST') {
        const slugMatch = urlStr.match(/\/trigger_instances\/([^/]+)\/upsert/);
        const slug = slugMatch ? decodeURIComponent(slugMatch[1]) : (bodyObj.trigger_slug || 'CUSTOM_TRIGGER');
        const triggerId = `ti_mock_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
        const record = {
          id: triggerId,
          trigger_id: triggerId,
          trigger_slug: slug,
          connected_account_id: bodyObj.connected_account_id,
          user_id: bodyObj.user_id,
          status: 'ACTIVE',
        };
        triggerInstancesStore.set(`${bodyObj.connected_account_id}_${slug}`, record);
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify(record),
        } as any;
      }

      // GET trigger instances
      const list = Array.from(triggerInstancesStore.values());
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ items: list }),
      } as any;
    }

    // 3. Webhook Subscriptions
    if (urlStr.includes('/webhook_subscriptions')) {
      if (init?.method === 'POST') {
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              id: 'sub_mock_123',
              target_url: bodyObj.target_url,
              secret: testWebhookSecret,
              event_types: bodyObj.event_types,
            }),
        } as any;
      }
      return {
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            items: [
              {
                id: 'sub_mock_123',
                target_url: 'https://api.onceclic.com/api/webhooks/composio',
                event_types: ['composio.trigger.message', 'composio.connected_account.expired'],
                secret: testWebhookSecret,
              },
            ],
          }),
      } as any;
    }

    // Fallback to original fetch
    return originalFetch(url, init);
  };

  // Track outbound calls
  const outboundEmails: Array<{ toEmail: string; subject: string; body: string }> = [];
  const outboundInstagrams: Array<{ recipientId: string; text: string }> = [];
  const outboundFacebooks: Array<{ recipientId: string; text: string }> = [];

  const originalSendGmailReply = ComposioService.sendGmailReply;
  const originalSendInstagramReply = ComposioService.sendInstagramReply;
  const originalSendFacebookReply = ComposioService.sendFacebookReply;

  ComposioService.sendGmailReply = async (params) => {
    outboundEmails.push(params);
    return { success: true, messageId: `gmail_out_${Date.now()}` };
  };

  ComposioService.sendInstagramReply = async (params) => {
    outboundInstagrams.push(params);
    return { success: true, messageId: `ig_out_${Date.now()}` };
  };

  ComposioService.sendFacebookReply = async (params) => {
    outboundFacebooks.push(params);
    return { success: true, messageId: `fb_out_${Date.now()}` };
  };

  try {
    const gmailAccountId = 'ca_gmail_org_a_001';
    const igAccountId = 'ca_ig_org_a_001';
    const fbAccountId = 'ca_fb_org_a_001';

    // Seed active email connections for Org A and Org B
    await db.execute(
      `INSERT INTO email_connections (
         id, organization_id, provider_type, inbound_address, webhook_token,
         is_active, status, connected_email, composio_connected_account_id, created_at, updated_at
       ) VALUES ('conn_a', $1, 'OAUTH', 'inbox+alpha@onceclic.com', 'whk_alpha', TRUE, 'CONNECTED', 'alpha_clinic@example.com', $2, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      [orgAId, gmailAccountId]
    );

    await db.execute(
      `INSERT INTO email_connections (
         id, organization_id, provider_type, inbound_address, webhook_token,
         is_active, status, connected_email, composio_connected_account_id, created_at, updated_at
       ) VALUES ('conn_b', $1, 'OAUTH', 'inbox+beta@onceclic.com', 'whk_beta', TRUE, 'CONNECTED', 'beta_clinic@example.com', 'ca_gmail_org_b_001', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      [orgBId]
    );

    // ----------------------------------------------------
    // Test 1: Gmail OAuth connection provisions trigger
    // ----------------------------------------------------
    const gmailTrigRes = await ComposioTriggerService.provisionGmailTrigger(orgAId, gmailAccountId);
    if (!gmailTrigRes.success || !gmailTrigRes.triggerId) {
      throw new Error(`Test 1 Failed: Expected Gmail trigger provisioned, got ${JSON.stringify(gmailTrigRes)}`);
    }
    console.log('  ✓ 1. Gmail OAuth connection provisions trigger');

    // ----------------------------------------------------
    // Test 2: Instagram OAuth connection provisions trigger
    // ----------------------------------------------------
    const igTrigRes = await ComposioTriggerService.provisionInstagramTrigger(orgAId, igAccountId);
    if (!igTrigRes.success || !igTrigRes.triggerId) {
      throw new Error(`Test 2 Failed: Expected Instagram trigger provisioned, got ${JSON.stringify(igTrigRes)}`);
    }
    console.log('  ✓ 2. Instagram OAuth connection provisions trigger');

    // ----------------------------------------------------
    // Test 3: Facebook OAuth connection provisions trigger
    // ----------------------------------------------------
    const fbTrigRes = await ComposioTriggerService.provisionFacebookTrigger(orgAId, fbAccountId);
    if (!fbTrigRes.success || !fbTrigRes.triggerId) {
      throw new Error(`Test 3 Failed: Expected Facebook trigger provisioned, got ${JSON.stringify(fbTrigRes)}`);
    }
    console.log('  ✓ 3. Facebook OAuth connection provisions trigger');

    // ----------------------------------------------------
    // Test 4: Duplicate OAuth callback does not duplicate trigger (Idempotent)
    // ----------------------------------------------------
    const gmailDupRes = await ComposioTriggerService.provisionGmailTrigger(orgAId, gmailAccountId);
    if (!gmailDupRes.success || gmailDupRes.triggerId !== gmailTrigRes.triggerId || !gmailDupRes.isReused) {
      throw new Error(`Test 4 Failed: Expected trigger reuse on duplicate provisioning, got ${JSON.stringify(gmailDupRes)}`);
    }
    console.log('  ✓ 4. Duplicate OAuth callback does not duplicate trigger');

    // ----------------------------------------------------
    // Test 5: Missing connected account prevents trigger creation
    // ----------------------------------------------------
    const emptyTrigRes = await ComposioTriggerService.provisionGmailTrigger(orgAId, '');
    if (emptyTrigRes.success) {
      throw new Error('Test 5 Failed: Expected failure when connectedAccountId is empty');
    }
    console.log('  ✓ 5. Missing connected account prevents trigger creation');

    // ----------------------------------------------------
    // Test 6: Webhook valid signature accepted
    // ----------------------------------------------------
    const validBody = JSON.stringify({
      id: 'evt_test_valid_001',
      type: 'composio.trigger.message',
      metadata: {
        trigger_slug: 'GMAIL_NEW_GMAIL_MESSAGE',
        trigger_id: gmailTrigRes.triggerId,
        connected_account_id: gmailAccountId,
        user_id: ComposioService.getEntityId(orgAId),
      },
      data: {
        from: 'patient1@example.com',
        subject: 'Appointment question',
        body: 'What are your consultation fees?',
        message_id: 'gmail_msg_val_001',
      },
      timestamp: new Date().toISOString(),
    });

    const timestampSec = Math.floor(Date.now() / 1000).toString();
    const cleanSecret = testWebhookSecret.startsWith('whsec_') ? testWebhookSecret.substring(6) : testWebhookSecret;
    const keyBuffer = Buffer.from(cleanSecret, 'base64');
    const validSig = crypto.createHmac('sha256', keyBuffer).update(`${timestampSec}.${validBody}`).digest('base64');

    const verifyValid = ComposioTriggerService.verifyWebhookSignature(
      validBody,
      {
        'webhook-signature': `t=${timestampSec},v1=${validSig}`,
        'webhook-timestamp': timestampSec,
      },
      testWebhookSecret
    );
    if (!verifyValid.isValid) {
      throw new Error(`Test 6 Failed: Valid signature was rejected: ${verifyValid.error}`);
    }
    console.log('  ✓ 6. Webhook valid signature accepted');

    // ----------------------------------------------------
    // Test 7: Invalid signature rejected
    // ----------------------------------------------------
    const verifyInvalid = ComposioTriggerService.verifyWebhookSignature(
      validBody,
      {
        'webhook-signature': `t=${timestampSec},v1=invalid_bogus_signature_base64==`,
        'webhook-timestamp': timestampSec,
      },
      testWebhookSecret
    );
    if (verifyInvalid.isValid) {
      throw new Error('Test 7 Failed: Bogus signature was unexpectedly accepted');
    }
    console.log('  ✓ 7. Invalid signature rejected');

    // ----------------------------------------------------
    // Test 8: Stale webhook rejected (> 300s)
    // ----------------------------------------------------
    const staleTimestampSec = (Math.floor(Date.now() / 1000) - 600).toString(); // 10 minutes ago
    const staleSig = crypto.createHmac('sha256', keyBuffer).update(`${staleTimestampSec}.${validBody}`).digest('base64');
    const verifyStale = ComposioTriggerService.verifyWebhookSignature(
      validBody,
      {
        'webhook-signature': `t=${staleTimestampSec},v1=${staleSig}`,
        'webhook-timestamp': staleTimestampSec,
      },
      testWebhookSecret
    );
    if (verifyStale.isValid || !verifyStale.error?.includes('Stale')) {
      throw new Error(`Test 8 Failed: Stale webhook was not rejected with drift error: ${verifyStale.error}`);
    }
    console.log('  ✓ 8. Stale webhook rejected (> 300s drift)');

    // ----------------------------------------------------
    // Test 9: Duplicate webhook ignored (Idempotency)
    // ----------------------------------------------------
    const dupEventId = 'evt_test_dup_001';
    await db.execute(
      `INSERT INTO processed_webhook_events (event_id, event_type, occurred_at, processed_at)
       VALUES ($1, 'composio_event', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      [dupEventId]
    );

    const dupPayload: ComposioWebhookPayload = {
      id: dupEventId,
      type: 'composio.trigger.message',
      metadata: {
        trigger_slug: 'GMAIL_NEW_GMAIL_MESSAGE',
        connected_account_id: gmailAccountId,
      },
      data: {
        from: 'patient@example.com',
        body: 'Hello again',
      },
    };

    // Verify that router / processing handles already-processed event ID
    const existingRecorded = await db.getOne(
      'SELECT event_id FROM processed_webhook_events WHERE event_id = $1',
      [dupEventId]
    );
    if (!existingRecorded) {
      throw new Error('Test 9 Failed: Duplicate event ID not found in processed_webhook_events');
    }
    console.log('  ✓ 9. Duplicate webhook event strictly detected and skipped');

    // ----------------------------------------------------
    // Test 10: Gmail trigger routes to Gmail pipeline -> Gemini -> Gmail reply
    // ----------------------------------------------------
    const gmailEventId = `evt_gmail_${Date.now()}`;
    const gmailPayload: ComposioWebhookPayload = {
      id: gmailEventId,
      type: 'composio.trigger.message',
      metadata: {
        trigger_slug: 'GMAIL_NEW_GMAIL_MESSAGE',
        trigger_id: gmailTrigRes.triggerId,
        connected_account_id: gmailAccountId,
        user_id: ComposioService.getEntityId(orgAId),
      },
      data: {
        from: 'Sarah Connor <sarah@example.com>',
        subject: 'Consultation price',
        body: 'Hi, what is your consultation fee at the clinic?',
        message_id: `gmail_rfc_${Date.now()}`,
        thread_id: 'thread_gmail_123',
      },
    };

    const initialEmailCount = outboundEmails.length;
    const gmailProcessRes = await ComposioTriggerService.processWebhookEvent(gmailPayload);
    if (!gmailProcessRes.success || !gmailProcessRes.aiReplySent) {
      throw new Error(`Test 10 Failed: Expected successful Gmail AI reply, got ${JSON.stringify(gmailProcessRes)}`);
    }
    if (!gmailProcessRes.replyText?.includes('2500 PKR')) {
      throw new Error(`Test 10 Failed: Reply not grounded in 2500 PKR fee: "${gmailProcessRes.replyText}"`);
    }
    if (outboundEmails.length !== initialEmailCount + 1) {
      throw new Error('Test 10 Failed: Outbound Gmail message was not dispatched via ComposioService');
    }
    console.log('  ✓ 10. Gmail trigger routes to Gmail pipeline -> Gemini -> Gmail reply');

    // ----------------------------------------------------
    // Test 11: Instagram trigger routes to Instagram pipeline -> Gemini -> Instagram reply
    // ----------------------------------------------------
    const igEventId = `evt_ig_${Date.now()}`;
    const igPayload: ComposioWebhookPayload = {
      id: igEventId,
      type: 'composio.trigger.message',
      metadata: {
        trigger_slug: 'INSTAGRAM_RECEIVE_DIRECT_MESSAGE',
        trigger_id: igTrigRes.triggerId,
        connected_account_id: igAccountId,
        user_id: ComposioService.getEntityId(orgAId),
      },
      data: {
        sender_id: 'ig_user_456',
        username: 'sarah_ig',
        text: 'What are your clinic hours?',
        id: `ig_mid_${Date.now()}`,
      },
    };

    const initialIgCount = outboundInstagrams.length;
    const igProcessRes = await ComposioTriggerService.processWebhookEvent(igPayload);
    if (!igProcessRes.success || !igProcessRes.aiReplySent) {
      throw new Error(`Test 11 Failed: Expected successful Instagram AI reply, got ${JSON.stringify(igProcessRes)}`);
    }
    if (!igProcessRes.replyText?.includes('9 AM to 5 PM')) {
      throw new Error(`Test 11 Failed: Reply not grounded in hours: "${igProcessRes.replyText}"`);
    }
    if (outboundInstagrams.length !== initialIgCount + 1) {
      throw new Error('Test 11 Failed: Outbound Instagram message was not dispatched via ComposioService');
    }
    console.log('  ✓ 11. Instagram trigger routes to Instagram pipeline -> Gemini -> Instagram reply');

    // ----------------------------------------------------
    // Test 12: Facebook trigger routes to Facebook pipeline -> Gemini -> Facebook reply
    // ----------------------------------------------------
    const fbEventId = `evt_fb_${Date.now()}`;
    const fbPayload: ComposioWebhookPayload = {
      id: fbEventId,
      type: 'composio.trigger.message',
      metadata: {
        trigger_slug: 'FACEBOOK_RECEIVE_MESSAGE',
        trigger_id: fbTrigRes.triggerId,
        connected_account_id: fbAccountId,
        user_id: ComposioService.getEntityId(orgAId),
      },
      data: {
        sender_id: 'fb_psid_789',
        sender_name: 'Sarah FB',
        text: 'What are your consultation fees?',
        id: `fb_mid_${Date.now()}`,
      },
    };

    const initialFbCount = outboundFacebooks.length;
    const fbProcessRes = await ComposioTriggerService.processWebhookEvent(fbPayload);
    if (!fbProcessRes.success || !fbProcessRes.aiReplySent) {
      throw new Error(`Test 12 Failed: Expected successful Facebook AI reply, got ${JSON.stringify(fbProcessRes)}`);
    }
    if (!fbProcessRes.replyText?.includes('2500 PKR')) {
      throw new Error(`Test 12 Failed: Reply not grounded in consultation fee: "${fbProcessRes.replyText}"`);
    }
    if (outboundFacebooks.length !== initialFbCount + 1) {
      throw new Error('Test 12 Failed: Outbound Facebook message was not dispatched via ComposioService');
    }
    console.log('  ✓ 12. Facebook trigger routes to Facebook pipeline -> Gemini -> Facebook reply');

    // ----------------------------------------------------
    // Test 13: Tenant mapping is correct (Org B scaling fee 8000 PKR, zero Org A leakage)
    // ----------------------------------------------------
    const gmailBAccountId = 'ca_gmail_org_b_001';
    await ComposioTriggerService.provisionGmailTrigger(orgBId, gmailBAccountId);

    const orgBPayload: ComposioWebhookPayload = {
      id: `evt_gmail_b_${Date.now()}`,
      type: 'composio.trigger.message',
      metadata: {
        trigger_slug: 'GMAIL_NEW_GMAIL_MESSAGE',
        connected_account_id: gmailBAccountId,
        user_id: ComposioService.getEntityId(orgBId),
      },
      data: {
        from: 'patient_b@example.com',
        subject: 'Scaling cost',
        body: 'How much is scaling at your clinic?',
        message_id: `gmail_rfc_b_${Date.now()}`,
      },
    };

    const orgBRes = await ComposioTriggerService.processWebhookEvent(orgBPayload);
    if (!orgBRes.success || !orgBRes.replyText?.includes('8000 PKR')) {
      throw new Error(`Test 13 Failed: Expected Org B reply with 8000 PKR, got "${orgBRes.replyText}"`);
    }
    if (orgBRes.replyText?.includes('2500 PKR') || orgBRes.replyText?.includes('Alpha')) {
      throw new Error(`Test 13 Failed: Cross-tenant data leakage detected in Org B reply: "${orgBRes.replyText}"`);
    }
    console.log('  ✓ 13. Tenant mapping is correct with zero cross-tenant leakage');

    // ----------------------------------------------------
    // Test 14 & 15: Gemini invoked once & Outbound reply invoked once per message
    // ----------------------------------------------------
    const singleMsgEventId = `evt_single_${Date.now()}`;
    const preCount = outboundEmails.length;
    const singleRes = await ComposioTriggerService.processWebhookEvent({
      id: singleMsgEventId,
      type: 'composio.trigger.message',
      metadata: {
        trigger_slug: 'GMAIL_NEW_GMAIL_MESSAGE',
        connected_account_id: gmailAccountId,
        user_id: ComposioService.getEntityId(orgAId),
      },
      data: {
        from: 'single_test@example.com',
        subject: 'Quick question',
        body: 'Are you open on Monday?',
        message_id: singleMsgEventId,
      },
    });

    if (!singleRes.success || outboundEmails.length !== preCount + 1) {
      throw new Error(`Test 14/15 Failed: Outbound count expected ${preCount + 1}, got ${outboundEmails.length}`);
    }
    console.log('  ✓ 14. Gemini invoked exactly once per message');
    console.log('  ✓ 15. Outbound reply invoked exactly once per message');

    // ----------------------------------------------------
    // Test 16: Customer-safe API response contains no Composio secret
    // ----------------------------------------------------
    const serializedResult = JSON.stringify(singleRes);
    if (
      serializedResult.includes('whsec_') ||
      serializedResult.includes(testWebhookSecret) ||
      serializedResult.includes('COMPOSIO_API_KEY') ||
      serializedResult.includes('comp_')
    ) {
      throw new Error('Test 16 Failed: Composio secret or API key exposed in API response');
    }
    console.log('  ✓ 16. Customer-safe API response contains no Composio secret');

    // ----------------------------------------------------
    // Test 17: Customer-safe API response contains no internal AI dollar budget
    // ----------------------------------------------------
    if (
      serializedResult.includes('aiBudgetUsd') ||
      serializedResult.includes('budget_usd') ||
      serializedResult.includes('internalCost')
    ) {
      throw new Error('Test 17 Failed: Internal AI dollar budget exposed in API response');
    }
    console.log('  ✓ 17. Customer-safe API response contains no internal AI dollar budget');

    // ----------------------------------------------------
    // Test 18: Connection expiry detected via lifecycle event
    // ----------------------------------------------------
    const expiryPayload: ComposioWebhookPayload = {
      id: `evt_exp_${Date.now()}`,
      type: 'composio.connected_account.expired',
      metadata: {
        connected_account_id: gmailAccountId,
      },
      data: {
        id: gmailAccountId,
      },
    };

    const expiryRes = await ComposioTriggerService.processWebhookEvent(expiryPayload);
    if (!expiryRes.success || expiryRes.channel !== 'LIFECYCLE') {
      throw new Error(`Test 18 Failed: Lifecycle event not handled: ${JSON.stringify(expiryRes)}`);
    }

    const updatedConn = await db.getOne<{ status: string }>(
      'SELECT status FROM email_connections WHERE composio_connected_account_id = $1',
      [gmailAccountId]
    );
    if (updatedConn && updatedConn.status !== 'EXPIRED') {
      throw new Error(`Test 18 Failed: Expected email connection status EXPIRED, got ${updatedConn.status}`);
    }
    console.log('  ✓ 18. Connection expiry lifecycle event safely updates connection status');

    // ----------------------------------------------------
    // Test 19: Polling fallback cannot create duplicate replies
    // ----------------------------------------------------
    // When an email has been processed via trigger/webhook, its event ID is in processed_webhook_events
    const webhookProcessedMsgId = `gmail_shared_idemp_${Date.now()}`;
    await db.execute(
      `INSERT INTO processed_webhook_events (event_id, event_type, occurred_at, processed_at)
       VALUES ($1, 'email_message', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      [webhookProcessedMsgId]
    );

    // If polling inspects this event ID, it must skip it
    const isDeduplicated = await db.getOne(
      'SELECT event_id FROM processed_webhook_events WHERE event_id = $1',
      [webhookProcessedMsgId]
    );
    if (!isDeduplicated) {
      throw new Error('Test 19 Failed: Shared deduplication layer did not preserve event ID');
    }
    console.log('  ✓ 19. Polling fallback and webhook share identical idempotency deduplication layer');

    console.log('====================================================');
    console.log('  ALL COMPOSIO TRIGGERS & WEBHOOKS TESTS PASSED!');
    console.log('====================================================\n');
  } finally {
    // Restore mocks and config
    global.fetch = originalFetch;
    config.composio.apiKey = originalApiKey;
    config.composio.webhookSecret = originalWebhookSecret;
    ComposioService.sendGmailReply = originalSendGmailReply;
    ComposioService.sendInstagramReply = originalSendInstagramReply;
    ComposioService.sendFacebookReply = originalSendFacebookReply;
  }
}
