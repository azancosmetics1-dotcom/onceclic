import React, { useState, useEffect } from 'react';
import { api } from '../api/client';
import {
  WebsiteConnectionConfig,
  EmailIntegrationConfig,
  GoogleCalendarConfig,
  InstagramIntegrationConfig,
  FacebookIntegrationConfig,
  IntegrationStatus,
} from '@onceclic/shared';
import {
  Globe,
  Mail,
  Calendar,
  Instagram,
  Facebook,
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
  Smartphone,
  Monitor,
  X,
  Bot,
} from 'lucide-react';

export const IntegrationsPage: React.FC = () => {
  const [websiteConfig, setWebsiteConfig] = useState<WebsiteConnectionConfig | null>(null);
  const [emailConfig, setEmailConfig] = useState<EmailIntegrationConfig | null>(null);
  const [calendarConfig, setCalendarConfig] = useState<GoogleCalendarConfig | null>(null);
  const [instagramConfig, setInstagramConfig] = useState<InstagramIntegrationConfig | null>(null);
  const [facebookConfig, setFacebookConfig] = useState<FacebookIntegrationConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [verifyingWebsite, setVerifyingWebsite] = useState(false);
  const [showPreviewModal, setShowPreviewModal] = useState(false);
  const [previewViewport, setPreviewViewport] = useState<'desktop' | 'mobile'>('mobile');

  const [connectingCalendar, setConnectingCalendar] = useState(false);
  const [actionMessage, setActionMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const loadIntegrations = async () => {
    setLoading(true);
    try {
      const [wRes, eRes, cRes, igRes, fbRes] = await Promise.all([
        api.getWebsiteIntegration(),
        api.getEmailIntegration(),
        api.getGoogleCalendarIntegration(),
        api.getInstagramIntegration().catch(() => null),
        api.getFacebookIntegration().catch(() => null),
      ]);
      setWebsiteConfig(wRes);
      setEmailConfig(eRes);
      setCalendarConfig(cRes);
      if (igRes) setInstagramConfig(igRes);
      if (fbRes) setFacebookConfig(fbRes);
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
    } else if (params.get('email_connected') === 'true') {
      const connectedAddr = params.get('email') || '';
      setActionMessage({ type: 'success', text: `Gmail mailbox ${connectedAddr ? `(${connectedAddr}) ` : ''}connected and verified!` });
      window.history.replaceState({}, document.title, window.location.pathname);
    } else if (params.get('instagram_connected') === 'true') {
      const igUser = params.get('username') || '';
      setActionMessage({ type: 'success', text: `Instagram account ${igUser ? `(@${igUser}) ` : ''}connected and active!` });
      window.history.replaceState({}, document.title, window.location.pathname);
    } else if (params.get('facebook_connected') === 'true') {
      const fbPage = params.get('pageName') || params.get('username') || '';
      setActionMessage({ type: 'success', text: `Facebook Page ${fbPage ? `(${fbPage}) ` : ''}connected and active!` });
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

  const handleDisconnectEmail = async () => {
    if (!confirm('Are you sure you want to disconnect this business email?')) return;
    try {
      const updated = await api.disconnectEmailIntegration();
      setEmailConfig(updated);
      setActionMessage({ type: 'success', text: 'Gmail mailbox disconnected.' });
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

  const handleDisconnectInstagram = async () => {
    if (!confirm('Are you sure you want to disconnect Instagram? The AI receptionist will stop responding to Instagram DMs.')) return;
    try {
      const updated = await api.disconnectInstagramIntegration();
      setInstagramConfig(updated);
      setActionMessage({ type: 'success', text: 'Instagram account disconnected.' });
    } catch (err: any) {
      setActionMessage({ type: 'error', text: err.message || 'Failed to disconnect Instagram.' });
    }
  };

  const handleDisconnectFacebook = async () => {
    if (!confirm('Are you sure you want to disconnect Facebook? The AI receptionist will stop responding to Facebook Page messages.')) return;
    try {
      const updated = await api.disconnectFacebookIntegration();
      setFacebookConfig(updated);
      setActionMessage({ type: 'success', text: 'Facebook Page disconnected.' });
    } catch (err: any) {
      setActionMessage({ type: 'error', text: err.message || 'Failed to disconnect Facebook.' });
    }
  };

  return (
    <div className="space-y-6 max-w-6xl w-full min-w-0">
      {/* Header */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 sm:p-6 shadow-sm min-w-0">
        <h1 className="text-xl sm:text-2xl font-bold text-white tracking-tight flex items-center gap-2.5 flex-wrap">
          <Layers className="w-6 h-6 sm:w-7 sm:h-7 text-emerald-400 flex-shrink-0" />
          <span>Channel & Calendar Integrations</span>
        </h1>
        <p className="text-slate-400 text-xs sm:text-sm mt-1">
          Connect your website widget, business email, and Google Calendar to empower your AI Receptionist with 24/7 synchronization.
        </p>
      </div>

      {actionMessage && (
        <div
          className={`p-4 rounded-xl text-xs sm:text-sm flex items-start sm:items-center gap-2.5 break-words ${
            actionMessage.type === 'success'
              ? 'bg-emerald-950/70 border border-emerald-800 text-emerald-300'
              : 'bg-red-950/70 border border-red-800 text-red-300'
          }`}
        >
          {actionMessage.type === 'success' ? (
            <CheckCircle2 className="w-5 h-5 flex-shrink-0 text-emerald-400 mt-0.5 sm:mt-0" />
          ) : (
            <AlertTriangle className="w-5 h-5 flex-shrink-0 text-red-400 mt-0.5 sm:mt-0" />
          )}
          <span className="min-w-0 flex-1">{actionMessage.text}</span>
        </div>
      )}

      {/* 1. Google Calendar Integration Card */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 sm:p-6 shadow-sm space-y-6 min-w-0">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-5 border-b border-slate-800">
          <div className="flex items-start sm:items-center gap-3.5 min-w-0">
            <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400 flex-shrink-0">
              <Calendar className="w-5 h-5 sm:w-6 sm:h-6" />
            </div>
            <div className="min-w-0">
              <h2 className="text-base sm:text-lg font-bold text-white flex items-center gap-2 flex-wrap">
                <span>Google Calendar</span>
                <span
                  className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] sm:text-xs font-semibold ${
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
          <div className="bg-slate-950 p-4 sm:p-5 rounded-xl border border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-4 min-w-0">
            <div className="min-w-0">
              <span className="text-xs text-slate-400 block font-medium">Connected Calendar:</span>
              <span className="text-sm sm:text-base font-bold text-white mt-0.5 block truncate">{calendarConfig.calendarSummary || 'Primary Google Calendar'}</span>
              <span className="text-xs text-emerald-400 mt-1 block">● 2-Way Sync Active (Busy Free Availability + Appointment Events)</span>
            </div>
            <button
              onClick={handleDisconnectGoogleCalendar}
              className="inline-flex items-center justify-center gap-1.5 bg-red-950/60 hover:bg-red-900/80 text-red-300 border border-red-800/80 px-4 py-2.5 rounded-lg text-xs font-medium transition w-full sm:w-auto"
            >
              <Power className="w-3.5 h-3.5" />
              Disconnect Calendar
            </button>
          </div>
        ) : (
          <div className="bg-slate-950 p-4 sm:p-5 rounded-xl border border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-4 min-w-0">
            <div className="min-w-0">
              <span className="text-sm font-semibold text-white block">Sync Bookings with Google Calendar</span>
              <span className="text-xs text-slate-400 mt-1 block">
                Connect your Google account with 1 click so appointments booked by your AI receptionist appear in your calendar instantly without requiring Google Cloud Console setup.
              </span>
            </div>
            <button
              onClick={handleConnectGoogleCalendar}
              disabled={connectingCalendar}
              className="inline-flex items-center justify-center gap-2 bg-gradient-to-r from-amber-600 to-orange-500 hover:from-amber-500 hover:to-orange-400 text-white font-medium px-5 py-2.5 rounded-lg text-xs sm:text-sm transition disabled:opacity-50 w-full sm:w-auto flex-shrink-0"
            >
              {connectingCalendar ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Calendar className="w-4 h-4" />}
              Connect Google Calendar
            </button>
          </div>
        )}
      </div>

      {/* 2. Website Connection Card */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 sm:p-6 shadow-sm space-y-6 min-w-0">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-5 border-b border-slate-800">
          <div className="flex items-start sm:items-center gap-3.5 min-w-0">
            <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-blue-400 flex-shrink-0">
              <Globe className="w-5 h-5 sm:w-6 sm:h-6" />
            </div>
            <div className="min-w-0">
              <h2 className="text-base sm:text-lg font-bold text-white flex items-center gap-2 flex-wrap">
                <span>Website Chat Widget</span>
                <span
                  className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] sm:text-xs font-semibold ${
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

          <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
            <button
              onClick={() => setShowPreviewModal(true)}
              className="inline-flex items-center justify-center gap-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 px-3.5 py-2 rounded-lg text-xs font-medium border border-slate-700 transition flex-1 sm:flex-initial"
            >
              <ExternalLink className="w-3.5 h-3.5 text-emerald-400" />
              Preview Hosted Chat
            </button>
            {websiteConfig?.status === IntegrationStatus.CONNECTED ? (
              <button
                onClick={handleDisconnectWebsite}
                className="inline-flex items-center justify-center gap-1.5 bg-red-950/60 hover:bg-red-900/80 text-red-300 border border-red-800/80 px-3.5 py-2 rounded-lg text-xs font-medium transition flex-1 sm:flex-initial"
              >
                <Power className="w-3.5 h-3.5" />
                Disable Widget
              </button>
            ) : (
              <button
                onClick={handleVerifyWebsite}
                disabled={verifyingWebsite}
                className="inline-flex items-center justify-center gap-1.5 bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2 rounded-lg text-xs font-medium transition disabled:opacity-50 flex-1 sm:flex-initial"
              >
                {verifyingWebsite ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <ShieldCheck className="w-3.5 h-3.5" />}
                Verify & Activate
              </button>
            )}
          </div>
        </div>

        {/* Embed Script Snippet */}
        <div className="space-y-2 min-w-0">
          <div className="flex items-center justify-between gap-2 flex-wrap">
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
          <div className="bg-slate-950 border border-slate-800 rounded-xl p-3 sm:p-4 font-mono text-xs text-slate-300 overflow-x-auto max-w-full min-w-0">
            <pre className="whitespace-pre font-mono text-[11px] sm:text-xs leading-relaxed">{websiteConfig?.embedScriptSnippet}</pre>
          </div>
        </div>
      </div>

      {/* 3. Email Channel Connection Card */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 sm:p-6 shadow-sm space-y-6 min-w-0">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-5 border-b border-slate-800">
          <div className="flex items-start sm:items-center gap-3.5 min-w-0">
            <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-center text-purple-400 flex-shrink-0">
              <Mail className="w-5 h-5 sm:w-6 sm:h-6" />
            </div>
            <div className="min-w-0">
              <h2 className="text-base sm:text-lg font-bold text-white flex items-center gap-2 flex-wrap">
                <span>Business Email Channel</span>
                <span className="px-2.5 py-0.5 rounded text-[10px] font-bold uppercase bg-amber-500/10 text-amber-400 border border-amber-500/20 select-none cursor-default pointer-events-none">
                  Coming Soon
                </span>
                {emailConfig?.status === IntegrationStatus.CONNECTED && (
                  <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] sm:text-xs font-semibold bg-emerald-950 text-emerald-400 border border-emerald-800">
                    ● CONNECTED
                  </span>
                )}
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Authorize your Gmail mailbox so ONCEClic can read inbound customer emails and send AI-drafted replies.
              </p>
            </div>
          </div>
        </div>

        {emailConfig?.status === IntegrationStatus.CONNECTED ? (
          <div className="bg-slate-950 p-4 sm:p-5 rounded-xl border border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-4 min-w-0">
            <div className="min-w-0">
              <span className="text-xs text-slate-400 block font-medium">Connected Gmail Mailbox:</span>
              <span className="text-sm sm:text-base font-bold text-white mt-0.5 block truncate">{emailConfig.connectedEmail}</span>
              <span className="text-xs text-emerald-400 mt-1 block">● AI receptionist monitoring inbound inquiries via Gmail API</span>
            </div>
            <button
              onClick={handleDisconnectEmail}
              className="inline-flex items-center justify-center gap-1.5 bg-red-950/60 hover:bg-red-900/80 text-red-300 border border-red-800/80 px-4 py-2.5 rounded-lg text-xs font-medium transition w-full sm:w-auto"
            >
              <Power className="w-3.5 h-3.5" />
              Disconnect Email
            </button>
          </div>
        ) : (
          <div className="bg-slate-950 p-4 sm:p-5 rounded-xl border border-slate-800 space-y-2 select-none">
            <div className="flex items-center gap-2">
              <span className="block text-xs font-bold uppercase tracking-wider text-slate-300">
                Inbound &amp; Outbound Email Receptionist
              </span>
              <span className="px-2 py-0.5 rounded text-[10px] font-semibold uppercase bg-slate-800 text-slate-400 border border-slate-700">
                Coming Soon
              </span>
            </div>
            <p className="text-xs text-slate-400 leading-relaxed">
              Automated AI business email answering and drafting is currently in development and will be available in an upcoming update. No connection action is required at this time.
            </p>
          </div>
        )}
      </div>

      {/* 4. Instagram Channel Connection Card */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 sm:p-6 shadow-sm space-y-6 min-w-0">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-5 border-b border-slate-800">
          <div className="flex items-start sm:items-center gap-3.5 min-w-0">
            <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-xl bg-pink-500/10 border border-pink-500/20 flex items-center justify-center text-pink-400 flex-shrink-0">
              <Instagram className="w-5 h-5 sm:w-6 sm:h-6" />
            </div>
            <div className="min-w-0">
              <h2 className="text-base sm:text-lg font-bold text-white flex items-center gap-2 flex-wrap">
                <span>Instagram AI Receptionist</span>
                <span className="px-2.5 py-0.5 rounded text-[10px] font-bold uppercase bg-amber-500/10 text-amber-400 border border-amber-500/20 select-none cursor-default pointer-events-none">
                  Coming Soon
                </span>
                {instagramConfig?.status === IntegrationStatus.CONNECTED && (
                  <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] sm:text-xs font-semibold bg-emerald-950 text-emerald-400 border border-emerald-800">
                    ● CONNECTED
                  </span>
                )}
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                AI receptionist responds 24/7 to customer direct messages (DMs) on your Instagram Business account.
              </p>
            </div>
          </div>
        </div>

        {instagramConfig?.status === IntegrationStatus.CONNECTED ? (
          <div className="bg-slate-950 p-4 sm:p-5 rounded-xl border border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-4 min-w-0">
            <div className="min-w-0">
              <span className="text-xs text-slate-400 block font-medium">Connected Instagram Account:</span>
              <span className="text-sm sm:text-base font-bold text-white mt-0.5 block truncate">
                @{instagramConfig.username || 'Connected Instagram Business'}
              </span>
              <span className="text-xs text-emerald-400 mt-1 block">
                ● AI receptionist actively monitoring and responding to incoming Instagram customer DMs
              </span>
            </div>
            <button
              onClick={handleDisconnectInstagram}
              className="inline-flex items-center justify-center gap-1.5 bg-red-950/60 hover:bg-red-900/80 text-red-300 border border-red-800/80 px-4 py-2.5 rounded-lg text-xs font-medium transition w-full sm:w-auto"
            >
              <Power className="w-3.5 h-3.5" />
              Disconnect Instagram
            </button>
          </div>
        ) : (
          <div className="bg-slate-950 p-4 sm:p-5 rounded-xl border border-slate-800 space-y-2 select-none">
            <div className="flex items-center gap-2">
              <span className="block text-xs font-bold uppercase tracking-wider text-slate-300">
                Instagram Direct Messages (DMs)
              </span>
              <span className="px-2 py-0.5 rounded text-[10px] font-semibold uppercase bg-slate-800 text-slate-400 border border-slate-700">
                Coming Soon
              </span>
            </div>
            <p className="text-xs text-slate-400 leading-relaxed">
              24/7 AI response automation for Instagram direct messages (DMs) is currently in development and will be available in an upcoming release.
            </p>
          </div>
        )}
      </div>

      {/* 5. Facebook Page Connection Card */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 sm:p-6 shadow-sm space-y-6 min-w-0">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-5 border-b border-slate-800">
          <div className="flex items-start sm:items-center gap-3.5 min-w-0">
            <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-blue-400 flex-shrink-0">
              <Facebook className="w-5 h-5 sm:w-6 sm:h-6" />
            </div>
            <div className="min-w-0">
              <h2 className="text-base sm:text-lg font-bold text-white flex items-center gap-2 flex-wrap">
                <span>Facebook Page AI Receptionist</span>
                <span className="px-2.5 py-0.5 rounded text-[10px] font-bold uppercase bg-amber-500/10 text-amber-400 border border-amber-500/20 select-none cursor-default pointer-events-none">
                  Coming Soon
                </span>
                {facebookConfig?.status === IntegrationStatus.CONNECTED && (
                  <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] sm:text-xs font-semibold bg-emerald-950 text-emerald-400 border border-emerald-800">
                    ● CONNECTED
                  </span>
                )}
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                AI receptionist responds 24/7 to customer messages on your authorized Facebook Business Page.
              </p>
            </div>
          </div>
        </div>

        {facebookConfig?.status === IntegrationStatus.CONNECTED ? (
          <div className="bg-slate-950 p-4 sm:p-5 rounded-xl border border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-4 min-w-0">
            <div className="min-w-0">
              <span className="text-xs text-slate-400 block font-medium">Connected Facebook Page:</span>
              <span className="text-sm sm:text-base font-bold text-white mt-0.5 block truncate">
                {facebookConfig.pageName || 'Connected Facebook Page'}
              </span>
              <span className="text-xs text-emerald-400 mt-1 block">
                ● AI receptionist actively monitoring and responding to incoming Facebook Page customer messages
              </span>
            </div>
            <button
              onClick={handleDisconnectFacebook}
              className="inline-flex items-center justify-center gap-1.5 bg-red-950/60 hover:bg-red-900/80 text-red-300 border border-red-800/80 px-4 py-2.5 rounded-lg text-xs font-medium transition w-full sm:w-auto"
            >
              <Power className="w-3.5 h-3.5" />
              Disconnect Facebook
            </button>
          </div>
        ) : (
          <div className="bg-slate-950 p-4 sm:p-5 rounded-xl border border-slate-800 space-y-2 select-none">
            <div className="flex items-center gap-2">
              <span className="block text-xs font-bold uppercase tracking-wider text-slate-300">
                Facebook Messenger Receptionist
              </span>
              <span className="px-2 py-0.5 rounded text-[10px] font-semibold uppercase bg-slate-800 text-slate-400 border border-slate-700">
                Coming Soon
              </span>
            </div>
            <p className="text-xs text-slate-400 leading-relaxed">
              24/7 AI inquiry answering and booking on Facebook Messenger is currently in development and will be available in an upcoming release.
            </p>
          </div>
        )}
      </div>

      {/* Interactive Hosted Chat Preview Modal */}
      {showPreviewModal && websiteConfig && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-slate-950/80 backdrop-blur-sm animate-in fade-in duration-200">
          <div
            className={`relative flex flex-col bg-slate-900 border border-slate-800 rounded-2xl sm:rounded-3xl shadow-2xl overflow-hidden transition-all duration-300 ${
              previewViewport === 'mobile'
                ? 'w-full max-w-[420px] h-[88vh] max-h-[740px]'
                : 'w-full max-w-4xl h-[88vh] max-h-[820px]'
            }`}
          >
            {/* Modal Header */}
            <div className="px-4 py-3 sm:px-5 sm:py-3.5 border-b border-slate-800 bg-slate-950/90 flex items-center justify-between gap-3 shrink-0">
              <div className="flex items-center space-x-2.5 min-w-0">
                <div className="w-8 h-8 rounded-xl bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center text-emerald-400 shrink-0">
                  <Bot className="w-4 h-4" />
                </div>
                <div className="min-w-0">
                  <h3 className="text-xs sm:text-sm font-bold text-white truncate flex items-center space-x-1.5">
                    <span>{websiteConfig.orgName || 'Hosted Chat Preview'}</span>
                    <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                  </h3>
                  <p className="text-[10px] text-slate-400 truncate">Live AI Receptionist Preview</p>
                </div>
              </div>

              {/* Viewport Toggles & Actions */}
              <div className="flex items-center space-x-2 shrink-0">
                <div className="hidden sm:flex items-center bg-slate-800/80 border border-slate-700/60 rounded-lg p-0.5">
                  <button
                    onClick={() => setPreviewViewport('mobile')}
                    title="Mobile View"
                    className={`p-1.5 rounded-md text-xs font-medium transition ${
                      previewViewport === 'mobile'
                        ? 'bg-emerald-500 text-slate-950 font-bold shadow-sm'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    <Smartphone className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => setPreviewViewport('desktop')}
                    title="Desktop View"
                    className={`p-1.5 rounded-md text-xs font-medium transition ${
                      previewViewport === 'desktop'
                        ? 'bg-emerald-500 text-slate-950 font-bold shadow-sm'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    <Monitor className="w-3.5 h-3.5" />
                  </button>
                </div>

                <a
                  href={websiteConfig.publicChatUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  title="Open in new window"
                  className="p-1.5 rounded-lg bg-slate-800 text-slate-300 hover:text-emerald-400 hover:bg-slate-700 border border-slate-700 transition"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>

                <button
                  onClick={() => setShowPreviewModal(false)}
                  title="Close preview"
                  className="p-1.5 rounded-lg bg-slate-800 text-slate-300 hover:text-rose-400 hover:bg-slate-700 border border-slate-700 transition"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Modal Body / Live Embedded Frame */}
            <div className="flex-1 bg-slate-950 p-2 sm:p-3 overflow-hidden flex items-center justify-center min-w-0">
              <iframe
                src={`/chat/${websiteConfig.orgSlug}?embed=true`}
                title="Hosted Chat Preview"
                className="w-full h-full border-0 rounded-xl sm:rounded-2xl shadow-inner bg-slate-900"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

