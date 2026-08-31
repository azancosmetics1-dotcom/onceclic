# ONCEClic Production Deployment Guide

## 1. Prerequisites
- **Node.js** >= 20.x
- **PostgreSQL Database** (e.g. Supabase, Neon, AWS RDS, DigitalOcean Managed Database)
- **OpenAI Account** (API Key with access to `gpt-4o-mini` & `text-embedding-3-small`)
- **Paddle Account** (Paddle Billing v2 account configured with a monthly $49 plan)

---

## 2. Production Build Steps

### Step 1: Clone & Install Dependencies
```bash
git clone <your-repo>
cd F-ONCECLIC
npm install
```

### Step 2: Build All Workspaces
```bash
npm run build
```
This compiles `@onceclic/shared`, the Node.js TypeScript server into `server/dist`, and Vite React client into `client/dist`.

### Step 3: Run Database Migrations
```bash
DATABASE_URL=postgresql://user:pass@host:5432/onceclic_db npm run migrate
```

---

## 3. Production Deployment Platforms

### Option A: Railway / Render / DigitalOcean App Platform (Recommended)
1. Connect your Git repository.
2. Set Environment Variables from `ENVIRONMENT.md`.
3. Set **Build Command**: `npm install && npm run build`
4. Set **Start Command**: `npm start`
5. Configure your custom domain: `onceclic.com`.

### Option B: Docker Deployment
```dockerfile
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
COPY shared ./shared
COPY server ./server
COPY client ./client
RUN npm install
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app ./
EXPOSE 5000
CMD ["npm", "start"]
```

---

## 4. Paddle Webhook Setup
1. In your Paddle Billing Dashboard, navigate to **Developer Tools > Notifications (Webhooks)**.
2. Add a new Destination URL pointing to: `https://api.onceclic.com/api/billing/webhook`.
3. Select the following event subscriptions:
   - `subscription.created`
   - `subscription.activated`
   - `subscription.updated`
   - `subscription.canceled`
   - `subscription.past_due`
   - `transaction.completed`
   - `transaction.payment_failed`
4. Copy the webhook secret key and set it as `PADDLE_WEBHOOK_SECRET` in your environment.

---

## 5. Domain & DNS Configuration for onceclic.com
- `onceclic.com` & `www.onceclic.com` -> Points to Frontend / App
- `api.onceclic.com` -> Points to Express Backend Server
- `mail.onceclic.com` -> MX & Inbound webhook routing
