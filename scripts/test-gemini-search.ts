import dotenv from 'dotenv';
dotenv.config();

async function testGeminiWithSearch() {
  const apiKey = process.env.GEMINI_API_KEY || '';
  const model = process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite';
  
  console.log('Testing Gemini API with Google Search Tool Grounding...');
  console.log('Model:', model);

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  
  // Test 1: Standard generation with ONCEClic public knowledge
  const payloadWithoutSearch = {
    contents: [
      {
        role: 'user',
        parts: [{ text: 'What is ONCEClic and what is its pricing and free trial?' }]
      }
    ],
    systemInstruction: {
      parts: [{
        text: `You are the official AI representative for ONCEClic (https://onceclic.com).
ONCEClic is an AI Receptionist for small businesses.
Pricing: $19/month for ONCEClic Pro.
Free Trial: 7-day free trial with no credit card required, $0 upfront, no automatic trial charges.
Channels: 24/7 Website Chatbot, Automated Gmail/Email Answering, Google Calendar Scheduling, Instagram DM & Facebook Page Receptionist.
Billing: Paddle Merchant of Record.`
      }]
    }
  };

  const res1 = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payloadWithoutSearch)
  });

  console.log('Standard Gemini Call Status:', res1.status);
  const data1: any = await res1.json();
  console.log('Gemini Answer:\n', data1?.candidates?.[0]?.content?.parts?.[0]?.text);

  // Test 2: With Google Search Tool
  const payloadWithSearch = {
    contents: [
      {
        role: 'user',
        parts: [{ text: 'Who won the most recent Super Bowl?' }]
      }
    ],
    tools: [
      { googleSearch: {} }
    ]
  };

  const res2 = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payloadWithSearch)
  });

  console.log('\nGemini Call with googleSearch tool Status:', res2.status);
  const data2: any = await res2.json();
  console.log('Search Grounded Answer:\n', data2?.candidates?.[0]?.content?.parts?.[0]?.text);
  if (data2?.error) {
    console.log('Search Error Detail:', data2.error);
  }
}

testGeminiWithSearch().catch(console.error);
