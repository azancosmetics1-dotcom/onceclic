async function runFullProductionSmokeTest() {
  const prodApi = 'https://api.onceclic.com';
  const prodFrontend = 'https://onceclic.com';
  console.log('================================================================');
  console.log('🚀 RUNNING COMPREHENSIVE PRODUCTION SMOKE TEST');
  console.log('Backend API:', prodApi);
  console.log('Frontend URL:', prodFrontend);
  console.log('================================================================\n');

  const results: Record<string, boolean> = {};

  // 1. Health Endpoint
  try {
    const healthRes = await fetch(`${prodApi}/health`);
    const healthData = await healthRes.json();
    console.log('[1. Health Check]', healthData);
    results['Health endpoint'] = healthRes.status === 200 && healthData.status === 'ok' && healthData.env === 'production';
    results['AI Available'] = healthData.aiAvailable === true;
    results['Paddle Configured'] = healthData.paddleConfigured === true;
    results['Composio Configured'] = healthData.composioConfigured === true;
  } catch (err) {
    console.error('Health check failed:', err);
    results['Health endpoint'] = false;
  }

  // 2. Public Frontend Availability
  try {
    const frontRes = await fetch(prodFrontend);
    const frontHtml = await frontRes.text();
    const hasApp = frontHtml.includes('ONCEClic') || frontHtml.includes('<div id="root">');
    console.log('[2. Frontend Check] HTTP Status:', frontRes.status, 'HTML length:', frontHtml.length);
    results['Frontend HTTPS & App'] = frontRes.status === 200 && hasApp;
  } catch (err) {
    console.error('Frontend check failed:', err);
    results['Frontend HTTPS & App'] = false;
  }

  // 3. User Registration & Email Verification
  const testEmail = `prod_smoke_${Date.now()}@example.com`;
  let token = '';
  let orgId = '';
  let userId = '';
  let orgSlug = '';

  try {
    const regRes = await fetch(`${prodApi}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: testEmail,
        password: 'SecurePassword123!',
        fullName: 'Smoke Test User',
        businessName: 'Apex Health Clinic',
      }),
    });
    const regData = await regRes.json();
    console.log('[3. Registration] Status:', regRes.status, 'Success:', regData.success);

    token = regData.data?.token || '';
    userId = regData.data?.user?.id || '';
    orgId = regData.data?.organization?.id || '';
    orgSlug = regData.data?.organization?.slug || '';

    if (!token && regData.data?.verificationToken) {
      console.log('Verifying email with verification token...');
      const verifyRes = await fetch(`${prodApi}/api/auth/verify-email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: regData.data.verificationToken }),
      });
      const verifyData = await verifyRes.json();
      token = verifyData.data?.token || '';
      console.log('[3. Email Verification] Status:', verifyRes.status, 'Success:', verifyData.success);
      results['Email verification'] = verifyRes.status === 200 && verifyData.success === true;
    } else {
      results['Email verification'] = true;
    }

    results['Signup & Login'] = !!token;
  } catch (err) {
    console.error('Registration/Login failed:', err);
    results['Signup & Login'] = false;
  }

  // 4. Billing Status & 7-Day Trial Confirmation
  try {
    const billingRes = await fetch(`${prodApi}/api/billing/status`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const billingData = await billingRes.json();
    console.log('[4. Billing Status & Trial] Status:', billingRes.status, 'Data:', billingData);
    results['7-Day $0 Trial Activated on Signup'] =
      billingRes.status === 200 &&
      billingData.success === true &&
      billingData.data?.subscription?.status === 'TRIALING' &&
      billingData.data?.daysRemainingInTrial === 7;
  } catch (err) {
    console.error('Billing status check failed:', err);
    results['7-Day $0 Trial Activated on Signup'] = false;
  }

  // 5. Billing Config (Paddle Price & Environment)
  try {
    const configRes = await fetch(`${prodApi}/api/billing/config`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const configData = await configRes.json();
    console.log('[5. Billing Config] Status:', configRes.status, 'Data:', configData);
    results['Paddle client config ($19/mo live price)'] =
      configRes.status === 200 &&
      configData.success === true &&
      configData.data?.priceId?.startsWith('pri_') &&
      configData.data?.monthlyPriceUsd === 19;
  } catch (err) {
    console.error('Billing config check failed:', err);
    results['Paddle client config ($19/mo live price)'] = false;
  }

  // 6. Organization Current & Public Chat AI Receptionist End-to-End
  try {
    const orgRes = await fetch(`${prodApi}/api/orgs/current`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const orgData = await orgRes.json();
    const slug = orgData.data?.organization?.slug || orgSlug;
    console.log('[6. Org Current] Slug:', slug);

    if (slug) {
      // Step A: Public org profile
      const profileRes = await fetch(`${prodApi}/api/public/chat/org/${slug}`);
      const profileData = await profileRes.json();
      console.log('[6. Public Org Profile] Status:', profileRes.status, 'AI Name:', profileData.data?.aiEmployee?.name);

      // Step B: Public chat session
      const sessionRes = await fetch(`${prodApi}/api/public/chat/session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orgSlug: slug, customerName: 'Patient Alice' }),
      });
      const sessionData = await sessionRes.json();
      const sessionToken = sessionData.data?.sessionToken;
      console.log('[6. Public Chat Session] Status:', sessionRes.status, 'Session created:', !!sessionToken);

      // Step C: Send message to AI Receptionist
      const msgRes = await fetch(`${prodApi}/api/public/chat/message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionToken,
          content: 'Hello, what are your consultation services and hours?',
        }),
      });
      const msgData = await msgRes.json();
      const aiReply = msgData.data?.aiMessage?.content || msgData.data?.message?.content || msgData.data?.content;
      console.log('[6. AI Receptionist Response] Status:', msgRes.status, 'AI Reply:', aiReply);

      results['AI receptionist chat'] = msgRes.status === 200 && msgData.success === true && !!aiReply;
    } else {
      results['AI receptionist chat'] = false;
    }
  } catch (err) {
    console.error('Public Chat check failed:', err);
    results['AI receptionist chat'] = false;
  }

  // 7. Composio Social & Calendar Auth URLs
  try {
    const gmailRes = await fetch(`${prodApi}/api/integrations/google-email/auth-url?returnUrl=/app/integrations`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const gmailData = await gmailRes.json();
    results['Gmail Composio OAuth'] = gmailRes.status === 200 && !!gmailData.data?.url;

    const calRes = await fetch(`${prodApi}/api/integrations/google-calendar/auth-url?returnUrl=/app/integrations`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const calData = await calRes.json();
    results['Calendar Composio OAuth'] = calRes.status === 200 && !!calData.data?.url;

    const igRes = await fetch(`${prodApi}/api/integrations/instagram/auth-url?returnUrl=/app/integrations`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const igData = await igRes.json();
    results['Instagram Composio OAuth'] = igRes.status === 200 && !!igData.data?.url;

    const fbRes = await fetch(`${prodApi}/api/integrations/facebook/auth-url?returnUrl=/app/integrations`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const fbData = await fbRes.json();
    results['Facebook Composio OAuth'] = fbRes.status === 200 && !!fbData.data?.url;
  } catch (err) {
    console.error('Integrations check failed:', err);
  }

  // 8. Public Booking Page
  try {
    const bookRes = await fetch(`${prodFrontend}/book/${orgSlug}`);
    console.log('[7. Public Booking Page] Status:', bookRes.status);
    results['Public booking page'] = bookRes.status === 200;
  } catch (err) {
    results['Public booking page'] = false;
  }

  // 9. Security & Tenant Isolation Guard Check
  try {
    const unauthRes = await fetch(`${prodApi}/api/billing/status`);
    results['Tenant & Auth Isolation'] = unauthRes.status === 401;
  } catch (err) {
    results['Tenant & Auth Isolation'] = false;
  }

  console.log('\n================================================================');
  console.log('📊 PRODUCTION SMOKE TEST SUMMARY');
  console.log('================================================================');
  let allPass = true;
  for (const [key, passed] of Object.entries(results)) {
    if (!passed) allPass = false;
    console.log(`${passed ? '✅ PASS' : '❌ FAIL'} - ${key}`);
  }

  if (!allPass) {
    process.exit(1);
  }
}

runFullProductionSmokeTest().catch((err) => {
  console.error(err);
  process.exit(1);
});
