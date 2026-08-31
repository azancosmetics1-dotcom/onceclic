import React, { useState, useEffect } from 'react';
import { api } from '../api/client';
import { EmailConnection } from '@onceclic/shared';
import { Badge } from '../components/Badge';
import {
  Mail,
  Save,
  CheckCircle2,
  AlertCircle,
  Copy,
  Check,
  Send,
  Zap,
  Server,
  Key,
} from 'lucide-react';

export const EmailPage: React.FC = () => {
  const [connection, setConnection] = useState<EmailConnection | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [copiedToken, setCopiedToken] = useState(false);
  const [copiedAddress, setCopiedAddress] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // Form inputs
  const [formData, setFormData] = useState({
    providerType: 'WEBHOOK' as 'WEBHOOK' | 'SMTP_IMAP',
    smtpHost: '',
    smtpPort: 587,
    smtpUser: '',
    smtpPass: '',
    imapHost: '',
    imapPort: 993,
    imapUser: '',
    imapPass: '',
    isActive: false,
  });

  const loadEmailSettings = async () => {
    try {
      const data = await api.getEmailConnection();
      setConnection(data);
      setFormData({
        providerType: data.providerType,
        smtpHost: data.smtpHost || '',
        smtpPort: data.smtpPort || 587,
        smtpUser: data.smtpUser || '',
        smtpPass: '',
        imapHost: data.imapHost || '',
        imapPort: data.imapPort || 993,
        imapUser: data.imapUser || '',
        imapPass: '',
        isActive: data.isActive,
      });
    } catch (err) {
      console.error('[Email] Failed to load:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadEmailSettings();
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setSaveSuccess(false);

    try {
      const updated = await api.updateEmailConnection(formData);
      setConnection(updated);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (err) {
      console.error('[Email] Update failed:', err);
    } finally {
      setSaving(false);
    }
  };

  const copy = (text: string, type: 'token' | 'address') => {
    navigator.clipboard.writeText(text);
    if (type === 'token') {
      setCopiedToken(true);
      setTimeout(() => setCopiedToken(false), 2000);
    } else {
      setCopiedAddress(true);
      setTimeout(() => setCopiedAddress(false), 2000);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <div className="w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const origin = window.location.origin;
  const webhookUrl = `${origin}/api/email/inbound`;

  return (
    <div className="space-y-8 max-w-5xl">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black text-white flex items-center space-x-2">
            <Mail className="w-6 h-6 text-emerald-400" />
            <span>Automated Email Answering</span>
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            Connect your business email to automatically answer incoming customer questions and schedule appointments.
          </p>
        </div>

        <div className="flex items-center space-x-2">
          <Badge variant={connection?.isActive ? 'success' : 'neutral'}>
            {connection?.isActive ? 'EMAIL CONNECTED' : 'EMAIL NOT CONNECTED'}
          </Badge>
        </div>
      </div>

      {saveSuccess && (
        <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-xl p-4 flex items-center space-x-2 text-xs text-emerald-400 font-semibold">
          <CheckCircle2 className="w-4 h-4" />
          <span>Email settings updated successfully!</span>
        </div>
      )}

      {/* Integration Method 1: Forwarding & Inbound Webhook (Recommended) */}
      <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 sm:p-8 space-y-6">
        <div>
          <h2 className="text-base font-bold text-white flex items-center space-x-2">
            <Zap className="w-5 h-5 text-emerald-400" />
            <span>Option 1: Inbound Email Webhook & Forwarding (Recommended)</span>
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            Forward your support email (e.g. hello@yourbusiness.com) to your dedicated address or configure SendGrid/Mailgun webhook.
          </p>
        </div>

        {/* Inbound Address */}
        <div className="space-y-2">
          <label className="text-xs font-semibold uppercase tracking-wider text-slate-400">
            Dedicated Inbound Reception Address
          </label>
          <div className="flex items-center space-x-2">
            <input
              type="text"
              readOnly
              value={connection?.inboundAddress || ''}
              className="flex-1 bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-xs text-emerald-400 font-mono focus:outline-none"
            />
            <button
              onClick={() => copy(connection?.inboundAddress || '', 'address')}
              className="px-4 py-2.5 bg-slate-800 hover:bg-slate-750 text-slate-200 text-xs font-semibold rounded-xl transition flex items-center space-x-1.5 shrink-0"
            >
              {copiedAddress ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copiedAddress ? 'Copied' : 'Copy'}</span>
            </button>
          </div>
        </div>

        {/* Webhook Endpoint URL */}
        <div className="space-y-2">
          <label className="text-xs font-semibold uppercase tracking-wider text-slate-400">
            Inbound Provider Webhook URL
          </label>
          <div className="flex items-center space-x-2">
            <input
              type="text"
              readOnly
              value={webhookUrl}
              className="flex-1 bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-xs text-slate-300 font-mono focus:outline-none"
            />
          </div>
        </div>

        {/* Webhook Secret Token */}
        <div className="space-y-2">
          <label className="text-xs font-semibold uppercase tracking-wider text-slate-400">
            Webhook Secret Token (Header: x-webhook-token)
          </label>
          <div className="flex items-center space-x-2">
            <input
              type="text"
              readOnly
              value={connection?.webhookToken || ''}
              className="flex-1 bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-xs text-slate-300 font-mono focus:outline-none"
            />
            <button
              onClick={() => copy(connection?.webhookToken || '', 'token')}
              className="px-4 py-2.5 bg-slate-800 hover:bg-slate-750 text-slate-200 text-xs font-semibold rounded-xl transition flex items-center space-x-1.5 shrink-0"
            >
              {copiedToken ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copiedToken ? 'Copied' : 'Copy'}</span>
            </button>
          </div>
        </div>
      </div>

      {/* Integration Method 2: Direct SMTP & IMAP */}
      <form onSubmit={handleSave} className="bg-slate-900 border border-slate-800 rounded-3xl p-6 sm:p-8 space-y-6">
        <div>
          <h2 className="text-base font-bold text-white flex items-center space-x-2">
            <Server className="w-5 h-5 text-emerald-400" />
            <span>Option 2: Direct SMTP / IMAP Mailbox Connection</span>
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            Provide your mail server credentials if you prefer direct connection over webhooks.
          </p>
        </div>

        <div className="flex items-center space-x-3 p-4 bg-slate-950 border border-slate-800 rounded-2xl">
          <input
            type="checkbox"
            id="isActive"
            checked={formData.isActive}
            onChange={(e) => setFormData({ ...formData, isActive: e.target.checked })}
            className="w-5 h-5 rounded text-emerald-500 accent-emerald-500 cursor-pointer"
          />
          <label htmlFor="isActive" className="text-xs font-semibold text-white cursor-pointer">
            Enable Automatic AI Email Replies
          </label>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
          <div className="space-y-4">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400">Outgoing Mail (SMTP)</h3>
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">SMTP Host</label>
              <input
                type="text"
                placeholder="smtp.mailgun.org"
                value={formData.smtpHost}
                onChange={(e) => setFormData({ ...formData, smtpHost: e.target.value })}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2 text-xs text-white focus:outline-none focus:border-emerald-500"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">SMTP Port</label>
              <input
                type="number"
                value={formData.smtpPort}
                onChange={(e) => setFormData({ ...formData, smtpPort: parseInt(e.target.value, 10) || 587 })}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2 text-xs text-white focus:outline-none focus:border-emerald-500"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">SMTP Username</label>
              <input
                type="text"
                value={formData.smtpUser}
                onChange={(e) => setFormData({ ...formData, smtpUser: e.target.value })}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2 text-xs text-white focus:outline-none focus:border-emerald-500"
              />
            </div>
          </div>

          <div className="space-y-4">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400">Incoming Mail (IMAP)</h3>
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">IMAP Host</label>
              <input
                type="text"
                placeholder="imap.mailgun.org"
                value={formData.imapHost}
                onChange={(e) => setFormData({ ...formData, imapHost: e.target.value })}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2 text-xs text-white focus:outline-none focus:border-emerald-500"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">IMAP Port</label>
              <input
                type="number"
                value={formData.imapPort}
                onChange={(e) => setFormData({ ...formData, imapPort: parseInt(e.target.value, 10) || 993 })}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2 text-xs text-white focus:outline-none focus:border-emerald-500"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">IMAP Username</label>
              <input
                type="text"
                value={formData.imapUser}
                onChange={(e) => setFormData({ ...formData, imapUser: e.target.value })}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2 text-xs text-white focus:outline-none focus:border-emerald-500"
              />
            </div>
          </div>
        </div>

        <div className="pt-4 border-t border-slate-800 flex justify-end">
          <button
            type="submit"
            disabled={saving}
            className="px-6 py-2.5 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs rounded-xl transition flex items-center space-x-1.5 shadow-md shadow-emerald-500/20 disabled:opacity-50"
          >
            <Save className="w-4 h-4" />
            <span>{saving ? 'Saving...' : 'Save Email Configuration'}</span>
          </button>
        </div>
      </form>
    </div>
  );
};
