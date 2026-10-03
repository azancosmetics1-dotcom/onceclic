import dotenv from 'dotenv';
dotenv.config();

import { config } from '../config';
import { ComposioService } from '../services/ComposioService';
import { ComposioTriggerService } from '../services/ComposioTriggerService';
import { db } from '../db';

async function runVerify() {
  console.log('====================================================');
  console.log('  ONCEClic Composio Configuration & Trigger Verification');
  console.log('  Mode: READ-ONLY (No Mutations)');
  console.log('====================================================\n');

  // 1. Check API Key
  const hasKey = ComposioService.isAvailable();
  console.log(`1. COMPOSIO_API_KEY configured: ${hasKey ? '✅ YES' : '❌ NO'}`);
  if (!hasKey) {
    console.warn('   ⚠️ Set COMPOSIO_API_KEY in your environment to connect to Composio.\n');
  }

  // 2. Check Webhook Secret
  const hasSecret = config.composio.isWebhookConfigured;
  console.log(`2. COMPOSIO_WEBHOOK_SECRET configured: ${hasSecret ? '✅ YES' : '⚠️ NO (Required in Production for webhook verification)'}`);

  // 3. Check AI Provider
  console.log(`3. AI Provider: ${config.ai.provider.toUpperCase()} (Model: ${config.gemini.model})`);

  if (!hasKey) {
    console.log('\n====================================================');
    console.log('  Verification complete (API Key missing).');
    console.log('====================================================');
    process.exit(0);
  }

  // 4. Discover Trigger Types Catalog
  console.log('\n4. Querying Composio Trigger Types Catalog...');
  try {
    const gmailSlug = await ComposioTriggerService.getTriggerSlugForApp('gmail');
    const igSlug = await ComposioTriggerService.getTriggerSlugForApp('instagram');
    const fbSlug = await ComposioTriggerService.getTriggerSlugForApp('facebook');

    console.log(`   - Gmail Inbound Trigger Slug: ${gmailSlug}`);
    console.log(`   - Instagram Inbound DM Trigger Slug: ${igSlug}`);
    console.log(`   - Facebook Message Trigger Slug: ${fbSlug}`);
  } catch (err: any) {
    console.warn('   ⚠️ Error discovering trigger types:', err.message);
  }

  // 5. Inspect Webhook Subscriptions
  console.log('\n5. Inspecting Composio Project Webhook Subscriptions...');
  try {
    const subscriptions = await ComposioTriggerService.getWebhookSubscriptions();
    console.log(`   - Total Webhook Subscriptions Found: ${subscriptions.length}`);
    const expectedUrl = 'https://api.onceclic.com/api/webhooks/composio';

    let foundExpected = false;
    for (const sub of subscriptions) {
      const isTarget = sub.targetUrl?.includes('/api/webhooks/composio');
      if (isTarget) foundExpected = true;
      console.log(`   - Subscription ID: ${sub.id} | Target URL: ${sub.targetUrl} | Events: ${sub.eventTypes.join(', ')} | Status: ${isTarget ? '✅ MATCH' : 'ℹ️ OTHER'}`);
    }

    if (!foundExpected) {
      console.log(`   ⚠️ Webhook subscription for ${expectedUrl} is NOT registered yet.`);
      console.log(`      Run \`npm run composio:setup\` with COMPOSIO_SETUP_CONFIRM=YES to register.`);
    }
  } catch (subErr: any) {
    console.warn('   ⚠️ Error inspecting webhook subscriptions:', subErr.message);
  }

  // 6. Railway Environment Variables Report
  console.log('\n6. Railway Production Environment Variables Status:');
  console.log(`   - COMPOSIO_API_KEY: ${hasKey ? 'CONFIGURED' : 'MISSING'}`);
  console.log(`   - COMPOSIO_WEBHOOK_SECRET: ${hasSecret ? 'CONFIGURED' : 'NEEDS CONFIGURATION IN RAILWAY'}`);
  console.log(`   - GEMINI_API_KEY: ${config.gemini.isAvailable ? 'CONFIGURED' : 'MISSING'}`);
  console.log(`   - AI_PROVIDER: ${config.ai.provider}`);

  console.log('\n====================================================');
  console.log('  Composio Verification Finished.');
  console.log('====================================================');
  process.exit(0);
}

runVerify().catch((err) => {
  console.error('[Verify Exception]', err);
  process.exit(1);
});
