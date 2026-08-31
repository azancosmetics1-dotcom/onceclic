// ==========================================
// ONCEClic Shared Types, Enums & Permissions
// ==========================================

export enum UserRole {
  OWNER = 'OWNER',
  MANAGER = 'MANAGER',
  EMPLOYEE = 'EMPLOYEE',
}

export enum SubscriptionStatus {
  TRIALING = 'TRIALING',
  ACTIVE = 'ACTIVE',
  PAUSED = 'PAUSED',
  PAST_DUE = 'PAST_DUE',
  CANCELED = 'CANCELED',
  EXPIRED = 'EXPIRED',
}

export enum ConversationChannel {
  WEB = 'WEB',
  EMAIL = 'EMAIL',
  // Extension interfaces for future channels
  WHATSAPP = 'WHATSAPP',
  FACEBOOK = 'FACEBOOK',
  INSTAGRAM = 'INSTAGRAM',
  SMS = 'SMS',
  PHONE = 'PHONE',
}

export enum ConversationStatus {
  OPEN = 'OPEN',
  HUMAN_HANDOFF = 'HUMAN_HANDOFF',
  RESOLVED = 'RESOLVED',
  ARCHIVED = 'ARCHIVED',
}

export enum MessageRole {
  CUSTOMER = 'CUSTOMER',
  AI = 'AI',
  HUMAN_AGENT = 'HUMAN_AGENT',
  SYSTEM = 'SYSTEM',
}

export enum AppointmentStatus {
  REQUESTED = 'REQUESTED',
  CONFIRMED = 'CONFIRMED',
  CANCELED = 'CANCELED',
  COMPLETED = 'COMPLETED',
  NO_SHOW = 'NO_SHOW',
}

export enum AIEmployeeStatus {
  ACTIVE = 'ACTIVE',
  DRAFT = 'DRAFT',
  INACTIVE = 'INACTIVE',
}

export enum KnowledgeSourceType {
  FAQ = 'FAQ',
  TEXT = 'TEXT',
  BUSINESS_INFO = 'BUSINESS_INFO',
}

export enum AuditAction {
  USER_REGISTERED = 'USER_REGISTERED',
  USER_LOGIN = 'USER_LOGIN',
  ORGANIZATION_CREATED = 'ORGANIZATION_CREATED',
  AI_EMPLOYEE_CREATED = 'AI_EMPLOYEE_CREATED',
  AI_EMPLOYEE_ACTIVATED = 'AI_EMPLOYEE_ACTIVATED',
  AI_EMPLOYEE_UPDATED = 'AI_EMPLOYEE_UPDATED',
  KNOWLEDGE_CREATED = 'KNOWLEDGE_CREATED',
  KNOWLEDGE_DELETED = 'KNOWLEDGE_DELETED',
  AI_RESPONSE_REQUESTED = 'AI_RESPONSE_REQUESTED',
  AI_RESPONSE_GENERATED = 'AI_RESPONSE_GENERATED',
  AI_RESPONSE_FAILED = 'AI_RESPONSE_FAILED',
  AI_HANDOFF_REQUIRED = 'AI_HANDOFF_REQUIRED',
  CONVERSATION_CREATED = 'CONVERSATION_CREATED',
  CONVERSATION_RESOLVED = 'CONVERSATION_RESOLVED',
  CONVERSATION_ARCHIVED = 'CONVERSATION_ARCHIVED',
  CONVERSATION_HANDOFF = 'CONVERSATION_HANDOFF',
  APPOINTMENT_CREATED = 'APPOINTMENT_CREATED',
  APPOINTMENT_CONFIRMED = 'APPOINTMENT_CONFIRMED',
  APPOINTMENT_CANCELED = 'APPOINTMENT_CANCELED',
  EMAIL_RECEIVED = 'EMAIL_RECEIVED',
  EMAIL_SENT = 'EMAIL_SENT',
  SUBSCRIPTION_CREATED = 'SUBSCRIPTION_CREATED',
  SUBSCRIPTION_ACTIVATED = 'SUBSCRIPTION_ACTIVATED',
  SUBSCRIPTION_CANCELED = 'SUBSCRIPTION_CANCELED',
  SUBSCRIPTION_EXPIRED = 'SUBSCRIPTION_EXPIRED',
  PAYMENT_FAILED = 'PAYMENT_FAILED',
  PADDLE_WEBHOOK_RECEIVED = 'PADDLE_WEBHOOK_RECEIVED',
  EMAIL_VERIFICATION_SENT = 'EMAIL_VERIFICATION_SENT',
  EMAIL_VERIFIED = 'EMAIL_VERIFIED',
  EMAIL_VERIFICATION_RESENT = 'EMAIL_VERIFICATION_RESENT',
  WEBSITE_CONNECTED = 'WEBSITE_CONNECTED',
  WEBSITE_DISCONNECTED = 'WEBSITE_DISCONNECTED',
  WEBSITE_VERIFICATION_STARTED = 'WEBSITE_VERIFICATION_STARTED',
  WEBSITE_VERIFICATION_COMPLETED = 'WEBSITE_VERIFICATION_COMPLETED',
  EMAIL_CONNECTION_STARTED = 'EMAIL_CONNECTION_STARTED',
  EMAIL_CONNECTED = 'EMAIL_CONNECTED',
  EMAIL_DISCONNECTED = 'EMAIL_DISCONNECTED',
  EMAIL_CONNECTION_FAILED = 'EMAIL_CONNECTION_FAILED',
  ANALYTICS_VIEWED = 'ANALYTICS_VIEWED',
}

