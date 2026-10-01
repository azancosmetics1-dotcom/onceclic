process.env.USE_EMBEDDED_DB = 'true';
process.env.NODE_ENV = 'test';

import {
  GeminiProvider,
  OpenAIProvider,
  createAIProvider,
  aiProvider,
  DelegatingAIProvider,
} from '../server/src/services/AIProvider';
import { ConversationService } from '../server/src/services/ConversationService';
import { db } from '../server/src/db';
import {
  ConversationChannel,
  ConversationStatus,
  SubscriptionStatus,
} from '@onceclic/shared';
import { v4 as uuidv4 } from 'uuid';

/**
 * Helper to run assertion with test description
 */
function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`❌ Assertion failed: ${message}`);
  }
}

export async function runGeminiProviderTests() {
  console.log('--- Running Gemini Provider & Multi-Provider Architecture Tests ---');

  // =========================================================================
  // 1. Gemini Provider Initialization & Missing Key Handling
  // =========================================================================
  const unconfiguredGemini = new GeminiProvider('', 'gemini-3.5-flash-lite');
  assert(unconfiguredGemini.providerName === 'Gemini', 'Provider name must be Gemini');
  assert(unconfiguredGemini.modelName === 'gemini-3.5-flash-lite', 'Model name matches configuration');

  const unconfiguredHealth = await unconfiguredGemini.healthCheck();
  assert(!unconfiguredHealth.available, 'Unconfigured Gemini health check must be unavailable');
  assert(
    unconfiguredHealth.error?.includes('GEMINI_API_KEY is not configured') === true,
    'Unconfigured Gemini returns safe key guidance'
  );

  let unconfiguredThrown = false;
  try {
    await unconfiguredGemini.generateResponse({
      messages: [{ role: 'user', content: 'Hello' }],
    });
  } catch (err: any) {
    unconfiguredThrown = true;
    assert(err.message.includes('GEMINI_API_KEY is not configured'), 'Throws clean error on missing key');
  }
  assert(unconfiguredThrown, 'Unconfigured generation throws error');
  console.log('  ✓ 1. Unconfigured Gemini provider fails safely without leaking secrets');

  // =========================================================================
  // 2. Mock-based HTTP Status Code & Error Handling (403, 404, 429, Timeout, Malformed)
  // =========================================================================
  const originalFetch = global.fetch;

  try {
    // 2A. 403 Forbidden Handling
    global.fetch = async () => {
      return new Response(
        JSON.stringify({ error: { message: 'API_KEY_INVALID' } }),
        { status: 403, statusText: 'Forbidden' }
      );
    };

    const mock403Provider = new GeminiProvider('fake_key_secret_123', 'gemini-3.5-flash-lite');
    const health403 = await mock403Provider.healthCheck();
    assert(!health403.available, '403 health check reports unavailable');
    assert(health403.error?.includes('403') === true, '403 error includes status code');
    assert(!health403.error?.includes('fake_key_secret_123'), '403 error NEVER leaks secret API key');

    let error403Thrown = false;
    try {
      await mock403Provider.generateResponse({ messages: [{ role: 'user', content: 'test' }] });
    } catch (err: any) {
      error403Thrown = true;
      assert(err.message.includes('403'), 'Generation error identifies 403 authorization issue');
      assert(!err.message.includes('fake_key_secret_123'), 'Generation error redacts API key');
    }
    assert(error403Thrown, '403 generation throws expected error');
    console.log('  ✓ 2. 403 Forbidden handling sanitized & verified');

    // 2B. 404 Model Not Found Handling
    global.fetch = async () => {
      return new Response(
        JSON.stringify({ error: { message: 'models/gemini-3.5-flash-lite is not found for API version v1beta' } }),
        { status: 404, statusText: 'Not Found' }
      );
    };

    const mock404Provider = new GeminiProvider('fake_key_secret_123', 'gemini-3.5-flash-lite');
    const health404 = await mock404Provider.healthCheck();
    assert(!health404.available, '404 health check reports unavailable');
    assert(health404.error?.includes('404') === true, '404 health check mentions 404');
    console.log('  ✓ 3. 404 Model availability/endpoint handling verified');

    // 2C. 429 Quota / Rate Limiting Handling
    global.fetch = async () => {
      return new Response(
        JSON.stringify({ error: { message: 'Resource has been exhausted (e.g. check quota).' } }),
        { status: 429, statusText: 'Too Many Requests' }
      );
    };

    const mock429Provider = new GeminiProvider('fake_key_secret_123', 'gemini-3.5-flash-lite');
    const health429 = await mock429Provider.healthCheck();
    assert(!health429.available, '429 health check reports unavailable');
    assert(health429.error?.includes('429') === true, '429 error includes status code');
    console.log('  ✓ 4. 429 Quota/rate limiting handling verified');

    // 2D. Timeout Handling
    global.fetch = async () => {
      const err = new Error('The operation was aborted due to timeout');
      err.name = 'AbortError';
      throw err;
    };

    const mockTimeoutProvider = new GeminiProvider('fake_key_secret_123', 'gemini-3.5-flash-lite');
    const healthTimeout = await mockTimeoutProvider.healthCheck();
    assert(!healthTimeout.available, 'Timeout health check reports unavailable');
    console.log('  ✓ 5. Timeout network handling verified');

    // 2E. Successful Generation & Token/Cost Accounting
    global.fetch = async (url: any, options: any) => {
      const body = JSON.parse(options?.body || '{}');
      const isEmbedding = String(url).includes('embedContent');

      if (isEmbedding) {
        return new Response(
          JSON.stringify({
            embedding: {
              values: new Array(768).fill(0.0123),
            },
          }),
          { status: 200, statusText: 'OK' }
        );
      }

      // Check system instruction passed properly
      const hasSystem = !!body.systemInstruction?.parts?.[0]?.text;
      const userText = body.contents?.[0]?.parts?.[0]?.text || '';

      let reply = 'Hello from Gemini Flash Lite!';
      if (userText.includes('GEMINI_TEST_OK')) {
        reply = 'GEMINI_TEST_OK';
      }

      return new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [{ text: reply }],
                role: 'model',
              },
              finishReason: 'STOP',
            },
          ],
          usageMetadata: {
            promptTokenCount: 15,
            candidatesTokenCount: 8,
            totalTokenCount: 23,
          },
        }),
        { status: 200, statusText: 'OK' }
      );
    };

    const mockSuccessProvider = new GeminiProvider('valid_test_key_123', 'gemini-3.5-flash-lite');
    const genResult = await mockSuccessProvider.generateResponse({
      messages: [
        { role: 'system', content: 'You are Luna receptionist.' },
        { role: 'user', content: 'Hi' },
      ],
    });

    assert(genResult.provider === 'Gemini', 'Provider matches Gemini');
    assert(genResult.model === 'gemini-3.5-flash-lite', 'Model matches configuration');
    assert(genResult.content.includes('Gemini Flash Lite'), 'Content matches generated reply');
    assert(genResult.promptTokens === 15, 'Prompt token count parsed correctly');
    assert(genResult.completionTokens === 8, 'Completion token count parsed correctly');
    assert(genResult.totalTokens === 23, 'Total tokens parsed correctly');
    assert(genResult.estimatedCostUsd > 0, 'Cost estimated accurately');

    // Embedding check
    const emb = await mockSuccessProvider.generateEmbedding('Test knowledge string');
    assert(Array.isArray(emb) && emb.length === 768, 'Embedding generated with 768 dimensions');
    console.log('  ✓ 6. Successful Gemini generation, embedding & token parsing verified');

  } finally {
    global.fetch = originalFetch;
  }

  // =========================================================================
  // 3. Provider Switching Factory & Delegating Provider
  // =========================================================================
  const openAIInstance = createAIProvider('openai');
  assert(openAIInstance instanceof OpenAIProvider, 'Factory creates OpenAIProvider');
  assert(openAIInstance.providerName === 'OpenAI', 'OpenAI provider name verified');

  const geminiInstance = createAIProvider('gemini');
  assert(geminiInstance instanceof GeminiProvider, 'Factory creates GeminiProvider');
  assert(geminiInstance.providerName === 'Gemini', 'Gemini provider name verified');

  let invalidProviderThrown = false;
  try {
    createAIProvider('invalid_ai_engine');
  } catch (err: any) {
    invalidProviderThrown = true;
    assert(err.message.includes('Unsupported AI Provider'), 'Throws clear error on invalid provider');
  }
  assert(invalidProviderThrown, 'Unsupported provider fails closed and safely');
  console.log('  ✓ 7. Provider factory & safe failure on invalid AI_PROVIDER verified');

  // =========================================================================
  // 4. ConversationService using Gemini Provider
  // =========================================================================
  const timestamp = Date.now();
  const dentalSlug = `apex-dental-${timestamp}`;
  const restaurantSlug = `bistro-gourmet-${timestamp}`;
  const salonSlug = `elegance-salon-${timestamp}`;

  const orgId = uuidv4();
  const userId = uuidv4();
  const aiEmployeeId = uuidv4();

  await db.execute(
    `INSERT INTO organizations (id, name, slug, business_type, address, phone, email, created_at, updated_at)
     VALUES ($1, 'Apex Dental Clinic', $2, 'Dental Clinic', '742 Evergreen Terrace, Suite 100', '+1-555-0199', 'care@apexdental.com', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    [orgId, dentalSlug]
  );

  await db.execute(
    `INSERT INTO business_settings (id, organization_id, business_hours, services, cancellation_policy, contact_instructions, created_at, updated_at)
     VALUES ($1, $2, '[]', '[{"name":"Dental Cleaning","price":120,"duration":45}]', '24h notice', 'Call clinic for emergency', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    [uuidv4(), orgId]
  );

  await db.execute(
    `INSERT INTO ai_employees (id, organization_id, name, role_title, instructions, greeting_message, fallback_message, tone, personality, status, created_at, updated_at)
     VALUES ($1, $2, 'Luna', 'AI Dental Receptionist', 'Assist dental patients with questions and appointments.', 'Hello! How can I help you today?', 'Please leave your contact info and our team will get back to you.', 'Professional & warm', 'Helpful dental receptionist', 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    [aiEmployeeId, orgId]
  );

  await db.execute(
    `INSERT INTO subscriptions (id, organization_id, status, trial_ends_at, created_at, updated_at)
     VALUES ($1, $2, 'TRIALING', CURRENT_TIMESTAMP + INTERVAL '7 day', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    [uuidv4(), orgId]
  );

  // Set active provider mock with deterministic Gemini generator
  (aiProvider as any).healthCheck = async () => ({
    available: true,
    provider: 'Gemini',
    model: 'gemini-3.5-flash-lite',
  });

  aiProvider.generateResponse = async (params) => {
    const systemPrompt = params.messages.find((m) => m.role === 'system')?.content || '';

    // Verify system prompt contains organization context and address
    if (!systemPrompt.includes('Apex Dental Clinic') || !systemPrompt.includes('742 Evergreen Terrace')) {
      throw new Error('System prompt did not ground clinic name and address properly!');
    }

    return {
      content: `Welcome to Apex Dental Clinic! We would be delighted to help you book a Dental Cleaning ($120). You can schedule directly at http://localhost:3000/book/${dentalSlug}.`,
      promptTokens: 40,
      completionTokens: 30,
      totalTokens: 70,
      estimatedCostUsd: 0.00002,
      model: 'gemini-3.5-flash-lite',
      provider: 'Gemini',
      handoffRequired: false,
    };
  };

  const conv = await ConversationService.getOrCreateConversation({
    organizationId: orgId,
    channel: ConversationChannel.WEB,
    customerName: 'Sarah Jenkins',
    customerEmail: 'sarah@example.com',
  });

  const messageResult = await ConversationService.handleCustomerMessage({
    organizationId: orgId,
    conversationId: conv.id,
    content: 'Hi, where are you located and how much is a teeth cleaning?',
  });

  assert(!!messageResult.aiMessage, 'AI response message was created by ConversationService');
  assert(
    messageResult.aiMessage!.content.includes('Apex Dental Clinic'),
    'AI response references correct organization'
  );
  assert(
    messageResult.aiMessage!.content.includes(`/book/${dentalSlug}`),
    'AI response contains valid booking link'
  );

  // Verify usage record in DB reflects Gemini provider & model
  const usageRes = await db.query(
    `SELECT provider, model, estimated_cost_usd FROM ai_usage_records WHERE organization_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [orgId]
  );
  assert(usageRes.rows.length === 1, 'AI usage record created');
  assert(usageRes.rows[0].provider === 'Gemini', 'Usage record logged provider as Gemini');
  assert(usageRes.rows[0].model === 'gemini-3.5-flash-lite', 'Usage record logged model as gemini-3.5-flash-lite');
  console.log('  ✓ 8. ConversationService seamlessly runs on Gemini provider with accurate usage logging');

  // =========================================================================
  // 5. Industry-Specific Grounding Verification for Gemini
  // =========================================================================
  // 5A. Restaurant context
  const restaurantOrgId = uuidv4();
  await db.execute(
    `INSERT INTO organizations (id, name, slug, business_type, address, phone, email, created_at, updated_at)
     VALUES ($1, 'Bistro Gourmet', $2, 'Restaurant', '100 Ocean Drive', '+1-555-8822', 'info@bistro.com', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    [restaurantOrgId, restaurantSlug]
  );
  await db.execute(
    `INSERT INTO business_settings (id, organization_id, business_hours, services, cancellation_policy, contact_instructions, reservation_settings, created_at, updated_at)
     VALUES ($1, $2, '[]', '[]', '24h notice', 'Call restaurant', $3, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    [uuidv4(), restaurantOrgId, JSON.stringify({ pricingType: 'deposit', depositAmount: 25, maxPartySize: 8 })]
  );

  const restaurantPrompt = await ConversationService.buildSystemPrompt(restaurantOrgId, ConversationChannel.WEB, 'Table reservation');
  assert(restaurantPrompt.includes('RESTAURANT / HOSPITALITY RECEPTIONIST GUIDELINES'), 'Restaurant guidelines included');
  assert(restaurantPrompt.includes('Reserve a Table'), 'Table reservation terminology present');
  assert(restaurantPrompt.includes('Deposit required: $25'), 'Deposit grounding present');
  assert(restaurantPrompt.includes('100 Ocean Drive'), 'Restaurant physical address grounded');
  assert(restaurantPrompt.includes(`/book/${restaurantSlug}`), 'Reservation URL grounded');
  console.log('  ✓ 9. Restaurant industry context grounding verified');

  // 5B. Salon & Spa context
  const salonOrgId = uuidv4();
  await db.execute(
    `INSERT INTO organizations (id, name, slug, business_type, address, phone, email, created_at, updated_at)
     VALUES ($1, 'Elegance Salon & Spa', $2, 'Hair Salon', '55 Fifth Ave', '+1-555-3344', 'contact@elegance.com', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    [salonOrgId, salonSlug]
  );
  await db.execute(
    `INSERT INTO business_settings (id, organization_id, business_hours, services, cancellation_policy, contact_instructions, created_at, updated_at)
     VALUES ($1, $2, '[]', $3, '24h notice', 'Call salon', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    [uuidv4(), salonOrgId, JSON.stringify([{ name: 'Balayage Color', price: 180, duration: 90 }])]
  );

  const salonPrompt = await ConversationService.buildSystemPrompt(salonOrgId, ConversationChannel.INSTAGRAM, 'Hair appointment');
  assert(salonPrompt.includes('SALON & SPA RECEPTIONIST GUIDELINES'), 'Salon guidelines included');
  assert(salonPrompt.includes('Stylist / Professional'), 'Stylist terminology present');
  assert(salonPrompt.includes('55 Fifth Ave'), 'Salon address grounded');
  assert(salonPrompt.includes('CHANNEL: INSTAGRAM DIRECT MESSAGE (DM)'), 'Instagram DM channel guidance present');
  console.log('  ✓ 10. Salon industry context & Instagram channel formatting grounded');

  // 5C. Facebook Messenger channel context
  const fbPrompt = await ConversationService.buildSystemPrompt(salonOrgId, ConversationChannel.FACEBOOK, 'Book haircut');
  assert(fbPrompt.includes('CHANNEL: FACEBOOK PAGE MESSAGE'), 'Facebook page channel guidance present');
  console.log('  ✓ 11. Facebook Messenger channel formatting grounded');

  // 5D. Email channel context
  const emailPrompt = await ConversationService.buildSystemPrompt(salonOrgId, ConversationChannel.EMAIL, 'Inquiry');
  assert(emailPrompt.includes('CHANNEL: BUSINESS EMAIL'), 'Email channel guidance present');
  console.log('  ✓ 12. Email channel formatting grounded');

  // =========================================================================
  // 6. Strict Tenant Isolation under Gemini
  // =========================================================================
  const tenantAOrgId = orgId;
  const tenantBOrgId = restaurantOrgId;

  const promptTenantA = await ConversationService.buildSystemPrompt(tenantAOrgId);
  const promptTenantB = await ConversationService.buildSystemPrompt(tenantBOrgId);

  assert(promptTenantA.includes('Apex Dental Clinic'), 'Tenant A prompt has Tenant A name');
  assert(!promptTenantA.includes('Bistro Gourmet'), 'Tenant A prompt has NO Tenant B data');
  assert(promptTenantB.includes('Bistro Gourmet'), 'Tenant B prompt has Tenant B name');
  assert(!promptTenantB.includes('Apex Dental Clinic'), 'Tenant B prompt has NO Tenant A data');
  console.log('  ✓ 13. Strict multi-tenant isolation under Gemini verified');

  console.log('\n====================================================');
  console.log('  ALL GEMINI PROVIDER & INTEGRATION TESTS PASSED!');
  console.log('====================================================');
}

if (require.main === module) {
  process.env.USE_EMBEDDED_DB = 'true';
  process.env.NODE_ENV = 'test';
  (async () => {
    const { getDatabase } = await import('../server/src/db');
    const db = getDatabase();
    await db.runMigrations();
    await runGeminiProviderTests();
    process.exit(0);
  })().catch((err) => {
    console.error('❌ Gemini tests failed:', err);
    process.exit(1);
  });
}
