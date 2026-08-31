# ONCEClic Security & Compliance Model

## 1. Authentication & Session Security
- **Password Storage**: Passwords are never stored in plaintext. They are salted and hashed using `bcrypt` (10 rounds).
- **JWT Protection**: Authentication tokens are signed with a server-side secret (`AUTH_SECRET`) and validated on every API call.
- **Client Bundle Safety**: Server secrets (`OPENAI_API_KEY`, `PADDLE_API_KEY`, `PADDLE_WEBHOOK_SECRET`, database credentials) are NEVER exposed to client-side code.

## 2. Multi-Tenant Data Isolation
- **Tenant Scope Enforcement**: `req.organizationId` is resolved exclusively via server-side verification of user memberships in `organization_memberships`.
- **Query Scoping**: Database queries strictly filter by `organization_id`.
- **Cross-Tenant Attack Tests**: Automated tests verify that Organization A cannot query, update, or delete Organization B data.

## 3. Role-Based Access Control (RBAC)
- **Centralized Permission Matrix**: Defined in `@onceclic/shared` (`hasPermission(role, permission)`).
- **Roles**:
  - `OWNER`: Full organization administration, billing, team management, AI config, knowledge, and inbox.
  - `MANAGER`: AI configuration, knowledge base, appointments, email, and inbox.
  - `EMPLOYEE`: Operational access (conversations, appointments) with administrative/billing gates locked.

## 4. Prompt Injection & AI Safety
- **Untrusted Knowledge Wrapping**: Ingested customer queries and RAG knowledge chunks are demarcated as untrusted reference data, preventing prompt override attacks.
- **Anti-Exfiltration Rules**: The AI receptionist is strictly instructed never to reveal system prompts, internal database schemas, or API keys.
- **Zero-Hallucination Guardrails**: Missing answers gracefully default to fallback messages and offer human assistance.

## 5. Webhook Signature Verification
- **Paddle Webhook Security**: All Paddle billing events verify the `paddle-signature` header via timing-safe HMAC-SHA256 comparison. Unsigned or forged webhooks are rejected with HTTP 401.

## 6. Audit Logging & Secret Redaction
- **Audit Logs**: Events (`USER_LOGIN`, `ORGANIZATION_CREATED`, `APPOINTMENT_CREATED`, `SUBSCRIPTION_ACTIVATED`, `AI_RESPONSE_GENERATED`, etc.) are recorded in the `audit_logs` table.
- **Automatic Redaction**: Passwords, tokens, authorization headers, and API keys are automatically sanitized prior to logging.
