import dotenv from 'dotenv';
dotenv.config();

export interface GeminiConnectivityReport {
  httpStatus: number | null;
  model: string;
  success: boolean;
  rawResponseText?: string;
  sanitizedError?: string;
  latencyMs: number;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  quotaReported?: string;
}

export async function testGeminiConnectivity(customKey?: string, customModel?: string): Promise<GeminiConnectivityReport> {
  const apiKey = customKey || process.env.GEMINI_API_KEY || '';
  const model = customModel || process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite';

  if (!apiKey || apiKey.includes('placeholder') || apiKey.trim().length === 0) {
    return {
      httpStatus: null,
      model,
      success: false,
      sanitizedError: 'GEMINI_API_KEY is not configured in environment. Please set GEMINI_API_KEY in .env or environment.',
      latencyMs: 0,
    };
  }

  const sanitize = (text: string) => {
    if (!apiKey) return text;
    const escaped = apiKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return text.replace(new RegExp(escaped, 'g'), '[REDACTED_API_KEY]').replace(/key=[a-zA-Z0-9_\-]+/g, 'key=[REDACTED]');
  };

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const payload = {
    contents: [
      {
        role: 'user',
        parts: [{ text: 'Reply with exactly GEMINI_TEST_OK' }],
      },
    ],
    generationConfig: {
      temperature: 0.0,
      maxOutputTokens: 20,
    },
  };

  const startTime = Date.now();
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    const latencyMs = Date.now() - startTime;

    const httpStatus = res.status;

    if (res.ok) {
      const data: any = await res.json();
      const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
      const usage = data?.usageMetadata;

      return {
        httpStatus,
        model,
        success: rawText.includes('GEMINI_TEST_OK'),
        rawResponseText: rawText,
        latencyMs,
        promptTokens: usage?.promptTokenCount,
        completionTokens: usage?.candidatesTokenCount,
        totalTokens: usage?.totalTokenCount,
        quotaReported: 'Standard Google AI Studio API tier response received.',
      };
    }

    let errorDetail = `HTTP ${httpStatus} ${res.statusText}`;
    try {
      const errData: any = await res.json();
      if (errData?.error?.message) {
        errorDetail = errData.error.message;
      }
    } catch {}

    let categorizedMessage = errorDetail;
    if (httpStatus === 400) {
      categorizedMessage = `400 Bad Request / Model Configuration Issue: ${errorDetail}`;
    } else if (httpStatus === 403) {
      categorizedMessage = `403 Project/Key Not Authorized: ${errorDetail}`;
    } else if (httpStatus === 404) {
      categorizedMessage = `404 Model Availability Issue: Model "${model}" not found or unsupported endpoint. Details: ${errorDetail}`;
    } else if (httpStatus === 429) {
      categorizedMessage = `429 Quota / Rate Limiting: ${errorDetail}`;
    }

    return {
      httpStatus,
      model,
      success: false,
      sanitizedError: sanitize(categorizedMessage),
      latencyMs,
    };
  } catch (err: any) {
    const latencyMs = Date.now() - startTime;
    return {
      httpStatus: null,
      model,
      success: false,
      sanitizedError: sanitize(err.message || 'Unknown network error'),
      latencyMs,
    };
  }
}

// CLI runner
if (require.main === module) {
  (async () => {
    console.log('====================================================');
    console.log('  ONCEClic Safe Gemini Connectivity Test');
    console.log('====================================================\n');
    console.log(`Target Model: ${process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite'}`);
    console.log('Connecting to official Gemini API endpoint...\n');

    const result = await testGeminiConnectivity();

    console.log(`HTTP Status: ${result.httpStatus !== null ? result.httpStatus : 'N/A (Network/Config Error)'}`);
    console.log(`Model: ${result.model}`);
    console.log(`Success: ${result.success ? 'YES (GEMINI_TEST_OK received)' : 'NO'}`);
    console.log(`Latency: ${result.latencyMs}ms`);

    if (result.promptTokens !== undefined) {
      console.log(`Usage: Prompt=${result.promptTokens} tokens, Completion=${result.completionTokens} tokens, Total=${result.totalTokens} tokens`);
    }

    if (result.sanitizedError) {
      console.log(`Error Report: ${result.sanitizedError}`);
    }

    if (result.rawResponseText) {
      console.log(`Response Text: "${result.rawResponseText}"`);
    }

    console.log('\n====================================================\n');
    process.exitCode = result.success ? 0 : 1;
  })();
}
