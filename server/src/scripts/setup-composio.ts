import dotenv from 'dotenv';
dotenv.config();

import { config } from '../config';
import { ComposioService } from '../services/ComposioService';
import { ComposioTriggerService } from '../services/ComposioTriggerService';
import { db } from '../db';

async function runSetup() {
  console.log('====================================================');
  console.log('  ONCEClic Composio Automated Setup');
  console.log('  Mode: MUTATING');
  console.log('====================================================\n');

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

  const targetUrl = `${config.app.apiUrl}/api/webhooks/composio`;
  console.log(`1. Target Production Webhook URL: ${targetUrl}`);

  // 1. Register Webhook Subscription
  console.log('2. Registering / Verifying Project Webhook Subscription...');
  const subRes = await ComposioTriggerService.registerProjectWebhook({
    targetUrl,
    eventTypes: ['composio.trigger.message', 'composio.connected_account.expired'],
  });

  if (subRes.success) {
    console.log(`   ✅ Webhook Subscription active (ID: ${subRes.subscriptionId})`);
    if (subRes.secret) {
      console.log('   🔒 A new webhook secret was generated.');
      console.log('   👉 ACTION REQUIRED: Set COMPOSIO_WEBHOOK_SECRET in Railway with the returned signing secret.');
    } else {
      console.log('   ℹ️ Existing webhook subscription reused.');
    }
  } else {
    console.warn(`   ⚠️ Webhook registration warning: ${subRes.error}`);
  }

  // 2. Discover Trigger Slugs
  console.log('\n3. Discovering Trigger Types...');
  const gmailSlug = await ComposioTriggerService.getTriggerSlugForApp('gmail');
  const igSlug = await ComposioTriggerService.getTriggerSlugForApp('instagram');
  const fbSlug = await ComposioTriggerService.getTriggerSlugForApp('facebook');
  console.log(`   - Gmail: ${gmailSlug}`);
  console.log(`   - Instagram: ${igSlug}`);
  console.log(`   - Facebook: ${fbSlug}`);

  // 3. Provision Triggers for Active Local Connections
  console.log('\n4. Syncing Trigger Instances for Active Local Connections...');
  try {
    const dbInstance = db;
    await dbInstance.runMigrations();

    // Gmail connections
    const activeEmails = await db.query<{ organization_id: string; composio_connected_account_id: string }>(
      "SELECT organization_id, composio_connected_account_id FROM email_connections WHERE status = 'CONNECTED' AND is_active = TRUE AND composio_connected_account_id IS NOT NULL"
    );
    for (const conn of activeEmails.rows) {
      console.log(`   - Provisioning Gmail trigger for org ${conn.organization_id}...`);
      await ComposioTriggerService.provisionGmailTrigger(conn.organization_id, conn.composio_connected_account_id);
    }

    // Instagram connections
    const activeIg = await db.query<{ organization_id: string; composio_connected_account_id: string; instagram_user_id: string }>(
      "SELECT organization_id, composio_connected_account_id, instagram_user_id FROM instagram_connections WHERE status = 'CONNECTED' AND is_active = TRUE"
    );
    for (const conn of activeIg.rows) {
      const accId = conn.composio_connected_account_id || conn.instagram_user_id;
      if (accId) {
        console.log(`   - Provisioning Instagram trigger for org ${conn.organization_id}...`);
        await ComposioTriggerService.provisionInstagramTrigger(conn.organization_id, accId);
      }
    }

    // Facebook connections
    const activeFb = await db.query<{ organization_id: string; composio_connected_account_id: string; page_id: string }>(
      "SELECT organization_id, composio_connected_account_id, page_id FROM facebook_connections WHERE status = 'CONNECTED' AND is_active = TRUE"
    );
    for (const conn of activeFb.rows) {
      const accId = conn.composio_connected_account_id || conn.page_id;
      if (accId) {
        console.log(`   - Provisioning Facebook trigger for org ${conn.organization_id}...`);
        await ComposioTriggerService.provisionFacebookTrigger(conn.organization_id, accId);
      }
    }
  } catch (err: any) {
    console.warn('   ⚠️ Error provisioning existing connections:', err.message);
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
