# ONCEClic Architecture Documentation

## 1. High-Level Architecture Overview

ONCEClic is architected as a modular, multi-tenant B2B SaaS platform:

```
┌─────────────────────────────────────────────────────────────┐
│                       Client Layer                          │
│  - React 18 SPA (Marketing, Onboarding, SaaS Dashboard)     │
│  - Embeddable Widget Script (widget.js)                     │
│  - Standalone Hosted Chat (/chat/:slug)                     │
└──────────────────────────────┬──────────────────────────────┘
                               │ HTTP / REST / JSON
┌──────────────────────────────▼──────────────────────────────┐
│                    API & Security Layer                     │
│  - Express.js with Helmet & CORS                            │
│  - JWT Bearer Authentication Middleware                     │
│  - Tenant Isolation Middleware (req.organizationId)         │
│  - Centralized RBAC Gate (OWNER, MANAGER, EMPLOYEE)         │
│  - Subscription Gating Middleware (Trial & Active Pro)      │
│  - Rate Limiter (IP & Tenant Protection)                    │
└──────────────────────────────┬──────────────────────────────┘
                               │
┌──────────────────────────────▼──────────────────────────────┐
│                    Core Business Services                   │
│  - AuthService: Multi-tenant user & org lifecycle           │
│  - AIProvider & RAG Engine: Grounding & anti-injection      │
│  - KnowledgeService: Chunking & cosine vector embeddings    │
│  - AppointmentService: Concurrency-locked booking engine    │
│  - ConversationService: Unified inbox (Web & Email)         │
│  - EmailService: Webhook parser & SMTP connection           │
│  - PaddleBillingService: Authoritative HMAC webhook sync    │
│  - AuditService: Sensitive secret redaction logging         │
└──────────────────────────────┬──────────────────────────────┘
                               │
┌──────────────────────────────▼──────────────────────────────┐
│                      Data Persistence                       │
│  - PostgreSQL / Supabase Relational Database                │
│  - Strict organization_id indexes & constraints             │
│  - Transactional Locks (Double-Booking Prevention)          │
└─────────────────────────────────────────────────────────────┘
```

## 2. Multi-Tenant Isolation Model

1. **Membership Verification**: The active organization is never trusted from client parameters alone. `tenantIsolationMiddleware` queries `organization_memberships` for the authenticated user and matches the organization ID.
2. **Database Scoping**: Every table (`appointments`, `conversations`, `knowledge_sources`, `ai_employees`, `subscriptions`, etc.) stores `organization_id`.
3. **Cross-Tenant Prevention**: All queries, updates, and deletes append `WHERE organization_id = $1`.

## 3. Grounded RAG & AI Pipeline

1. **Retrieval**: User queries are analyzed against the business knowledge base using cosine similarity embeddings + keyword frequency boost.
2. **Prompt Assembly**: The system prompt injects business context, operating hours, bookable services, and retrieved fact chunks.
3. **Anti-Injection Rule**: Business knowledge is wrapped in strict non-instructional boundaries so users cannot inject prompt overrides.
4. **Zero-Hallucination Fallback**: If facts do not contain the answer, the AI is instructed to reply: *"I do not have enough information to answer that question accurately. Would you like me to connect you with a team member?"*

## 4. Appointment Booking & Double-Booking Prevention

1. **Available Slot Generation**: Evaluates weekly availability rules against business hours and existing bookings with buffer times.
2. **Concurrency Safety**: Bookings run inside PostgreSQL database transactions (`withTransaction`) checking time overlap conflicts before committing.

## 5. Paddle Billing & Lifecycle State Machine

- **Signup**: Automatic 7-day trial created in `subscriptions` (`status = TRIALING`).
- **Checkout**: Handled via Paddle Checkout v2 overlay with `custom_data: { organization_id }`.
- **Authoritative Webhook**: Paddle sends `subscription.activated` / `subscription.updated` / `subscription.canceled` signed with HMAC-SHA256. The server verifies `paddle-signature` and updates database status.
- **Gating**: `requireActiveSubscription` allows full usage during active trial or paid Pro state, and cleanly restricts AI responses when expired while preserving dashboard data.
