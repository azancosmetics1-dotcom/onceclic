import React, { useEffect, useState, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api/client';
import {
  CustomerVoiceConfig,
  VoicePhoneNumber,
  VoiceCallRecord,
  VoiceAnalyticsSummary,
  VoiceProvisioningStatus,
  TelephonyCountryInfo,
  AvailablePhoneNumber,
  DEFAULT_VOICE_PLAN_LIMITS,
} from '@onceclic/shared';
import { BrowserVoiceSession, VoiceSessionStatus } from '../utils/vapiBrowserVoice';
import {
  Phone,
  PhoneCall,
  CheckCircle2,
  AlertCircle,
  Clock,
  Sparkles,
  HelpCircle,
  X,
  Volume2,
  Zap,
  Globe,
  ShieldCheck,
  AlertTriangle,
  RefreshCw,
  Info,
  Play,
  Pause,
  Settings,
  Scissors,
  ExternalLink,
  TrendingUp,
  Mic,
  MicOff,
  Copy,
  Check,
  Code,
  Lock,
} from 'lucide-react';
import { Badge } from '../components/Badge';

export const AIReceptionistPage: React.FC = () => {
  const [searchParams] = useSearchParams();
  const [config, setConfig] = useState<CustomerVoiceConfig | null>(null);
  const [calls, setCalls] = useState<VoiceCallRecord[]>([]);
  const [analytics, setAnalytics] = useState<VoiceAnalyticsSummary | null>(null);
  const [countries, setCountries] = useState<TelephonyCountryInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Active Tab State
  const initialTab = searchParams.get('tab') === 'phone' ? 'phone' : 'website';
  const [activeTab, setActiveTab] = useState<'website' | 'phone' | 'analytics' | 'settings'>(initialTab);

  // Browser Voice Tester State
  const [browserVoiceStatus, setBrowserVoiceStatus] = useState<VoiceSessionStatus>('idle');
  const [browserVoiceError, setBrowserVoiceError] = useState<string | null>(null);
  const [browserTranscripts, setBrowserTranscripts] = useState<Array<{ role: 'user' | 'assistant'; text: string }>>([]);
  const browserVoiceSessionRef = useRef<BrowserVoiceSession | null>(null);
  const [copiedSnippet, setCopiedSnippet] = useState(false);

  // Industry Config State
  const [industryType, setIndustryType] = useState<string>('clinic');
  const [transferPhoneNumber, setTransferPhoneNumber] = useState<string>('');
  const [savingIndustryConfig, setSavingIndustryConfig] = useState(false);

  // Audio recording player state
  const [playingRecordingId, setPlayingRecordingId] = useState<string | null>(null);
  const [recordingUrl, setRecordingUrl] = useState<string | null>(null);
  const [recordingLoading, setRecordingLoading] = useState<string | null>(null);
  const [recordingError, setRecordingError] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const loadData = async () => {
    try {
      setLoading(true);
      setError(null);

      const [statusRes, callsRes, analyticsRes, countriesRes, industryRes] = await Promise.all([
        api.getVoiceStatus().catch(() => null),
        api.getVoiceCalls(50).catch(() => []),
        api.getVoiceAnalytics().catch(() => null),
        api.getVoiceCountries().catch(() => []),
        api.getIndustryConfig().catch(() => null),
      ]);

      if (statusRes) setConfig(statusRes);
      if (callsRes) setCalls(callsRes);
      if (analyticsRes) setAnalytics(analyticsRes);
      if (countriesRes) setCountries(countriesRes);
      if (industryRes) {
        setIndustryType(industryRes.industryType || 'clinic');
        setTransferPhoneNumber(industryRes.transferPhoneNumber || '');
      }
    } catch (err: any) {
      setError(err.message || 'Failed to load voice configuration');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
    return () => {
      if (browserVoiceSessionRef.current) {
        browserVoiceSessionRef.current.stop();
      }
    };
  }, []);

  const handleStartBrowserVoiceTest = async () => {
    try {
      setBrowserVoiceError(null);
      setBrowserTranscripts([]);
      const session = await api.startBrowserVoiceSession();
      if (!session?.sessionTicket && !session?.deepgramToken && (!session?.assistantId || !session?.vapiPublicKey)) {
        setBrowserVoiceError('AI voice receptionist assistant is not ready yet.');
        return;
      }

      const voice = new BrowserVoiceSession({
        provider: session.provider || (session.deepgramToken ? 'deepgram_voice_agent' : session.sessionTicket ? 'gemini_live' : 'vapi'),
        sessionTicket: session.sessionTicket,
        deepgramToken: session.deepgramToken,
        deepgramWsUrl: session.deepgramWsUrl,
        settings: session.settings,
        toolEndpointUrl: '/api/voice/tools/execute',
        sessionEndUrl: '/api/voice/session/end',
        wsUrl: session.wsUrl,
        assistantId: session.assistantId,
        publicKey: session.vapiPublicKey,
        maxDurationSeconds: session.maxDurationSeconds || 180,
        appointmentReminderSeconds: session.appointmentReminderSeconds || 120,
        callbacks: {
          onStatusChange: (status, err) => {
            setBrowserVoiceStatus(status);
            if (err) setBrowserVoiceError(err);
          },
          onAppointmentReminder: () => {
            setBrowserTranscripts((prev) => [
              ...prev,
              { role: 'assistant', text: 'Would you like me to book an appointment for you before we finish?' },
            ]);
          },
          onTranscript: (role, text) => {
            setBrowserTranscripts((prev) => [...prev, { role, text }]);
          },
        },
      });

      browserVoiceSessionRef.current = voice;
      await voice.start();
    } catch (err: any) {
      setBrowserVoiceError(err.message || 'Failed to start browser voice test session');
    }
  };

  const handleEndBrowserVoiceTest = () => {
    if (browserVoiceSessionRef.current) {
      browserVoiceSessionRef.current.stop();
      browserVoiceSessionRef.current = null;
    }
    setBrowserVoiceStatus('ended');
  };

  const handleCopySnippet = () => {
    if (!config?.embedSnippet) return;
    navigator.clipboard.writeText(config.embedSnippet);
    setCopiedSnippet(true);
    setTimeout(() => setCopiedSnippet(false), 2000);
  };

  const saveIndustryConfig = async () => {
    try {
      setSavingIndustryConfig(true);
      setError(null);
      await api.updateIndustryConfig({
        industryType,
        transferPhoneNumber: transferPhoneNumber.trim() || undefined,
      });
      setSuccessMsg('Voice agent settings updated successfully.');
      setTimeout(() => setSuccessMsg(null), 3000);
    } catch (err: any) {
      setError(err.message || 'Failed to save settings.');
    } finally {
      setSavingIndustryConfig(false);
    }
  };

  const playRecording = async (callId: string) => {
    if (playingRecordingId === callId) {
      audioRef.current?.pause();
      setPlayingRecordingId(null);
      return;
    }
    try {
      setRecordingLoading(callId);
      setRecordingError(null);
      const res = await api.getRecordingSignedUrl(callId);
      if (!res.signedUrl) {
        setRecordingError('Recording unavailable');
        setRecordingLoading(null);
        return;
      }
      setRecordingUrl(res.signedUrl);
      setPlayingRecordingId(callId);
      setRecordingLoading(null);
      setTimeout(() => {
        audioRef.current?.play().catch(() => {
          setRecordingError('Playback failed');
          setPlayingRecordingId(null);
        });
      }, 50);
    } catch (err: any) {
      setRecordingError(err.message || 'Failed to load recording');
      setRecordingLoading(null);
      setPlayingRecordingId(null);
    }
  };

  const formatDuration = (seconds?: number): string => {
    if (!seconds || seconds <= 0) return '0s';
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    if (mins > 0) return `${mins}m ${secs}s`;
    return `${secs}s`;
  };

  const PHONE_COMING_SOON_MSG =
    'Phone calling and phone number services are coming soon. ONCEClic currently supports AI voice conversations directly through your website.';

  const usage = config?.voiceUsage;
  const rawPlanTier = (usage?.planTier || 'PRO').toUpperCase();
  const planTier = (['TRIAL', 'STARTER', 'PRO', 'BUSINESS'].includes(rawPlanTier)
    ? rawPlanTier
    : 'PRO') as keyof typeof DEFAULT_VOICE_PLAN_LIMITS;
  const usedMinutes = usage?.usedMinutes ?? config?.browserVoiceMinutes ?? 0;
  const maxMinutes = usage?.includedMinutes ?? (DEFAULT_VOICE_PLAN_LIMITS[planTier] ?? 200);
  const minutePct = Math.min(100, Math.round((usedMinutes / Math.max(1, maxMinutes)) * 100));
  const isLimitReached = (usage?.remainingMinutes !== undefined && usage.remainingMinutes <= 0) || (usage?.minuteLimitReached ?? false) || (usedMinutes >= maxMinutes);

  if (loading) {
    return (
      <div className="p-8 max-w-7xl mx-auto flex items-center justify-center min-h-[400px]">
        <div className="w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-8">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800 pb-6">
        <div>
          <div className="flex items-center space-x-3">
            <div className="p-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
              <Sparkles className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h1 className="text-2xl font-bold text-white tracking-tight">AI Voice Receptionist</h1>
                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/10 border border-emerald-500/30 text-emerald-400">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse mr-1.5" />
                  Available Now
                </span>
              </div>
              <p className="text-sm text-slate-300 mt-1 max-w-3xl leading-relaxed">
                Give your website visitors a natural voice conversation with your AI receptionist. Visitors can speak directly through their browser without calling a phone number.
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {config?.isVoiceReceptionistReady && (
            <span className="inline-flex items-center space-x-1.5 px-3 py-1 rounded-xl bg-slate-800 text-xs font-mono text-slate-300 border border-slate-700">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
              <span>AI Voice Receptionist Ready</span>
            </span>
          )}
        </div>
      </div>

      {/* Navigation Tabs */}
      <div className="flex items-center space-x-2 border-b border-slate-800 overflow-x-auto pb-px">
        <button
          onClick={() => setActiveTab('website')}
          className={`flex items-center space-x-2 px-4 py-2.5 text-xs font-bold rounded-t-xl transition border-b-2 ${activeTab === 'website'
            ? 'border-emerald-500 text-white bg-slate-900/80'
            : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
        >
          <Sparkles className="w-4 h-4 text-emerald-400" />
          <span>Website AI Voice Agent</span>
          <span className="px-1.5 py-0.2 rounded text-[10px] bg-emerald-500/20 text-emerald-400 font-semibold">
            Active
          </span>
        </button>

        <button
          onClick={() => setActiveTab('phone')}
          className={`flex items-center space-x-2 px-4 py-2.5 text-xs font-bold rounded-t-xl transition border-b-2 ${activeTab === 'phone'
            ? 'border-emerald-500 text-white bg-slate-900/80'
            : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
        >
          <Phone className="w-4 h-4 text-slate-400" />
          <span>AI Phone Receptionist & Numbers</span>
          <span className="px-1.5 py-0.2 rounded text-[10px] bg-amber-500/10 text-amber-400 font-semibold border border-amber-500/30">
            Coming Soon
          </span>
        </button>

        <button
          onClick={() => setActiveTab('analytics')}
          className={`flex items-center space-x-2 px-4 py-2.5 text-xs font-bold rounded-t-xl transition border-b-2 ${activeTab === 'analytics'
            ? 'border-emerald-500 text-white bg-slate-900/80'
            : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
        >
          <TrendingUp className="w-4 h-4 text-slate-400" />
          <span>Browser Voice Analytics</span>
        </button>

        <button
          onClick={() => setActiveTab('settings')}
          className={`flex items-center space-x-2 px-4 py-2.5 text-xs font-bold rounded-t-xl transition border-b-2 ${activeTab === 'settings'
            ? 'border-emerald-500 text-white bg-slate-900/80'
            : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
        >
          <Settings className="w-4 h-4 text-slate-400" />
          <span>Industry & Persona</span>
        </button>
      </div>

      {/* Global Alerts */}
      {error && (
        <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/30 flex items-start space-x-3 text-rose-300 text-sm">
          <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
          <div>{error}</div>
        </div>
      )}

      {successMsg && (
        <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-start space-x-3 text-emerald-300 text-sm">
          <CheckCircle2 className="w-5 h-5 shrink-0 mt-0.5" />
          <div>{successMsg}</div>
        </div>
      )}

      {/* ───────────────────────────────────────────────────────────────────────────── */}
      {/* TAB 1: WEBSITE AI VOICE RECEPTIONIST (AVAILABLE NOW) */}
      {/* ───────────────────────────────────────────────────────────────────────────── */}
      {activeTab === 'website' && (
        <div className="space-y-6">
          {/* Top Banner: Voice Minute Usage & Assistant Architecture */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Monthly AI Voice Minutes Allowance */}
            <div className="lg:col-span-2 p-6 rounded-2xl bg-slate-900 border border-slate-800 flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center space-x-1.5">
                    <Mic className="w-3.5 h-3.5 text-emerald-400" />
                    <span>Monthly AI Voice Minute Allowance</span>
                  </span>
                  <span className="text-xs font-semibold px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                    {planTier} Plan ({maxMinutes} min included)
                  </span>
                </div>

                <div className="mt-4 flex items-baseline justify-between flex-wrap gap-2">
                  <div className="flex items-baseline space-x-2">
                    <span className={`text-3xl font-black ${isLimitReached ? 'text-rose-400' : 'text-white'}`}>
                      {usedMinutes}
                    </span>
                    <span className="text-slate-400 text-sm font-medium">/ {maxMinutes} AI voice minutes used</span>
                  </div>
                  <span className="text-xs text-slate-400 bg-slate-800/80 px-2 py-0.5 rounded border border-slate-700/50">
                    Browser Voice Sessions
                  </span>
                </div>

                {/* Progress Bar */}
                <div className="mt-3 w-full bg-slate-800 rounded-full h-2.5 overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-500 ${minutePct > 90
                      ? 'bg-rose-500'
                      : minutePct > 70
                        ? 'bg-amber-500'
                        : 'bg-gradient-to-r from-emerald-500 to-teal-400'
                      }`}
                    style={{ width: `${minutePct}%` }}
                  />
                </div>

                <div className="mt-3 text-xs text-slate-400 leading-relaxed">
                  AI voice minutes are consumed during browser-based voice conversations. Usage is strictly capped at your plan's included allowance with zero automated overage fees. Universal 3-minute limit applies per conversation.
                </div>
              </div>

              <div className="mt-4 pt-4 border-t border-slate-800 flex flex-col sm:flex-row items-start sm:items-center justify-between text-xs text-slate-400 gap-2">
                <div className="flex items-center space-x-1.5">
                  <Sparkles className="w-4 h-4 text-emerald-400 shrink-0" />
                  <span>
                    {planTier === 'TRIAL'
                      ? '14-Day Free Trial: 30 total minutes for the entire trial period.'
                      : 'Allowance resets monthly with your billing cycle.'}
                  </span>
                </div>
                {isLimitReached && (
                  <a
                    href="/app/billing"
                    className="inline-flex items-center text-xs font-bold text-emerald-400 hover:text-emerald-300 underline"
                  >
                    Upgrade for More Minutes →
                  </a>
                )}
              </div>
            </div>

            {/* Deepgram Voice Agent & Gemini Architecture Card */}
            <div className="p-6 rounded-2xl bg-slate-900 border border-slate-800 flex flex-col justify-between">
              <div>
                <span className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center space-x-1.5">
                  <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Voice Agent Architecture</span>
                </span>

                <div className="mt-4 space-y-2 text-xs">
                  <div className="flex justify-between py-1 border-b border-slate-800/60">
                    <span className="text-slate-400">Voice Engine:</span>
                    <span className="font-semibold text-white">Deepgram Voice Agent</span>
                  </div>
                  <div className="flex justify-between py-1 border-b border-slate-800/60">
                    <span className="text-slate-400">Voice Intelligence (LLM):</span>
                    <span className="font-semibold text-white">Deepgram Managed OpenAI (GPT-4o-mini)</span>
                  </div>
                  <div className="flex justify-between py-1 border-b border-slate-800/60">
                    <span className="text-slate-400">Speech Recognition (STT):</span>
                    <span className="font-semibold text-white">Deepgram Flux STT (flux-general-en)</span>
                  </div>
                  <div className="flex justify-between py-1 border-b border-slate-800/60">
                    <span className="text-slate-400">Speech Generation (TTS):</span>
                    <span className="font-semibold text-white">Deepgram Aura (aura-2-thalia-en)</span>
                  </div>
                  <div className="flex justify-between py-1 border-b border-slate-800/60">
                    <span className="text-slate-400">Text AI & Knowledge:</span>
                    <span className="font-semibold text-white">Google Gemini (Chat & Embeddings)</span>
                  </div>
                  <div className="flex justify-between py-1">
                    <span className="text-slate-400">Calendar & Tools:</span>
                    <span className="font-semibold text-emerald-400">Real-Time DB Guaranteed</span>
                  </div>
                </div>
              </div>

              <div className="mt-4 pt-3 border-t border-slate-800 text-[11px] text-slate-500">
                Tenant isolation enforced &bull; Voice: Deepgram Voice Agent (Flux, Managed GPT-4o-mini, Aura) &bull; Text: Google Gemini
              </div>
            </div>
          </div>

          {/* Interactive In-Browser Voice Tester */}
          <div className="rounded-2xl bg-gradient-to-tr from-slate-900 via-slate-900 to-emerald-950/20 border border-emerald-500/30 p-6 shadow-xl">
            <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 pb-4 border-b border-slate-800">
              <div>
                <div className="flex items-center space-x-2">
                  <h2 className="text-lg font-bold text-white">Live In-Browser Voice Tester</h2>
                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/20 text-emerald-400 uppercase tracking-wider">
                    Interactive
                  </span>
                </div>
                <p className="text-xs text-slate-300 mt-1">
                  Test your dedicated AI receptionist right now using your browser microphone and speakers. Ask about your services or check appointment availability.
                </p>
              </div>

              <div className="flex items-center gap-3 shrink-0">
                {browserVoiceStatus !== 'idle' && browserVoiceStatus !== 'ended' && browserVoiceStatus !== 'error' ? (
                  <button
                    onClick={handleEndBrowserVoiceTest}
                    className="inline-flex items-center space-x-2 px-5 py-2.5 rounded-xl bg-rose-500 hover:bg-rose-600 text-white font-bold text-xs transition shadow-lg shadow-rose-500/20"
                  >
                    <MicOff className="w-4 h-4" />
                    <span>End Voice Test</span>
                  </button>
                ) : (
                  <button
                    onClick={handleStartBrowserVoiceTest}
                    className="inline-flex items-center space-x-2 px-5 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black text-xs transition shadow-lg shadow-emerald-500/25"
                  >
                    <Mic className="w-4 h-4" />
                    <span>Start Voice Test</span>
                  </button>
                )}
              </div>
            </div>

            {/* Test Status and Transcript Stream */}
            <div className="mt-4">
              {browserVoiceStatus !== 'idle' && browserVoiceStatus !== 'ended' && browserVoiceStatus !== 'error' && (
                <div className="p-4 rounded-xl bg-slate-950 border border-emerald-500/40 flex items-center justify-between mb-4">
                  <div className="flex items-center space-x-3">
                    <span className="w-3 h-3 rounded-full bg-emerald-400 animate-ping" />
                    <div>
                      <p className="text-xs font-bold text-white">
                        {browserVoiceStatus === 'requesting_microphone' && 'Requesting microphone permission...'}
                        {browserVoiceStatus === 'connecting' && 'Connecting to Deepgram Voice Agent...'}
                        {browserVoiceStatus === 'waiting_for_gemini' && 'Configuring tenant settings...'}
                        {browserVoiceStatus === 'ready' && 'Ready — speak now'}
                        {browserVoiceStatus === 'listening' && 'Listening... Speak into your microphone.'}
                        {browserVoiceStatus === 'speaking' && 'Luna is speaking...'}
                        {browserVoiceStatus === 'active' && 'Ready — speak now'}
                        {browserVoiceStatus === 'reconnecting' && 'Reconnecting to voice service...'}
                        {browserVoiceStatus === 'loading_sdk' && 'Initializing Voice Agent...'}
                      </p>
                      <p className="text-[11px] text-slate-400">Deepgram Voice Agent &bull; Google Gemini Intelligence</p>
                    </div>
                  </div>
                  <div className="flex items-center space-x-1">
                    <span className="w-1.5 h-4 bg-emerald-400 rounded-full animate-pulse" />
                    <span className="w-1.5 h-6 bg-emerald-400 rounded-full animate-pulse delay-75" />
                    <span className="w-1.5 h-3 bg-emerald-400 rounded-full animate-pulse delay-150" />
                  </div>
                </div>
              )}

              {browserVoiceError && (
                <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs mb-4 flex items-center justify-between">
                  <span>{browserVoiceError}</span>
                  <button onClick={() => setBrowserVoiceError(null)} className="text-slate-400 hover:text-white">
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}

              {browserTranscripts.length > 0 ? (
                <div className="p-4 rounded-xl bg-slate-950/70 border border-slate-800 max-h-56 overflow-y-auto space-y-2.5">
                  {browserTranscripts.map((t, idx) => (
                    <div key={idx} className="text-xs flex items-start space-x-2">
                      <span className={`font-bold shrink-0 ${t.role === 'user' ? 'text-emerald-400' : 'text-sky-400'}`}>
                        {t.role === 'user' ? 'You:' : 'AI Receptionist:'}
                      </span>
                      <span className="text-slate-200">{t.text}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-slate-500 italic">
                  Click "Start Voice Test" to begin a live spoken conversation directly in your browser.
                </p>
              )}
            </div>
          </div>

          {/* 1-Click Website Embed & Installation */}
          <div className="rounded-2xl bg-slate-900 border border-slate-800 p-6 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-bold text-white flex items-center space-x-2">
                  <Code className="w-4 h-4 text-emerald-400" />
                  <span>1-Click Website Embed & Installation</span>
                </h2>
                <p className="text-xs text-slate-400 mt-0.5">
                  Install the AI Voice Receptionist on your website by pasting this script before the closing <code>&lt;/body&gt;</code> tag.
                </p>
              </div>

              <button
                onClick={handleCopySnippet}
                className="inline-flex items-center space-x-1.5 px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-semibold text-xs border border-slate-700 transition shrink-0"
              >
                {copiedSnippet ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-emerald-400" />
                    <span>Copied!</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5" />
                    <span>Copy Embed Code</span>
                  </>
                )}
              </button>
            </div>

            <pre className="p-4 rounded-xl bg-slate-950 border border-slate-800/80 text-xs font-mono text-emerald-400 overflow-x-auto select-all">
              {config?.embedSnippet || `<!-- ONCEClic AI Receptionist (Voice & Chat) -->\n<script>\n  window.ONCECLIC_CONFIG = { orgSlug: "your-business" };\n</script>\n<script src="https://onceclic.com/widget.js" async></script>`}
            </pre>

            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 pt-2 text-[11px] text-slate-400">
              <div className="p-2.5 rounded-lg bg-slate-950/60 border border-slate-800 text-center">
                <span className="font-semibold text-white block">WordPress</span>
                <span>Footer script or plugin</span>
              </div>
              <div className="p-2.5 rounded-lg bg-slate-950/60 border border-slate-800 text-center">
                <span className="font-semibold text-white block">Webflow</span>
                <span>Custom code in Body</span>
              </div>
              <div className="p-2.5 rounded-lg bg-slate-950/60 border border-slate-800 text-center">
                <span className="font-semibold text-white block">Shopify</span>
                <span>theme.liquid before &lt;/body&gt;</span>
              </div>
              <div className="p-2.5 rounded-lg bg-slate-950/60 border border-slate-800 text-center">
                <span className="font-semibold text-white block">Squarespace</span>
                <span>Code Injection (Footer)</span>
              </div>
              <div className="p-2.5 rounded-lg bg-slate-950/60 border border-slate-800 text-center">
                <span className="font-semibold text-white block">React / Next.js</span>
                <span>Next Script or useEffect</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ───────────────────────────────────────────────────────────────────────────── */}
      {/* TAB 2: AI PHONE RECEPTIONIST & NUMBERS (COMING SOON) */}
      {/* ───────────────────────────────────────────────────────────────────────────── */}
      {activeTab === 'phone' && (
        <div className="space-y-6">
          {/* Prominent Coming Soon Banner */}
          <div className="p-6 rounded-2xl bg-amber-500/10 border-2 border-amber-500/30 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
            <div className="flex items-start space-x-3.5">
              <div className="p-2 rounded-xl bg-amber-500/20 text-amber-400 shrink-0 mt-0.5">
                <Lock className="w-5 h-5" />
              </div>
              <div>
                <div className="flex items-center space-x-2">
                  <h2 className="text-base font-bold text-white">AI Phone Receptionist & Business Numbers</h2>
                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40 uppercase">
                    Coming Soon
                  </span>
                </div>
                <p className="text-xs text-amber-200 mt-1 max-w-2xl leading-relaxed">
                  {PHONE_COMING_SOON_MSG}
                </p>
              </div>
            </div>

            <button
              onClick={() => setActiveTab('website')}
              className="px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs transition shadow-md shadow-emerald-500/20 shrink-0"
            >
              Use Website Voice Agent →
            </button>
          </div>

          {/* Disabled Phone Number Marketplace */}
          <div className="rounded-2xl bg-slate-900 border border-slate-800 p-6 opacity-60 relative overflow-hidden select-none">
            <div className="absolute inset-0 bg-slate-950/50 backdrop-blur-[1px] z-10 flex flex-col items-center justify-center p-6 text-center">
              <Lock className="w-8 h-8 text-amber-400 mb-2" />
              <h3 className="text-sm font-bold text-white">Telephone Provisioning is Coming Soon</h3>
              <p className="text-xs text-slate-300 max-w-md mt-1">
                Purchasing and ordering phone numbers are postponed until a future release. No phone number is needed for ONCEClic website voice conversations.
              </p>
            </div>

            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-white flex items-center space-x-2">
                  <Phone className="w-4 h-4 text-slate-400" />
                  <span>Search & Buy Business Numbers</span>
                </h3>
                <span className="text-xs text-slate-500">$3.00 / month</span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <input
                  type="text"
                  disabled
                  placeholder="Area Code (e.g. 415)"
                  className="px-3.5 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-slate-500 cursor-not-allowed"
                />
                <input
                  type="text"
                  disabled
                  placeholder="City"
                  className="px-3.5 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-slate-500 cursor-not-allowed"
                />
                <button
                  disabled
                  title={PHONE_COMING_SOON_MSG}
                  className="px-4 py-2 bg-slate-800 text-slate-500 font-bold rounded-xl text-xs cursor-not-allowed"
                >
                  Search Numbers (Coming Soon)
                </button>
              </div>
            </div>
          </div>

          {/* Existing Phone Numbers (Read-Only) */}
          <div className="rounded-2xl bg-slate-900 border border-slate-800 p-6 space-y-4">
            <div>
              <h3 className="text-sm font-bold text-white">Registered Phone Records (Archived / Read-Only)</h3>
              <p className="text-xs text-slate-400 mt-0.5">
                Existing SignalWire and Telnyx telephony records remain intact in your account.
              </p>
            </div>

            {config?.phoneNumbers && config.phoneNumbers.length > 0 ? (
              <div className="divide-y divide-slate-800">
                {config.phoneNumbers.map((num) => (
                  <div key={num.id} className="py-3 flex items-center justify-between text-xs">
                    <div className="flex items-center space-x-3">
                      <span className="font-mono font-bold text-white">{num.phoneNumber}</span>
                      <span className="px-2 py-0.5 rounded text-[10px] bg-slate-800 text-slate-400 border border-slate-700">
                        {num.status}
                      </span>
                    </div>
                    <span className="text-slate-500 text-[11px]">Phone line suspended for V1</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-slate-500 italic">No phone numbers have been provisioned.</p>
            )}
          </div>
        </div>
      )}

      {/* ───────────────────────────────────────────────────────────────────────────── */}
      {/* TAB 3: BROWSER VOICE ANALYTICS & CALL HISTORY */}
      {/* ───────────────────────────────────────────────────────────────────────────── */}
      {activeTab === 'analytics' && (
        <div className="space-y-6">
          {/* Analytics Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div className="p-4 rounded-xl bg-slate-900 border border-slate-800">
              <span className="text-xs font-medium text-slate-400">Total Voice Sessions</span>
              <p className="text-2xl font-bold text-white mt-1">{analytics?.totalCalls ?? 0}</p>
            </div>
            <div className="p-4 rounded-xl bg-slate-900 border border-slate-800">
              <span className="text-xs font-medium text-slate-400">Completed Sessions</span>
              <p className="text-2xl font-bold text-emerald-400 mt-1">{analytics?.answeredCalls ?? 0}</p>
            </div>
            <div className="p-4 rounded-xl bg-slate-900 border border-slate-800">
              <span className="text-xs font-medium text-slate-400">Appointments Booked</span>
              <p className="text-2xl font-bold text-teal-300 mt-1">{analytics?.appointmentsBooked ?? 0}</p>
            </div>
            <div className="p-4 rounded-xl bg-slate-900 border border-slate-800">
              <span className="text-xs font-medium text-slate-400">Avg Session Duration</span>
              <p className="text-2xl font-bold text-white mt-1">
                {formatDuration(analytics?.averageDurationSeconds)}
              </p>
            </div>
          </div>

          {/* Voice Session Logs */}
          <div className="rounded-2xl bg-slate-900 border border-slate-800 p-6 space-y-4">
            <div>
              <h3 className="text-base font-bold text-white">Recent Voice Sessions</h3>
              <p className="text-xs text-slate-400 mt-0.5">
                Audio sessions conducted through the website AI voice receptionist.
              </p>
            </div>

            {calls.length === 0 ? (
              <p className="text-xs text-slate-500 py-6 text-center italic">
                No voice sessions recorded yet. Test your agent in the "Website AI Voice Agent" tab.
              </p>
            ) : (
              <div className="divide-y divide-slate-800">
                {calls.map((call) => (
                  <div key={call.id} className="py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
                    <div>
                      <div className="flex items-center space-x-2">
                        <span className="font-semibold text-white">
                          {call.callerPhone || 'Website Visitor'}
                        </span>
                        <span className="px-2 py-0.5 rounded text-[10px] bg-slate-800 text-slate-300">
                          {call.status}
                        </span>
                        <span className="px-1.5 py-0.2 rounded text-[9px] bg-emerald-500/10 text-emerald-400 font-mono">
                          {call.direction}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-400 mt-0.5">
                        {new Date(call.createdAt).toLocaleString()} &bull; Duration: {formatDuration(call.durationSeconds)}
                      </p>
                    </div>

                    <div className="flex items-center space-x-2">
                      {call.recordingUrl && (
                        <button
                          onClick={() => playRecording(call.id)}
                          className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-white font-medium text-xs border border-slate-700 flex items-center space-x-1"
                        >
                          {playingRecordingId === call.id ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3" />}
                          <span>{playingRecordingId === call.id ? 'Pause' : 'Listen'}</span>
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ───────────────────────────────────────────────────────────────────────────── */}
      {/* TAB 4: INDUSTRY & PERSONA SETTINGS */}
      {/* ───────────────────────────────────────────────────────────────────────────── */}
      {activeTab === 'settings' && (
        <div className="rounded-2xl bg-slate-900 border border-slate-800 p-6 space-y-6">
          <div className="flex items-center gap-3 pb-4 border-b border-slate-800">
            <div className="p-2 bg-emerald-500/10 rounded-lg text-emerald-400">
              <Settings className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white">Industry & Receptionist Behavior</h2>
              <p className="text-xs text-slate-400 mt-0.5">Configure your business vertical and conversational preferences.</p>
            </div>
          </div>

          <div className="space-y-4 max-w-xl">
            <div>
              <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">
                Business Vertical / Industry
              </label>
              <select
                value={industryType}
                onChange={(e) => setIndustryType(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-white text-xs focus:outline-none focus:border-emerald-500"
              >
                <option value="clinic">Clinic / Healthcare</option>
                <option value="restaurant">Restaurant / Dining</option>
                <option value="salon">Salon / Beauty Parlour</option>
                <option value="general">General Business / Professional Services</option>
              </select>
              <p className="text-[11px] text-slate-500 mt-1">Determines AI receptionist behavior and conversational prompts.</p>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">
                Human Staff Transfer Phone Number (E.164)
              </label>
              <input
                type="tel"
                value={transferPhoneNumber}
                onChange={(e) => setTransferPhoneNumber(e.target.value)}
                placeholder="+12125551234"
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-white text-xs focus:outline-none focus:border-emerald-500"
              />
              <p className="text-[11px] text-slate-500 mt-1">Provided to website visitors when human escalation is requested.</p>
            </div>

            <div className="pt-2">
              <button
                onClick={saveIndustryConfig}
                disabled={savingIndustryConfig}
                className="px-5 py-2.5 bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-slate-950 font-bold text-xs rounded-xl transition shadow-md shadow-emerald-500/20"
              >
                {savingIndustryConfig ? 'Saving...' : 'Save Settings'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Hidden audio element for call recording playback */}
      <audio
        ref={audioRef}
        src={recordingUrl || undefined}
        onEnded={() => setPlayingRecordingId(null)}
        onError={() => {
          setRecordingError('Playback error');
          setPlayingRecordingId(null);
        }}
        className="hidden"
      />
    </div>
  );
};
