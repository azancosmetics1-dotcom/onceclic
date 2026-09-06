import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import { config } from './config';
import { getDatabase } from './db';
import { errorHandler } from './middleware/errorHandler';

import authRoutes from './routes/authRoutes';
import organizationRoutes from './routes/organizationRoutes';
import aiEmployeeRoutes from './routes/aiEmployeeRoutes';
import knowledgeRoutes from './routes/knowledgeRoutes';
import appointmentRoutes from './routes/appointmentRoutes';
import conversationRoutes from './routes/conversationRoutes';
import emailRoutes from './routes/emailRoutes';
import billingRoutes from './routes/billingRoutes';
import publicChatRoutes from './routes/publicChatRoutes';
import analyticsRoutes from './routes/analyticsRoutes';
import integrationRoutes from './routes/integrationRoutes';

dotenv.config();

const app = express();

// Security Headers & CORS
app.use(
  helmet({
    contentSecurityPolicy: false, // Allow chat widget embed and inline scripts
    crossOriginEmbedderPolicy: false,
  })
);

const allowedOrigins = [
  'https://onceclic.com',
  'https://www.onceclic.com',
  'https://api.onceclic.com',
  'http://localhost:3000',
  'http://localhost:5173',
  'http://localhost:5000',
];

if (config.app.corsOrigin && config.app.corsOrigin !== '*') {
  const extraOrigins = config.app.corsOrigin.split(',').map((s) => s.trim());
  allowedOrigins.push(...extraOrigins);
}

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (e.g. mobile apps, curl, server-to-server, health checks)
      if (!origin) return callback(null, true);
      if (
        allowedOrigins.includes(origin) ||
        origin.endsWith('.onceclic.com') ||
        origin.endsWith('.netlify.app')
      ) {
        return callback(null, true);
      }
      // Permissive fallback to allow embeddable chat widgets on customer websites
      return callback(null, true);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-organization-id', 'x-webhook-token', 'paddle-signature'],
  })
);

// Capture raw body for Paddle webhook HMAC signature verification
app.use(
  express.json({
    verify: (req: any, _res, buf) => {
      req.rawBody = buf.toString();
    },
  })
);
app.use(express.urlencoded({ extended: true }));

// Health check endpoints (root /health and /api/health for cloud load balancers and monitors)
app.get(['/health', '/api/health'], (req, res) => {
  res.json({
    status: 'ok',
    service: 'ONCEClic API',
    timestamp: new Date().toISOString(),
    env: config.nodeEnv,
    aiAvailable: config.openai.isAvailable,
    paddleConfigured: config.paddle.isConfigured,
  });
});

// Dynamic Public Website Chat Widget Script
app.get(['/widget.js', '/api/public/widget.js'], (req, res) => {
  res.setHeader('Content-Type', 'application/javascript');
  res.send(`(function() {
  var script = document.currentScript || document.querySelector('script[data-org]');
  if (!script) return;
  var orgSlug = script.getAttribute('data-org');
  if (!orgSlug) return;

  var baseUrl = "${config.app.url}";
  var chatUrl = baseUrl + "/chat/" + encodeURIComponent(orgSlug) + "?embed=true";

  var container = document.createElement('div');
  container.id = 'onceclic-widget-container';
  container.innerHTML = [
    '<div id="onceclic-chat-modal" style="display:none;position:fixed;bottom:90px;right:24px;width:380px;height:600px;max-width:calc(100vw - 32px);max-height:calc(100vh - 120px);box-shadow:0 20px 40px rgba(0,0,0,0.3);border-radius:16px;overflow:hidden;z-index:999999;border:1px solid rgba(255,255,255,0.1);background:#020617;transition:all 0.3s ease;">',
    '  <iframe src="' + chatUrl + '" style="width:100%;height:100%;border:none;"></iframe>',
    '</div>',
    '<button id="onceclic-launcher-btn" style="position:fixed;bottom:24px;right:24px;width:60px;height:60px;border-radius:50%;background:linear-gradient(135deg,#059669,#10b981);color:#ffffff;border:none;box-shadow:0 8px 24px rgba(16,185,129,0.35);cursor:pointer;z-index:999999;display:flex;align-items:center;justify-content:center;transition:transform 0.2s ease;">',
    '  <svg id="onceclic-icon-chat" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>',
    '  <svg id="onceclic-icon-close" style="display:none;" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>',
    '</button>'
  ].join('');

  document.body.appendChild(container);

  var modal = document.getElementById('onceclic-chat-modal');
  var btn = document.getElementById('onceclic-launcher-btn');
  var iconChat = document.getElementById('onceclic-icon-chat');
  var iconClose = document.getElementById('onceclic-icon-close');
  var isOpen = false;

  btn.addEventListener('click', function() {
    isOpen = !isOpen;
    if (isOpen) {
      modal.style.display = 'block';
      iconChat.style.display = 'none';
      iconClose.style.display = 'block';
    } else {
      modal.style.display = 'none';
      iconChat.style.display = 'block';
      iconClose.style.display = 'none';
    }
  });
})();`);
});

