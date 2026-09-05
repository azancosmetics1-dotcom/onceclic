import dotenv from 'dotenv';
dotenv.config();

export const config = {
  port: parseInt(process.env.PORT || '5000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  jwtSecret: process.env.AUTH_SECRET || process.env.JWT_SECRET || 'onceclic_super_secret_jwt_key_2026_dev_mode_only',
  jwtExpiresIn: '7d',
  
  database: {
    url: process.env.DATABASE_URL || '',
  },

  encryption: {
    emailKey: process.env.EMAIL_ENCRYPTION_KEY || '',
    isConfigured: !!process.env.EMAIL_ENCRYPTION_KEY && !process.env.EMAIL_ENCRYPTION_KEY.includes('placeholder'),
  },

  openai: {
    apiKey: process.env.OPENAI_API_KEY || '',
    chatModel: process.env.OPENAI_CHAT_MODEL || 'gpt-4o-mini',
    embeddingModel: process.env.OPENAI_EMBEDDING_MODEL || 'text-embedding-3-small',
    isAvailable: !!process.env.OPENAI_API_KEY && !process.env.OPENAI_API_KEY.includes('placeholder'),
  },

  paddle: {
    apiKey: process.env.PADDLE_API_KEY || '',
    clientToken: process.env.PADDLE_CLIENT_TOKEN || process.env.VITE_PADDLE_CLIENT_TOKEN || '',
    webhookSecret: process.env.PADDLE_WEBHOOK_SECRET || '',
    priceId: process.env.PADDLE_PRICE_ID || process.env.VITE_PADDLE_PRICE_ID || '',
    environment: (process.env.PADDLE_ENVIRONMENT || 'sandbox') as 'sandbox' | 'production',
    isConfigured: !!process.env.PADDLE_WEBHOOK_SECRET && !process.env.PADDLE_WEBHOOK_SECRET.includes('placeholder'),
  },

  composio: {
    apiKey: process.env.COMPOSIO_API_KEY || '',
    isConfigured: !!process.env.COMPOSIO_API_KEY && !process.env.COMPOSIO_API_KEY.includes('placeholder'),
    baseUrl: process.env.COMPOSIO_BASE_URL || 'https://backend.composio.dev/api',
  },

  google: {
    clientId: process.env.GOOGLE_CLIENT_ID || '',
    clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
    callbackUrl: process.env.GOOGLE_CALLBACK_URL || `${process.env.API_URL || 'http://localhost:5000'}/api/auth/google/callback`,
    calendarCallbackUrl: process.env.GOOGLE_CALENDAR_CALLBACK_URL || `${process.env.API_URL || 'http://localhost:5000'}/api/integrations/google-calendar/callback`,
    emailCallbackUrl: process.env.GOOGLE_EMAIL_CALLBACK_URL || `${process.env.API_URL || 'http://localhost:5000'}/api/integrations/google-email/callback`,
    isConfigured: !!process.env.GOOGLE_CLIENT_ID && !process.env.GOOGLE_CLIENT_ID.includes('placeholder') && !!process.env.GOOGLE_CLIENT_SECRET && !process.env.GOOGLE_CLIENT_SECRET.includes('placeholder'),
  },

  resend: {
    apiKey: process.env.RESEND_API_KEY || '',
    fromEmail: process.env.RESEND_FROM_EMAIL || 'ONCEClic <notifications@onceclic.com>',
    isConfigured: !!process.env.RESEND_API_KEY && !process.env.RESEND_API_KEY.includes('placeholder'),
  },

  app: {
    url: (process.env.FRONTEND_URL || process.env.APP_URL || (process.env.NODE_ENV === 'production' ? 'https://onceclic.com' : 'http://localhost:3000')).replace(/\/+$/, ''),
    frontendUrl: (process.env.FRONTEND_URL || process.env.APP_URL || (process.env.NODE_ENV === 'production' ? 'https://onceclic.com' : 'http://localhost:3000')).replace(/\/+$/, ''),
    apiUrl: process.env.API_URL || 'http://localhost:5000',
    corsOrigin: process.env.CORS_ORIGIN || '*',
  },
  frontendUrl: (process.env.FRONTEND_URL || process.env.APP_URL || (process.env.NODE_ENV === 'production' ? 'https://onceclic.com' : 'http://localhost:3000')).replace(/\/+$/, ''),

  billing: {
    planName: 'ONCEClic Pro',
    monthlyPriceUsd: 49,
    trialPeriodDays: 7,
  }
};
