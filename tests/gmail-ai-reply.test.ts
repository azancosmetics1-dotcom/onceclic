import { getDatabase } from '../server/src/db';
import { AuthService } from '../server/src/services/AuthService';
import { EmailService } from '../server/src/services/EmailService';
import { InboundChannelService } from '../server/src/services/InboundChannelService';
import { ConversationChannel, KnowledgeSourceType } from '@onceclic/shared';
import { KnowledgeService } from '../server/src/services/KnowledgeService';
import { ComposioService } from '../server/src/services/ComposioService';

export async function runGmailAIReplyTests() {
  console.log('====================================================');
  console.log('  RUNNING GMAIL AI REPLY INTEGRATION TESTS');
  console.log('====================================================');

  const db = getDatabase();
  await db.runMigrations();

  // 1. Create Test Organization A: ONCEClic Test Clinic
  const userA = await AuthService.register({
    email: `gmail_test_clinic_${Date.now()}@example.com`,
    password: 'password123',
    fullName: 'Dr. Test Clinic',
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
    email: `gmail_test_b_${Date.now()}@example.com`,
    password: 'password123',
    fullName: 'Dr. Other Clinic',
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

  // Mock outbound email dispatcher
  let outboundEmailsSent: Array<{ toEmail: string; subject: string; body: string }> = [];
  let shouldSimulateOutboundFailure = false;

  const originalSendEmailReply = EmailService.sendEmailReply;
  EmailService.sendEmailReply = async (params) => {
    if (shouldSimulateOutboundFailure) {
      return { success: false, provider: 'TEST_MOCK_FAILED' };
    }
    outboundEmailsSent.push({
      toEmail: params.toEmail,
      subject: params.subject,
      body: params.body,
    });
    return { success: true, messageId: `sent_gmail_${Date.now()}`, provider: 'TEST_GMAIL_MOCK' };
  };

  try {
    // ----------------------------------------------------
    // Test 1: First Inbound Message Creates Conversation & Sends Grounded AI Reply
    // ----------------------------------------------------
    const fakeCustomerEmail = 'trial-test-001@example.test';
    const msg1EventId = `gmail_msg_001_${Date.now()}`;

    const res1 = await InboundChannelService.processInboundCustomerMessage({
      organizationId: orgAId,
      channel: ConversationChannel.EMAIL,
      externalMessageId: msg1EventId,
      senderId: fakeCustomerEmail,
      senderAddress: fakeCustomerEmail,
      senderName: 'Test Customer',
      subject: 'Opening Hours Question',
      text: 'What time are you open?',
    });

    if (!res1.success || !res1.aiReplySent || !res1.conversationId) {
      throw new Error(`Gmail Test 1 Failed: Expected successful AI reply, got ${JSON.stringify(res1)}`);
    }

    if (!res1.replyText?.includes('9 AM to 5 PM') && !res1.replyText?.includes('Monday to Friday')) {
      throw new Error(`Gmail Test 1 Failed: Reply not grounded in clinic hours: "${res1.replyText}"`);
    }

    // Check that outbound email was dispatched
    if (outboundEmailsSent.length !== 1 || outboundEmailsSent[0].toEmail !== fakeCustomerEmail) {
      throw new Error(`Gmail Test 1 Failed: Outbound email not sent to ${fakeCustomerEmail}`);
    }

    // Check that event was marked as processed in processed_webhook_events
    const event1Recorded = await db.getOne(
      'SELECT event_id FROM processed_webhook_events WHERE event_id = $1',
      [msg1EventId]
    );
    if (!event1Recorded) {
      throw new Error('Gmail Test 1 Failed: Event was not recorded in processed_webhook_events.');
    }
    console.log('  ✓ 1-8. Gmail Inbound → Org Resolution → Conversation Created → Knowledge Loaded → AI Grounded → Outbound Sent → Event Processed');

    // ----------------------------------------------------
    // Test 2: Idempotency & Duplicate Event Protection
    // ----------------------------------------------------
    const resDuplicate = await InboundChannelService.processInboundCustomerMessage({
      organizationId: orgAId,
      channel: ConversationChannel.EMAIL,
      externalMessageId: msg1EventId, // same event ID
      senderId: fakeCustomerEmail,
      senderAddress: fakeCustomerEmail,
      senderName: 'Test Customer',
      subject: 'Opening Hours Question',
      text: 'What time are you open?',
    });

    if (!resDuplicate.ignoredDuplicate || resDuplicate.aiReplySent) {
      throw new Error('Gmail Test 2 Failed: Replaying exact duplicate event was not ignored.');
    }
    if (outboundEmailsSent.length !== 1) {
      throw new Error('Gmail Test 2 Failed: Duplicate message caused a second outbound email.');
    }
    console.log('  ✓ 9. Duplicate inbound email event strictly ignored (Zero duplicate emails sent)');

    // ----------------------------------------------------
    // Test 3: Second Unique Message from Same Sender is Processed
    // ----------------------------------------------------
    const msg2EventId = `gmail_msg_002_${Date.now()}`;
    const res2 = await InboundChannelService.processInboundCustomerMessage({
      organizationId: orgAId,
      channel: ConversationChannel.EMAIL,
      externalMessageId: msg2EventId,
      senderId: fakeCustomerEmail,
      senderAddress: fakeCustomerEmail,
      senderName: 'Test Customer',
      subject: 'Fee Inquiry',
      text: 'What is your consultation fee?',
    });

    if (!res2.success || !res2.aiReplySent) {
      throw new Error(`Gmail Test 3 Failed: Second unique message failed: ${JSON.stringify(res2)}`);
    }

    if (!res2.replyText?.includes('2500 PKR') && !res2.replyText?.includes('2500')) {
      throw new Error(`Gmail Test 3 Failed: Fee not grounded: "${res2.replyText}"`);
    }
    if (outboundEmailsSent.length !== 2) {
      throw new Error('Gmail Test 3 Failed: Expected 2 total outbound emails sent.');
    }
    console.log('  ✓ 10. Second unique message from same customer successfully processed in existing conversation');

    // ----------------------------------------------------
    // Test 4: Missing Information / Anti-Hallucination
    // ----------------------------------------------------
    const msg3EventId = `gmail_msg_003_${Date.now()}`;
    const res3 = await InboundChannelService.processInboundCustomerMessage({
      organizationId: orgAId,
      channel: ConversationChannel.EMAIL,
      externalMessageId: msg3EventId,
      senderId: fakeCustomerEmail,
      senderAddress: fakeCustomerEmail,
      senderName: 'Test Customer',
      subject: 'Sunday Hours',
      text: 'What time are you open Sunday?',
    });

    if (!res3.replyText || res3.replyText.toLowerCase().includes('open on sunday')) {
      throw new Error(`Gmail Test 4 Failed: AI hallucinated Sunday hours: "${res3.replyText}"`);
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

    const msg4EventId = `gmail_msg_004_${Date.now()}`;
    const res4 = await InboundChannelService.processInboundCustomerMessage({
      organizationId: orgAId,
      channel: ConversationChannel.EMAIL,
      externalMessageId: msg4EventId,
      senderId: fakeCustomerEmail,
      senderAddress: fakeCustomerEmail,
      senderName: 'Test Customer',
      subject: 'Updated Fee Inquiry',
      text: 'How much is the fee now?',
    });

    if (!res4.replyText?.includes('3000 PKR') && !res4.replyText?.includes('3000')) {
      throw new Error(`Gmail Test 5 Failed: AI did not reflect updated 3000 PKR fee: "${res4.replyText}"`);
    }
    console.log('  ✓ 12. Knowledge update: AI immediately uses updated 3000 PKR fee');

    // ----------------------------------------------------
    // Test 6: Strict Multi-Tenant Isolation (Org A vs Org B)
    // ----------------------------------------------------
    const msgBEventId = `gmail_msg_orgB_${Date.now()}`;
    const resB = await InboundChannelService.processInboundCustomerMessage({
      organizationId: orgBId,
      channel: ConversationChannel.EMAIL,
      externalMessageId: msgBEventId,
      senderId: 'patient.b@example.test',
      senderAddress: 'patient.b@example.test',
      senderName: 'Patient B',
      subject: 'Fee for Clinic B',
      text: 'What is your consultation fee?',
    });

    if (!resB.replyText?.includes('9000 PKR') && !resB.replyText?.includes('9000')) {
      throw new Error(`Gmail Test 6 Failed: Tenant B received incorrect knowledge: "${resB.replyText}"`);
    }
    if (resB.replyText.includes('2500') || resB.replyText.includes('3000')) {
      throw new Error('Gmail Test 6 Failed: Cross-tenant knowledge leak from Org A to Org B detected!');
    }
    console.log('  ✓ 13. Tenant isolation: Org B receives 9000 PKR fee with ZERO Org A leakage');

    // ----------------------------------------------------
    // Test 7: Outbound Failure Handling (Event NOT marked processed)
    // ----------------------------------------------------
    shouldSimulateOutboundFailure = true;
    const msgFailEventId = `gmail_msg_fail_${Date.now()}`;

    const resFail = await InboundChannelService.processInboundCustomerMessage({
      organizationId: orgAId,
      channel: ConversationChannel.EMAIL,
      externalMessageId: msgFailEventId,
      senderId: fakeCustomerEmail,
      senderAddress: fakeCustomerEmail,
      senderName: 'Test Customer',
      subject: 'Outbound Failure Test',
      text: 'Hello test failure',
    });

    if (resFail.success || resFail.aiReplySent) {
      throw new Error('Gmail Test 7 Failed: Expected failure return on outbound send failure.');
    }

    const failedEventRecorded = await db.getOne(
      'SELECT event_id FROM processed_webhook_events WHERE event_id = $1',
      [msgFailEventId]
    );
    if (failedEventRecorded) {
      throw new Error('Gmail Test 7 Failed: Event was erroneously marked processed after outbound failure.');
    }
    console.log('  ✓ 14. Outbound dispatch failure safely handled: Event NOT marked processed, retry preserved');
  } finally {
    EmailService.sendEmailReply = originalSendEmailReply;
  }

  console.log('====================================================');
  console.log('  ALL GMAIL AI REPLY INTEGRATION TESTS PASSED!');
  console.log('====================================================\n');
}
