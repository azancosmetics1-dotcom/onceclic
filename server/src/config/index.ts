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

  openai: {
    apiKey: process.env.OPENAI_API_KEY || '',
    chatModel: process.env.OPENAI_CHAT_MODEL || 'gpt-4o-mini',
    embeddingModel: process.env.OPENAI_EMBEDDING_MODEL || 'text-embedding-3-small',
    isAvailable: !!process.env.OPENAI_API_KEY && !process.env.OPENAI_API_KEY.includes('placeholder'),
  },

  paddle: {
    apiKey: process.env.PADDLE_API_KEY || '',
    clientToken: process.env.PADDLE_CLIENT_TOKEN || '',
    webhookSecret: process.env.PADDLE_WEBHOOK_SECRET || '',
    priceId: process.env.PADDLE_PRICE_ID || 'pri_01onceclicpro49monthly',
    environment: (process.env.PADDLE_ENVIRONMENT || 'sandbox') as 'sandbox' | 'production',
    isConfigured: !!process.env.PADDLE_WEBHOOK_SECRET && !process.env.PADDLE_WEBHOOK_SECRET.includes('placeholder'),
  },

  google: {
    clientId: process.env.GOOGLE_CLIENT_ID || '',
    clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
    callbackUrl: process.env.GOOGLE_CALLBACK_URL || `${process.env.API_URL || 'http://localhost:5000'}/api/auth/google/callback`,
    isConfigured: !!process.env.GOOGLE_CLIENT_ID && !process.env.GOOGLE_CLIENT_ID.includes('placeholder') && !!process.env.GOOGLE_CLIENT_SECRET && !process.env.GOOGLE_CLIENT_SECRET.includes('placeholder'),
  },

  app: {
    url: process.env.APP_URL || 'http://localhost:3000',
    apiUrl: process.env.API_URL || 'http://localhost:5000',
    corsOrigin: process.env.CORS_ORIGIN || '*',
  },

  billing: {
    planName: 'ONCEClic Pro',
    monthlyPriceUsd: 49,
    trialPeriodDays: 7,
  }
};
