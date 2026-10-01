import { strict as assert } from 'assert';
import { getDatabase } from '../server/src/db';
import { AuthService } from '../server/src/services/AuthService';
import { KnowledgeService } from '../server/src/services/KnowledgeService';
import { ConversationService } from '../server/src/services/ConversationService';
import { IntegrationService } from '../server/src/services/IntegrationService';
import { EmailService } from '../server/src/services/EmailService';
import { ComposioService } from '../server/src/services/ComposioService';
import { aiProvider, MockAIProvider, GeminiProvider } from '../server/src/services/AIProvider';
import {
  ConversationChannel,
  MessageRole,
  KnowledgeSourceType,
} from '@onceclic/shared';
import { v4 as uuidv4 } from 'uuid';

export async function runRealChannelAIReplyTests() {
  console.log('====================================================');
  console.log('  RUNNING REAL CHANNEL AI REPLY & CONVERSATION TESTS');
  console.log('====================================================\n');

  const db = getDatabase();
  await db.runMigrations();

  const timestamp = Date.now();

  // 1. SAFETY CHECK: Verify Mock AI Provider is used and Zero Gemini calls are made
  console.log('--- 1. Verification of AI Mock Provider & Credit Safety ---');
  assert.ok(
    aiProvider instanceof MockAIProvider || !(aiProvider instanceof GeminiProvider),
    'Mock AI Provider must be used in automated tests (Zero real Gemini calls)'
  );
  console.log('  ✓ Verified: Mock AI Provider active, Zero real Gemini API calls will be made.');

  // 2. TENANT SETUP: Org A (Sunrise Clinic) & Org B (Sunset Clinic) with distinct knowledge
  console.log('\n--- 2. Setting Up Tenant Isolation Test Data ---');
  const orgAEmail = `sunrise_clinic_${timestamp}@example.com`;
  const orgAReg = await AuthService.register({
    email: orgAEmail,
    password: 'password123',
    fullName: 'Dr. Sunrise',
    businessName: 'Sunrise Clinic',
  });
  const orgAId = orgAReg.organization!.id;

  // Complete onboarding for Org A
  await AuthService.completeOnboarding({
    userId: orgAReg.user.id,
    organizationId: orgAId,
    industry: 'Clinic',
    businessKnowledge: 'Sunrise Clinic is open Monday to Friday from 9 AM to 5 PM. Consultation is $50. Address: 123 Main Street.',
  });

  const orgBEmail = `sunset_clinic_${timestamp}@example.com`;
  const orgBReg = await AuthService.register({
    email: orgBEmail,
    password: 'password123',
    fullName: 'Dr. Sunset',
    businessName: 'Sunset Clinic',
  });
  const orgBId = orgBReg.organization!.id;

  // Complete onboarding for Org B
  await AuthService.completeOnboarding({
    userId: orgBReg.user.id,
    organizationId: orgBId,
    industry: 'Clinic',
    businessKnowledge: 'Sunset Clinic is open Monday to Friday from 10 AM to 6 PM. Consultation is $80. Address: 456 Sunset Boulevard.',
  });

  console.log('  ✓ Org A (Sunrise Clinic) and Org B (Sunset Clinic) initialized with verified knowledge.');

  // Mock outbound channel handlers to intercept and verify outbound dispatches
  const outboundDispatches: Array<{
    channel: string;
    organizationId: string;
    recipientId?: string;
    threadId?: string;
    content: string;
  }> = [];

  // Spy on Composio outbound send methods (ExecuteAction doesn't exist — spy on actual send methods)
  const originalSendInstagramReply = ComposioService.sendInstagramReply;
  const originalSendFacebookReply = ComposioService.sendFacebookReply;
  const originalSendGmailReply = ComposioService.sendGmailReply;

  ComposioService.sendInstagramReply = async (params: any) => {
    outboundDispatches.push({
      channel: 'INSTAGRAM',
      organizationId: params.organizationId,
      recipientId: params.recipientId,
      content: params.text || '',
    });
    return { success: true, messageId: `mock_ig_${Date.now()}` };
  };

  ComposioService.sendFacebookReply = async (params: any) => {
    outboundDispatches.push({
      channel: 'FACEBOOK',
      organizationId: params.organizationId,
      recipientId: params.recipientId,
      content: params.text || '',
    });
    return { success: true, messageId: `mock_fb_${Date.now()}` };
  };

  ComposioService.sendGmailReply = async (params: any) => {
    outboundDispatches.push({
      channel: 'GMAIL',
      organizationId: params.organizationId,
      recipientId: params.toEmail,
      content: params.body || '',
    });
    return { success: true, messageId: `mock_gmail_${Date.now()}` };
  };

  // Spy on EmailService outbound reply (fallback path)
  const originalSendEmailReply = EmailService.sendEmailReply;
  EmailService.sendEmailReply = async (params: any) => {
    outboundDispatches.push({
      channel: 'GMAIL',
      organizationId: params.organizationId,
      recipientId: params.toEmail,
      threadId: undefined,
      content: params.body || params.bodyHtml || params.bodyText || '',
    });
    return { success: true, messageId: `msg_${Date.now()}`, provider: 'TEST_MOCK' };
  };

  try {
    // =========================================================================
    // 3. GMAIL PIPELINE: First inbound message with NO pre-existing conversation
    // =========================================================================
    console.log('\n--- 3. Testing Gmail Inbound AI Reply Pipeline ---');
    outboundDispatches.length = 0;

    // Verify no pre-existing conversations
    const existingGmailConvs = await db.query(
      'SELECT id FROM conversations WHERE organization_id = $1 AND channel = $2',
      [orgAId, ConversationChannel.EMAIL]
    );
    assert.equal(existingGmailConvs.rows.length, 0, 'No prior Gmail conversation exists');

    // Simulate Gmail Inbound
    const gmailInboundResult = await EmailService.processInboundEmail({
      organizationId: orgAId,
      fromEmail: 'patient_jane@example.com',
      fromName: 'Jane Doe',
      subject: 'Inquiry about opening hours',
      textBody: 'Hi, what time are you open?',
      messageId: `gmail_inbound_msg_${timestamp}`,
    });

    assert.equal(gmailInboundResult.success, true, 'Gmail inbound processing succeeded');
    assert.ok(gmailInboundResult.conversationId, 'Conversation automatically created for first Gmail message');

    // Verify conversation was created
    const createdGmailConv = await db.getOne(
      'SELECT id, channel, customer_email FROM conversations WHERE id = $1',
      [gmailInboundResult.conversationId]
    );
    assert.ok(createdGmailConv, 'Conversation record created in database');
    assert.equal(createdGmailConv.channel, ConversationChannel.EMAIL, 'Conversation channel is EMAIL');
    assert.equal(createdGmailConv.customer_email, 'patient_jane@example.com', 'Customer email identified');

    // Verify messages stored
    const gmailMessages = await ConversationService.getMessages(orgAId, gmailInboundResult.conversationId!);
    assert.equal(gmailMessages.length, 2, 'Inbound customer message + Outbound AI reply stored');
    assert.equal(gmailMessages[0].role, MessageRole.CUSTOMER);
    assert.equal(gmailMessages[1].role, MessageRole.AI);

    // Verify AI reply is grounded in Org A knowledge (9 AM to 5 PM)
    const gmailAIReply = gmailMessages[1].content;
    assert.ok(
      gmailAIReply.includes('9') && (gmailAIReply.includes('5') || gmailAIReply.includes('9:00') || gmailAIReply.includes('9 AM')),
      `AI response must contain opening hours (9 AM - 5 PM). Received: "${gmailAIReply}"`
    );

    // Verify outbound dispatch occurred
    assert.ok(outboundDispatches.some((d) => d.channel === 'GMAIL' && d.organizationId === orgAId), 'Gmail outbound reply sent');
    console.log('  ✓ Gmail first message processed: Auto-created conversation, grounded AI response (9 AM - 5 PM), dispatched via Gmail.');

    // =========================================================================
    // 4. INSTAGRAM PIPELINE: First inbound message with NO pre-existing conversation
    // =========================================================================
    console.log('\n--- 4. Testing Instagram Inbound AI Reply Pipeline ---');
    outboundDispatches.length = 0;

    // Verify no pre-existing Instagram conversations
    const existingIgConvs = await db.query(
      'SELECT id FROM conversations WHERE organization_id = $1 AND channel = $2',
      [orgAId, ConversationChannel.INSTAGRAM]
    );
    assert.equal(existingIgConvs.rows.length, 0, 'No prior Instagram conversation exists');

    const igInboundEventId = `ig_evt_${timestamp}_1`;
    const igInboundResult = await IntegrationService.handleInstagramInboundMessage({
      organizationId: orgAId,
      senderId: 'ig_user_alexp',
      senderUsername: 'alex_patient',
      text: 'How much is a consultation?',
      messageId: igInboundEventId,
    });

    assert.equal(igInboundResult.success, true, 'Instagram inbound message handled');
    assert.ok(igInboundResult.conversationId, 'Conversation automatically created for first Instagram message');

    const igMessages = await ConversationService.getMessages(orgAId, igInboundResult.conversationId!);
    assert.equal(igMessages.length, 2, 'Instagram inbound message + AI reply stored');
    const igAIReply = igMessages[1].content;
    assert.ok(
      igAIReply.includes('$50') || igAIReply.includes('50'),
      `Instagram AI reply must contain consultation price ($50). Received: "${igAIReply}"`
    );

    // Verify outbound Instagram dispatch
    assert.ok(outboundDispatches.some((d) => d.channel === 'INSTAGRAM'), 'Instagram outbound reply dispatched');
    console.log('  ✓ Instagram first message processed: Auto-created conversation, grounded price ($50), dispatched via Instagram.');

    // =========================================================================
    // 5. FACEBOOK PIPELINE: First inbound message with NO pre-existing conversation
    // =========================================================================
    console.log('\n--- 5. Testing Facebook Inbound AI Reply Pipeline ---');
    outboundDispatches.length = 0;

    const existingFbConvs = await db.query(
      'SELECT id FROM conversations WHERE organization_id = $1 AND channel = $2',
      [orgAId, ConversationChannel.FACEBOOK]
    );
    assert.equal(existingFbConvs.rows.length, 0, 'No prior Facebook conversation exists');

    const fbInboundEventId = `fb_evt_${timestamp}_1`;
    const fbInboundResult = await IntegrationService.handleFacebookInboundMessage({
      organizationId: orgAId,
      senderId: 'fb_user_samuel',
      senderName: 'Samuel Green',
      text: 'Where are you located?',
      messageId: fbInboundEventId,
    });

    assert.equal(fbInboundResult.success, true, 'Facebook inbound message handled');
    assert.ok(fbInboundResult.conversationId, 'Conversation automatically created for first Facebook message');

    const fbMessages = await ConversationService.getMessages(orgAId, fbInboundResult.conversationId!);
    assert.equal(fbMessages.length, 2, 'Facebook inbound message + AI reply stored');
    const fbAIReply = fbMessages[1].content;
    assert.ok(
      fbAIReply.includes('123 Main Street') || fbAIReply.includes('Main Street'),
      `Facebook AI reply must contain address (123 Main Street). Received: "${fbAIReply}"`
    );

    // Verify outbound Facebook dispatch
    assert.ok(outboundDispatches.some((d) => d.channel === 'FACEBOOK'), 'Facebook outbound reply dispatched');
    console.log('  ✓ Facebook first message processed: Auto-created conversation, grounded address (123 Main Street), dispatched via Facebook.');

    // =========================================================================
    // 6. DUPLICATE EVENT PROTECTION: Duplicate event IDs do NOT produce duplicate replies
    // =========================================================================
    console.log('\n--- 6. Testing Duplicate Event Protection ---');
    const dispatchCountBefore = outboundDispatches.length;

    // Send the same Facebook messageId again
    const duplicateFbResult = await IntegrationService.handleFacebookInboundMessage({
      organizationId: orgAId,
      senderId: 'fb_user_samuel',
      senderName: 'Samuel Green',
      text: 'Where are you located?',
      messageId: fbInboundEventId,
    });

    assert.equal(duplicateFbResult.success, true);
    assert.equal(duplicateFbResult.ignoredDuplicate, true, 'Duplicate inbound message safely ignored');
    assert.equal(outboundDispatches.length, dispatchCountBefore, 'No duplicate outbound dispatch sent');
    console.log('  ✓ Duplicate inbound event safely ignored without duplicate reply.');

    // =========================================================================
    // 7. TENANT ISOLATION: Org A vs Org B Grounding
    // =========================================================================
    console.log('\n--- 7. Testing Strict Multi-Tenant Knowledge Isolation ---');
    // Message to Org B (Sunset Clinic) asking for hours
    const orgBGmailResult = await EmailService.processInboundEmail({
      organizationId: orgBId,
      fromEmail: 'patient_bob@example.com',
      fromName: 'Bob Smith',
      subject: 'Opening hours?',
      textBody: 'What time does Sunset Clinic open?',
      messageId: `gmail_orgb_${timestamp}`,
    });

    const orgBMessages = await ConversationService.getMessages(orgBId, orgBGmailResult.conversationId!);
    const orgBAIReply = orgBMessages[1].content;
    assert.ok(
      orgBAIReply.includes('10') || orgBAIReply.includes('6') || orgBAIReply.includes('10 AM'),
      `Org B AI must use Org B hours (10 AM - 6 PM). Received: "${orgBAIReply}"`
    );
    assert.ok(!orgBAIReply.includes('Sunrise Clinic'), 'Org B AI must never mention Org A');
    assert.ok(!orgBAIReply.includes('123 Main Street'), 'Org B AI must never leak Org A address');
    console.log('  ✓ Multi-tenant isolation verified: Org B replies exclusively with Org B knowledge.');

    // =========================================================================
    // 8. UNKNOWN INFORMATION: Safe fallback when information is not in knowledge
    // =========================================================================
    console.log('\n--- 8. Testing Anti-Hallucination Safe Fallback for Unknown Information ---');
    const unknownQuestionResult = await ConversationService.handleCustomerMessage({
      organizationId: orgAId,
      conversationId: gmailInboundResult.conversationId!,
      content: 'Do you offer valet parking and helicopter landing?',
      clientMessageId: `msg_unknown_${Date.now()}`,
    });

    const unknownAnswer = unknownQuestionResult.aiMessage!.content.toLowerCase();
    assert.ok(
      unknownAnswer.includes("don't have") ||
        unknownAnswer.includes('not have') ||
        unknownAnswer.includes('please contact') ||
        unknownAnswer.includes('directly') ||
        unknownAnswer.includes('assist'),
      `AI must not invent facts for unknown topics. Received: "${unknownQuestionResult.aiMessage!.content}"`
    );
    assert.ok(!unknownAnswer.includes('helicopter'), 'AI must NOT invent fake helicopter landing services');
    console.log('  ✓ Safe fallback verified: Unknown information safely deferred to business owner.');

    // =========================================================================
    // 9. KNOWLEDGE UPDATE TEST: Dynamic updates immediately reflect in subsequent replies
    // =========================================================================
    console.log('\n--- 9. Testing Knowledge Update Dynamic Reflection ---');
    // Add updated knowledge source for Org A
    await KnowledgeService.addSource({
      organizationId: orgAId,
      sourceType: KnowledgeSourceType.BUSINESS_INFO,
      title: 'Updated Clinic Opening Hours',
      rawContent: 'URGENT UPDATE: Sunrise Clinic now opens at 11:00 AM on weekdays.',
    });

    const updatedReplyResult = await ConversationService.handleCustomerMessage({
      organizationId: orgAId,
      conversationId: gmailInboundResult.conversationId!,
      content: 'What time do you open now?',
      clientMessageId: `msg_update_${Date.now()}`,
    });

    const updatedAnswer = updatedReplyResult.aiMessage!.content;
    assert.ok(
      updatedAnswer.includes('11') || updatedAnswer.includes('11:00'),
      `Updated opening hours (11:00 AM) reflected in AI reply. Received: "${updatedAnswer}"`
    );
    console.log('  ✓ Knowledge update immediately reflected in subsequent customer replies.');

    console.log('\n====================================================');
    console.log('  ALL REAL CHANNEL AI REPLY TESTS PASSED (0 GEMINI CALLS)!');
    console.log('====================================================\n');
  } finally {
    // Restore original methods
    ComposioService.sendInstagramReply = originalSendInstagramReply;
    ComposioService.sendFacebookReply = originalSendFacebookReply;
    ComposioService.sendGmailReply = originalSendGmailReply;
    EmailService.sendEmailReply = originalSendEmailReply;
  }
}
