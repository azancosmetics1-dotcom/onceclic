import { AuthService } from '../server/src/services/AuthService';
import { ConversationService } from '../server/src/services/ConversationService';
import { ConversationChannel } from '@onceclic/shared';

export async function runIdempotencyTests() {
  console.log('--- Running Client Message Idempotency Tests ---');

  const auth = await AuthService.register({
    email: `idemp_${Date.now()}@example.com`,
    password: 'password123',
    fullName: 'Idempotency Tester',
    businessName: 'Idempotency Corp',
  });

  const orgId = auth.organization!.id;

  const conv = await ConversationService.getOrCreateConversation({
    organizationId: orgId,
    channel: ConversationChannel.WEB,
    customerName: 'Test Visitor',
    customerEmail: 'visitor@example.com',
  });

  const clientMsgId = `client_msg_${Date.now()}`;

  // First dispatch
  const res1 = await ConversationService.handleCustomerMessage({
    organizationId: orgId,
    conversationId: conv.id,
    content: 'Hello, what are your hours?',
    clientMessageId: clientMsgId,
  });

  // Second duplicate dispatch (network retry simulation)
  const res2 = await ConversationService.handleCustomerMessage({
    organizationId: orgId,
    conversationId: conv.id,
    content: 'Hello, what are your hours?',
    clientMessageId: clientMsgId,
  });

  if (res1.userMessage.id !== res2.userMessage.id) {
    throw new Error('Idempotency Failure: Duplicate customer message was created for identical clientMessageId!');
  }

  const allMessages = await ConversationService.getMessages(orgId, conv.id);
  const customerMessages = allMessages.filter((m) => m.clientMessageId === clientMsgId);

  if (customerMessages.length !== 1) {
    throw new Error(`Expected exactly 1 message in database for clientMessageId, found ${customerMessages.length}`);
  }

  console.log('  ✓ Client message idempotency verified: duplicate retries return original response without duplication');
}
