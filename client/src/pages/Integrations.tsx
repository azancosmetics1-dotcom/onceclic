import React, { useState, useEffect } from 'react';
import { api } from '../api/client';
import { WebsiteConnectionConfig, EmailIntegrationConfig, IntegrationStatus } from '@onceclic/shared';
import {
  Globe,
  Mail,
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
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [verifyingWebsite, setVerifyingWebsite] = useState(false);
  const [emailInput, setEmailInput] = useState('');
  const [connectingEmail, setConnectingEmail] = useState(false);
  const [actionMessage, setActionMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const loadIntegrations = async () => {
    setLoading(true);
    try {
      const [wRes, eRes] = await Promise.all([
        api.getWebsiteIntegration(),
        api.getEmailIntegration(),
      ]);
      setWebsiteConfig(wRes);
      setEmailConfig(eRes);
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

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-sm">
        <h1 className="text-2xl font-bold text-white tracking-tight flex items-center gap-2.5">
          <Layers className="w-7 h-7 text-emerald-400" />
          Channel Integrations
        </h1>
        <p className="text-slate-400 text-sm mt-1">
          Connect your business website and email so your AI Receptionist answers customers 24/7.
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

      {/* 1. Website Connection Card */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-sm space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-5 border-b border-slate-800">
          <div className="flex items-center gap-3.5">
            <div className="w-12 h-12 rounded-xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-blue-400">
              <Globe className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                Website Chat
                <span
                  className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                    websiteConfig?.status === IntegrationStatus.CONNECTED
                      ? 'bg-emerald-950 text-emerald-400 border border-emerald-800'
                      : websiteConfig?.status === IntegrationStatus.DISCONNECTED
                      ? 'bg-red-950 text-red-400 border border-red-800'
                      : 'bg-slate-800 text-slate-400 border border-slate-700'
                  }`}
                >
                  {websiteConfig?.status === IntegrationStatus.CONNECTED && '● CONNECTED'}
                  {websiteConfig?.status === IntegrationStatus.DISCONNECTED && '● DISCONNECTED'}
                  {websiteConfig?.status === IntegrationStatus.NOT_CONNECTED && '○ NOT CONNECTED'}
                </span>
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Add ONCEClic to your website so visitors can chat with your AI Receptionist and request appointments.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <a
              href={websiteConfig?.publicChatUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 bg-slate-800 hover:bg-slate-750 text-slate-200 hover:text-white px-3.5 py-2 rounded-lg text-xs font-medium border border-slate-700 transition"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              Test Chat Window
            </a>

            {websiteConfig?.status === IntegrationStatus.CONNECTED ? (
              <button
                onClick={handleDisconnectWebsite}
                className="inline-flex items-center gap-1.5 bg-red-950/60 hover:bg-red-900/80 text-red-300 border border-red-800/80 px-3.5 py-2 rounded-lg text-xs font-medium transition"
              >
                <Power className="w-3.5 h-3.5" />
                Disconnect
              </button>
            ) : (
              <button
                onClick={handleVerifyWebsite}
                disabled={verifyingWebsite}
                className="inline-flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-500 text-white px-3.5 py-2 rounded-lg text-xs font-medium transition disabled:opacity-50"
              >
                {verifyingWebsite ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <ShieldCheck className="w-3.5 h-3.5" />}
                Verify & Connect
              </button>
            )}
          </div>
        </div>

        {/* Options Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Option A: One-Click Configuration */}
          <div className="bg-slate-950 p-5 rounded-xl border border-slate-800 space-y-3">
            <div className="flex items-center gap-2 text-xs font-bold uppercase text-emerald-400">
              <Sparkles className="w-4 h-4" />
              Option A: Direct Hosted Link
            </div>
            <p className="text-xs text-slate-300 leading-relaxed">
              Share your dedicated AI chat page directly with clients, via social media, or in your email signature:
            </p>
            <div className="bg-slate-900 p-3 rounded-lg border border-slate-800 flex items-center justify-between gap-2">
              <span className="text-xs font-mono text-slate-300 truncate">{websiteConfig?.publicChatUrl}</span>
              <a
                href={websiteConfig?.publicChatUrl}
                target="_blank"
                rel="noreferrer"
                className="text-emerald-400 hover:text-emerald-300 text-xs font-semibold flex items-center gap-1"
              >
                Open <ExternalLink className="w-3 h-3" />
              </a>
            </div>
          </div>

          {/* Option B: Copy Installation Script */}
          <div className="bg-slate-950 p-5 rounded-xl border border-slate-800 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-xs font-bold uppercase text-blue-400">
                <Globe className="w-4 h-4" />
                Option B: Embed on Any Website
              </div>
              <button
                onClick={handleCopySnippet}
                className="inline-flex items-center gap-1 text-xs text-emerald-400 hover:text-emerald-300 font-semibold transition"
              >
                {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                {copied ? 'Copied!' : 'Copy Code'}
              </button>
            </div>
            <p className="text-xs text-slate-300 leading-relaxed">
              Paste this one-line script before the closing <code className="text-emerald-300 bg-slate-900 px-1 py-0.5 rounded">&lt;/body&gt;</code> tag on WordPress, Webflow, Squarespace, or Shopify:
            </p>
            <div className="bg-slate-900 p-3 rounded-lg border border-slate-800 font-mono text-xs text-emerald-400 overflow-x-auto">
              <pre>{websiteConfig?.embedScriptSnippet}</pre>
            </div>
          </div>
        </div>

        {websiteConfig?.lastActivityAt && (
          <div className="text-xs text-slate-400 flex items-center gap-2 pt-2">
            <span>Last recorded visitor activity:</span>
            <strong className="text-slate-200">{new Date(websiteConfig.lastActivityAt).toLocaleString()}</strong>
          </div>
        )}
      </div>

      {/* 2. Email Connection Card */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-sm space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-5 border-b border-slate-800">
          <div className="flex items-center gap-3.5">
            <div className="w-12 h-12 rounded-xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-center text-purple-400">
              <Mail className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                Business Email
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
                Connect your business email so ONCEClic can answer customer emails using your AI Receptionist.
              </p>
            </div>
          </div>
        </div>

        {emailConfig?.status === IntegrationStatus.CONNECTED ? (
          <div className="bg-slate-950 p-5 rounded-xl border border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <span className="text-xs text-slate-400 block font-medium">Connected Business Email:</span>
              <span className="text-base font-bold text-white mt-0.5 block">{emailConfig.connectedEmail}</span>
              <span className="text-xs text-emerald-400 mt-1 block">● AI receptionist is active and monitoring inbound inquiries</span>
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

              {!emailConfig?.isOAuthConfigured && (
                <div className="pt-3 border-t border-slate-800/80 flex items-start gap-2.5 text-xs text-slate-400">
                  <HelpCircle className="w-4 h-4 text-purple-400 flex-shrink-0 mt-0.5" />
                  <div>
                    <span className="text-slate-300 font-semibold block">Email Forwarding Alternative:</span>
                    <span>
                      You can also forward incoming customer inquiries directly to your dedicated address:{' '}
                      <strong className="text-purple-300 font-mono">{emailConfig?.inboundWebhookAddress}</strong>
                    </span>
                  </div>
                </div>
              )}
            </form>
          </div>
        )}
      </div>
    </div>
  );
};