// ------------------------------------------
// Centralized RBAC Permission Matrix
// ------------------------------------------

export type Permission =
  | 'org:manage'
  | 'org:read'
  | 'billing:manage'
  | 'billing:read'
  | 'ai:manage'
  | 'ai:read'
  | 'knowledge:manage'
  | 'knowledge:read'
  | 'appointments:manage'
  | 'appointments:read'
  | 'conversations:manage'
  | 'conversations:read'
  | 'email:manage'
  | 'email:read'
  | 'settings:manage'
  | 'settings:read'
  | 'analytics:read'
  | 'integrations:manage'
  | 'integrations:read';

export const ROLE_PERMISSIONS: Record<UserRole, Permission[]> = {
  [UserRole.OWNER]: [
    'org:manage',
    'org:read',
    'billing:manage',
    'billing:read',
    'ai:manage',
    'ai:read',
    'knowledge:manage',
    'knowledge:read',
    'appointments:manage',
    'appointments:read',
    'conversations:manage',
    'conversations:read',
    'email:manage',
    'email:read',
    'settings:manage',
    'settings:read',
    'analytics:read',
    'integrations:manage',
    'integrations:read',
  ],
  [UserRole.MANAGER]: [
    'org:read',
    'billing:read',
    'ai:manage',
    'ai:read',
    'knowledge:manage',
    'knowledge:read',
    'appointments:manage',
    'appointments:read',
    'conversations:manage',
    'conversations:read',
    'email:manage',
    'email:read',
    'settings:read',
    'analytics:read',
    'integrations:read',
  ],
  [UserRole.EMPLOYEE]: [
    'org:read',
    'ai:read',
    'knowledge:read',
    'appointments:manage',
    'appointments:read',
    'conversations:manage',
    'conversations:read',
    'settings:read',
  ],
};

export function hasPermission(role: UserRole, permission: Permission): boolean {
  const permissions = ROLE_PERMISSIONS[role] || [];
  return permissions.includes(permission);
}

// ------------------------------------------
// Core Entity Interfaces
// ------------------------------------------

