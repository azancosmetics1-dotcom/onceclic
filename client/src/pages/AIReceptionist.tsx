import React, { useEffect, useState } from 'react';
import { api } from '../api/client';
import {
  CustomerVoiceConfig,
  VoicePhoneNumber,
  VoiceCallRecord,
  VoiceAnalyticsSummary,
  VoiceConnectionMethod,
} from '@onceclic/shared';
import {
  Phone,
  PhoneCall,
  PhoneForwarded,
  CheckCircle2,
  AlertCircle,
  Clock,
  Sparkles,
  CalendarCheck,
  FileText,
  Plus,
  Trash2,
  HelpCircle,
  X,
  Volume2,
  Zap,
} from 'lucide-react';
import { Badge } from '../components/Badge';

export const AIReceptionistPage: React.FC = () => {
  const [config, setConfig] = useState<CustomerVoiceConfig | null>(null);
  const [calls, setCalls] = useState<VoiceCallRecord[]>([]);
  const [analytics, setAnalytics] = useState<VoiceAnalyticsSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Setup Form State
  const [activeTab, setActiveTab] = useState<'EXISTING' | 'NEW'>('EXISTING');
  const [existingMethod, setExistingMethod] = useState<VoiceConnectionMethod>(
    VoiceConnectionMethod.EXISTING_FORWARDING
  );
  const [inputPhoneNumber, setInputPhoneNumber] = useState('');
  const [areaCode, setAreaCode] = useState('415');
  const [submitting, setSubmitting] = useState(false);

  // Transcript Modal State
  const [selectedTranscript, setSelectedTranscript] = useState<{
    caller: string;
    date: string;
    text: string;
  } | null>(null);

  const loadData = async () => {
    try {
      setLoading(true);
      setError(null);

      const [statusRes, callsRes, analyticsRes] = await Promise.all([
        api.getVoiceStatus().catch(() => null),
        api.getVoiceCalls(50).catch(() => []),
        api.getVoiceAnalytics().catch(() => null),
      ]);

      if (statusRes) setConfig(statusRes);
      if (callsRes) setCalls(callsRes);
      if (analyticsRes) setAnalytics(analyticsRes);
    } catch (err: any) {
      setError(err.message || 'Failed to load voice receptionist data.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleConnectExisting = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputPhoneNumber.trim()) {
      setError('Please enter your existing business phone number.');
      return;
    }

    try {
      setSubmitting(true);
      setError(null);
      await api.connectExistingVoiceNumber({
        phoneNumber: inputPhoneNumber.trim(),
        connectionMethod: existingMethod,
      });
      setSuccessMsg('Your business phone number has been connected successfully!');
      setInputPhoneNumber('');
      await loadData();
    } catch (err: any) {
      setError(err.message || 'Failed to connect phone number.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleProvisionNew = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setSubmitting(true);
      setError(null);
      await api.provisionNewVoiceNumber({ areaCode: areaCode.trim() });
      setSuccessMsg('New AI Receptionist phone number assigned successfully!');
      await loadData();
    } catch (err: any) {
      setError(err.message || 'Failed to assign new number.');
    } finally {
      setSubmitting(false);
    }
  };

  const [testingId, setTestingId] = useState<string | null>(null);

  const handleTestConnection = async (id: string) => {
    try {
      setTestingId(id);
      setError(null);
      const res = await api.testVoiceNumberConnection(id);
      if (res.data?.success) {
        setSuccessMsg(res.data.message || 'Call routing and AI Receptionist verified successfully!');
      } else {
        setError(res.data?.message || 'Connection test could not verify routing.');
      }
      await loadData();
    } catch (err: any) {
      setError(err.message || 'Failed to test connection.');
    } finally {
      setTestingId(null);
    }
  };

  const handleDisconnect = async (id: string) => {
    if (!window.confirm('Are you sure you want to disconnect this phone number from your AI receptionist?')) {
      return;
    }

    try {
      setLoading(true);
      await api.disconnectVoiceNumber(id);
      setSuccessMsg('Phone number disconnected successfully.');
      await loadData();
    } catch (err: any) {
      setError(err.message || 'Failed to disconnect phone number.');
      setLoading(false);
    }
  };

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}m ${secs < 10 ? '0' : ''}${secs}s`;
  };

  if (loading && !config) {
    return (
      <div className="p-8 flex items-center justify-center min-h-[60vh]">
        <div className="w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const usage = config?.voiceUsage;
  const isLimitReached = usage?.limitReached;

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-8">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800/80 pb-6">
        <div>
          <div className="flex items-center space-x-3">
            <div className="p-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
              <PhoneCall className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h1 className="text-2xl font-bold text-white tracking-tight">AI Phone Receptionist</h1>
                {config?.receptionistActive ? (
                  <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/10 border border-emerald-500/30 text-emerald-400">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse mr-1.5" />
                    Active & Answering
                  </span>
                ) : (
                  <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-slate-800 text-slate-400 border border-slate-700">
                    Not Configured
                  </span>
                )}
              </div>
              <p className="text-sm text-slate-400 mt-1">
                Your 24/7 Voice AI answers incoming calls, answers business questions, and schedules appointments automatically.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Alerts */}
      {error && (
        <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/30 flex items-start space-x-3 text-rose-300">
          <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
          <div className="text-sm">{error}</div>
        </div>
      )}

      {successMsg && (
        <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-start space-x-3 text-emerald-300">
          <CheckCircle2 className="w-5 h-5 shrink-0 mt-0.5" />
          <div className="text-sm">{successMsg}</div>
        </div>
      )}

      {/* Voice Usage Meter & Allowance */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 p-6 rounded-2xl bg-slate-900/90 border border-slate-800 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-400">
                Monthly Voice Minute Allowance
              </span>
              <span className="text-xs font-semibold px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                {usage?.planTier || 'PRO'} Plan
              </span>
            </div>

            <div className="mt-4 flex items-baseline space-x-2">
              <span className="text-3xl font-extrabold text-white">{usage?.usedMinutes || 0}</span>
              <span className="text-slate-400 text-base font-medium">/ {usage?.includedMinutes || 150} minutes used</span>
            </div>

            {/* Progress Bar */}
            <div className="mt-3 w-full bg-slate-800 rounded-full h-2.5 overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-500 ${
                  (usage?.percentageUsed || 0) > 90
                    ? 'bg-rose-500'
                    : (usage?.percentageUsed || 0) > 70
                    ? 'bg-amber-500'
                    : 'bg-gradient-to-r from-emerald-500 to-teal-400'
                }`}
                style={{ width: `${Math.min(100, usage?.percentageUsed || 0)}%` }}
              />
            </div>
          </div>

          <div className="mt-4 pt-4 border-t border-slate-800 flex flex-col sm:flex-row items-start sm:items-center justify-between text-xs text-slate-400 gap-2">
            <div className="flex items-center space-x-1.5">
              <Sparkles className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>AI usage is subject to reasonable-use limits. Standard monthly allowance.</span>
            </div>
            {isLimitReached && (
              <a
                href="/app/billing"
                className="inline-flex items-center text-xs font-bold text-emerald-400 hover:text-emerald-300 underline"
              >
                Upgrade Plan for More Minutes &rarr;
              </a>
            )}
          </div>
        </div>

        {/* Quick Phone Number Status Card */}
        <div className="p-6 rounded-2xl bg-slate-900/90 border border-slate-800 flex flex-col justify-between">
          <div>
            <span className="text-xs font-bold uppercase tracking-wider text-slate-400">
              Active Inbound Number
            </span>
            <div className="mt-3">
              {config?.activeNumber ? (
                <div>
                  <p className="text-xl font-mono font-bold text-white tracking-wide">
                    {config.activeNumber}
                  </p>
                  <p className="text-xs text-emerald-400 mt-1 flex items-center space-x-1">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>Connected ({config.connectionMethod?.replace('_', ' ')})</span>
                  </p>
                </div>
              ) : (
                <div>
                  <p className="text-sm text-slate-400 font-medium">No business phone connected</p>
                  <p className="text-xs text-slate-500 mt-1">Connect your existing business number below</p>
                </div>
              )}
            </div>
          </div>

          <div className="mt-4 pt-4 border-t border-slate-800 text-xs text-slate-400 flex items-center justify-between">
            <span>Receptionist Greeting:</span>
            <span className="text-slate-200 font-medium truncate max-w-[140px]">Luna (AI Receptionist)</span>
          </div>
        </div>
      </div>

      {/* Voice Analytics Grid */}
      {analytics && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div className="p-4 rounded-xl bg-slate-900 border border-slate-800">
            <span className="text-xs font-medium text-slate-400">Total Phone Calls</span>
            <p className="text-2xl font-bold text-white mt-1">{analytics.totalCalls}</p>
          </div>
          <div className="p-4 rounded-xl bg-slate-900 border border-slate-800">
            <span className="text-xs font-medium text-slate-400">Answered & Assisted</span>
            <p className="text-2xl font-bold text-emerald-400 mt-1">{analytics.answeredCalls}</p>
          </div>
          <div className="p-4 rounded-xl bg-slate-900 border border-slate-800">
            <span className="text-xs font-medium text-slate-400">Appointments Booked</span>
            <p className="text-2xl font-bold text-teal-300 mt-1">{analytics.appointmentsBooked}</p>
          </div>
          <div className="p-4 rounded-xl bg-slate-900 border border-slate-800">
            <span className="text-xs font-medium text-slate-400">Avg Call Duration</span>
            <p className="text-2xl font-bold text-white mt-1">
              {formatDuration(analytics.averageDurationSeconds)}
            </p>
          </div>
        </div>
      )}

      {/* Phone Number Setup Section */}
      <div className="rounded-2xl bg-slate-900 border border-slate-800 overflow-hidden">
        <div className="p-6 border-b border-slate-800">
          <h2 className="text-lg font-bold text-white">Connect Your Business Phone</h2>
          <p className="text-sm text-slate-400 mt-1">
            Choose whether to link your existing business phone number or get a new dedicated number.
          </p>

          {/* Primary vs Secondary Option Tabs */}
          <div className="mt-6 flex space-x-3">
            <button
              onClick={() => setActiveTab('EXISTING')}
              className={`px-4 py-2.5 rounded-xl text-sm font-semibold transition flex items-center space-x-2 ${
                activeTab === 'EXISTING'
                  ? 'bg-emerald-500 text-slate-950 shadow-md shadow-emerald-500/20'
                  : 'bg-slate-800 text-slate-300 hover:text-white hover:bg-slate-750'
              }`}
            >
              <PhoneForwarded className="w-4 h-4" />
              <span>Use Existing Business Number</span>
              <span className="px-1.5 py-0.5 rounded text-[10px] uppercase font-bold bg-slate-950/30 text-emerald-950">
                Recommended
              </span>
            </button>

            <button
              onClick={() => setActiveTab('NEW')}
              className={`px-4 py-2.5 rounded-xl text-sm font-semibold transition flex items-center space-x-2 ${
                activeTab === 'NEW'
                  ? 'bg-emerald-500 text-slate-950 shadow-md shadow-emerald-500/20'
                  : 'bg-slate-800 text-slate-300 hover:text-white hover:bg-slate-750'
              }`}
            >
              <Plus className="w-4 h-4" />
              <span>Get New Business Number</span>
            </button>
          </div>
        </div>

        {/* Tab Content: Existing Number Setup */}
        {activeTab === 'EXISTING' && (
          <div className="p-6 space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <button
                type="button"
                onClick={() => setExistingMethod(VoiceConnectionMethod.EXISTING_FORWARDING)}
                className={`p-4 rounded-xl border text-left transition ${
                  existingMethod === VoiceConnectionMethod.EXISTING_FORWARDING
                    ? 'border-emerald-500 bg-emerald-500/5'
                    : 'border-slate-800 bg-slate-950/40 hover:border-slate-700'
                }`}
              >
                <div className="font-semibold text-white text-sm">1. Call Forwarding</div>
                <p className="text-xs text-slate-400 mt-1">
                  Keep your current carrier. Route unanswered or after-hours business calls to ONCEClic.
                </p>
              </button>

              <button
                type="button"
                onClick={() => setExistingMethod(VoiceConnectionMethod.EXISTING_SIP)}
                className={`p-4 rounded-xl border text-left transition ${
                  existingMethod === VoiceConnectionMethod.EXISTING_SIP
                    ? 'border-emerald-500 bg-emerald-500/5'
                    : 'border-slate-800 bg-slate-950/40 hover:border-slate-700'
                }`}
              >
                <div className="font-semibold text-white text-sm">2. VoIP / SIP Trunking</div>
                <p className="text-xs text-slate-400 mt-1">
                  Connect your existing compatible business VoIP/SIP provider to route calls to ONCEClic.
                </p>
              </button>

              <button
                type="button"
                onClick={() => setExistingMethod(VoiceConnectionMethod.EXISTING_PORT)}
                className={`p-4 rounded-xl border text-left transition ${
                  existingMethod === VoiceConnectionMethod.EXISTING_PORT
                    ? 'border-emerald-500 bg-emerald-500/5'
                    : 'border-slate-800 bg-slate-950/40 hover:border-slate-700'
                }`}
              >
                <div className="font-semibold text-white text-sm">3. Number Porting</div>
                <p className="text-xs text-slate-400 mt-1">
                  Port your existing business number directly to ONCEClic where carrier porting is supported.
                </p>
              </button>
            </div>

            <div className="p-3 bg-slate-950/60 rounded-xl border border-slate-800 text-xs text-slate-400 flex items-start space-x-2">
              <span className="text-emerald-400 font-bold">ℹ️</span>
              <span>
                Call Forwarding — availability and activation codes depend on your carrier and country.
              </span>
            </div>

            <form onSubmit={handleConnectExisting} className="space-y-4 max-w-xl">
              <div>
                <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">
                  Your Current Business Phone Number
                </label>
                <div className="relative">
                  <Phone className="w-5 h-5 text-slate-500 absolute left-3.5 top-3" />
                  <input
                    type="tel"
                    value={inputPhoneNumber}
                    onChange={(e) => setInputPhoneNumber(e.target.value)}
                    placeholder="+1 (555) 234-5678"
                    className="w-full pl-11 pr-4 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500 transition"
                  />
                </div>
                <p className="text-xs text-slate-500 mt-1.5">
                  We'll configure the AI Receptionist to answer and identify calls from this number.
                </p>
              </div>

              <button
                type="submit"
                disabled={submitting}
                className="px-5 py-2.5 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold rounded-xl transition shadow-md shadow-emerald-500/20 disabled:opacity-50"
              >
                {submitting ? 'Connecting...' : 'Connect Business Number'}
              </button>
            </form>
          </div>
        )}

        {/* Tab Content: New Number Option */}
        {activeTab === 'NEW' && (
          <div className="p-6 space-y-4 max-w-xl">
            <p className="text-sm text-slate-300">
              Get a dedicated local phone number for your business powered by ONCEClic Voice AI where production telephony capacity is available.
            </p>

            <form onSubmit={handleProvisionNew} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">
                  Preferred US Area Code
                </label>
                <input
                  type="text"
                  maxLength={3}
                  value={areaCode}
                  onChange={(e) => setAreaCode(e.target.value)}
                  placeholder="415"
                  className="w-32 px-4 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500 transition"
                />
              </div>

              <button
                type="submit"
                disabled={submitting}
                className="px-5 py-2.5 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold rounded-xl transition shadow-md shadow-emerald-500/20 disabled:opacity-50"
              >
                {submitting ? 'Assigning Number...' : 'Assign New Number'}
              </button>
            </form>
          </div>
        )}
      </div>

      {/* Connected Phone Numbers List */}
      {config?.phoneNumbers && config.phoneNumbers.length > 0 && (
        <div className="rounded-2xl bg-slate-900 border border-slate-800 p-6 space-y-6">
          <div>
            <h3 className="text-base font-bold text-white">Connected Business Phone Numbers</h3>
            <p className="text-xs text-slate-400 mt-0.5">
              Phone numbers actively routed to your ONCEClic AI Receptionist.
            </p>
          </div>

          <div className="divide-y divide-slate-800">
            {config.phoneNumbers.map((num) => (
              <div key={num.id} className="py-4 space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div className="flex items-center space-x-3">
                    <div className="p-2.5 rounded-xl bg-emerald-500/10 text-emerald-400">
                      <Phone className="w-5 h-5" />
                    </div>
                    <div>
                      <div className="flex items-center space-x-2">
                        <span className="font-mono font-bold text-white text-base">{num.phoneNumber}</span>
                        <Badge variant={num.status === 'ACTIVE' ? 'success' : 'warning'} size="sm">
                          {num.status === 'ACTIVE' ? 'CONNECTED' : num.status}
                        </Badge>
                      </div>
                      <span className="text-xs text-slate-400">
                        Method: {num.connectionMethod?.replace(/_/g, ' ')}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center space-x-2">
                    <button
                      onClick={() => handleTestConnection(num.id)}
                      disabled={testingId === num.id}
                      className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-750 text-slate-200 text-xs font-semibold transition border border-slate-700 flex items-center space-x-1.5 disabled:opacity-50"
                    >
                      {testingId === num.id ? (
                        <>
                          <div className="w-3 h-3 border border-emerald-400 border-t-transparent rounded-full animate-spin" />
                          <span>Testing...</span>
                        </>
                      ) : (
                        <>
                          <Zap className="w-3.5 h-3.5 text-emerald-400" />
                          <span>Test Connection</span>
                        </>
                      )}
                    </button>

                    <button
                      onClick={() => handleDisconnect(num.id)}
                      className="p-1.5 text-slate-400 hover:text-rose-400 transition rounded-xl hover:bg-slate-800"
                      title="Disconnect number"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {num.connectionMethod === VoiceConnectionMethod.EXISTING_FORWARDING && (
                  <div className="p-4 rounded-xl bg-slate-950/70 border border-slate-800/80 text-xs space-y-2">
                    <div className="font-semibold text-slate-300 flex items-center space-x-1.5">
                      <PhoneForwarded className="w-3.5 h-3.5 text-emerald-400" />
                      <span>Carrier Forwarding Setup Instructions</span>
                    </div>
                    <ol className="list-decimal list-inside text-slate-400 space-y-1 pl-1">
                      <li>Open your phone app or carrier management portal.</li>
                      <li>Enable call forwarding (either unconditional or when busy/unanswered).</li>
                      <li>Set destination number to ONCEClic routing line: <strong className="text-white font-mono">{num.forwardingTarget || '+1 (800) 555-0199'}</strong></li>
                      <li>Call your business number from another line to verify the AI answers, then click "Test Connection" above.</li>
                    </ol>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Call History & Transcripts */}
      <div className="rounded-2xl bg-slate-900 border border-slate-800 overflow-hidden">
        <div className="p-6 border-b border-slate-800 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-white">Call History & Transcripts</h2>
            <p className="text-sm text-slate-400 mt-0.5">
              Review recent customer calls, scheduled bookings, and AI conversation transcripts.
            </p>
          </div>
        </div>

        {calls.length === 0 ? (
          <div className="p-12 text-center text-slate-500">
            <PhoneCall className="w-8 h-8 mx-auto mb-2 text-slate-600" />
            <p className="text-sm">No phone calls recorded yet.</p>
            <p className="text-xs text-slate-600 mt-1">
              When customers call your business number, their calls and transcripts will appear here.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-950/60 text-slate-400 text-xs uppercase tracking-wider">
                <tr>
                  <th className="px-6 py-3.5">Caller</th>
                  <th className="px-6 py-3.5">Date & Time</th>
                  <th className="px-6 py-3.5">Duration</th>
                  <th className="px-6 py-3.5">Outcome</th>
                  <th className="px-6 py-3.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {calls.map((c) => (
                  <tr key={c.id} className="hover:bg-slate-800/40 transition">
                    <td className="px-6 py-4 font-mono font-medium text-white">{c.callerPhone}</td>
                    <td className="px-6 py-4 text-slate-400 text-xs">
                      {new Date(c.startedAt).toLocaleString('en-US', {
                        month: 'short',
                        day: 'numeric',
                        hour: 'numeric',
                        minute: '2-digit',
                      })}
                    </td>
                    <td className="px-6 py-4 text-slate-300 font-mono text-xs">
                      {formatDuration(c.durationSeconds)}
                    </td>
                    <td className="px-6 py-4">
                      {c.outcome === 'APPOINTMENT_BOOKED' ? (
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                          <CalendarCheck className="w-3 h-3 mr-1" />
                          Appointment Booked
                        </span>
                      ) : c.outcome === 'APPOINTMENT_RESCHEDULED' ? (
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-teal-500/10 text-teal-400 border border-teal-500/20">
                          Rescheduled
                        </span>
                      ) : c.outcome === 'APPOINTMENT_CANCELED' ? (
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-rose-500/10 text-rose-400 border border-rose-500/20">
                          Cancelled
                        </span>
                      ) : (
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium text-slate-400 bg-slate-800">
                          General Inquiry
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-right">
                      {c.transcript && (
                        <button
                          onClick={() =>
                            setSelectedTranscript({
                              caller: c.callerPhone || 'Caller',
                              date: new Date(c.startedAt).toLocaleString(),
                              text: c.transcript || '',
                            })
                          }
                          className="inline-flex items-center space-x-1 px-2.5 py-1 rounded-lg text-xs font-medium bg-slate-800 hover:bg-slate-750 text-slate-200 transition"
                        >
                          <FileText className="w-3.5 h-3.5 text-emerald-400" />
                          <span>Transcript</span>
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Transcript Modal */}
      {selectedTranscript && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-2xl w-full p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div>
                <h3 className="font-bold text-white text-base">Call Transcript</h3>
                <p className="text-xs text-slate-400">
                  {selectedTranscript.caller} &bull; {selectedTranscript.date}
                </p>
              </div>
              <button
                onClick={() => setSelectedTranscript(null)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-4 rounded-xl bg-slate-950 font-mono text-xs text-slate-300 whitespace-pre-wrap max-h-96 overflow-y-auto leading-relaxed border border-slate-850">
              {selectedTranscript.text}
            </div>

            <div className="flex justify-end pt-2">
              <button
                onClick={() => setSelectedTranscript(null)}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white text-sm font-semibold rounded-xl transition"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