// Mount Routes
app.use('/api/auth', authRoutes);
app.use('/api/orgs', organizationRoutes);
app.use('/api/ai', aiEmployeeRoutes);
app.use('/api/knowledge', knowledgeRoutes);
app.use('/api/appointments', appointmentRoutes);
app.use('/api/conversations', conversationRoutes);
app.use('/api/email', emailRoutes);
app.use('/api/billing', billingRoutes);
app.use('/api/public/chat', publicChatRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/integrations', integrationRoutes);

// Fallback JSON 404 handler for API routes
app.use('/api', (req, res) => {
  res.status(404).json({
    success: false,
    error: `API endpoint not found: ${req.method} ${req.originalUrl}`,
    code: 'NOT_FOUND',
  });
});

// Fallback JSON 404 handler for all other unhandled requests
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: `Not found: ${req.method} ${req.originalUrl}`,
    code: 'NOT_FOUND',
  });
});

// Error Handler
app.use(errorHandler);

export function validateProductionConfig() {
  if (config.nodeEnv === 'production') {
    const missing: string[] = [];
    if (!config.database.url || config.database.url.includes('placeholder')) {
      missing.push('DATABASE_URL');
    }
    if (!config.jwtSecret || config.jwtSecret.includes('dev_mode_only') || config.jwtSecret.includes('placeholder')) {
      missing.push('AUTH_SECRET');
    }
    if (missing.length > 0) {
      throw new Error(
        `[Config] Production startup validation failed. Missing required production environment variables: ${missing.join(', ')}`
      );
    }
  }
}

// Database initialization and server startup
export async function startServer() {
  validateProductionConfig();
  const db = getDatabase();
  await db.runMigrations();

  const server = app.listen(config.port, '0.0.0.0', () => {
    console.log(`==================================================`);
    console.log(`  ONCEClic Server running on 0.0.0.0:${config.port}`);
    console.log(`  Environment: ${config.nodeEnv}`);
    console.log(`  AI Provider: OpenAI (${config.openai.isAvailable ? 'Ready' : 'Requires OPENAI_API_KEY'})`);
    console.log(`  Paddle Billing: ${config.paddle.isConfigured ? 'Ready' : 'Requires PADDLE_WEBHOOK_SECRET'}`);
    console.log(`==================================================`);
  });

  // Start background workers (Gmail Sync)
  if (config.google.isConfigured || config.nodeEnv !== 'test') {
    const { EmailSyncService } = require('./services/EmailSyncService');
    EmailSyncService.startPolling(30000);
  }

  return { app, server };
}

if (require.main === module) {
  startServer().catch((err) => {
    console.error('[Server Startup Error]', err);
    process.exit(1);
  });
}

export default app;
