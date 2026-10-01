process.env.USE_EMBEDDED_DB = 'true';
process.env.NODE_ENV = 'test';
process.env.AI_PROVIDER = 'gemini';

import dotenv from 'dotenv';
dotenv.config();

import { GeminiProvider } from '../server/src/services/AIProvider';
import { ConversationService } from '../server/src/services/ConversationService';
import { db, getDatabase } from '../server/src/db';
import { ConversationChannel } from '@onceclic/shared';
import { v4 as uuidv4 } from 'uuid';

async function runRealGeminiONCEClicTest() {
  console.log('====================================================');
  console.log('  ONCEClic Live Gemini Integration & Grounding Test');
  console.log('====================================================\n');

  const apiKey = process.env.GEMINI_API_KEY || '';
  const model = process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite';

  if (!apiKey || apiKey.includes('placeholder')) {
    console.error('❌ Error: GEMINI_API_KEY is not set in environment.');
    process.exit(1);
  }

  // Initialize DB migrations
  const database = getDatabase();
  await database.runMigrations();

  const realGeminiProvider = new GeminiProvider(apiKey, model);
  const health = await realGeminiProvider.healthCheck();
  console.log(`Gemini Health Check: Available=${health.available}, Model=${health.model}`);
  if (!health.available) {
    console.error(`❌ Gemini health check failed: ${health.error}`);
    process.exit(1);
  }

  const timestamp = Date.now();

  // 1. Synthetic Clinic Test
  console.log('\n--- 1. Testing Clinic Organization with Live Gemini ---');
  const clinicOrgId = uuidv4();
  const clinicSlug = `live-dental-${timestamp}`;
  await db.execute(
    `INSERT INTO organizations (id, name, slug, business_type, address, phone, email, created_at, updated_at)
     VALUES ($1, 'Beacon Family Dental Clinic', $2, 'Dental Clinic', '450 Lexington Ave, New York, NY', '+1-212-555-0144', 'contact@beacondental.com', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    [clinicOrgId, clinicSlug]
  );
  await db.execute(
    `INSERT INTO business_settings (id, organization_id, business_hours, services, cancellation_policy, contact_instructions, created_at, updated_at)
     VALUES ($1, $2, '[]', '[{"name":"Dental Hygiene & Cleaning","price":135,"duration":45},{"name":"Teeth Whitening","price":299,"duration":60}]', '24h notice required', 'Call for urgent dental needs', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    [uuidv4(), clinicOrgId]
  );
  await db.execute(
    `INSERT INTO ai_employees (id, organization_id, name, role_title, instructions, greeting_message, fallback_message, tone, personality, status, created_at, updated_at)
     VALUES ($1, $2, 'Ava', 'Dental AI Receptionist', 'Help patients learn about dental services, prices, address, and book appointments.', 'Hello! How can I help you today?', 'Please call our clinic directly.', 'Warm and professional', 'Empathetic receptionist', 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    [uuidv4(), clinicOrgId]
  );
  await db.execute(
    `INSERT INTO subscriptions (id, organization_id, status, trial_ends_at, created_at, updated_at)
     VALUES ($1, $2, 'TRIALING', CURRENT_TIMESTAMP + INTERVAL '7 day', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    [uuidv4(), clinicOrgId]
  );

  const clinicSystemPrompt = await ConversationService.buildSystemPrompt(clinicOrgId, ConversationChannel.WEB, 'Patient inquiry');
  const clinicResponse = await realGeminiProvider.generateResponse({
    messages: [
      { role: 'system', content: clinicSystemPrompt },
      { role: 'user', content: 'What services do you offer, how much is teeth cleaning, what is your address, and how do I book?' }
    ],
    temperature: 0.2,
    maxTokens: 300,
  });

  console.log(`[Clinic Gemini Output]:\n${clinicResponse.content}\n`);
  console.log(`[Clinic Token Usage]: Prompt=${clinicResponse.promptTokens}, Completion=${clinicResponse.completionTokens}, Cost=$${clinicResponse.estimatedCostUsd}`);

  const clinicText = clinicResponse.content.toLowerCase();
  const clinicPass = clinicText.includes('135') &&
                     (clinicText.includes('lexington') || clinicText.includes('450')) &&
                     clinicResponse.content.includes(`/book/${clinicSlug}`);
  console.log(`Clinic Grounding Pass: ${clinicPass ? 'YES' : 'NO'}`);

  // 2. Synthetic Restaurant Test
  console.log('\n--- 2. Testing Restaurant Organization with Live Gemini ---');
  const restOrgId = uuidv4();
  const restSlug = `la-trattoria-${timestamp}`;
  await db.execute(
    `INSERT INTO organizations (id, name, slug, business_type, address, phone, email, created_at, updated_at)
     VALUES ($1, 'La Trattoria Italiana', $2, 'Restaurant', '88 Main Street, Boston, MA', '+1-617-555-9080', 'reservations@latrattoria.com', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    [restOrgId, restSlug]
  );
  await db.execute(
    `INSERT INTO business_settings (id, organization_id, business_hours, services, cancellation_policy, contact_instructions, reservation_settings, created_at, updated_at)
     VALUES ($1, $2, '[]', '[]', '2 hours notice', 'Call host stand', $3, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    [uuidv4(), restOrgId, JSON.stringify({ pricingType: 'deposit', depositAmount: 20, maxPartySize: 10 })]
  );
  await db.execute(
    `INSERT INTO ai_employees (id, organization_id, name, role_title, instructions, greeting_message, fallback_message, tone, personality, status, created_at, updated_at)
     VALUES ($1, $2, 'Marco', 'AI Host', 'Assist guests with table reservations, location, and party sizes.', 'Welcome to La Trattoria!', 'Please contact our host directly.', 'Welcoming Italian host', 'Friendly and polite', 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    [uuidv4(), restOrgId]
  );
  await db.execute(
    `INSERT INTO subscriptions (id, organization_id, status, trial_ends_at, created_at, updated_at)
     VALUES ($1, $2, 'TRIALING', CURRENT_TIMESTAMP + INTERVAL '7 day', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    [uuidv4(), restOrgId]
  );

  const restSystemPrompt = await ConversationService.buildSystemPrompt(restOrgId, ConversationChannel.WEB, 'Table inquiry');
  const restResponse = await realGeminiProvider.generateResponse({
    messages: [
      { role: 'system', content: restSystemPrompt },
      { role: 'user', content: 'Can I reserve a table for 4 tonight? Where are you located and is there a deposit?' }
    ],
    temperature: 0.2,
    maxTokens: 300,
  });

  console.log(`[Restaurant Gemini Output]:\n${restResponse.content}\n`);
  console.log(`[Restaurant Token Usage]: Prompt=${restResponse.promptTokens}, Completion=${restResponse.completionTokens}, Cost=$${restResponse.estimatedCostUsd}`);

  const restText = restResponse.content.toLowerCase();
  const restPass = restText.includes('20') &&
                   (restText.includes('main street') || restText.includes('88 main')) &&
                   restResponse.content.includes(`/book/${restSlug}`) &&
                   !restText.includes('appointment fee');
  console.log(`Restaurant Grounding Pass: ${restPass ? 'YES' : 'NO'}`);

  // 3. Synthetic Salon & Instagram Channel Test
  console.log('\n--- 3. Testing Salon & Instagram Channel with Live Gemini ---');
  const salonOrgId = uuidv4();
  const salonSlug = `velvet-hair-lounge-${timestamp}`;
  await db.execute(
    `INSERT INTO organizations (id, name, slug, business_type, address, phone, email, created_at, updated_at)
     VALUES ($1, 'Velvet Hair Lounge', $2, 'Hair Salon', '12 Beverly Blvd, Los Angeles, CA', '+1-310-555-7766', 'book@velvethair.com', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    [salonOrgId, salonSlug]
  );
  await db.execute(
    `INSERT INTO business_settings (id, organization_id, business_hours, services, cancellation_policy, contact_instructions, created_at, updated_at)
     VALUES ($1, $2, '[]', '[{"name":"Signature Haircut & Blowout","price":85,"duration":60},{"name":"Full Balayage","price":220,"duration":120}]', '24h notice', 'DM or call salon', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    [uuidv4(), salonOrgId]
  );
  await db.execute(
    `INSERT INTO ai_employees (id, organization_id, name, role_title, instructions, greeting_message, fallback_message, tone, personality, status, created_at, updated_at)
     VALUES ($1, $2, 'Chloe', 'Salon Coordinator', 'Help clients discover styles, stylist services, prices, and booking.', 'Hey there! Welcome to Velvet Hair Lounge!', 'Send us a message and we will respond ASAP.', 'Chic & friendly', 'Trendy stylist assistant', 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    [uuidv4(), salonOrgId]
  );
  await db.execute(
    `INSERT INTO subscriptions (id, organization_id, status, trial_ends_at, created_at, updated_at)
     VALUES ($1, $2, 'TRIALING', CURRENT_TIMESTAMP + INTERVAL '7 day', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    [uuidv4(), salonOrgId]
  );

  const salonSystemPrompt = await ConversationService.buildSystemPrompt(salonOrgId, ConversationChannel.INSTAGRAM, 'DM booking question');
  const salonResponse = await realGeminiProvider.generateResponse({
    messages: [
      { role: 'system', content: salonSystemPrompt },
      { role: 'user', content: 'Hey! How much is a haircut and blowout, where is the salon, and how do I book an appointment?' }
    ],
    temperature: 0.2,
    maxTokens: 250,
  });

  console.log(`[Salon Instagram Gemini Output]:\n${salonResponse.content}\n`);
  console.log(`[Salon Token Usage]: Prompt=${salonResponse.promptTokens}, Completion=${salonResponse.completionTokens}, Cost=$${salonResponse.estimatedCostUsd}`);

  const salonText = salonResponse.content.toLowerCase();
  const salonPass = salonText.includes('85') &&
                    (salonText.includes('beverly') || salonText.includes('12 beverly')) &&
                    salonResponse.content.includes(`/book/${salonSlug}`);
  console.log(`Salon Grounding Pass: ${salonPass ? 'YES' : 'NO'}`);

  // 3B. Facebook Messenger Channel Test
  console.log('\n--- 3B. Testing Facebook Messenger Channel with Live Gemini ---');
  const fbSystemPrompt = await ConversationService.buildSystemPrompt(salonOrgId, ConversationChannel.FACEBOOK, 'Facebook booking');
  const fbResponse = await realGeminiProvider.generateResponse({
    messages: [
      { role: 'system', content: fbSystemPrompt },
      { role: 'user', content: 'Hi, I want to book a Balayage on Saturday. What is the price and link?' }
    ],
    temperature: 0.2,
    maxTokens: 250,
  });

  console.log(`[Salon Facebook Gemini Output]:\n${fbResponse.content}\n`);
  console.log(`[Salon Facebook Token Usage]: Prompt=${fbResponse.promptTokens}, Completion=${fbResponse.completionTokens}, Cost=$${fbResponse.estimatedCostUsd}`);

  const fbText = fbResponse.content.toLowerCase();
  const fbPass = fbText.includes('220') && fbResponse.content.includes(`/book/${salonSlug}`);
  console.log(`Facebook Messenger Pass: ${fbPass ? 'YES' : 'NO'}`);

  // 4. General / Generic Business Test
  console.log('\n--- 4. Testing General / Unknown Industry Business ---');
  const genOrgId = uuidv4();
  const genSlug = `quantum-tech-advisory-${timestamp}`;
  await db.execute(
    `INSERT INTO organizations (id, name, slug, business_type, address, phone, email, created_at, updated_at)
     VALUES ($1, 'Quantum Tech Advisory', $2, 'Consulting', '100 Silicon Way, Austin, TX', '+1-512-555-4321', 'info@quantumadvisory.com', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    [genOrgId, genSlug]
  );
  await db.execute(
    `INSERT INTO business_settings (id, organization_id, business_hours, services, cancellation_policy, contact_instructions, created_at, updated_at)
     VALUES ($1, $2, '[]', '[{"name":"Initial Tech Consultation","price":150,"duration":30}]', '24h notice', 'Email us', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    [uuidv4(), genOrgId]
  );
  await db.execute(
    `INSERT INTO ai_employees (id, organization_id, name, role_title, instructions, greeting_message, fallback_message, tone, personality, status, created_at, updated_at)
     VALUES ($1, $2, 'Alex', 'Consulting Receptionist', 'Help clients book advisory consultations.', 'Hello!', 'Please contact our office.', 'Professional', 'Consultant', 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    [uuidv4(), genOrgId]
  );
  await db.execute(
    `INSERT INTO subscriptions (id, organization_id, status, trial_ends_at, created_at, updated_at)
     VALUES ($1, $2, 'TRIALING', CURRENT_TIMESTAMP + INTERVAL '7 day', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    [uuidv4(), genOrgId]
  );

  const genSystemPrompt = await ConversationService.buildSystemPrompt(genOrgId, ConversationChannel.EMAIL, 'Email inquiry');
  const genResponse = await realGeminiProvider.generateResponse({
    messages: [
      { role: 'system', content: genSystemPrompt },
      { role: 'user', content: 'What is your consultation fee and how do I schedule?' }
    ],
    temperature: 0.2,
    maxTokens: 250,
  });

  console.log(`[General Business Email Gemini Output]:\n${genResponse.content}\n`);
  console.log(`[General Token Usage]: Prompt=${genResponse.promptTokens}, Completion=${genResponse.completionTokens}, Cost=$${genResponse.estimatedCostUsd}`);

  // Summary
  console.log('====================================================');
  console.log('  ALL LIVE GEMINI ONCECLIC GROUNDING TESTS COMPLETE!');
  console.log('====================================================');
  process.exitCode = (clinicPass && restPass && salonPass && fbPass) ? 0 : 1;
}

runRealGeminiONCEClicTest().catch((err) => {
  console.error('❌ Live Gemini test encountered error:', err);
  process.exitCode = 1;
});
