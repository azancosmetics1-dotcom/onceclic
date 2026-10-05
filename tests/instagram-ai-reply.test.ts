process.env.USE_EMBEDDED_DB = 'true';
process.env.NODE_ENV = 'test';
process.env.AI_PROVIDER = 'mock';

import { getDatabase } from '../server/src/db';
import { AuthService } from '../server/src/services/AuthService';
import { ComposioService } from '../server/src/services/ComposioService';
import { InboundChannelService } from '../server/src/services/InboundChannelService';
import { ConversationChannel, KnowledgeSourceType } from '@onceclic/shared';
import { KnowledgeService } from '../server/src/services/KnowledgeService';

export async function runInstagramAIReplyTests() {
  console.log('====================================================');
  console.log('  RUNNING INSTAGRAM AI REPLY INTEGRATION TESTS');
  console.log('====================================================');

  const db = getDatabase();
  await db.runMigrations();

  // 1. Create Test Organization A: ONCEClic Test Clinic
  const userA = await AuthService.register({
    email: `ig_test_clinic_${Date.now()}@example.com`,
    password: 'password123',
    fullName: 'Dr. IG Clinic',
    businessName: 'ONCEClic Test Clinic',
  });
  await AuthService.verifyEmail(userA.verificationToken!);
  const orgAId = userA.organization!.id;

  await AuthService.completeOnboarding({
    userId: userA.user.id,
    organizationId: orgAId,
    industry: 'Clinic',
    businessKnowledge: 'ONCEClic Test Clinic is open Monday to Friday from 9 AM to 5 PM. Consultation fee is 2500 PKR. Located at 10 Health Avenue.',
  });

  // Create Test Organization B for Tenant Isolation Check
  const userB = await AuthService.register({
    email: `ig_test_b_${Date.now()}@example.com`,
    password: 'password123',
    fullName: 'Dr. IG Clinic B',
    businessName: 'Other Clinic B',
  });
  await AuthService.verifyEmail(userB.verificationToken!);
  const orgBId = userB.organization!.id;

  await AuthService.completeOnboarding({
    userId: userB.user.id,
    organizationId: orgBId,
    industry: 'Clinic',
    businessKnowledge: 'Other Clinic B is open Monday to Friday from 8 AM to 4 PM. Consultation fee is 9000 PKR. Located at 99 Metro Plaza.',
  });

  // Mock Composio Instagram outbound dispatcher
  let outboundDMsSent: Array<{ recipientId: string; text: string }> = [];
  let shouldSimulateOutboundFailure = false;

  const originalSendInstagramReply = ComposioService.sendInstagramReply;
  ComposioService.sendInstagramReply = async (params) => {
    if (shouldSimulateOutboundFailure) {
      return { success: false, error: 'Simulated Composio Instagram dispatch error' };
    }
    outboundDMsSent.push({
      recipientId: params.recipientId,
      text: params.text,
    });
    return { success: true, messageId: `sent_ig_${Date.now()}` };
  };

  try {
    // ----------------------------------------------------
    // Test 1: First Inbound Instagram DM Creates Conversation & Sends Grounded AI Reply
    // ----------------------------------------------------
    const fakeSenderId = 'ig-user-001';
    const msg1EventId = 'ig-msg-001';

    const res1 = await InboundChannelService.processInboundCustomerMessage({
      organizationId: orgAId,
      channel: ConversationChannel.INSTAGRAM,
      externalMessageId: msg1EventId,
      externalConversationId: 'ig-thread-001',
      senderId: fakeSenderId,
      senderName: 'ig_customer_alice',
      text: 'What are your opening hours?',
    });

    if (!res1.success || !res1.aiReplySent || !res1.conversationId) {
      throw new Error(`Instagram Test 1 Failed: Expected successful AI reply, got ${JSON.stringify(res1)}`);
    }

    if (!res1.replyText?.includes('9 AM to 5 PM') && !res1.replyText?.includes('Monday to Friday')) {
      throw new Error(`Instagram Test 1 Failed: Reply not grounded in clinic hours: "${res1.replyText}"`);
    }

    // Check that outbound Instagram DM was dispatched with correct recipient
    if ((outboundDMsSent.length as number) !== 1 || outboundDMsSent[0].recipientId !== fakeSenderId) {
      throw new Error(`Instagram Test 1 Failed: Outbound DM not sent to recipient ${fakeSenderId}`);
    }

    // Check that event was marked as processed
    const event1Recorded = await db.getOne(
      'SELECT event_id FROM processed_webhook_events WHERE event_id = $1',
      [msg1EventId]
    );
    if (!event1Recorded) {
      throw new Error('Instagram Test 1 Failed: Event was not recorded in processed_webhook_events.');
    }
    console.log('  ✓ 1-8. Instagram Inbound DM → Org Resolution → Conversation Created → Knowledge Loaded → AI Grounded → Outbound DM Dispatched → Event Processed');

    // ----------------------------------------------------
    // Test 2: Idempotency & Duplicate Replay Protection
    // ----------------------------------------------------
    const resDuplicate = await InboundChannelService.processInboundCustomerMessage({
      organizationId: orgAId,
      channel: ConversationChannel.INSTAGRAM,
      externalMessageId: msg1EventId, // same event ID ig-msg-001
      externalConversationId: 'ig-thread-001',
      senderId: fakeSenderId,
      senderName: 'ig_customer_alice',
      text: 'What are your opening hours?',
    });

    if (!resDuplicate.ignoredDuplicate || resDuplicate.aiReplySent) {
      throw new Error('Instagram Test 2 Failed: Replaying exact duplicate event was not ignored.');
    }
    if ((outboundDMsSent.length as number) !== 1) {
      throw new Error('Instagram Test 2 Failed: Duplicate message caused a second outbound DM.');
    }
    console.log('  ✓ 9. Duplicate inbound Instagram event strictly ignored (Zero duplicate DMs sent)');

    // ----------------------------------------------------
    // Test 3: Second Unique Message from Same Sender is Processed
    // ----------------------------------------------------
    const msg2EventId = 'ig-msg-002';
    const res2 = await InboundChannelService.processInboundCustomerMessage({
      organizationId: orgAId,
      channel: ConversationChannel.INSTAGRAM,
      externalMessageId: msg2EventId,
      externalConversationId: 'ig-thread-001',
      senderId: fakeSenderId,
      senderName: 'ig_customer_alice',
      text: 'What is your consultation fee?',
    });

    if (!res2.success || !res2.aiReplySent) {
      throw new Error(`Instagram Test 3 Failed: Second unique message failed: ${JSON.stringify(res2)}`);
    }

    if (!res2.replyText?.includes('2500 PKR') && !res2.replyText?.includes('2500')) {
      throw new Error(`Instagram Test 3 Failed: Fee not grounded: "${res2.replyText}"`);
    }
    if (outboundDMsSent.length !== 2) {
      throw new Error('Instagram Test 3 Failed: Expected 2 total outbound DMs sent.');
    }
    console.log('  ✓ 10. Second unique Instagram message from same customer successfully processed in existing conversation');

    // ----------------------------------------------------
    // Test 4: Missing Information / Anti-Hallucination
    // ----------------------------------------------------
    const msg3EventId = 'ig-msg-003';
    const res3 = await InboundChannelService.processInboundCustomerMessage({
      organizationId: orgAId,
      channel: ConversationChannel.INSTAGRAM,
      externalMessageId: msg3EventId,
      externalConversationId: 'ig-thread-001',
      senderId: fakeSenderId,
      senderName: 'ig_customer_alice',
      text: 'What time are you open Sunday?',
    });

    if (!res3.replyText || res3.replyText.toLowerCase().includes('open on sunday')) {
      throw new Error(`Instagram Test 4 Failed: AI hallucinated Sunday hours: "${res3.replyText}"`);
    }
    console.log('  ✓ 11. Missing information guard: AI does NOT hallucinate unconfigured Sunday hours');

    // ----------------------------------------------------
    // Test 5: Dynamic Knowledge Update (2500 PKR -> 3000 PKR)
    // ----------------------------------------------------
    await db.execute('DELETE FROM knowledge_chunks WHERE organization_id = $1', [orgAId]);
    await db.execute('DELETE FROM knowledge_sources WHERE organization_id = $1', [orgAId]);
    await KnowledgeService.addSource({
      organizationId: orgAId,
      sourceType: KnowledgeSourceType.TEXT,
      title: 'Updated Clinic Knowledge',
      rawContent: 'ONCEClic Test Clinic is open Monday to Friday from 9 AM to 5 PM. Consultation fee is 3000 PKR. Located at 10 Health Avenue.',
    });

    const msg4EventId = 'ig-msg-004';
    const res4 = await InboundChannelService.processInboundCustomerMessage({
      organizationId: orgAId,
      channel: ConversationChannel.INSTAGRAM,
      externalMessageId: msg4EventId,
      externalConversationId: 'ig-thread-001',
      senderId: fakeSenderId,
      senderName: 'ig_customer_alice',
      text: 'How much is the consultation fee now?',
    });

    if (!res4.replyText?.includes('3000 PKR') && !res4.replyText?.includes('3000')) {
      throw new Error(`Instagram Test 5 Failed: AI did not reflect updated 3000 PKR fee: "${res4.replyText}"`);
    }
    console.log('  ✓ 12. Knowledge update: AI immediately uses updated 3000 PKR fee on Instagram');

    // ----------------------------------------------------
    // Test 6: Strict Multi-Tenant Isolation (Org A vs Org B)
    // ----------------------------------------------------
    const msgBEventId = `ig_msg_orgB_${Date.now()}`;
    const resB = await InboundChannelService.processInboundCustomerMessage({
      organizationId: orgBId,
      channel: ConversationChannel.INSTAGRAM,
      externalMessageId: msgBEventId,
      senderId: 'ig-user-tenant-b',
      senderName: 'tenant_b_follower',
      text: 'What is your consultation fee?',
    });

    if (!resB.replyText?.includes('9000 PKR') && !resB.replyText?.includes('9000')) {
      throw new Error(`Instagram Test 6 Failed: Tenant B received incorrect knowledge: "${resB.replyText}"`);
    }
    if (resB.replyText.includes('2500') || resB.replyText.includes('3000')) {
      throw new Error('Instagram Test 6 Failed: Cross-tenant knowledge leak from Org A to Org B detected!');
    }
    console.log('  ✓ 13. Tenant isolation: Org B receives 9000 PKR fee with ZERO Org A leakage');

    // ----------------------------------------------------
    // Test 7: Outbound Failure Handling (Event NOT marked processed)
    // ----------------------------------------------------
    shouldSimulateOutboundFailure = true;
    const msgFailEventId = `ig_msg_fail_${Date.now()}`;

    const resFail = await InboundChannelService.processInboundCustomerMessage({
      organizationId: orgAId,
      channel: ConversationChannel.INSTAGRAM,
      externalMessageId: msgFailEventId,
      senderId: fakeSenderId,
      senderName: 'ig_customer_alice',
      text: 'Hello test failure',
    });

    if (resFail.success || resFail.aiReplySent) {
      throw new Error('Instagram Test 7 Failed: Expected failure return on outbound send failure.');
    }

    const failedEventRecorded = await db.getOne(
      'SELECT event_id FROM processed_webhook_events WHERE event_id = $1',
      [msgFailEventId]
    );
    if (failedEventRecorded) {
      throw new Error('Instagram Test 7 Failed: Event was erroneously marked processed after outbound failure.');
    }
    console.log('  ✓ 14. Outbound dispatch failure safely handled: Event NOT marked processed, retry preserved');
  } finally {
    ComposioService.sendInstagramReply = originalSendInstagramReply;
  }

  console.log('====================================================');
  console.log('  ALL INSTAGRAM AI REPLY INTEGRATION TESTS PASSED!');
  console.log('====================================================\n');
}

if (require.main === module) {
  process.env.USE_EMBEDDED_DB = 'true';
  process.env.NODE_ENV = 'test';
  process.env.AI_PROVIDER = 'mock';
  runInstagramAIReplyTests()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}

