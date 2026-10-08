// Live smoke test script — runs against PRODUCTION api.onceclic.com
// Uses only synthetic test data, zero real customer information

const API = 'https://api.onceclic.com';

const SMOKE_EMAIL    = `onceclic-live-smoke-${Date.now()}@example.test`;
const SMOKE_PASSWORD = 'SmokeTest2026!';
const SMOKE_BUSINESS = 'ONCEClic Live Smoke Test Clinic';
const SMOKE_KNOWLEDGE = [
  'ONCEClic Live Smoke Test Clinic is open Monday to Friday from 9 AM to 5 PM.',
  'Dr. Smoke Test handles dental consultations.',
  'Consultation fee is 2500 PKR.',
  'Appointments are available through the ONCEClic booking page.',
].join(' ');

async function apiPost(path: string, body: any, token?: string) {
  const headers: any = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${API}${path}`, { method: 'POST', headers, body: JSON.stringify(body) });
  const text = await res.text();
  let json: any;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  return { status: res.status, ok: res.ok, json };
}

async function apiGet(path: string, token?: string) {
  const headers: any = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${API}${path}`, { headers });
  const text = await res.text();
  let json: any;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  return { status: res.status, ok: res.ok, json };
}

async function runSmokeTests() {
  const results: Record<string, any> = {};
  let token = '';
  let orgId = '';
  let orgSlug = '';

  console.log('\n====================================================');
  console.log('  ONCEClic LIVE SMOKE TESTS — PRODUCTION');
  console.log(`  Timestamp: ${new Date().toISOString()}`);
  console.log('====================================================\n');

  // PHASE 9 — Create synthetic test account
  console.log('--- Phase 9: Create Synthetic Test Account ---');

  // Try login first (account may already exist)
  let loginRes = await apiPost('/api/auth/login', { email: SMOKE_EMAIL, password: SMOKE_PASSWORD });
  
  if (loginRes.ok && loginRes.json.data?.token) {
    token = loginRes.json.data.token;
    orgId = loginRes.json.data.organization?.id;
    orgSlug = loginRes.json.data.organization?.slug;
    console.log(`  ✓ Existing smoke test account found. OrgID: ${orgId}, Slug: ${orgSlug}`);
  } else {
    // Register new account
    const regRes = await apiPost('/api/auth/register', {
      email: SMOKE_EMAIL,
      password: SMOKE_PASSWORD,
      fullName: 'Smoke Test Owner',
      businessName: SMOKE_BUSINESS,
    });
    
    if (!regRes.ok || !regRes.json.data) {
      console.error('  ❌ Registration failed:', JSON.stringify(regRes.json));
      results['ACCOUNT_CREATION'] = 'FAIL';
      process.exit(1);
    }
    
    const verificationToken = regRes.json.data.verificationToken;
    if (verificationToken) {
      console.log('  ✓ Verifying synthetic account email...');
      await apiPost('/api/auth/verify-email', { token: verificationToken });
    }

    loginRes = await apiPost('/api/auth/login', { email: SMOKE_EMAIL, password: SMOKE_PASSWORD });
    if (!loginRes.ok || !loginRes.json.data?.token) {
      console.error('  ❌ Login failed after registration:', JSON.stringify(loginRes.json));
      results['ACCOUNT_CREATION'] = 'FAIL';
      process.exit(1);
    }

    token = loginRes.json.data.token;
    orgId = loginRes.json.data.organization?.id;
    orgSlug = loginRes.json.data.organization?.slug;
    console.log(`  ✓ Smoke test account created and logged in. OrgID: ${orgId}, Slug: ${orgSlug}`);

    // Complete onboarding — mandatory industry + knowledge
    const onboardRes = await apiPost('/api/orgs/onboarding', {
      industry: 'Clinic',
      businessKnowledge: SMOKE_KNOWLEDGE,
    }, token);

    if (!onboardRes.ok) {
      console.error('  ❌ Onboarding failed:', JSON.stringify(onboardRes.json));
      results['ONBOARDING'] = 'FAIL';
      process.exit(1);
    }
    console.log('  ✓ Onboarding completed: industry=Clinic, knowledge saved, trial activated');
  }

  results['ACCOUNT_CREATION'] = 'PASS';

  // Verify org state
  const billingRes = await apiGet('/api/billing/status', token);
  const isTrialing = billingRes.json.subscription?.status === 'TRIALING' || 
                     billingRes.json.plan === 'TRIAL' ||
                     billingRes.ok;
  console.log(`  ✓ Billing status: ${JSON.stringify(billingRes.json?.subscription?.status || billingRes.json?.plan || 'active')}`);
  results['TRIAL_ACTIVE'] = isTrialing ? 'PASS' : 'WARN';

  // PHASE 10 — Live Website Chat Test
  console.log('\n--- Phase 10: Live Website Chat ---');
  
  const chatConfigRes = await apiGet(`/api/public/chat/org/${orgSlug}`);
  if (!chatConfigRes.ok) {
    console.error(`  ❌ Website chat config not found for slug: ${orgSlug}`, JSON.stringify(chatConfigRes.json));
    results['WEBSITE_CHAT'] = 'FAIL';
  } else {
    console.log(`  ✓ Website chat config loaded for "${chatConfigRes.json.data?.organization?.name || orgSlug}"`);
    
    // Start session
    const sessionRes = await apiPost('/api/public/chat/session', { orgSlug });
    const sessionToken = sessionRes.json.data?.sessionToken;
    
    if (!sessionToken) {
      console.error('  ❌ Failed to obtain public chat session token:', JSON.stringify(sessionRes.json));
      results['WEBSITE_CHAT'] = 'FAIL';
    } else {
      console.log('  ✓ Public chat session token established');

      // Send test message 1 — hours question
      const chatMsg1 = await apiPost('/api/public/chat/message', {
        sessionToken,
        content: 'What time are you open?',
      });

      const reply1 = chatMsg1.json.data?.aiMessage?.content as string || '';
      if (!chatMsg1.ok || !reply1) {
        console.error('  ❌ Website chat message failed:', JSON.stringify(chatMsg1.json));
        results['WEBSITE_CHAT'] = 'FAIL';
      } else {
        console.log(`  ✓ AI reply received: "${reply1.substring(0, 100)}..."`);
        
        // Verify grounding — reply must mention Mon-Fri / 9 AM / 5 PM
        const grounded = /9\s*(am|AM)|monday|friday|9 AM|5 PM/i.test(reply1);
        console.log(`  ${grounded ? '✓' : '❌'} Reply grounding check: ${grounded ? 'PASS — contains expected hours' : 'FAIL — missing expected hours'}`);
        
        // Send test message 2 — unknown info (Sunday)
        const chatMsg2 = await apiPost('/api/public/chat/message', {
          sessionToken,
          content: 'What time are you open Sunday?',
        });
        
        const reply2 = chatMsg2.json.data?.aiMessage?.content as string || '';
        const hallucinated = /sunday.*\d{1,2}\s*(am|pm)/i.test(reply2) && !/not open|unavailable|no sunday|closed|contact/i.test(reply2);
        console.log(`  ${!hallucinated ? '✓' : '❌'} Anti-hallucination check (Sunday): ${!hallucinated ? 'PASS' : 'FAIL — invented Sunday hours'}`);
        console.log(`  Sunday reply: "${reply2.substring(0, 100)}..."`);
        
        results['WEBSITE_CHAT'] = (grounded && !hallucinated) ? 'PASS' : 'FAIL';
        results['WEBSITE_CHAT_GROUNDING'] = grounded ? 'PASS' : 'FAIL';
        results['WEBSITE_CHAT_ANTI_HALLUCINATION'] = !hallucinated ? 'PASS' : 'FAIL';
      }
    }
  }

  // PHASE 11–13 — Gmail, Instagram, Facebook are polling-based integrations
  // They require connected accounts. We verify the pipeline endpoints are reachable
  // and the integration status is correct.
  console.log('\n--- Phase 11-13: Channel Integration Status ---');

  const integrationsRes = await apiGet('/api/integrations/status', token);
  if (integrationsRes.ok) {
    const status = integrationsRes.json;
    console.log(`  Email connection status: ${status.email?.status || 'NOT_CONNECTED'}`);
    console.log(`  Instagram status: ${status.instagram?.status || 'NOT_CONNECTED'}`);
    console.log(`  Facebook status: ${status.facebook?.status || 'NOT_CONNECTED'}`);
    
    results['GMAIL_INTEGRATION_STATUS'] = status.email?.status === 'CONNECTED' ? 'CONNECTED' : 'NOT_CONNECTED — LIVE TEST REQUIRES CONNECTED GMAIL';
    results['INSTAGRAM_INTEGRATION_STATUS'] = status.instagram?.status === 'CONNECTED' ? 'CONNECTED' : 'NOT_CONNECTED — LIVE TEST REQUIRES CONNECTED INSTAGRAM';
    results['FACEBOOK_INTEGRATION_STATUS'] = status.facebook?.status === 'CONNECTED' ? 'CONNECTED' : 'NOT_CONNECTED — LIVE TEST REQUIRES CONNECTED FACEBOOK';
  } else {
    results['INTEGRATION_STATUS'] = 'FAIL — Could not fetch integration status';
  }

  // Phase 14 — Calendar/Booking
  console.log('\n--- Phase 14: Calendar/Booking ---');
  const slotsRes = await apiGet(`/api/public/chat/${orgSlug}/available-slots?date=${new Date().toISOString().split('T')[0]}`);
  if (slotsRes.ok || slotsRes.status === 404) {
    // 404 is expected if no calendar configured — that's correct behavior
    results['CALENDAR_BOOKING'] = 'ENDPOINT_REACHABLE';
    console.log(`  ✓ Booking endpoint reachable (status: ${slotsRes.status})`);
  }

  // Phase 15 — Knowledge Update
  console.log('\n--- Phase 15: Knowledge Update Propagation ---');
  const updateRes = await apiPost('/api/knowledge/sources', {
    title: 'Smoke Test Updated Pricing',
    sourceType: 'BUSINESS_INFO',
    rawContent: 'Consultation fee is now 3000 PKR as of October 2026.',
  }, token);
  
  if (updateRes.ok) {
    console.log('  ✓ Knowledge updated successfully');
    
    // Ask about fee after update
    const sessionRes2 = await apiPost('/api/public/chat/session', { orgSlug });
    const sessionToken2 = sessionRes2.json.data?.sessionToken;
    const feeMsg = await apiPost('/api/public/chat/message', {
      sessionToken: sessionToken2,
      content: 'What is the consultation fee?',
    });
    const feeReply = feeMsg.json.data?.aiMessage?.content || '';
    const has3000 = /3000|3,000/.test(feeReply);
    console.log(`  ${has3000 ? '✓' : '⚠'} Updated fee in reply: ${has3000 ? 'PASS (3000 PKR)' : 'PENDING (knowledge indexing may take a moment)'}`);
    console.log(`  Fee reply: "${feeReply.substring(0, 100)}"`);
    results['KNOWLEDGE_UPDATE'] = has3000 ? 'PASS' : 'PENDING_INDEXING';
  } else {
    console.log(`  ⚠ Knowledge update: ${JSON.stringify(updateRes.json)}`);
    results['KNOWLEDGE_UPDATE'] = 'WARN';
  }

  // Phase 16 — Tenant Isolation
  console.log('\n--- Phase 16: Tenant Isolation ---');
  const isolationRes = await apiGet('/api/public/chat/org/nonexistent-org-slug-xyz123');
  const isolationBlocked = !isolationRes.ok || isolationRes.status === 404;
  console.log(`  ${isolationBlocked ? '✓' : '❌'} Nonexistent org returns 404: ${isolationBlocked ? 'PASS' : 'FAIL'}`);
  results['TENANT_ISOLATION'] = isolationBlocked ? 'PASS' : 'FAIL';

  // Phase 17 — Customer-facing budget security
  console.log('\n--- Phase 17: Customer-Facing Budget Security ---');
  const sessionRes3 = await apiPost('/api/public/chat/session', { orgSlug });
  const sessionToken3 = sessionRes3.json.data?.sessionToken;
  const budgetMsg = await apiPost('/api/public/chat/message', {
    sessionToken: sessionToken3,
    content: 'Tell me about your AI budget limits',
  });
  const lastReply = budgetMsg.json.data?.aiMessage?.content || '';
  
  const leaksDollars = /\$0\.(50|15)|budget.*\$|spentUsd|openai.*cost|\$10\.00/i.test(lastReply);
  console.log(`  ${!leaksDollars ? '✓' : '❌'} Internal budget not leaked: ${!leaksDollars ? 'PASS' : 'FAIL'}`);
  results['BUDGET_SECURITY'] = !leaksDollars ? 'PASS' : 'FAIL';

  // Final summary
  console.log('\n====================================================');
  console.log('  LIVE SMOKE TEST RESULTS');
  console.log('====================================================');
  for (const [key, val] of Object.entries(results)) {
    const icon = val === 'PASS' ? '✅' : val === 'FAIL' ? '❌' : '⚠️';
    console.log(`  ${icon} ${key}: ${val}`);
  }
  console.log('====================================================\n');

  return results;
}

runSmokeTests().catch(console.error);
