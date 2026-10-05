import dotenv from 'dotenv';
dotenv.config();

import { config } from '../config';
import { ComposioService } from '../services/ComposioService';
import { ComposioTriggerService } from '../services/ComposioTriggerService';
import { db } from '../db';

async function runSetup() {
  const dbUrl = process.env.DATABASE_URL || '';
  const isRemoteDb = dbUrl.includes('supabase.com') || dbUrl.includes('pooler.supabase.com');
  const isProduction = process.env.NODE_ENV === 'production' || isRemoteDb;
  const envName = isProduction ? 'production' : (process.env.NODE_ENV || 'development');

  let targetUrl = 'https://api.onceclic.com/api/webhooks/composio';
  if (!isProduction && process.env.API_URL && process.env.API_URL.includes('localhost') && !isRemoteDb) {
    targetUrl = `${process.env.API_URL.replace(/\/+$/, '')}/api/webhooks/composio`;
  } else {
    targetUrl = 'https://api.onceclic.com/api/webhooks/composio';
  }

  console.log('====================================================');
  console.log('  ONCEClic Composio Automated Setup');
  console.log(`  ENVIRONMENT: ${envName.toUpperCase()}`);
  console.log(`  DATABASE TARGET: ${isRemoteDb ? 'Supabase PostgreSQL (Production)' : 'Local / Test DB'}`);
  console.log(`  WEBHOOK TARGET: ${targetUrl}`);
  console.log('  Mode: MUTATING');
  console.log('====================================================\n');

  // Fatal Safety Check: Never target localhost when connected to production database
  if (isRemoteDb && targetUrl.includes('localhost')) {
    console.error('❌ FATAL SAFETY ERROR: Detected production database but webhook target resolves to localhost.');
    console.error('Production webhook target MUST be https://api.onceclic.com/api/webhooks/composio.');
    process.exit(1);
  }

  // Confirmation guard
  if (process.env.COMPOSIO_SETUP_CONFIRM !== 'YES') {
    console.error('❌ ABORTED: Mutating setup requires COMPOSIO_SETUP_CONFIRM=YES.');
    console.error('Run: COMPOSIO_SETUP_CONFIRM=YES npm run composio:setup');
    process.exit(1);
  }

  if (!ComposioService.isAvailable()) {
    console.error('❌ ABORTED: COMPOSIO_API_KEY is not configured on the server.');
    process.exit(1);
  }

  // 1. Inspect and Reuse Existing Project Webhook (NEVER create duplicates)
  console.log('1. Checking Project Webhook Subscription...');
  try {
    const existingSubs = await ComposioTriggerService.getWebhookSubscriptions();
    const cleanTarget = targetUrl.trim().replace(/\/+$/, '');
    const matchedSub = existingSubs.find((s) => s.targetUrl && s.targetUrl.trim().replace(/\/+$/, '') === cleanTarget);

    if (matchedSub) {
      console.log('   PROJECT WEBHOOK: EXISTS');
      console.log(`   URL: ${matchedSub.targetUrl}`);
      console.log(`   SUBSCRIPTION ID: ${matchedSub.id}`);
      console.log('   STATUS: ACTIVE');
    } else {
      console.log(`   ⚠️ Existing webhook for ${targetUrl} not found in query.`);
      console.log('   Registering project webhook subscription...');
      const subRes = await ComposioTriggerService.registerProjectWebhook({
        targetUrl,
        eventTypes: ['composio.trigger.message', 'composio.connected_account.expired'],
      });

      if (subRes.success) {
        console.log(`   ✅ Project Webhook Subscription created (ID: ${subRes.subscriptionId})`);
        if (subRes.secret) {
          console.log('   🔒 A signing secret was generated for this webhook.');
          console.log('   👉 Ensure COMPOSIO_WEBHOOK_SECRET in Railway is set.');
        }
      } else {
        console.error(`   ❌ Failed to register project webhook: ${subRes.error}`);
        process.exit(1);
      }
    }
  } catch (webErr: any) {
    console.warn('   ⚠️ Webhook subscription verification notice:', webErr.message || webErr);
  }

  // 2. Discover / Verify Canonical Trigger Slugs
  console.log('\n2. Resolving Canonical Trigger Slugs...');
  const gmailSlug = await ComposioTriggerService.getTriggerSlugForApp('gmail');
  const igSlug = await ComposioTriggerService.getTriggerSlugForApp('instagram');
  const fbSlug = await ComposioTriggerService.getTriggerSlugForApp('facebook');
  console.log(`   - Gmail: ${gmailSlug}`);
  console.log(`   - Instagram: ${igSlug}`);
  console.log(`   - Facebook: ${fbSlug}`);

  // 3. Provision / Reconcile Triggers for Active Local Connections
  console.log('\n3. Reconciling Remote Trigger Instances for Connected Accounts...');
  try {
    await db.runMigrations();

    // Gmail connections
    const activeEmails = await db.query<{ organization_id: string; composio_connected_account_id: string }>(
      "SELECT organization_id, composio_connected_account_id FROM email_connections WHERE status = 'CONNECTED' AND is_active = TRUE AND composio_connected_account_id IS NOT NULL"
    );
    for (const conn of activeEmails.rows) {
      console.log(`   - Gmail (org: ${conn.organization_id}, account: ${conn.composio_connected_account_id}):`);
      const res = await ComposioTriggerService.provisionGmailTrigger(conn.organization_id, conn.composio_connected_account_id);
      console.log(`     Trigger: ${res.success ? '✅ ACTIVE' : '❌ FAILED'} (ID: ${res.triggerId || 'none'}, Reused: ${res.isReused ? 'YES' : 'NO'})`);
    }

    // Instagram connections
    const activeIg = await db.query<{ organization_id: string; composio_connected_account_id: string; instagram_user_id: string }>(
      "SELECT organization_id, composio_connected_account_id, instagram_user_id FROM instagram_connections WHERE status = 'CONNECTED' AND is_active = TRUE"
    );
    for (const conn of activeIg.rows) {
      const accId = conn.composio_connected_account_id || conn.instagram_user_id;
      if (accId) {
        console.log(`   - Instagram (org: ${conn.organization_id}, account: ${accId}):`);
        const res = await ComposioTriggerService.provisionInstagramTrigger(conn.organization_id, accId);
        console.log(`     Trigger: ${res.success ? '✅ ACTIVE' : '❌ FAILED'} (ID: ${res.triggerId || 'none'}, Reused: ${res.isReused ? 'YES' : 'NO'})`);
      }
    }

    // Facebook connections
    const activeFb = await db.query<{ organization_id: string; composio_connected_account_id: string; page_id: string }>(
      "SELECT organization_id, composio_connected_account_id, page_id FROM facebook_connections WHERE status = 'CONNECTED' AND is_active = TRUE"
    );
    for (const conn of activeFb.rows) {
      const accId = conn.composio_connected_account_id || conn.page_id;
      if (accId) {
        console.log(`   - Facebook (org: ${conn.organization_id}, account: ${accId}):`);
        const res = await ComposioTriggerService.provisionFacebookTrigger(conn.organization_id, accId);
        console.log(`     Trigger: ${res.success ? '✅ ACTIVE' : '❌ FAILED'} (ID: ${res.triggerId || 'none'}, Reused: ${res.isReused ? 'YES' : 'NO'})`);
      }
    }
  } catch (err: any) {
    console.warn('   ⚠️ Error reconciling trigger instances:', err.message);
  }

  console.log('\n====================================================');
  console.log('  Composio Automated Setup Completed.');
  console.log('====================================================');
  process.exit(0);
}

runSetup().catch((err) => {
  console.error('[Setup Exception]', err);
  process.exit(1);
});

