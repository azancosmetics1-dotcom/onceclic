# ONCEClic Environment Variables Guide

## Core Server Environment Variables

| Variable | Description | Default / Example | Required |
| :--- | :--- | :--- | :--- |
| `PORT` | API Server listening port | `5000` | No |
| `NODE_ENV` | Environment mode (`development` / `production`) | `development` | Yes |
| `APP_URL` | Public Frontend Web Application URL | `https://onceclic.com` | Yes |
| `FRONTEND_URL` | Frontend Origin URL for verification links & redirects | `https://onceclic.com` | Yes |
| `API_URL` | Public Backend API URL | `https://api.onceclic.com` | Yes |
| `CORS_ORIGIN` | Allowed CORS origins for frontend requests | `https://onceclic.com` | Yes |
| `AUTH_SECRET` | Secure JWT signing key (min 32 chars) | `openssl rand -hex 32` | Yes |

## Database Configuration

| Variable | Description | Example | Required |
| :--- | :--- | :--- | :--- |
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://user:pass@host:5432/onceclic_db` | Yes (Production) |

## OpenAI Configuration

| Variable | Description | Example | Required |
| :--- | :--- | :--- | :--- |
| `OPENAI_API_KEY` | OpenAI API Key for GPT-4o-mini & Embeddings | `sk-proj-...` | Yes (for live AI) |
| `OPENAI_CHAT_MODEL` | Default chat completion model | `gpt-4o-mini` | No |
| `OPENAI_EMBEDDING_MODEL` | Default text embedding model | `text-embedding-3-small` | No |

## Paddle Billing v2 Configuration

| Variable | Description | Example | Required |
| :--- | :--- | :--- | :--- |
| `PADDLE_ENVIRONMENT` | Paddle environment (`sandbox` or `production`) | `sandbox` | Yes |
| `PADDLE_API_KEY` | Paddle API Key (Server-side) | `pdl_apikey_...` | Yes (for live billing) |
| `PADDLE_CLIENT_TOKEN` | Paddle Client Token (Frontend safe) | `test_...` | Yes (for checkout) |
| `PADDLE_WEBHOOK_SECRET` | Secret key for verifying HMAC webhook signatures | `pdl_ntfset_...` | Yes |
| `PADDLE_PRICE_ID` | Paddle Price ID for the $49/month recurring plan | `pri_...` | Yes |