export interface User {
  id: string;
  email: string;
  fullName: string;
  isEmailVerified: boolean;
  googleId?: string;
  avatarUrl?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Organization {
  id: string;
  name: string;
  slug: string;
  businessType: string;
  phone?: string;
  email?: string;
  website?: string;
  address?: string;
  timezone: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface OrganizationMembership {
  id: string;
  organizationId: string;
  userId: string;
  role: UserRole;
  createdAt: string;
  updatedAt: string;
  user?: User;
  organization?: Organization;
}

export interface Subscription {
  id: string;
  organizationId: string;
  paddleCustomerId?: string;
  paddleSubscriptionId?: string;
  paddleTransactionId?: string;
  priceId?: string;
  status: SubscriptionStatus;
  trialStartedAt: string;
  trialEndsAt: string;
  currentPeriodStart?: string;
  currentPeriodEnd?: string;
  cancelAtPeriodEnd: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ServiceItem {
  id: string;
  name: string;
  durationMinutes: number;
  price: number;
  description?: string;
}

export interface DayBusinessHours {
  dayOfWeek: number; // 0 = Sunday, 1 = Monday, ... 6 = Saturday
  openTime: string; // "09:00"
  closeTime: string; // "17:00"
  isClosed: boolean;
}

export interface BusinessSettings {
  id: string;
  organizationId: string;
  businessHours: DayBusinessHours[];
  services: ServiceItem[];
  cancellationPolicy?: string;
  contactInstructions?: string;
  websiteChatEnabled: boolean;
  emailAnsweringEnabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AIEmployee {
  id: string;
  organizationId: string;
  name: string;
  roleTitle: string;
  description: string;
  personality: string;
  tone: string;
  instructions: string;
  businessContext: string;
  greetingMessage: string;
  fallbackMessage: string;
  operatingHours?: string;
  appointmentRules?: string;
  handoffRules?: string;
  status: AIEmployeeStatus;
  createdAt: string;
  updatedAt: string;
}

export interface KnowledgeSource {
  id: string;
  organizationId: string;
  sourceType: KnowledgeSourceType;
  title: string;
  rawContent: string;
  chunkCount: number;
  status: 'PROCESSED' | 'PENDING' | 'FAILED';
  createdAt: string;
  updatedAt: string;
}

export interface KnowledgeChunk {
  id: string;
  organizationId: string;
  sourceId: string;
  chunkContent: string;
  chunkIndex: number;
  embedding?: number[];
  metadata?: Record<string, any>;
  createdAt: string;
}

export interface AvailabilityRule {
  id: string;
  organizationId: string;
  dayOfWeek: number;
  startTime: string; // "09:00"
  endTime: string; // "17:00"
  slotDurationMinutes: number;
  bufferMinutes: number;
  isAvailable: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Appointment {
  id: string;
  organizationId: string;
  serviceId?: string;
  serviceName: string;
  customerName: string;
  customerEmail: string;
  customerPhone?: string;
  startTime: string; // ISO String
  endTime: string; // ISO String
  status: AppointmentStatus;
  notes?: string;
  conversationId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Conversation {
  id: string;
  organizationId: string;
  aiEmployeeId?: string;
  channel: ConversationChannel;
  customerName?: string;
  customerEmail?: string;
  customerPhone?: string;
  status: ConversationStatus;
  createdAt: string;
  updatedAt: string;
  resolvedAt?: string;
  archivedAt?: string;
  lastMessage?: ConversationMessage;
  unreadCount?: number;
}

export interface ConversationMessage {
  id: string;
  conversationId: string;
  organizationId: string;
  role: MessageRole;
  content: string;
  clientMessageId?: string;
  status: 'SENT' | 'DELIVERED' | 'FAILED';
  grounded: boolean;
  handoffRequired: boolean;
  sourceReferences?: Array<{ sourceId: string; title: string }>;
  aiEmployeeId?: string;
  createdAt: string;
}

export interface EmailConnection {
  id: string;
  organizationId: string;
  providerType: 'WEBHOOK' | 'SMTP_IMAP';
  inboundAddress: string;
  smtpHost?: string;
  smtpPort?: number;
  smtpUser?: string;
  imapHost?: string;
  imapPort?: number;
  imapUser?: string;
  webhookToken: string;
  isActive: boolean;
  lastSyncedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AuditLog {
  id: string;
  organizationId: string;
  userId?: string;
  action: AuditAction;
  entityType: string;
  entityId?: string;
  metadata?: Record<string, any>;
  ipAddress?: string;
  createdAt: string;
}

export interface AIUsageRecord {
  id: string;
  organizationId: string;
  aiEmployeeId?: string;
  conversationId?: string;
  provider: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  estimatedCostUsd: number;
  success: boolean;
  errorMessage?: string;
  createdAt: string;
}

// ------------------------------------------
// API Request & Response DTOs
// ------------------------------------------

export interface AuthResponse {
  user: User;
  token: string;
  organization?: Organization;
  membership?: OrganizationMembership;
}

export interface RegisterRequest {
  email: string;
  password: string;
  fullName: string;
  businessName?: string;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface OnboardingStepRequest {
  step: number;
  data: Record<string, any>;
}

export interface PublicChatSession {
  conversationId: string;
  sessionToken: string;
  organization: {
    name: string;
    slug: string;
    greeting: string;
    aiName: string;
  };
}

export interface SendChatMessageRequest {
  content: string;
  clientMessageId: string;
  customerName?: string;
  customerEmail?: string;
  customerPhone?: string;
}

export interface BookAppointmentRequest {
  serviceId?: string;
  serviceName: string;
  customerName: string;
  customerEmail: string;
  customerPhone?: string;
  startTime: string;
  endTime?: string;
  notes?: string;
  conversationId?: string;
}

export interface AvailableSlot {
  startTime: string; // ISO 8601
  endTime: string;   // ISO 8601
  available: boolean;
}

// ------------------------------------------
// Email Verification Interfaces
// ------------------------------------------

export interface EmailVerification {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: string;
  usedAt?: string;
  createdAt: string;
}

export interface VerifyEmailRequest {
  token: string;
}

export interface ResendVerificationRequest {
  email: string;
}

// ------------------------------------------
// Analytics Interfaces
// ------------------------------------------

export interface AnalyticsOverviewKPIs {
  totalConversations: number;
  conversationsToday: number;
  conversationsThisWeek: number;
  conversationsThisMonth: number;
  aiResponses: number;
  humanHandoffs: number;
  appointmentsRequested: number;
  appointmentsBooked: number;
  appointmentsCompleted: number;
  appointmentsCancelled: number;
  aiResolutionRate: number; // Percentage 0 - 100
  averageResponseTimeSeconds: number;
  unansweredOrFailedAiRequests: number;
  websiteConversations: number;
  emailConversations: number;
}

export interface AnalyticsTimeSeriesPoint {
  date: string;
  conversations: number;
  appointments: number;
  aiHandled: number;
  humanHandled: number;
  webConversations: number;
  emailConversations: number;
}

export interface ChannelBreakdown {
  channel: ConversationChannel;
  count: number;
  percentage: number;
}

export interface AppointmentStatusBreakdown {
  status: AppointmentStatus;
  count: number;
  percentage: number;
}

export interface AIUsageAnalytics {
  totalRequests: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  estimatedCostUsd: number;
  successfulRequests: number;
  failedRequests: number;
}

export interface AnalyticsResponse {
  period: string;
  startDate: string;
  endDate: string;
  kpis: AnalyticsOverviewKPIs;
  timeSeries: AnalyticsTimeSeriesPoint[];
  channelBreakdown: ChannelBreakdown[];
  appointmentStatusBreakdown: AppointmentStatusBreakdown[];
  aiUsage: AIUsageAnalytics;
  hasData: boolean;
}

// ------------------------------------------
// Website & Integration Interfaces
// ------------------------------------------

export enum IntegrationStatus {
  NOT_CONNECTED = 'NOT_CONNECTED',
  PENDING = 'PENDING',
  CONNECTED = 'CONNECTED',
  ERROR = 'ERROR',
  DISCONNECTED = 'DISCONNECTED',
}

export interface WebsiteConnectionConfig {
  orgSlug: string;
  orgName: string;
  status: IntegrationStatus;
  embedScriptSnippet: string;
  publicChatUrl: string;
  lastActivityAt?: string;
  isVerified: boolean;
}

export interface EmailIntegrationConfig {
  status: IntegrationStatus;
  connectedEmail?: string;
  inboundWebhookAddress: string;
  providerType: 'OAUTH' | 'WEBHOOK';
  isOAuthConfigured: boolean;
  lastSyncedAt?: string;
  errorMessage?: string;
}
