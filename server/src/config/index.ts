import dotenv from 'dotenv';
dotenv.config();

// Detect production environment: explicit NODE_ENV=production OR any Railway / Render deployment signal
const isProduction =
  process.env.NODE_ENV === 'production' ||
  !!process.env.RAILWAY_ENVIRONMENT ||
  !!process.env.RAILWAY_PUBLIC_DOMAIN ||
  !!process.env.RAILWAY_SERVICE_NAME ||
  !!process.env.RENDER ||
  !!process.env.RENDER_SERVICE_ID;

export const config = {
  port: parseInt(process.env.PORT || '5000', 10),
  nodeEnv: process.env.NODE_ENV || (isProduction ? 'production' : 'development'),
  jwtSecret: process.env.AUTH_SECRET || process.env.JWT_SECRET || 'onceclic_super_secret_jwt_key_2026_dev_mode_only',
  jwtExpiresIn: '7d',
  
  database: {
    url: process.env.DATABASE_URL || '',
  },

  encryption: {
    emailKey: process.env.EMAIL_ENCRYPTION_KEY || '',
    isConfigured: !!process.env.EMAIL_ENCRYPTION_KEY && !process.env.EMAIL_ENCRYPTION_KEY.includes('placeholder'),
  },

  ai: {
    provider: (process.env.AI_PROVIDER || 'gemini').toLowerCase().trim(),
  },

  openai: {
    apiKey: process.env.OPENAI_API_KEY || '',
    chatModel: process.env.OPENAI_CHAT_MODEL || 'gpt-4o-mini',
    embeddingModel: process.env.OPENAI_EMBEDDING_MODEL || 'text-embedding-3-small',
    isAvailable: !!process.env.OPENAI_API_KEY && !process.env.OPENAI_API_KEY.includes('placeholder'),
  },

  gemini: {
    apiKey: process.env.GEMINI_API_KEY || '',
    model: process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite',
    embeddingModel: process.env.GEMINI_EMBEDDING_MODEL || 'text-embedding-004',
    isAvailable: !!process.env.GEMINI_API_KEY && !process.env.GEMINI_API_KEY.includes('placeholder'),
  },

  paddle: {
    apiKey: process.env.PADDLE_API_KEY || '',
    clientToken: process.env.PADDLE_CLIENT_TOKEN || process.env.VITE_PADDLE_CLIENT_TOKEN || '',
    webhookSecret: process.env.PADDLE_WEBHOOK_SECRET || '',
    priceId: process.env.PADDLE_PRICE_ID || process.env.VITE_PADDLE_PRICE_ID || 'pri_01j7onceclic_pro_19m_sandbox',
    proMonthlyPriceId: process.env.PADDLE_PRICE_ID || process.env.VITE_PADDLE_PRICE_ID || 'pri_01j7onceclic_pro_19m_sandbox',
    environment: (process.env.PADDLE_ENVIRONMENT || 'sandbox') as 'sandbox' | 'production',
    isConfigured: !!process.env.PADDLE_WEBHOOK_SECRET && !process.env.PADDLE_WEBHOOK_SECRET.includes('placeholder'),
  },

  composio: {
    apiKey: process.env.COMPOSIO_API_KEY || '',
    webhookSecret: process.env.COMPOSIO_WEBHOOK_SECRET || '',
    isConfigured: !!process.env.COMPOSIO_API_KEY && !process.env.COMPOSIO_API_KEY.includes('placeholder'),
    isWebhookConfigured: !!process.env.COMPOSIO_WEBHOOK_SECRET && !process.env.COMPOSIO_WEBHOOK_SECRET.includes('placeholder'),
    baseUrl: process.env.COMPOSIO_BASE_URL || 'https://backend.composio.dev/api',
  },

  google: {
    clientId: process.env.GOOGLE_CLIENT_ID || '',
    clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
    callbackUrl: process.env.GOOGLE_CALLBACK_URL || `${process.env.API_URL || (isProduction ? 'https://api.onceclic.com' : 'http://localhost:5000')}/api/auth/google/callback`,
    calendarCallbackUrl: process.env.GOOGLE_CALENDAR_CALLBACK_URL || `${process.env.API_URL || (isProduction ? 'https://api.onceclic.com' : 'http://localhost:5000')}/api/integrations/google-calendar/callback`,
    emailCallbackUrl: process.env.GOOGLE_EMAIL_CALLBACK_URL || `${process.env.API_URL || (isProduction ? 'https://api.onceclic.com' : 'http://localhost:5000')}/api/integrations/google-email/callback`,
    isProduction,
    isConfigured: !!process.env.GOOGLE_CLIENT_ID && !process.env.GOOGLE_CLIENT_ID.includes('placeholder') && !!process.env.GOOGLE_CLIENT_SECRET && !process.env.GOOGLE_CLIENT_SECRET.includes('placeholder'),
  },

  resend: {
    apiKey: process.env.RESEND_API_KEY || '',
    fromEmail: process.env.RESEND_FROM_EMAIL || 'ONCEClic <notifications@onceclic.com>',
    isConfigured: !!process.env.RESEND_API_KEY && !process.env.RESEND_API_KEY.includes('placeholder'),
  },

  app: {
    url: (process.env.FRONTEND_URL || process.env.APP_URL || (isProduction ? 'https://onceclic.com' : 'http://localhost:3000')).replace(/\/+$/, ''),
    frontendUrl: (process.env.FRONTEND_URL || process.env.APP_URL || (isProduction ? 'https://onceclic.com' : 'http://localhost:3000')).replace(/\/+$/, ''),
    apiUrl: (process.env.API_URL || (isProduction ? 'https://api.onceclic.com' : 'http://localhost:5000')).replace(/\/+$/, ''),
    corsOrigin: process.env.CORS_ORIGIN || '*',
    isProduction,
  },
  frontendUrl: (process.env.FRONTEND_URL || process.env.APP_URL || (isProduction ? 'https://onceclic.com' : 'http://localhost:3000')).replace(/\/+$/, ''),
  isProduction,

  billing: {
    planName: 'ONCEClic Pro',
    monthlyPriceUsd: 19,
    trialPeriodDays: 7,
    trialPriceUsd: 0,
    trialAiBudgetUsd: parseFloat(process.env.TRIAL_AI_BUDGET_USD || '0.50'),
    proAiBudgetUsd: parseFloat(process.env.PRO_AI_BUDGET_USD || '10.00'),
  }
};
