# ONCEClic (onceclic.com)

**ONCEClic** is a production-ready, multi-tenant B2B SaaS MVP providing an **AI Receptionist & Assistant** for small businesses (clinics, salons, consultants, contractors, agencies, and local service companies).

It automates customer intake across **Website Chat** and **Email**, answers business FAQs with grounded RAG knowledge, books real-time appointments without double-booking, handles human handoffs, and manages subscriptions via **Paddle Billing ($49/month with a 7-day free trial)**.

---

## Key Features

- **24/7 Website AI Receptionist**: Embeddable 1-line script or hosted public chat link (`/chat/:orgSlug`).
- **Real-Time Appointment Scheduling**: Timezone-aware slot calculator and concurrency-safe booking engine preventing double-booking.
- **Business Knowledge Base (RAG)**: Chunking, OpenAI embeddings (`text-embedding-3-small`), and cosine vector search with prompt-injection defense.
- **Automated Email Answering**: Dedicated inbound reception address, webhook routing, and AI response drafts.
- **Paddle Billing Integration**: One recurring plan ($49/month, 7-day trial), Paddle Checkout v2 overlay, and authoritative HMAC-SHA256 webhook signature verification.
- **Multi-Tenant Architecture**: Strict organization data isolation and centralized RBAC (`OWNER`, `MANAGER`, `EMPLOYEE`).
- **Idempotency & Guardrails**: Client message deduplication and zero-hallucination policies.
- **Audit Logging & Token Cost Tracking**: Exact token cost records per conversation in USD.

---

## Tech Stack

- **Frontend**: React 18, TypeScript, Vite, Tailwind CSS, Lucide React, React Router v6.
- **Backend**: Node.js, Express, TypeScript, JWT auth, bcrypt password hashing.
- **Database**: PostgreSQL (Supabase / Neon / RDS compatible) with SQL migrations and embedded zero-config fallback for testing.
- **AI Engine**: OpenAI SDK (`gpt-4o-mini` & `text-embedding-3-small`) with modular `AIProvider` interface.
- **Payments**: Paddle Billing v2 Merchant of Record.

---

## Quick Start (Local Development)

### 1. Install Dependencies
```bash
npm install
```

### 2. Configure Environment Variables
Copy `.env.example` to `.env`:
```bash
cp .env.example .env
```
*(Optionally provide your `OPENAI_API_KEY` and Paddle credentials. The app includes transparent fallback diagnostics if credentials are not yet set).*

### 3. Run Automated Test Suite
```bash
npm test
```

### 4. Start Development Servers
In two terminal tabs or run concurrently:
```bash
# Start Backend API (Port 5000)
npm run dev:server

# Start Frontend (Port 3000)
npm run dev:client
```
Visit `http://localhost:3000` to access the marketing site and SaaS app.

---

## First-Customer Launch Workflow

1. **Sign Up**: Register at `/signup` to initiate your 7-day free trial.
2. **Complete 8-Step Onboarding**: Confirm business details, AI receptionist name, services, and working hours.
3. **Embed Chat Widget**: Copy the embed code from **Settings** or share your public link (`/chat/your-business`).
4. **Test Booking**: Open your public chat, ask a question, and book an appointment.
5. **Manage Inquiries**: View incoming appointments in **Appointments** and converse with visitors in the **Conversations** inbox.
6. **Paddle Subscription**: Customers upgrade to Pro ($49/mo) after their 7-day trial via Paddle recurring billing.
