import { config } from '../server/src/config';

async function verifyProduction() {
  const prodApi = 'https://api.onceclic.com';
  console.log('Testing against production:', prodApi);

  // 1. Health check
  const healthRes = await fetch(`${prodApi}/api/health`);
  const healthData = await healthRes.json();
  console.log('Health check:', healthData);

  // 2. Register / login test user
  const email = `prod_test_${Date.now()}@example.com`;
  const regRes = await fetch(`${prodApi}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email,
      password: 'Password123!',
      fullName: 'Composio Production Verifier',
      businessName: 'Verifier Corp',
    }),
  });
  const regData = await regRes.json();
  console.log('Register response status:', regRes.status, 'success:', regData.success);

  let token = regData.data?.token;
  if (!token && regData.data?.verificationToken) {
    const verifyRes = await fetch(`${prodApi}/api/auth/verify-email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: regData.data.verificationToken }),
    });
    const verifyData = await verifyRes.json();
    token = verifyData.data?.token;
  }

  if (!token) {
    const loginRes = await fetch(`${prodApi}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: 'Password123!' }),
    });
    const loginData = await loginRes.json();
    token = loginData.data?.token;
  }

  console.log('JWT Token acquired:', !!token);
  if (!token) {
    throw new Error('Failed to acquire token on production.');
  }

  // 3. Test Gmail Auth URL
  console.log('\n--- Requesting Gmail Auth URL from production ---');
  const gmailRes = await fetch(`${prodApi}/api/integrations/google-email/auth-url?returnUrl=/app/integrations`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const gmailData = await gmailRes.json();
  console.log('Gmail Auth URL HTTP Status:', gmailRes.status);
  console.log('Gmail Auth URL Response:', JSON.stringify(gmailData, null, 2));

  // 4. Test Calendar Auth URL
  console.log('\n--- Requesting Google Calendar Auth URL from production ---');
  const calRes = await fetch(`${prodApi}/api/integrations/google-calendar/auth-url?returnUrl=/app/integrations`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const calData = await calRes.json();
  console.log('Google Calendar Auth URL HTTP Status:', calRes.status);
  console.log('Google Calendar Auth URL Response:', JSON.stringify(calData, null, 2));

  // Check URL types
  if (gmailData.data?.url) {
    const isComposio = gmailData.data.url.includes('composio.dev') || gmailData.data.url.includes('composio');
    const isOldGoogle = gmailData.data.url.includes('accounts.google.com/o/oauth2');
    console.log(`\nGmail URL Type: ${isComposio ? 'COMPOSIO MANAGED OAUTH LINK' : isOldGoogle ? 'OLD GOOGLE DIRECT OAUTH' : 'OTHER'}`);
  }

  if (calData.data?.url) {
    const isComposio = calData.data.url.includes('composio.dev') || calData.data.url.includes('composio');
    const isOldGoogle = calData.data.url.includes('accounts.google.com/o/oauth2');
    console.log(`Calendar URL Type: ${isComposio ? 'COMPOSIO MANAGED OAUTH LINK' : isOldGoogle ? 'OLD GOOGLE DIRECT OAUTH' : 'OTHER'}`);
  }
}

verifyProduction().catch(console.error);
