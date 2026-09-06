import {
  AuthResponse,
  LoginRequest,
  RegisterRequest,
  User,
  Organization,
  OrganizationMembership,
  AIEmployee,
  BusinessSettings,
  KnowledgeSource,
  Appointment,
  AvailableSlot,
  AvailabilityRule,
  Conversation,
  ConversationMessage,
  EmailConnection,
  Subscription,
  AnalyticsResponse,
  WebsiteConnectionConfig,
  EmailIntegrationConfig,
  GoogleCalendarConfig,
} from '@onceclic/shared';

const getApiBase = (): string => {
  const envUrl = (import.meta as any).env?.VITE_API_URL || (import.meta as any).env?.VITE_BACKEND_URL;
  if (envUrl) {
    const clean = envUrl.replace(/\/+$/, '');
    return clean.endsWith('/api') ? clean : `${clean}/api`;
  }

  // In production browser environments (onceclic.com / netlify), route directly to Railway backend API
  if (typeof window !== 'undefined' && window.location) {
    const host = window.location.hostname;
    if (host === 'onceclic.com' || host.endsWith('.onceclic.com') || host.endsWith('.netlify.app')) {
      return 'https://api.onceclic.com/api';
    }
  }

  return '/api';
};

const API_BASE = getApiBase();


class ApiClient {
  private getToken(): string | null {
    return localStorage.getItem('onceclic_token');
  }

  private getOrgId(): string | null {
    return localStorage.getItem('onceclic_org_id');
  }

  public setToken(token: string) {
    localStorage.setItem('onceclic_token', token);
  }

  public setOrgId(orgId: string) {
    localStorage.setItem('onceclic_org_id', orgId);
  }

  public clearAuth() {
    localStorage.removeItem('onceclic_token');
    localStorage.removeItem('onceclic_org_id');
  }

