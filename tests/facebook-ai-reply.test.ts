import { getDatabase } from '../server/src/db';
import { AuthService } from '../server/src/services/AuthService';
import { ComposioService } from '../server/src/services/ComposioService';
import { InboundChannelService } from '../server/src/services/InboundChannelService';
import { ConversationChannel, KnowledgeSourceType } from '@onceclic/shared';
import { KnowledgeService } from '../server/src/services/KnowledgeService';

export async function runFacebookAIReplyTests() {
  console.log('====================================================');
  console.log('  RUNNING FACEBOOK AI REPLY INTEGRATION TESTS');
  console.log('====================================================');

  const db = getDatabase();
  await db.runMigrations();

  // 1. Create Test Organization A: ONCEClic Test Clinic
  const userA = await AuthService.register({
    email: `fb_test_clinic_${Date.now()}@example.com`,
    password: 'password123',
    fullName: 'Dr. FB Clinic',
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
    email: `fb_test_b_${Date.now()}@example.com`,
    password: 'password123',
    fullName: 'Dr. FB Clinic B',
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

  // Mock Composio Facebook outbound dispatcher
  let outboundPageMessagesSent: Array<{ recipientId: string; text: string }> = [];
  let shouldSimulateOutboundFailure = false;

  const originalSendFacebookReply = ComposioService.sendFacebookReply;
  ComposioService.sendFacebookReply = async (params) => {
    if (shouldSimulateOutboundFailure) {
      return { success: false, error: 'Simulated Composio Facebook dispatch error' };
    }
    outboundPageMessagesSent.push({
      recipientId: params.recipientId,
      text: params.text,
    });
    return { success: true, messageId: `sent_fb_${Date.now()}` };
  };

  try {
    // ----------------------------------------------------
    // Test 1: First Inbound Facebook Page Message Creates Conversation & Sends Grounded AI Reply
    // ----------------------------------------------------
    const fakeSenderPsid = 'fb-psid-001';
    const msg1EventId = 'fb-msg-001';

    const res1 = await InboundChannelService.processInboundCustomerMessage({
      organizationId: orgAId,
      channel: ConversationChannel.FACEBOOK,
      externalMessageId: msg1EventId,
      externalConversationId: 'fb-thread-001',
      senderId: fakeSenderPsid,
      senderName: 'John Doe',
      metadata: { pageId: 'page_123456' },
      text: 'What are your opening hours?',
    });

    if (!res1.success || !res1.aiReplySent || !res1.conversationId) {
      throw new Error(`Facebook Test 1 Failed: Expected successful AI reply, got ${JSON.stringify(res1)}`);
    }

    if (!res1.replyText?.includes('9 AM to 5 PM') && !res1.replyText?.includes('Monday to Friday')) {
      throw new Error(`Facebook Test 1 Failed: Reply not grounded in clinic hours: "${res1.replyText}"`);
    }

    // Check that outbound Facebook message was dispatched with correct recipient PSID
    if (outboundPageMessagesSent.length !== 1 || outboundPageMessagesSent[0].recipientId !== fakeSenderPsid) {
      throw new Error(`Facebook Test 1 Failed: Outbound message not sent to recipient PSID ${fakeSenderPsid}`);
    }

    // Check that event was marked as processed
    const event1Recorded = await db.getOne(
      'SELECT event_id FROM processed_webhook_events WHERE event_id = $1',
      [msg1EventId]
    );
    if (!event1Recorded) {
      throw new Error('Facebook Test 1 Failed: Event was not recorded in processed_webhook_events.');
    }
    console.log('  ✓ 1-8. Facebook Inbound Message → Org Resolution → Conversation Created → Knowledge Loaded → AI Grounded → Outbound PSID Dispatched → Event Processed');

    // ----------------------------------------------------
    // Test 2: Idempotency & Duplicate Replay Protection
    // ----------------------------------------------------
    const resDuplicate = await InboundChannelService.processInboundCustomerMessage({
      organizationId: orgAId,
      channel: ConversationChannel.FACEBOOK,
      externalMessageId: msg1EventId, // same event ID fb-msg-001
      externalConversationId: 'fb-thread-001',
      senderId: fakeSenderPsid,
      senderName: 'John Doe',
      text: 'What are your opening hours?',
    });

    if (!resDuplicate.ignoredDuplicate || resDuplicate.aiReplySent) {
      throw new Error('Facebook Test 2 Failed: Replaying exact duplicate event was not ignored.');
    }
    if (outboundPageMessagesSent.length !== 1) {
      throw new Error('Facebook Test 2 Failed: Duplicate message caused a second outbound Facebook message.');
    }
    console.log('  ✓ 9. Duplicate inbound Facebook event strictly ignored (Zero duplicate messages sent)');

    // ----------------------------------------------------
    // Test 3: Second Unique Message from Same Sender is Processed
    // ----------------------------------------------------
    const msg2EventId = 'fb-msg-002';
    const res2 = await InboundChannelService.processInboundCustomerMessage({
      organizationId: orgAId,
      channel: ConversationChannel.FACEBOOK,
      externalMessageId: msg2EventId,
      externalConversationId: 'fb-thread-001',
      senderId: fakeSenderPsid,
      senderName: 'John Doe',
      text: 'What is your consultation fee?',
    });

    if (!res2.success || !res2.aiReplySent) {
      throw new Error(`Facebook Test 3 Failed: Second unique message failed: ${JSON.stringify(res2)}`);
    }

    if (!res2.replyText?.includes('2500 PKR') && !res2.replyText?.includes('2500')) {
      throw new Error(`Facebook Test 3 Failed: Fee not grounded: "${res2.replyText}"`);
    }
    if (outboundPageMessagesSent.length !== 2) {
      throw new Error('Facebook Test 3 Failed: Expected 2 total outbound messages sent.');
    }
    console.log('  ✓ 10. Second unique Facebook message from same customer PSID successfully processed in existing conversation');

    // ----------------------------------------------------
    // Test 4: Missing Information / Anti-Hallucination
    // ----------------------------------------------------
    const msg3EventId = 'fb-msg-003';
    const res3 = await InboundChannelService.processInboundCustomerMessage({
      organizationId: orgAId,
      channel: ConversationChannel.FACEBOOK,
      externalMessageId: msg3EventId,
      externalConversationId: 'fb-thread-001',
      senderId: fakeSenderPsid,
      senderName: 'John Doe',
      text: 'What time are you open Sunday?',
    });

    if (!res3.replyText || res3.replyText.toLowerCase().includes('open on sunday')) {
      throw new Error(`Facebook Test 4 Failed: AI hallucinated Sunday hours: "${res3.replyText}"`);
    }
    console.log('  ✓ 11. Missing information guard: AI does NOT hallucinate unconfigured Sunday hours');

    // ----------------------------------------------------
    // Test 5: Dynamic Knowledge Update (2500 PKR -> 3000 PKR)
    // ----------------------------------------------------
    await db.execute('DELETE FROM knowledge_chunks WHERE organization_id = $1', [orgAId]);
    await db.execute('DELETE FROM knowledge_sources WHERE organization_id = $1', [orgAId]);
    await KnowledgeService.addSource({
      organizationId: orgAId,
      sourceType: KnowledgeSourceType.CUSTOM_TEXT,
      title: 'Updated Clinic Knowledge',
      rawContent: 'ONCEClic Test Clinic is open Monday to Friday from 9 AM to 5 PM. Consultation fee is 3000 PKR. Located at 10 Health Avenue.',
    });

    const msg4EventId = 'fb-msg-004';
    const res4 = await InboundChannelService.processInboundCustomerMessage({
      organizationId: orgAId,
      channel: ConversationChannel.FACEBOOK,
      externalMessageId: msg4EventId,
      externalConversationId: 'fb-thread-001',
      senderId: fakeSenderPsid,
      senderName: 'John Doe',
      text: 'How much is the consultation fee now?',
    });

    if (!res4.replyText?.includes('3000 PKR') && !res4.replyText?.includes('3000')) {
      throw new Error(`Facebook Test 5 Failed: AI did not reflect updated 3000 PKR fee: "${res4.replyText}"`);
    }
    console.log('  ✓ 12. Knowledge update: AI immediately uses updated 3000 PKR fee on Facebook Page');

    // ----------------------------------------------------
    // Test 6: Strict Multi-Tenant Isolation (Org A vs Org B)
    // ----------------------------------------------------
    const msgBEventId = `fb_msg_orgB_${Date.now()}`;
    const resB = await InboundChannelService.processInboundCustomerMessage({
      organizationId: orgBId,
      channel: ConversationChannel.FACEBOOK,
      externalMessageId: msgBEventId,
      senderId: 'fb-psid-tenant-b',
      senderName: 'Jane Smith',
      text: 'What is your consultation fee?',
    });

    if (!resB.replyText?.includes('9000 PKR') && !resB.replyText?.includes('9000')) {
      throw new Error(`Facebook Test 6 Failed: Tenant B received incorrect knowledge: "${resB.replyText}"`);
    }
    if (resB.replyText.includes('2500') || resB.replyText.includes('3000')) {
      throw new Error('Facebook Test 6 Failed: Cross-tenant knowledge leak from Org A to Org B detected!');
    }
    console.log('  ✓ 13. Tenant isolation: Org B receives 9000 PKR fee with ZERO Org A leakage');

    // ----------------------------------------------------
    // Test 7: Outbound Failure Handling (Event NOT marked processed)
    // ----------------------------------------------------
    shouldSimulateOutboundFailure = true;
    const msgFailEventId = `fb_msg_fail_${Date.now()}`;

    const resFail = await InboundChannelService.processInboundCustomerMessage({
      organizationId: orgAId,
      channel: ConversationChannel.FACEBOOK,
      externalMessageId: msgFailEventId,
      senderId: fakeSenderPsid,
      senderName: 'John Doe',
      text: 'Hello test failure',
    });

    if (resFail.success || resFail.aiReplySent) {
      throw new Error('Facebook Test 7 Failed: Expected failure return on outbound send failure.');
    }

    const failedEventRecorded = await db.getOne(
      'SELECT event_id FROM processed_webhook_events WHERE event_id = $1',
      [msgFailEventId]
    );
    if (failedEventRecorded) {
      throw new Error('Facebook Test 7 Failed: Event was erroneously marked processed after outbound failure.');
    }
    console.log('  ✓ 14. Outbound dispatch failure safely handled: Event NOT marked processed, retry preserved');
  } finally {
    ComposioService.sendFacebookReply = originalSendFacebookReply;
  }

  console.log('====================================================');
  console.log('  ALL FACEBOOK AI REPLY INTEGRATION TESTS PASSED!');
  console.log('====================================================\n');
}
