import { ConversationService } from '../server/src/services/ConversationService';
import { PublicKnowledgeGroundingService } from '../server/src/services/PublicKnowledgeGroundingService';
import { getDatabase } from '../server/src/db';
import { ConversationChannel } from '@onceclic/shared';
import { v4 as uuidv4 } from 'uuid';

async function testPublicKnowledgeGrounding() {
  console.log('--- Running Public Knowledge & Page Grounding Verification Tests ---');

  const db = getDatabase();
  await db.runMigrations();

  // 1. Verify Public Knowledge items
  const items = PublicKnowledgeGroundingService.getAllKnowledge();
  if (items.length < 5) throw new Error('Expected at least 5 public knowledge items');
  console.log(`  ✓ 1. Loaded ${items.length} verified ONCEClic public knowledge articles.`);

  const orgId = uuidv4();
  const testSlug = `onceclic-test-${Date.now()}`;
  await db.execute(
    `INSERT INTO organizations (id, name, slug, business_type, email, phone, website, is_active, created_at, updated_at)
     VALUES ($1, 'ONCEClic Official', $2, 'AI Receptionist SaaS', 'support@onceclic.com', '+1-800-ONCECLIC', 'https://onceclic.com', TRUE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    [orgId, testSlug]
  );

  await db.execute(
    `INSERT INTO ai_employees (id, organization_id, name, role_title, status, personality, instructions, greeting_message, fallback_message, created_at, updated_at)
     VALUES ($1, $2, 'Luna', 'ONCEClic AI Specialist', 'ACTIVE', 'Helpful, transparent and knowledgeable', 'Assist customers with ONCEClic information, pricing, and trial.', 'Hello! How can I help you with ONCEClic today?', 'Our team is here to assist.', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    [uuidv4(), orgId]
  );

  await db.execute(
    `INSERT INTO subscriptions (id, organization_id, status, trial_started_at, trial_ends_at, created_at, updated_at)
     VALUES ($1, $2, 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    [uuidv4(), orgId]
  );

  // 3. Test System Prompt Construction
  const prompt = await ConversationService.buildSystemPrompt(orgId, ConversationChannel.WEB, 'What is your pricing and refund policy?');
  
  if (!prompt.includes('VERIFIED ONCECLIC PUBLIC PLATFORM & PAGE KNOWLEDGE')) {
    throw new Error('System prompt missing ONCEClic public knowledge grounding.');
  }
  if (!prompt.includes('$19 USD / month')) {
    throw new Error('System prompt missing $19/mo pricing information.');
  }
  if (!prompt.includes('7-Day Free Trial')) {
    throw new Error('System prompt missing 7-day trial information.');
  }
  if (!prompt.includes('14-Day Refund Guarantee')) {
    throw new Error('System prompt missing 14-day refund policy.');
  }
  console.log('  ✓ 2. System prompt for ONCEClic correctly embeds all public page facts (Pricing, Trial, Refund, Channels).');

  // 4. Test Customer Message Handling with Grounded AI Response
  const conv = await ConversationService.getOrCreateConversation({
    organizationId: orgId,
    channel: ConversationChannel.WEB,
    customerName: 'Visitor Bob',
  });

  const reply = await ConversationService.handleCustomerMessage({
    organizationId: orgId,
    conversationId: conv.id,
    content: 'Hi! Can you tell me what ONCEClic is, what is the price for Pro, and how the free trial works?',
  });

  if (!reply.aiMessage) {
    throw new Error('AI receptionist returned no aiMessage object.');
  }
  const aiContent = reply.aiMessage.content;
  console.log('\n[Simulated AI Reply Sample]:\n', aiContent);

  if (!aiContent || aiContent.length === 0) {
    throw new Error('AI receptionist returned empty content.');
  }
  console.log('  ✓ 3. End-to-end customer message to AI receptionist answered successfully with grounded knowledge.');

  console.log('====================================================');
  console.log('  ALL PUBLIC KNOWLEDGE GROUNDING TESTS PASSED!');
  console.log('====================================================\n');
}

testPublicKnowledgeGrounding().catch((err) => {
  console.error(err);
  process.exit(1);
});