  private async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(options.headers as Record<string, string>),
    };

    const token = this.getToken();
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const orgId = this.getOrgId();
    if (orgId) {
      headers['x-organization-id'] = orgId;
    }

    const response = await fetch(`${API_BASE}${endpoint}`, {
      ...options,
      headers,
    });

    const contentType = response.headers.get('content-type') || '';
    let data: any;

    if (contentType.includes('application/json')) {
      try {
        data = await response.json();
      } catch {
        throw new Error(`Failed to parse JSON response from ${endpoint} (HTTP ${response.status})`);
      }
    } else {
      const text = await response.text();
      const preview = text.substring(0, 100).replace(/\s+/g, ' ');
      throw new Error(`API endpoint ${endpoint} returned unexpected response (${response.status}): ${preview}`);
    }

    if (!response.ok || !data.success) {
      const errorMsg = data.error || `Request failed with status ${response.status}`;
      const err = new Error(errorMsg);
      (err as any).status = response.status;
      (err as any).code = data.code;
      throw err;
    }

    return data.data;
  }

  // Auth
  async register(data: RegisterRequest): Promise<AuthResponse & { verificationToken?: string; emailVerificationRequired?: boolean }> {
    const res = await this.request<AuthResponse & { verificationToken?: string; emailVerificationRequired?: boolean }>('/auth/register', {
      method: 'POST',
      body: JSON.stringify(data),
    });
    if (res.token) this.setToken(res.token);
    if (res.organization?.id) this.setOrgId(res.organization.id);
    return res;
  }

  async login(data: LoginRequest): Promise<AuthResponse> {
    const res = await this.request<AuthResponse>('/auth/login', {
      method: 'POST',
      body: JSON.stringify(data),
    });
    if (res.token) this.setToken(res.token);
    if (res.organization?.id) this.setOrgId(res.organization.id);
    return res;
  }

  async verifyEmail(token: string): Promise<{ success: boolean; message: string; user?: User }> {
    return this.request('/auth/verify-email', {
      method: 'POST',
      body: JSON.stringify({ token }),
    });
  }

  async resendVerification(email: string): Promise<{ success: boolean; message: string; verificationToken?: string }> {
    return this.request('/auth/resend-verification', {
      method: 'POST',
      body: JSON.stringify({ email }),
    });
  }

  async getGoogleAuthUrl(returnUrl?: string): Promise<{ url: string; state: string }> {
    return this.request(`/auth/google/url${returnUrl ? `?returnUrl=${encodeURIComponent(returnUrl)}` : ''}`);
  }

  async exchangeGoogleAuth(code: string, state: string): Promise<any> {
    const res = await this.request<any>('/auth/google/exchange', {
      method: 'POST',
      body: JSON.stringify({ code, state }),
    });
    if (res?.auth?.token) this.setToken(res.auth.token);
    if (res?.auth?.organization?.id) this.setOrgId(res.auth.organization.id);
    return res;
  }

  async getProfile(): Promise<{
    user: User;
    organizations: Array<{ organization: Organization; membership: OrganizationMembership }>;
  }> {
    return this.request('/auth/me');
  }

  // Organization & Settings
  async getOrgCurrent(): Promise<{
    organization: Organization;
    settings: BusinessSettings;
    role: string;
  }> {
    return this.request('/orgs/current');
  }

  async updateOrgCurrent(data: any): Promise<{ success: boolean; message: string }> {
    return this.request('/orgs/current', {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async getMembers(): Promise<Array<{ id: string; role: string; userId: string; email: string; fullName: string }>> {
    return this.request('/orgs/members');
  }

  async addMember(data: { email: string; role: string }): Promise<any> {
    return this.request('/orgs/members', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  // AI Employee
  async getAIEmployee(): Promise<AIEmployee> {
    return this.request('/ai/employee');
  }

  async updateAIEmployee(data: Partial<AIEmployee>): Promise<{ success: boolean; message: string }> {
    return this.request('/ai/employee', {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async getAIHealth(): Promise<{ available: boolean; provider: string; model: string; error?: string }> {
    return this.request('/ai/health');
  }

  async getAIUsage(): Promise<{ records: any[]; summary: { totalTokens: number; totalCostUsd: number; totalRequests: number } }> {
    return this.request('/ai/usage');
  }

  // Knowledge Base
  async getKnowledgeSources(): Promise<KnowledgeSource[]> {
    return this.request('/knowledge/sources');
  }

  async addKnowledgeSource(data: { sourceType: string; title: string; rawContent: string }): Promise<KnowledgeSource> {
    return this.request('/knowledge/sources', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async deleteKnowledgeSource(id: string): Promise<any> {
    return this.request(`/knowledge/sources/${id}`, {
      method: 'DELETE',
    });
  }

  // Appointments
  async getAppointments(status?: string): Promise<Appointment[]> {
    const query = status ? `?status=${status}` : '';
    return this.request(`/appointments${query}`);
  }

  async getAppointmentSlots(date: string, duration?: number): Promise<AvailableSlot[]> {
    const query = `?date=${date}${duration ? `&duration=${duration}` : ''}`;
    return this.request(`/appointments/slots${query}`);
  }

  async bookAppointment(data: any): Promise<Appointment> {
    return this.request('/appointments', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updateAppointmentStatus(id: string, status: string): Promise<Appointment> {
    return this.request(`/appointments/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    });
  }

  async rescheduleAppointment(id: string, startTime: string, endTime?: string): Promise<Appointment> {
    return this.request(`/appointments/${id}/reschedule`, {
      method: 'PATCH',
      body: JSON.stringify({ startTime, endTime }),
    });
  }

  async cancelAppointment(id: string): Promise<Appointment> {
    return this.request(`/appointments/${id}/cancel`, {
      method: 'POST',
    });
  }

  async getAvailabilityRules(): Promise<AvailabilityRule[]> {
    return this.request('/appointments/rules');
  }

  async updateAvailabilityRules(rules: AvailabilityRule[]): Promise<any> {
    return this.request('/appointments/rules', {
      method: 'PUT',
      body: JSON.stringify({ rules }),
    });
  }

  // Conversations
  async getConversations(channel?: string, status?: string): Promise<Conversation[]> {
    const params = new URLSearchParams();
    if (channel) params.append('channel', channel);
    if (status) params.append('status', status);
    const query = params.toString() ? `?${params.toString()}` : '';
    return this.request(`/conversations${query}`);
  }

  async getConversationMessages(id: string): Promise<ConversationMessage[]> {
    return this.request(`/conversations/${id}/messages`);
  }

  async sendHumanReply(conversationId: string, content: string): Promise<ConversationMessage> {
    return this.request(`/conversations/${conversationId}/reply`, {
      method: 'POST',
      body: JSON.stringify({ content }),
    });
  }

  async updateConversationStatus(id: string, status: string): Promise<Conversation> {
    return this.request(`/conversations/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    });
  }

  // Email
  async getEmailConnection(): Promise<EmailConnection> {
    return this.request('/email/connection');
  }

  async updateEmailConnection(data: Partial<EmailConnection>): Promise<EmailConnection> {
    return this.request('/email/connection', {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  // Billing
  async getBillingStatus(): Promise<{
    subscription: Subscription | null;
    isPro: boolean;
    daysRemainingInTrial: number;
    billingConfigured: boolean;
  }> {
    return this.request('/billing/status');
  }

  async getBillingConfig(): Promise<{
    clientToken: string;
    priceId: string;
    environment: 'sandbox' | 'production';
    isConfigured: boolean;
    planName: string;
    monthlyPriceUsd: number;
    trialPeriodDays: number;
  }> {
    return this.request('/billing/config');
  }

  async createCustomerPortalSession(): Promise<{ url: string }> {
    return this.request('/billing/portal-session', {
      method: 'POST',
    });
  }

  async cancelSubscription(): Promise<{ success: boolean; status: string; scheduledChange?: string }> {
    return this.request('/billing/cancel', {
      method: 'POST',
    });
  }

  // Public Chat (Customer Facing)
  async getPublicOrg(slug: string): Promise<any> {
    return this.request(`/public/chat/org/${slug}`);
  }

  async startPublicChatSession(data: {
    orgSlug: string;
    customerName?: string;
    customerEmail?: string;
    customerPhone?: string;
    conversationId?: string;
  }): Promise<{ conversationId: string; sessionToken: string; organizationId: string; messages: ConversationMessage[] }> {
    return this.request('/public/chat/session', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async sendPublicChatMessage(data: {
    sessionToken: string;
    content: string;
    clientMessageId: string;
    customerName?: string;
    customerEmail?: string;
    customerPhone?: string;
  }): Promise<{ userMessage: ConversationMessage; aiMessage?: ConversationMessage }> {
    return this.request('/public/chat/message', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async getPublicAppointmentSlots(orgSlug: string, date: string, duration?: number): Promise<AvailableSlot[]> {
    const query = `?orgSlug=${orgSlug}&date=${date}${duration ? `&duration=${duration}` : ''}`;
    return this.request(`/public/chat/slots${query}`);
  }

  async bookPublicAppointment(data: any): Promise<Appointment> {
    return this.request('/public/chat/book', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  // Analytics
  async getAnalytics(params?: {
    period?: string;
    startDate?: string;
    endDate?: string;
    channel?: string;
  }): Promise<AnalyticsResponse> {
    const query = new URLSearchParams();
    if (params?.period) query.append('period', params.period);
    if (params?.startDate) query.append('startDate', params.startDate);
    if (params?.endDate) query.append('endDate', params.endDate);
    if (params?.channel) query.append('channel', params.channel);
    const qs = query.toString();
    return this.request(`/analytics${qs ? `?${qs}` : ''}`);
  }

  // Integrations (Website & Email)
  async getWebsiteIntegration(): Promise<WebsiteConnectionConfig> {
    return this.request('/integrations/website');
  }

  async verifyWebsiteIntegration(): Promise<WebsiteConnectionConfig> {
    return this.request('/integrations/website/verify', { method: 'POST' });
  }

  async disconnectWebsiteIntegration(): Promise<WebsiteConnectionConfig> {
    return this.request('/integrations/website/disconnect', { method: 'POST' });
  }

  async getEmailIntegration(): Promise<EmailIntegrationConfig> {
    return this.request('/integrations/email');
  }

  async getGoogleEmailAuthUrl(returnUrl?: string): Promise<{ url: string; state: string }> {
    return this.request(`/integrations/google-email/auth-url${returnUrl ? `?returnUrl=${encodeURIComponent(returnUrl)}` : ''}`);
  }

  async disconnectEmailIntegration(): Promise<EmailIntegrationConfig> {
    return this.request('/integrations/email/disconnect', { method: 'POST' });
  }

  // Google Calendar Integration
  async getGoogleCalendarIntegration(): Promise<GoogleCalendarConfig> {
    return this.request('/integrations/google-calendar');
  }

  async getGoogleCalendarAuthUrl(returnUrl?: string): Promise<{ url: string; state: string }> {
    return this.request(`/integrations/google-calendar/auth-url${returnUrl ? `?returnUrl=${encodeURIComponent(returnUrl)}` : ''}`);
  }

  async disconnectGoogleCalendarIntegration(): Promise<GoogleCalendarConfig> {
    return this.request('/integrations/google-calendar/disconnect', { method: 'POST' });
  }
}

export const api = new ApiClient();

