# ONCEClic Environment Variables Guide

## 1. Required Server Variables (Production)

| Variable | Description | Example / Format | Classification |
| :--- | :--- | :--- | :--- |
| `NODE_ENV` | Environment mode | `production` or `development` | Core |
| `PORT` | Server listening port (Render provides automatically) | `5000` / `10000` | Core |
| `DATABASE_URL` | Supabase / PostgreSQL pooling connection string | `postgresql://user:pass@host:6543/postgres` | Database |
| `AUTH_SECRET` | Secure JWT token signing secret (minimum 32 chars) | `openssl rand -hex 32` | Security |
| `AI_PROVIDER` | Active AI provider (`gemini` or `openai`) | `gemini` | AI |
| `GEMINI_API_KEY` | Google AI Studio Developer API Key (when using Gemini) | `AQ...` / `AIza...` | AI (Server-only) |
| `PADDLE_ENVIRONMENT` | Paddle API mode (`sandbox` or `production`) | `production` / `sandbox` | Payments |
| `PADDLE_API_KEY` | Server-side Paddle API key | `pdl_live_apikey_...` / `pdl_sdbx_...` | Payments (Server-only) |
| `PADDLE_WEBHOOK_SECRET` | HMAC secret for Paddle webhook signature verification | `ntfset_...` | Payments (Server-only) |
| `PADDLE_PRICE_ID` | Paddle Pro Monthly recurring Price ID ($19/mo) | `pri_...` | Payments |
| `FRONTEND_URL` | Frontend origin for CORS and verification links | `https://onceclic.com` | App URL |
| `API_URL` | Backend public endpoint | `https://api.onceclic.com` | App URL |
| `APP_URL` | Web application base URL | `https://onceclic.com` | App URL |
| `CORS_ORIGIN` | Allowed CORS origins for browser security | `https://onceclic.com,https://www.onceclic.com` | Security |

## 2. Optional / Integration Variables (Server-Only)

| Variable | Description | Default / Example | Classification |
| :--- | :--- | :--- | :--- |
| `GEMINI_MODEL` | Gemini LLM model identifier | `gemini-3.5-flash-lite` | AI |
| `GEMINI_EMBEDDING_MODEL` | Gemini vector embedding model | `text-embedding-004` | AI |
| `OPENAI_API_KEY` | Fallback OpenAI API key (if `AI_PROVIDER=openai`) | `sk-proj-...` | AI (Server-only) |
| `OPENAI_CHAT_MODEL` | OpenAI LLM model identifier | `gpt-4o-mini` | AI |
| `OPENAI_EMBEDDING_MODEL` | OpenAI vector embedding model | `text-embedding-3-small` | AI |
| `RESEND_API_KEY` | Resend transactional email API key | `re_...` | Email |
| `RESEND_FROM_EMAIL` | From header for outgoing system notifications | `ONCEClic <notifications@onceclic.com>` | Email |
| `COMPOSIO_API_KEY` | Composio Managed OAuth API key (Gmail, Calendar, IG, FB)| `comp_...` | Integrations |
| `EMAIL_ENCRYPTION_KEY` | AES encryption key for customer email credentials | `openssl rand -hex 16` | Security |
| `TRIAL_AI_BUDGET_USD` | Free trial AI cost allowance | `0.50` | Billing |
| `PRO_AI_BUDGET_USD` | Monthly Pro AI cost allowance | `10.00` | Billing |

## 3. Client-Safe Variables (Frontend / Netlify)

| Variable | Description | Example |
| :--- | :--- | :--- |
| `VITE_API_URL` | Backend API base URL for client HTTP calls | `https://api.onceclic.com` |
| `VITE_SUPABASE_URL` | Public Supabase project URL | `https://[ref].supabase.co` |
| `VITE_PADDLE_ENVIRONMENT`| Client Paddle environment (`sandbox` / `production`) | `production` / `sandbox` |
| `VITE_PADDLE_CLIENT_TOKEN`| Paddle public client token for overlay checkout | `live_...` / `test_...` |
| `VITE_PADDLE_PRICE_ID` | Paddle Pro Monthly Price ID | `pri_...` |

