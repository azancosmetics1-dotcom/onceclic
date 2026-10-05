import dotenv from 'dotenv';
dotenv.config();

import { config } from '../config';
import { ComposioService } from '../services/ComposioService';
import { ComposioTriggerService } from '../services/ComposioTriggerService';
import { db } from '../db';

async function runVerify() {
  const dbUrl = process.env.DATABASE_URL || '';
  const isRemoteDb = dbUrl.includes('supabase.com') || dbUrl.includes('pooler.supabase.com');
  const isProduction = process.env.NODE_ENV === 'production' || isRemoteDb;
  const envName = isProduction ? 'production' : (process.env.NODE_ENV || 'development');
  const expectedUrl = 'https://api.onceclic.com/api/webhooks/composio';

  console.log('====================================================');
  console.log('  ONCEClic Composio Configuration & Trigger Verification');
  console.log(`  ENVIRONMENT: ${envName.toUpperCase()}`);
  console.log(`  DATABASE TARGET: ${isRemoteDb ? 'Supabase PostgreSQL (Production)' : 'Local / Test DB'}`);
  console.log('  Mode: READ-ONLY (No Mutations)');
  console.log('====================================================\n');

  // 1. Environment and Credential Presence (No secrets printed)
  const hasKey = ComposioService.isAvailable();
  const hasSecret = config.composio.isWebhookConfigured;

  console.log('--- ENVIRONMENT CONFIGURATION ---');
  console.log(`COMPOSIO_API_KEY: ${hasKey ? 'CONFIGURED (YES)' : 'MISSING (NO)'}`);
  console.log(`COMPOSIO_WEBHOOK_SECRET: ${hasSecret ? 'CONFIGURED (YES)' : 'NEEDS CONFIGURATION IN RAILWAY (NO)'}`);
  console.log(`AI_PROVIDER: ${config.ai.provider.toUpperCase()} (${config.gemini.model})`);
  console.log(`GEMINI_API_KEY: ${config.gemini.isAvailable ? 'CONFIGURED (YES)' : 'MISSING (NO)'}`);

  // 2. Project Webhook Status
  console.log('\n====================================================');
  console.log('PROJECT WEBHOOK');
  console.log('====================================================');
  let webhookExists = false;
  let webhookActive = false;
  let detectedWebhookUrl = 'NONE';

  if (hasKey) {
    try {
      const subscriptions = await ComposioTriggerService.getWebhookSubscriptions();
      const match = subscriptions.find((s) => s.targetUrl?.includes('/api/webhooks/composio'));
      if (match) {
        webhookExists = true;
        detectedWebhookUrl = match.targetUrl;
        webhookActive = true;
        console.log('  EXISTS: YES');
        console.log(`  URL: ${match.targetUrl}`);
        console.log(`  SUBSCRIPTION ID: ${match.id}`);
        console.log('  ACTIVE: YES');
        console.log(`  EVENTS: ${match.eventTypes.join(', ')}`);
      } else {
        console.log('  EXISTS: NO');
        console.log(`  TARGET URL: ${expectedUrl}`);
        console.log('  ACTIVE: NO');
      }
    } catch (err: any) {
      console.log('  EXISTS: ERROR QUERYING COMPOSIO');
      console.log(`  DETAILS: ${err.message}`);
    }
  } else {
    console.log('  EXISTS: CANNOT VERIFY (COMPOSIO_API_KEY MISSING LOCALLY)');
  }

  // 3. Channel Triggers Status
  console.log('\n====================================================');
  console.log('CHANNELS & TRIGGER STATUS');
  console.log('====================================================');

  try {
    const gmailSlug = await ComposioTriggerService.getTriggerSlugForApp('gmail');
    const igSlug = await ComposioTriggerService.getTriggerSlugForApp('instagram');
    const fbSlug = await ComposioTriggerService.getTriggerSlugForApp('facebook');

    // Query local DB connections
    const emailConns = await db.query<{ organization_id: string; status: string; composio_connected_account_id: string; trigger_id: string }>(
      "SELECT organization_id, status, composio_connected_account_id, trigger_id FROM email_connections WHERE status = 'CONNECTED'"
    );
    const igConns = await db.query<{ organization_id: string; status: string; composio_connected_account_id: string; instagram_user_id: string; trigger_id: string }>(
      "SELECT organization_id, status, composio_connected_account_id, instagram_user_id, trigger_id FROM instagram_connections WHERE status = 'CONNECTED'"
    );
    const fbConns = await db.query<{ organization_id: string; status: string; composio_connected_account_id: string; page_id: string; trigger_id: string }>(
      "SELECT organization_id, status, composio_connected_account_id, page_id, trigger_id FROM facebook_connections WHERE status = 'CONNECTED'"
    );

    // GMAIL REPORT
    console.log('\nGMAIL');
    const hasGmailConn = emailConns.rows.length > 0;
    const gmailAcc = emailConns.rows[0]?.composio_connected_account_id;
    console.log(`  LOCAL CONNECTION: ${hasGmailConn ? 'YES' : 'NO'}`);
    console.log(`  COMPOSIO ACCOUNT: ${gmailAcc ? 'YES' : 'NO'}`);
    console.log(`  LOCAL TRIGGER RECORD: ${emailConns.rows[0]?.trigger_id ? 'YES' : 'NO'}`);

    if (hasKey && gmailAcc) {
      const remoteGmail = await ComposioTriggerService.getRemoteTriggerInstance(gmailAcc, gmailSlug);
      console.log(`  REMOTE TRIGGER: ${remoteGmail.exists ? 'YES' : 'NO'}`);
      if (remoteGmail.exists && remoteGmail.triggerId) {
        console.log(`  REMOTE TRIGGER ID: ${remoteGmail.triggerId}`);
        console.log('  ACTIVE: YES');
      } else {
        console.log('  ACTIVE: NO (Run `npm run composio:setup` to provision)');
      }
    } else {
      console.log(`  REMOTE TRIGGER: ${hasKey ? 'NO CONNECTED ACCOUNT' : 'CANNOT VERIFY (API KEY MISSING)'}`);
      console.log(`  ACTIVE: ${emailConns.rows[0]?.trigger_id ? 'LOCAL RECORD PRESENT' : 'NO'}`);
    }

    // INSTAGRAM REPORT
    console.log('\nINSTAGRAM');
    const hasIgConn = igConns.rows.length > 0;
    const igAcc = igConns.rows[0]?.composio_connected_account_id || igConns.rows[0]?.instagram_user_id;
    console.log(`  LOCAL CONNECTION: ${hasIgConn ? 'YES' : 'NO'}`);
    console.log(`  COMPOSIO ACCOUNT: ${igAcc ? 'YES' : 'NO'}`);
    console.log(`  LOCAL TRIGGER RECORD: ${igConns.rows[0]?.trigger_id ? 'YES' : 'NO'}`);

    if (hasKey && igAcc) {
      const remoteIg = await ComposioTriggerService.getRemoteTriggerInstance(igAcc, igSlug);
      console.log(`  REMOTE TRIGGER: ${remoteIg.exists ? 'YES' : 'NO'}`);
      if (remoteIg.exists && remoteIg.triggerId) {
        console.log(`  REMOTE TRIGGER ID: ${remoteIg.triggerId}`);
        console.log('  ACTIVE: YES');
      } else {
        console.log('  ACTIVE: NO (Run `npm run composio:setup` to provision)');
      }
    } else {
      console.log(`  REMOTE TRIGGER: ${hasKey ? 'NO CONNECTED ACCOUNT' : 'CANNOT VERIFY (API KEY MISSING)'}`);
      console.log(`  ACTIVE: ${igConns.rows[0]?.trigger_id ? 'LOCAL RECORD PRESENT' : 'NO'}`);
    }

    // FACEBOOK REPORT
    console.log('\nFACEBOOK');
    const hasFbConn = fbConns.rows.length > 0;
    const fbAcc = fbConns.rows[0]?.composio_connected_account_id || fbConns.rows[0]?.page_id;
    console.log(`  LOCAL CONNECTION: ${hasFbConn ? 'YES' : 'NO'}`);
    console.log(`  COMPOSIO ACCOUNT: ${fbAcc ? 'YES' : 'NO'}`);
    console.log(`  LOCAL TRIGGER RECORD: ${fbConns.rows[0]?.trigger_id ? 'YES' : 'NO'}`);

    if (hasKey && fbAcc) {
      const remoteFb = await ComposioTriggerService.getRemoteTriggerInstance(fbAcc, fbSlug);
      console.log(`  REMOTE TRIGGER: ${remoteFb.exists ? 'YES' : 'NO'}`);
      if (remoteFb.exists && remoteFb.triggerId) {
        console.log(`  REMOTE TRIGGER ID: ${remoteFb.triggerId}`);
        console.log('  ACTIVE: YES');
      } else {
        console.log('  ACTIVE: NO (Run `npm run composio:setup` to provision)');
      }
    } else {
      console.log(`  REMOTE TRIGGER: ${hasKey ? 'NO CONNECTED ACCOUNT' : 'CANNOT VERIFY (API KEY MISSING)'}`);
      console.log(`  ACTIVE: ${fbConns.rows[0]?.trigger_id ? 'LOCAL RECORD PRESENT' : 'NO'}`);
    }

  } catch (dbErr: any) {
    console.warn('  ⚠️ Channel status lookup notice:', dbErr.message || dbErr);
  }

  console.log('\n====================================================');
  console.log('  Composio Verification Finished.');
  console.log('====================================================');
  process.exit(0);
}

runVerify().catch((err) => {
  console.error('[Verify Exception]', err);
  process.exit(1);
});

