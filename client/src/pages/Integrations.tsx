import React, { useState, useEffect } from 'react';
import { api } from '../api/client';
import {
  WebsiteConnectionConfig,
  EmailIntegrationConfig,
  GoogleCalendarConfig,
  IntegrationStatus,
} from '@onceclic/shared';
import {
  Globe,
  Mail,
  Calendar,
  Copy,
  Check,
  ExternalLink,
  ShieldCheck,
  AlertTriangle,
  RefreshCw,
  Power,
  Sparkles,
  Layers,
  CheckCircle2,
  XCircle,
  HelpCircle,
} from 'lucide-react';

export const IntegrationsPage: React.FC = () => {
  const [websiteConfig, setWebsiteConfig] = useState<WebsiteConnectionConfig | null>(null);
  const [emailConfig, setEmailConfig] = useState<EmailIntegrationConfig | null>(null);
  const [calendarConfig, setCalendarConfig] = useState<GoogleCalendarConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [verifyingWebsite, setVerifyingWebsite] = useState(false);
  const [emailInput, setEmailInput] = useState('');
  const [connectingEmail, setConnectingEmail] = useState(false);
  const [connectingCalendar, setConnectingCalendar] = useState(false);
  const [actionMessage, setActionMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const loadIntegrations = async () => {
    setLoading(true);
    try {
      const [wRes, eRes, cRes] = await Promise.all([
        api.getWebsiteIntegration(),
        api.getEmailIntegration(),
        api.getGoogleCalendarIntegration(),
      ]);
      setWebsiteConfig(wRes);
      setEmailConfig(eRes);
      setCalendarConfig(cRes);
      if (eRes.connectedEmail) {
        setEmailInput(eRes.connectedEmail);
      }
    } catch (err: any) {
      setActionMessage({ type: 'error', text: err.message || 'Failed to load integration configurations.' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadIntegrations();

    // Check query params for OAuth return
    const params = new URLSearchParams(window.location.search);
    if (params.get('calendar_connected') === 'true') {
      setActionMessage({ type: 'success', text: 'Google Calendar successfully connected and synced!' });
      window.history.replaceState({}, document.title, window.location.pathname);
    } else if (params.get('error')) {
      setActionMessage({ type: 'error', text: `Integration error: ${params.get('error')}` });
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  }, []);

  const handleCopySnippet = () => {
    if (!websiteConfig?.embedScriptSnippet) return;
    navigator.clipboard.writeText(websiteConfig.embedScriptSnippet);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  const handleVerifyWebsite = async () => {
    setVerifyingWebsite(true);
    setActionMessage(null);
    try {
      const updated = await api.verifyWebsiteIntegration();
      setWebsiteConfig(updated);
      setActionMessage({ type: 'success', text: 'Website integration verified and active!' });
    } catch (err: any) {
      setActionMessage({ type: 'error', text: err.message || 'Website verification failed.' });
    } finally {
      setVerifyingWebsite(false);
    }
  };

  const handleDisconnectWebsite = async () => {
    if (!confirm('Are you sure you want to disconnect the website chat widget?')) return;
    try {
      const updated = await api.disconnectWebsiteIntegration();
      setWebsiteConfig(updated);
      setActionMessage({ type: 'success', text: 'Website widget disconnected.' });
    } catch (err: any) {
      setActionMessage({ type: 'error', text: err.message || 'Failed to disconnect website.' });
    }
  };

  const handleConnectEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!emailInput) return;

    setConnectingEmail(true);
    setActionMessage(null);
    try {
      const updated = await api.connectEmailIntegration(emailInput);
      setEmailConfig(updated);
      setActionMessage({ type: 'success', text: `Business email (${emailInput}) connected successfully!` });
    } catch (err: any) {
      setActionMessage({ type: 'error', text: err.message || 'Failed to connect email.' });
    } finally {
      setConnectingEmail(false);
    }
  };

  const handleDisconnectEmail = async () => {
    if (!confirm('Are you sure you want to disconnect this business email?')) return;
    try {
      const updated = await api.disconnectEmailIntegration();
      setEmailConfig(updated);
      setEmailInput('');
      setActionMessage({ type: 'success', text: 'Business email disconnected.' });
    } catch (err: any) {
      setActionMessage({ type: 'error', text: err.message || 'Failed to disconnect email.' });
    }
  };

  const handleConnectGoogleCalendar = async () => {
    setConnectingCalendar(true);
    setActionMessage(null);
    try {
      const { url } = await api.getGoogleCalendarAuthUrl('/app/integrations');
      window.location.href = url;
    } catch (err: any) {
      setActionMessage({ type: 'error', text: err.message || 'Failed to initiate Google Calendar connection.' });
      setConnectingCalendar(false);
    }
  };

  const handleDisconnectGoogleCalendar = async () => {
    if (!confirm('Are you sure you want to disconnect Google Calendar? Appointments will no longer synchronize.')) return;
    try {
      const updated = await api.disconnectGoogleCalendarIntegration();
      setCalendarConfig(updated);
      setActionMessage({ type: 'success', text: 'Google Calendar disconnected.' });
    } catch (err: any) {
      setActionMessage({ type: 'error', text: err.message || 'Failed to disconnect Google Calendar.' });
    }
  };

  return (
    <div className="space-y-6 max-w-6xl">
      {/* Header */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-sm">
        <h1 className="text-2xl font-bold text-white tracking-tight flex items-center gap-2.5">
          <Layers className="w-7 h-7 text-emerald-400" />
          Channel & Calendar Integrations
        </h1>
        <p className="text-slate-400 text-sm mt-1">
          Connect your website widget, business email, and Google Calendar to empower your AI Receptionist with 24/7 synchronization.
        </p>
      </div>

      {actionMessage && (
        <div
          className={`p-4 rounded-xl text-sm flex items-center gap-2.5 ${
            actionMessage.type === 'success'
              ? 'bg-emerald-950/70 border border-emerald-800 text-emerald-300'
              : 'bg-red-950/70 border border-red-800 text-red-300'
          }`}
        >
          {actionMessage.type === 'success' ? (
            <CheckCircle2 className="w-5 h-5 flex-shrink-0 text-emerald-400" />
          ) : (
            <AlertTriangle className="w-5 h-5 flex-shrink-0 text-red-400" />
          )}
          {actionMessage.text}
        </div>
      )}

      {/* 1. Google Calendar Integration Card */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-sm space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-5 border-b border-slate-800">
          <div className="flex items-center gap-3.5">
            <div className="w-12 h-12 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400">
              <Calendar className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                Google Calendar
                <span
                  className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                    calendarConfig?.status === IntegrationStatus.CONNECTED
                      ? 'bg-emerald-950 text-emerald-400 border border-emerald-800'
                      : calendarConfig?.status === IntegrationStatus.DISCONNECTED
                      ? 'bg-red-950 text-red-400 border border-red-800'
                      : 'bg-slate-800 text-slate-400 border border-slate-700'
                  }`}
                >
                  {calendarConfig?.status === IntegrationStatus.CONNECTED && '● CONNECTED'}
                  {calendarConfig?.status === IntegrationStatus.DISCONNECTED && '● DISCONNECTED'}
                  {calendarConfig?.status === IntegrationStatus.NOT_CONNECTED && '○ NOT CONNECTED'}
                </span>
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Automatically block busy periods and synchronize confirmed appointments directly to your Google Calendar.
              </p>
            </div>
          </div>
        </div>

        {calendarConfig?.status === IntegrationStatus.CONNECTED ? (
          <div className="bg-slate-950 p-5 rounded-xl border border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <span className="text-xs text-slate-400 block font-medium">Connected Calendar:</span>
              <span className="text-base font-bold text-white mt-0.5 block">{calendarConfig.calendarSummary || 'Primary Google Calendar'}</span>
              <span className="text-xs text-emerald-400 mt-1 block">● 2-Way Sync Active (Busy Free Availability + Appointment Events)</span>
            </div>
            <button
              onClick={handleDisconnectGoogleCalendar}
              className="inline-flex items-center gap-1.5 bg-red-950/60 hover:bg-red-900/80 text-red-300 border border-red-800/80 px-4 py-2 rounded-lg text-xs font-medium transition"
            >
              <Power className="w-3.5 h-3.5" />
              Disconnect Calendar
            </button>
          </div>
        ) : (
          <div className="bg-slate-950 p-5 rounded-xl border border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <span className="text-sm font-semibold text-white block">Sync Bookings with Google Calendar</span>
              <span className="text-xs text-slate-400 mt-1 block">
                Connect your business Google account so appointments booked by your AI receptionist appear in your calendar instantly.
              </span>
            </div>
            <button
              onClick={handleConnectGoogleCalendar}
              disabled={connectingCalendar}
              className="inline-flex items-center justify-center gap-2 bg-gradient-to-r from-amber-600 to-orange-500 hover:from-amber-500 hover:to-orange-400 text-white font-medium px-5 py-2.5 rounded-lg text-sm transition disabled:opacity-50 flex-shrink-0"
            >
              {connectingCalendar ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Calendar className="w-4 h-4" />}
              Connect with Google Calendar
            </button>
          </div>
        )}
      </div>

      {/* 2. Website Connection Card */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-sm space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-5 border-b border-slate-800">
          <div className="flex items-center gap-3.5">
            <div className="w-12 h-12 rounded-xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-blue-400">
              <Globe className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                Website Chat Widget
                <span
                  className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                    websiteConfig?.status === IntegrationStatus.CONNECTED
                      ? 'bg-emerald-950 text-emerald-400 border border-emerald-800'
                      : websiteConfig?.status === IntegrationStatus.DISCONNECTED
                      ? 'bg-red-950 text-red-400 border border-red-800'
                      : 'bg-slate-800 text-slate-400 border border-slate-700'
                  }`}
                >
                  {websiteConfig?.status === IntegrationStatus.CONNECTED && '● ACTIVE'}
                  {websiteConfig?.status === IntegrationStatus.DISCONNECTED && '● DISABLED'}
                  {websiteConfig?.status === IntegrationStatus.NOT_CONNECTED && '○ READY'}
                </span>
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Embed your AI receptionist on your website with a single copy-paste script.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <a
              href={websiteConfig?.publicChatUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 px-3.5 py-2 rounded-lg text-xs font-medium border border-slate-700 transition"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              Preview Hosted Chat
            </a>
            {websiteConfig?.status === IntegrationStatus.CONNECTED ? (
              <button
                onClick={handleDisconnectWebsite}
                className="inline-flex items-center gap-1.5 bg-red-950/60 hover:bg-red-900/80 text-red-300 border border-red-800/80 px-3.5 py-2 rounded-lg text-xs font-medium transition"
              >
                <Power className="w-3.5 h-3.5" />
                Disable Widget
              </button>
            ) : (
              <button
                onClick={handleVerifyWebsite}
                disabled={verifyingWebsite}
                className="inline-flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2 rounded-lg text-xs font-medium transition disabled:opacity-50"
              >
                {verifyingWebsite ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <ShieldCheck className="w-3.5 h-3.5" />}
                Verify & Activate
              </button>
            )}
          </div>
        </div>

        {/* Embed Script Snippet */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-xs font-bold uppercase tracking-wider text-slate-300">
              Embed Script Snippet (Paste before &lt;/body&gt;)
            </label>
            <button
              onClick={handleCopySnippet}
              className="inline-flex items-center gap-1 text-xs text-emerald-400 hover:text-emerald-300 transition"
            >
              {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              {copied ? 'Copied to clipboard!' : 'Copy Code'}
            </button>
          </div>
          <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 font-mono text-xs text-slate-300 overflow-x-auto">
            <pre>{websiteConfig?.embedScriptSnippet}</pre>
          </div>
        </div>
      </div>

      {/* 3. Email Channel Connection Card */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-sm space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-5 border-b border-slate-800">
          <div className="flex items-center gap-3.5">
            <div className="w-12 h-12 rounded-xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-center text-purple-400">
              <Mail className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                Business Email Channel
                <span
                  className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                    emailConfig?.status === IntegrationStatus.CONNECTED
                      ? 'bg-emerald-950 text-emerald-400 border border-emerald-800'
                      : emailConfig?.status === IntegrationStatus.DISCONNECTED
                      ? 'bg-red-950 text-red-400 border border-red-800'
                      : 'bg-slate-800 text-slate-400 border border-slate-700'
                  }`}
                >
                  {emailConfig?.status === IntegrationStatus.CONNECTED && '● CONNECTED'}
                  {emailConfig?.status === IntegrationStatus.DISCONNECTED && '● DISCONNECTED'}
                  {emailConfig?.status === IntegrationStatus.NOT_CONNECTED && '○ NOT CONNECTED'}
                </span>
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Connect your business email address so ONCEClic can draft and process inbound customer inquiries.
              </p>
            </div>
          </div>
        </div>

        {emailConfig?.status === IntegrationStatus.CONNECTED ? (
          <div className="bg-slate-950 p-5 rounded-xl border border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <span className="text-xs text-slate-400 block font-medium">Connected Business Email:</span>
              <span className="text-base font-bold text-white mt-0.5 block">{emailConfig.connectedEmail}</span>
              <span className="text-xs text-emerald-400 mt-1 block">● AI receptionist monitoring inbound inquiries</span>
            </div>
            <button
              onClick={handleDisconnectEmail}
              className="inline-flex items-center gap-1.5 bg-red-950/60 hover:bg-red-900/80 text-red-300 border border-red-800/80 px-4 py-2 rounded-lg text-xs font-medium transition"
            >
              <Power className="w-3.5 h-3.5" />
              Disconnect Email
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            <form onSubmit={handleConnectEmail} className="bg-slate-950 p-5 rounded-xl border border-slate-800 space-y-4">
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-300 mb-1.5">
                  Connect Business Email
                </label>
                <p className="text-xs text-slate-400 mb-3">
                  Enter your business contact address (e.g. info@yourclinic.com) to enable AI email drafting and scheduling:
                </p>
                <div className="flex flex-col sm:flex-row items-center gap-3">
                  <input
                    type="email"
                    required
                    value={emailInput}
                    onChange={(e) => setEmailInput(e.target.value)}
                    placeholder="clinic@example.com"
                    className="w-full sm:w-80 bg-slate-900 border border-slate-700 text-white rounded-lg px-3.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
                  />
                  <button
                    type="submit"
                    disabled={connectingEmail || !emailInput}
                    className="w-full sm:w-auto inline-flex items-center justify-center gap-2 bg-gradient-to-r from-purple-600 to-indigo-500 hover:from-purple-500 hover:to-indigo-400 text-white font-medium px-5 py-2 rounded-lg text-sm transition disabled:opacity-50"
                  >
                    {connectingEmail ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Mail className="w-4 h-4" />}
                    Connect Email
                  </button>
                </div>
              </div>
            </form>
          </div>
        )}
      </div>
    </div>
  );
};
