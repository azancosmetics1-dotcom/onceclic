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
  PLAN_PHONE_NUMBER_LIMITS,
  PLAN_MONTHLY_CALL_LIMITS,
} from '@onceclic/shared';
import {
  Phone,
  PhoneCall,
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
  Globe,
  ShieldCheck,
  AlertTriangle,
  RefreshCw,
  Info,
  FileCheck,
  Play,
  Pause,
  Settings,
  Scissors,
  ExternalLink,
  TrendingUp,
} from 'lucide-react';
import { Badge } from '../components/Badge';
export const AIReceptionistPage: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const [config, setConfig] = useState<CustomerVoiceConfig | null>(null);
  const [calls, setCalls] = useState<VoiceCallRecord[]>([]);
  const [analytics, setAnalytics] = useState<VoiceAnalyticsSummary | null>(null);
  const [countries, setCountries] = useState<TelephonyCountryInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [pollingPostCheckout, setPollingPostCheckout] = useState(false);
  const [postCheckoutMsg, setPostCheckoutMsg] = useState<string | null>(null);
  const [cancellingNumberId, setCancellingNumberId] = useState<string | null>(null);
  const [renewingNumberId, setRenewingNumberId] = useState<string | null>(null);

  // Setup Form State
  // Note: "Connect Existing Number" has been removed — only new Telnyx numbers supported.

  // New Number Flow State
  const [selectedCountry, setSelectedCountry] = useState<string>('US');
  const [selectedNumberType, setSelectedNumberType] = useState<string>('local');
  const [areaCodeInput, setAreaCodeInput] = useState<string>('415');
  const [searchingNumbers, setSearchingNumbers] = useState<boolean>(false);
  const [availableNumbers, setAvailableNumbers] = useState<AvailablePhoneNumber[]>([]);
  const [selectedNumberForOrder, setSelectedNumberForOrder] = useState<AvailablePhoneNumber | null>(null);
  const [showOrderConfirmModal, setShowOrderConfirmModal] = useState<boolean>(false);
  const [orderingNumber, setOrderingNumber] = useState<boolean>(false);
  const [orderProgressState, setOrderProgressState] = useState<string | null>(null);

  // Existing number flow removed — only new Telnyx numbers are supported.

  // Test Call Modal State
  const [testCallLoadingId, setTestCallLoadingId] = useState<string | null>(null);
  const [testCallResult, setTestCallResult] = useState<{
    phoneNumber: string;
    transcript: string;
    durationSeconds: number;
    success: boolean;
  } | null>(null);

  // Transcript Modal State
  const [selectedTranscript, setSelectedTranscript] = useState<{
    caller: string;
    date: string;
    text: string;
  } | null>(null);

  const [retryingNumberId, setRetryingNumberId] = useState<string | null>(null);

  // Industry Config State
  const [industryType, setIndustryType] = useState<string>('clinic');
  const [transferPhoneNumber, setTransferPhoneNumber] = useState<string>('');
  const [savingIndustryConfig, setSavingIndustryConfig] = useState(false);
  const [industryConfigLoaded, setIndustryConfigLoaded] = useState(false);

  // Recording audio player state
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
      if (countriesRes && countriesRes.length > 0) setCountries(countriesRes);
      if (industryRes) {
        setIndustryType(industryRes.industryType || 'clinic');
        setTransferPhoneNumber(industryRes.transferPhoneNumber || '');
        setIndustryConfigLoaded(true);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to load voice receptionist data.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  // Post-checkout polling when customer returns from Creem checkout
  useEffect(() => {
    const checkoutStatus = searchParams.get('checkout');
    const checkoutPhone = searchParams.get('phone');
    if (checkoutStatus === 'success' && checkoutPhone) {
      setPollingPostCheckout(true);
      setPostCheckoutMsg(`Payment confirmed for ${checkoutPhone}! Verifying subscription and setting up your business number...`);

      let attempts = 0;
      const interval = setInterval(async () => {
        attempts++;
        try {
          const statusRes = await api.getVoiceStatus();
          if (statusRes) {
            setConfig(statusRes);
            const matchingPhone = (statusRes.phoneNumbers || []).find(
              (n) => n.phoneNumber === checkoutPhone || n.phoneNumber.includes(checkoutPhone.replace(/\D/g, ''))
            );
            if (matchingPhone && matchingPhone.status === 'ACTIVE') {
              clearInterval(interval);
              setPollingPostCheckout(false);
              setSuccessMsg(`Phone number ${matchingPhone.phoneNumber} is now active and ready for AI calls!`);
              setPostCheckoutMsg(null);
              searchParams.delete('checkout');
              searchParams.delete('phone');
              searchParams.delete('checkoutId');
              setSearchParams(searchParams);
              loadData();
              return;
            }
          }
        } catch {
          // Continue polling on transient errors
        }

        if (attempts >= 12) {
          clearInterval(interval);
          setPollingPostCheckout(false);
          setPostCheckoutMsg(`Number provisioning is completing on carrier networks. Please refresh shortly.`);
        }
      }, 2500);

      return () => clearInterval(interval);
    }
  }, [searchParams]);

  // Update available number types when country changes
  const activeCountryInfo = countries.find((c) => c.countryCode === selectedCountry) || countries[0];
  useEffect(() => {
    if (activeCountryInfo && !activeCountryInfo.supportedNumberTypes.includes(selectedNumberType as any)) {
      setSelectedNumberType(activeCountryInfo.supportedNumberTypes[0] || 'local');
    }
  }, [selectedCountry, activeCountryInfo]);

  // Search available numbers
  const handleSearchNumbers = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    try {
      setSearchingNumbers(true);
      setError(null);
      const results = await api.getAvailableVoiceNumbers({
        country: selectedCountry,
        type: selectedNumberType,
        areaCode: areaCodeInput.trim() || undefined,
        limit: 5,
      });
      setAvailableNumbers(results);
      if (results.length === 0) {
        setError(`No numbers currently available in ${selectedCountry} with area code ${areaCodeInput}. Try another area code.`);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to search available phone numbers.');
    } finally {
      setSearchingNumbers(false);
    }
  };

  // Open confirmation modal for ordering number
  const handleSelectNumberForOrder = (number: AvailablePhoneNumber) => {
    setSelectedNumberForOrder(number);
    setShowOrderConfirmModal(true);
  };

  // Initiate independent Creem checkout session ($3 one-time for trial or $3/mo recurring)
  const handleConfirmOrder = async () => {
    if (!selectedNumberForOrder) return;

    try {
      setOrderingNumber(true);
      setError(null);
      setOrderProgressState('INITIATING_CHECKOUT');

      const idempotencyKey = `ord_${selectedCountry}_${selectedNumberForOrder.phoneNumber}_${Date.now()}`;
      const isTrial = usage?.planTier === 'TRIAL';
      const checkoutType = isTrial ? 'TRIAL_ONE_TIME' : 'RECURRING';

      const res = await api.createVoiceNumberCheckoutSession({
        phoneNumber: selectedNumberForOrder.phoneNumber,
        countryCode: selectedNumberForOrder.countryCode,
        numberType: selectedNumberForOrder.numberType,
        expectedMonthlyCostUsd: 3.00,
        expectedSetupCostUsd: selectedNumberForOrder.setupCostUsd,
        idempotencyKey,
        checkoutType,
      });

      const checkoutData = res?.data || res;
      const checkoutUrl = checkoutData?.checkoutUrl;

      if (checkoutUrl) {
        setOrderProgressState('REDIRECTING');
        setShowOrderConfirmModal(false);
        // Redirect customer to Creem secure checkout
        window.location.href = checkoutUrl;
        return;
      }

      setSuccessMsg(`Checkout session created. Please proceed to payment.`);
      setShowOrderConfirmModal(false);
      setSelectedNumberForOrder(null);
      setAvailableNumbers([]);
      await loadData();
    } catch (err: any) {
      setError(err.message || 'Phone number checkout initiation failed.');
      setOrderProgressState('FAILED');
    } finally {
      setOrderingNumber(false);
    }
  };

  // Initiate manual renewal checkout for a temporary or retained phone number ($3/month recurring)
  const handleRenewNumber = async (num: VoicePhoneNumber) => {
    try {
      setRenewingNumberId(num.id);
      setError(null);
      const idempotencyKey = `renew_${num.phoneNumber}_${Date.now()}`;

      const res = await api.createVoiceNumberCheckoutSession({
        phoneNumber: num.phoneNumber,
        countryCode: num.countryCode || 'US',
        numberType: num.phoneNumberType || 'local',
        expectedMonthlyCostUsd: 3.00,
        idempotencyKey,
        checkoutType: 'RENEWAL',
        targetPhoneNumberId: num.id,
      });

      const checkoutData = res?.data || res;
      const checkoutUrl = checkoutData?.checkoutUrl;

      if (checkoutUrl) {
        window.location.href = checkoutUrl;
        return;
      }

      setSuccessMsg('Renewal checkout created. Please proceed to payment.');
      await loadData();
    } catch (err: any) {
      setError(err.message || 'Failed to initiate phone number renewal.');
    } finally {
      setRenewingNumberId(null);
    }
  };

  // Cancel individual phone number subscription without touching main plan
  const handleCancelSubscription = async (id: string, phoneStr: string) => {
    if (!window.confirm(`Are you sure you want to cancel the recurring subscription for ${phoneStr}? The number will remain active until the end of your billing cycle. Your main subscription will NOT be cancelled.`)) {
      return;
    }

    try {
      setCancellingNumberId(id);
      setError(null);
      const res = await api.cancelVoiceNumberRental(id);
      const data = res?.data || res;
      setSuccessMsg(data?.message || `Subscription for ${phoneStr} scheduled for cancellation at period end.`);
      await loadData();
    } catch (err: any) {
      setError(err.message || 'Failed to cancel phone number subscription.');
    } finally {
      setCancellingNumberId(null);
    }
  };

  // Run test call to verify AI Receptionist routing before marking ACTIVE
  const handleRunTestCall = async (id: string, phoneStr: string) => {
    try {
      setTestCallLoadingId(id);
      setError(null);
      const res = await api.testVoiceCall(id);
      const data = res.data || res;
      if (data.success) {
        setTestCallResult({
          phoneNumber: phoneStr,
          transcript: data.transcript || 'AI Receptionist answered successfully and verified business knowledge.',
          durationSeconds: data.durationSeconds || 15,
          success: true,
        });
        setSuccessMsg(`Test call successful! ${phoneStr} is now ACTIVE and answering calls with ONCEClic AI.`);
      } else {
        setError(data.message || 'Test call failed to connect.');
      }
      await loadData();
    } catch (err: any) {
      setError(err.message || 'Failed to execute test call.');
    } finally {
      setTestCallLoadingId(null);
    }
  };

  // Disconnect / Delete number
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

  // Safe retry for failed phone number provisioning
  const handleRetryProvisioning = async (id: string, phoneStr: string) => {
    try {
      setRetryingNumberId(id);
      setError(null);
      await api.retryVoiceNumber(id);
      setSuccessMsg(`Provisioning for ${phoneStr} resumed! Click Run AI Test Call below once ready.`);
      await loadData();
    } catch (err: any) {
      setError(err.message || 'Retry failed.');
    } finally {
      setRetryingNumberId(null);
    }
  };

  // Industry config save handler
  const saveIndustryConfig = async () => {
    setSavingIndustryConfig(true);
    setError(null);
    try {
      await api.updateIndustryConfig({
        industryType,
        transferPhoneNumber: transferPhoneNumber.trim() || null,
      });
      setSuccessMsg('Industry configuration saved successfully.');
    } catch (err: any) {
      setError(err.message || 'Failed to save industry configuration.');
    } finally {
      setSavingIndustryConfig(false);
    }
  };

  // Audio player: load signed URL and play
  const handlePlayRecording = async (callId: string) => {
    if (playingRecordingId === callId) {
      // Toggle pause
      if (audioRef.current) {
        if (audioRef.current.paused) {
          audioRef.current.play();
        } else {
          audioRef.current.pause();
        }
      }
      return;
    }

    setRecordingLoading(callId);
    setRecordingError(null);
    setPlayingRecordingId(null);
    setRecordingUrl(null);

    try {
      const result = await api.getRecordingSignedUrl(callId);
      const url = result?.signedUrl;
      if (!url) throw new Error('No signed URL returned.');
      setRecordingUrl(url);
      setPlayingRecordingId(callId);
    } catch (err: any) {
      setRecordingError(err.message || 'Recording not available.');
    } finally {
      setRecordingLoading(null);
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
  const isCallLimitReached = usage?.callLimitReached ?? usage?.limitReached ?? false;
  const isPhoneLimitReached = usage?.phoneNumberLimitReached ?? false;
  const usedCalls = usage?.usedCalls ?? 0;
  const maxCalls = usage?.maxMonthlyCalls ?? (PLAN_MONTHLY_CALL_LIMITS[usage?.planTier ?? 'PRO'] ?? 50);
  const callPct = Math.min(100, Math.round((usedCalls / Math.max(1, maxCalls)) * 100));
  const activePhones = usage?.activePhoneNumbers ?? (config?.phoneNumbers?.filter(n => n.status === 'ACTIVE').length ?? 0);
  const maxPhones = usage?.maxPhoneNumbers ?? (PLAN_PHONE_NUMBER_LIMITS[usage?.planTier ?? 'PRO'] ?? 3);

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
                  <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/30">
                    Setup Required
                  </span>
                )}
              </div>
              <p className="text-sm text-slate-400 mt-1">
                24/7 AI Voice Receptionist powered by Vapi & Telnyx. Answers business questions, schedules appointments, and routes calls.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Alerts */}
      {pollingPostCheckout && (
        <div className="p-4 rounded-xl bg-sky-500/10 border border-sky-500/30 flex items-start space-x-3 text-sky-300">
          <RefreshCw className="w-5 h-5 shrink-0 mt-0.5 animate-spin" />
          <div className="text-sm">
            <p className="font-semibold">{postCheckoutMsg}</p>
            <p className="text-xs text-slate-400 mt-1">Please wait while our telephony network assigns your AI assistant.</p>
          </div>
        </div>
      )}

      {!pollingPostCheckout && postCheckoutMsg && (
        <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-start space-x-3 text-amber-300">
          <Info className="w-5 h-5 shrink-0 mt-0.5" />
          <div className="text-sm">{postCheckoutMsg}</div>
        </div>
      )}

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

      {/* Usage Stats Grid — Call Allowance + Phone Number Quota */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* Monthly Call Allowance */}
        <div className="lg:col-span-2 p-6 rounded-2xl bg-slate-900/90 border border-slate-800 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center space-x-1.5">
                <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />
                <span>Monthly AI Call Allowance</span>
              </span>
              <span className="text-xs font-semibold px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                {usage?.planTier || 'PRO'} Plan
              </span>
            </div>

            <div className="mt-4 flex items-baseline justify-between flex-wrap gap-2">
              <div className="flex items-baseline space-x-2">
                <span className={`text-3xl font-extrabold ${isCallLimitReached ? 'text-rose-400' : 'text-white'}`}>
                  {usedCalls}
                </span>
                <span className="text-slate-400 text-base font-medium">/ {maxCalls} calls used this month</span>
              </div>
              <span className="text-xs text-slate-400 bg-slate-800/80 px-2 py-0.5 rounded border border-slate-700/50 font-medium">
                Max 2 min / call
              </span>
            </div>

            {/* Progress Bar */}
            <div className="mt-3 w-full bg-slate-800 rounded-full h-2.5 overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-500 ${
                  callPct > 90
                    ? 'bg-rose-500'
                    : callPct > 70
                    ? 'bg-amber-500'
                    : 'bg-gradient-to-r from-emerald-500 to-teal-400'
                }`}
                style={{ width: `${callPct}%` }}
              />
            </div>

            {callPct > 70 && !isCallLimitReached && (
              <p className="mt-2 text-xs text-amber-400 flex items-center space-x-1">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                <span>Approaching monthly call limit — {maxCalls - usedCalls} calls remaining.</span>
              </p>
            )}
            {isCallLimitReached && (
              <p className="mt-2 text-xs text-rose-400 flex items-center space-x-1">
                <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                <span>Monthly call limit reached. Callers will hear a polite message until your plan resets.</span>
              </p>
            )}
          </div>

          <div className="mt-4 pt-4 border-t border-slate-800 flex flex-col sm:flex-row items-start sm:items-center justify-between text-xs text-slate-400 gap-2">
            <div className="flex items-center space-x-1.5">
              <Sparkles className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>Call allowance resets at the start of each billing cycle.</span>
            </div>
            {isCallLimitReached && (
              <a
                href="/app/billing"
                className="inline-flex items-center text-xs font-bold text-emerald-400 hover:text-emerald-300 underline"
              >
                Upgrade for More Calls →
              </a>
            )}
          </div>
        </div>

        {/* Phone Number Quota Card */}
        <div className="p-6 rounded-2xl bg-slate-900/90 border border-slate-800 flex flex-col justify-between">
          <div>
            <span className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center space-x-1.5">
              <Phone className="w-3.5 h-3.5" />
              <span>Phone Numbers</span>
            </span>
            <div className="mt-3 flex items-baseline space-x-1">
              <span className={`text-3xl font-extrabold ${isPhoneLimitReached ? 'text-amber-400' : 'text-white'}`}>
                {activePhones}
              </span>
              <span className="text-slate-400 text-base">/ {maxPhones}</span>
            </div>
            <p className="text-xs text-slate-500 mt-1">active numbers on your plan</p>
            {config?.activeNumber ? (
              <div className="mt-3">
                <p className="text-sm font-mono font-bold text-white tracking-wide">{config.activeNumber}</p>
                <p className="text-xs text-emerald-400 mt-1 flex items-center space-x-1">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>Connected & Active</span>
                </p>
              </div>
            ) : (
              <div className="mt-3">
                <p className="text-sm text-slate-400 font-medium">No active number</p>
                <p className="text-xs text-slate-500 mt-1">Purchase a Telnyx number below</p>
              </div>
            )}
          </div>
          <div className="mt-4 pt-4 border-t border-slate-800">
            {isPhoneLimitReached ? (
              <a href="/app/billing" className="text-xs font-bold text-amber-400 hover:text-amber-300 underline flex items-center space-x-1">
                <span>Upgrade to add more numbers →</span>
              </a>
            ) : (
              <p className="text-xs text-slate-500">
                {maxPhones - activePhones} number slot{maxPhones - activePhones !== 1 ? 's' : ''} available
              </p>
            )}
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

      {/* Industry Configuration Panel */}
      <div className="rounded-2xl bg-slate-900 border border-slate-800 overflow-hidden">
        <div className="p-5 border-b border-slate-800 flex items-center gap-3">
          <div className="p-2 bg-blue-500/10 rounded-lg">
            <Settings className="w-5 h-5 text-blue-400" />
          </div>
          <div>
            <h2 className="text-base font-bold text-white">Industry & Transfer Settings</h2>
            <p className="text-xs text-slate-400 mt-0.5">Configure your business type and human transfer number</p>
          </div>
        </div>
        <div className="p-5 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1.5">Business Industry</label>
              <select
                value={industryType}
                onChange={(e) => setIndustryType(e.target.value)}
                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2.5 text-white text-sm focus:outline-none focus:border-blue-500"
              >
                <option value="clinic">Clinic / Healthcare</option>
                <option value="restaurant">Restaurant</option>
                <option value="salon">Salon / Beauty Parlour</option>
              </select>
              <p className="text-xs text-slate-500 mt-1">Determines AI receptionist behavior and available tools.</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1.5">Human Transfer Number (E.164)</label>
              <input
                type="tel"
                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2.5 text-white text-sm focus:outline-none focus:border-blue-500"
                value={transferPhoneNumber}
                onChange={(e) => setTransferPhoneNumber(e.target.value)}
                placeholder="+12125551234"
              />
              <p className="text-xs text-slate-500 mt-1">AI will transfer calls here when a human is requested.</p>
            </div>
          </div>
          {industryType === 'salon' && (
            <div className="bg-purple-500/10 border border-purple-500/20 rounded-lg p-3 flex items-center gap-3">
              <Scissors className="w-4 h-4 text-purple-400 flex-shrink-0" />
              <div className="flex-1 text-sm text-purple-200">
                You have selected Salon mode. Manage your services and stylists in the Salon Management page.
              </div>
              <a
                href="/app/salon"
                className="text-xs text-purple-400 hover:text-purple-300 flex items-center gap-1 flex-shrink-0"
              >
                Open <ExternalLink className="w-3 h-3" />
              </a>
            </div>
          )}
          <div className="flex justify-end">
            <button
              onClick={saveIndustryConfig}
              disabled={savingIndustryConfig}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors"
            >
              {savingIndustryConfig ? 'Saving…' : 'Save Settings'}
            </button>
          </div>
        </div>
      </div>

      {/* Phone Number Setup Section — Purchase New Telnyx Number */}
      <div className="rounded-2xl bg-slate-900 border border-slate-800 overflow-hidden">
        <div className="p-6 border-b border-slate-800">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div>
              <h2 className="text-lg font-bold text-white flex items-center space-x-2">
                <Phone className="w-5 h-5 text-emerald-400" />
                <span>Get a Dedicated Business Phone Number</span>
              </h2>
              <p className="text-sm text-slate-400 mt-1">
                Purchase a new Telnyx number powered by Vapi AI.{' '}
                <span className="text-slate-300 font-medium">{activePhones}/{maxPhones} number{maxPhones !== 1 ? 's' : ''} used on your plan.</span>
              </p>
            </div>
            {isPhoneLimitReached && (
              <a
                href="/app/billing"
                className="inline-flex items-center px-4 py-2 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-400 text-sm font-semibold hover:bg-amber-500/20 transition"
              >
                Upgrade to Add More Numbers →
              </a>
            )}
          </div>

          {isPhoneLimitReached && (
            <div className="mt-4 p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-300 text-sm flex items-center space-x-2">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>
                You've reached your plan's limit of {maxPhones} phone number{maxPhones !== 1 ? 's' : ''}.
                Upgrade your plan to add more dedicated numbers.
              </span>
            </div>
          )}
        </div>

        {/* Get a New Number — Vapi + Telnyx */}
        {!isPhoneLimitReached ? (
          <div className="p-6 space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {/* Country Selection */}
              <div>
                <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">
                  Country
                </label>
                <div className="relative">
                  <Globe className="w-4 h-4 text-slate-500 absolute left-3 top-3.5" />
                  <select
                    value={selectedCountry}
                    onChange={(e) => setSelectedCountry(e.target.value)}
                    className="w-full pl-9 pr-4 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-white focus:outline-none focus:border-emerald-500 text-sm"
                  >
                    {countries.map((c) => (
                      <option key={c.countryCode} value={c.countryCode}>
                        {c.countryName} ({c.dialCode})
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Number Type Selection */}
              <div>
                <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">
                  Number Type
                </label>
                <select
                  value={selectedNumberType}
                  onChange={(e) => setSelectedNumberType(e.target.value)}
                  className="w-full px-4 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-white focus:outline-none focus:border-emerald-500 text-sm"
                >
                  {(activeCountryInfo?.supportedNumberTypes || ['local']).map((t) => (
                    <option key={t} value={t}>
                      {t === 'local' ? 'Local Number' : t === 'toll_free' ? 'Toll-Free' : t === 'national' ? 'National' : t}
                    </option>
                  ))}
                </select>
              </div>

              {/* Preferred Area Code */}
              <div>
                <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">
                  Area Code / City Prefix
                </label>
                <div className="flex space-x-2">
                  <input
                    type="text"
                    value={areaCodeInput}
                    onChange={(e) => setAreaCodeInput(e.target.value)}
                    placeholder="415"
                    className="w-full px-4 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500 text-sm"
                  />
                  <button
                    type="button"
                    onClick={() => handleSearchNumbers()}
                    disabled={searchingNumbers}
                    className="px-4 py-2.5 bg-slate-800 hover:bg-slate-700 text-white font-semibold rounded-xl text-xs whitespace-nowrap transition disabled:opacity-50"
                  >
                    {searchingNumbers ? 'Searching...' : 'Search'}
                  </button>
                </div>
              </div>
            </div>

            {/* Regulatory Notice Banner */}
            {activeCountryInfo && (
              <div className="p-4 rounded-xl bg-slate-950/60 border border-slate-800 text-xs space-y-1.5">
                <div className="flex items-center space-x-2 text-slate-300 font-semibold">
                  <ShieldCheck className="w-4 h-4 text-emerald-400" />
                  <span>Telephony Regulations & Transparency — {activeCountryInfo.countryName}</span>
                </div>
                <p className="text-slate-400 leading-relaxed">
                  {activeCountryInfo.regulatoryNotice}
                </p>
                {activeCountryInfo.regulatoryLevel !== 'NONE' && (
                  <p className="text-amber-400 flex items-center space-x-1.5 pt-1">
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                    <span>Documentation Required: {activeCountryInfo.requiredDocuments.join(', ')}</span>
                  </p>
                )}
              </div>
            )}

            {/* Available Numbers Result List */}
            {availableNumbers.length > 0 && (
              <div className="space-y-3">
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400">
                  Available Numbers in {activeCountryInfo?.countryName}
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {availableNumbers.map((num) => (
                    <div
                      key={num.phoneNumber}
                      className="p-4 rounded-xl bg-slate-950 border border-slate-800 flex items-center justify-between gap-3 hover:border-slate-700 transition"
                    >
                      <div>
                        <p className="font-mono font-bold text-white text-base">{num.nationalFormat}</p>
                        <div className="flex items-center space-x-2 mt-1">
                          <span className="text-xs text-emerald-400 font-semibold">
                            $3.00/mo
                          </span>
                          <span className="text-[10px] uppercase font-bold text-slate-500 bg-slate-900 px-1.5 py-0.5 rounded border border-slate-800">
                            {num.numberType}
                          </span>
                          <span className="text-[10px] text-slate-400">
                            (separate subscription)
                          </span>
                        </div>
                      </div>

                      <button
                        onClick={() => handleSelectNumberForOrder(num)}
                        className="px-3.5 py-2 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold rounded-xl text-xs transition shadow-md shadow-emerald-500/20"
                      >
                        Choose Number
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : null}

      </div>

      {/* Connected Phone Numbers List with Provisioning States & Test Calls */}
      {config?.phoneNumbers && config.phoneNumbers.length > 0 && (
        <div className="rounded-2xl bg-slate-900 border border-slate-800 p-6 space-y-6">
          <div>
            <h3 className="text-base font-bold text-white">Registered Business Phone Numbers</h3>
            <p className="text-xs text-slate-400 mt-0.5">
              Phone lines routing to your Vapi AI Receptionist.
            </p>
          </div>

          <div className="divide-y divide-slate-800">
            {config.phoneNumbers.map((num) => {
              const provStatus = num.provisioningStatus || num.status;
              const isTestRequired = provStatus === VoiceProvisioningStatus.TEST_REQUIRED;
              const isActive = provStatus === VoiceProvisioningStatus.ACTIVE;
              const isActionRequired = provStatus === VoiceProvisioningStatus.ACTION_REQUIRED;
              const isProvisioning = provStatus === VoiceProvisioningStatus.PROVISIONING || provStatus === VoiceProvisioningStatus.CONNECTING;
              const isFailed = provStatus === VoiceProvisioningStatus.FAILED;
              const isReleaseInProgress = num.status === 'RELEASE_IN_PROGRESS' || num.releaseStatus === 'RELEASE_IN_PROGRESS';
              const isReleased = num.status === 'RELEASED' || num.releaseStatus === 'RELEASED';
              const isReleaseFailedManual = num.status === 'RELEASE_FAILED_MANUAL_ATTENTION' || num.releaseStatus === 'RELEASE_FAILED_MANUAL_ATTENTION';

              return (
                <div key={num.id} className="py-4 space-y-4">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div className="flex items-center space-x-3">
                      <div className="p-2.5 rounded-xl bg-emerald-500/10 text-emerald-400">
                        <Phone className="w-5 h-5" />
                      </div>
                      <div>
                        <div className="flex items-center space-x-2">
                          <span className="font-mono font-bold text-white text-base">{num.phoneNumber}</span>
                          {isActive && (
                            <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 flex items-center space-x-1">
                              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 mr-1" />
                              ACTIVE
                            </span>
                          )}
                          {isTestRequired && (
                            <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/30">
                              TEST REQUIRED
                            </span>
                          )}
                          {isActionRequired && (
                            <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-purple-500/10 text-purple-400 border border-purple-500/30">
                              ACTION REQUIRED
                            </span>
                          )}
                          {isProvisioning && (
                            <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-sky-500/10 text-sky-400 border border-sky-500/30 flex items-center space-x-1">
                              <RefreshCw className="w-3 h-3 animate-spin mr-1" />
                              PROVISIONING
                            </span>
                          )}
                          {isFailed && (
                            <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-rose-500/10 text-rose-400 border border-rose-500/30">
                              FAILED
                            </span>
                          )}
                          {num.billingStatus === 'PAST_DUE' && (
                            <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/30">
                              PAST DUE (Grace Period)
                            </span>
                          )}
                          {num.cancelAtPeriodEnd && (
                            <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-slate-500/10 text-slate-400 border border-slate-500/30">
                              CANCELING AT PERIOD END
                            </span>
                          )}
                          {num.isTrialNumber && !num.renewedToSubscriptionId && num.rentalEndsAt && new Date(num.rentalEndsAt) > new Date() && (
                            <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-indigo-500/10 text-indigo-400 border border-indigo-500/30">
                              14-DAY TEMPORARY RENTAL
                            </span>
                          )}
                          {isReleaseInProgress && (
                            <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/30">
                              RELEASE IN PROGRESS
                            </span>
                          )}
                          {isReleased && (
                            <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-slate-500/10 text-slate-400 border border-slate-500/30">
                              RELEASED
                            </span>
                          )}
                          {isReleaseFailedManual && (
                            <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-rose-500/10 text-rose-400 border border-rose-500/30">
                              RELEASE FAILED (Attention Required)
                            </span>
                          )}
                          {!isReleaseInProgress && !isReleased && !isReleaseFailedManual && (num.isRetained || num.status === 'SUSPENDED' || num.billingStatus === 'SUSPENDED_GRACE_PERIOD') && (
                            <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-rose-500/10 text-rose-400 border border-rose-500/30">
                              SUSPENDED (30-Day Retention Grace Period)
                            </span>
                          )}
                        </div>
                        <div className="flex items-center space-x-3 text-xs text-slate-400 mt-1 flex-wrap gap-y-1">
                          <span>Method: {num.connectionMethod?.replace(/_/g, ' ')}</span>
                          {num.countryCode && <span>&bull; Country: {num.countryCode}</span>}
                          {num.monthlyCostUsd !== undefined && num.monthlyCostUsd > 0 && !num.isTrialNumber && (
                            <span>&bull; ${num.monthlyCostUsd.toFixed(2)}/mo (Creem)</span>
                          )}
                          {num.isTrialNumber && !num.renewedToSubscriptionId && num.rentalEndsAt && (
                            <span className="text-indigo-300">&bull; 14-day rental ends: {new Date(num.rentalEndsAt).toLocaleDateString()}</span>
                          )}
                          {(num.isRetained || num.status === 'SUSPENDED') && num.retentionEndsAt && !isReleased && !isReleaseInProgress && (
                            <span className="text-rose-400 font-semibold">&bull; Retention deadline: {new Date(num.retentionEndsAt).toLocaleDateString()}</span>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center space-x-2">
                      {/* Manual Renewal button for temporary numbers and suspended/retained numbers */}
                      {!isReleaseInProgress && !isReleased && !isReleaseFailedManual && (num.isTrialNumber || num.isRetained || num.status === 'SUSPENDED') && (
                        <button
                          onClick={() => handleRenewNumber(num)}
                          disabled={renewingNumberId === num.id}
                          className="px-3 py-1.5 rounded-xl text-xs font-bold bg-emerald-500 hover:bg-emerald-400 text-slate-950 transition shadow-md shadow-emerald-500/20 disabled:opacity-50 flex items-center space-x-1"
                          title="Manually renew this phone number for $3/month"
                        >
                          {renewingNumberId === num.id ? (
                            <>
                              <RefreshCw className="w-3.5 h-3.5 animate-spin mr-1" />
                              <span>Renewing...</span>
                            </>
                          ) : (
                            <span>Renew for $3/month</span>
                          )}
                        </button>
                      )}
                      {/* Cancel Subscription button for active numbers */}
                      {isActive && !num.cancelAtPeriodEnd && (
                        <button
                          onClick={() => handleCancelSubscription(num.id, num.phoneNumber)}
                          disabled={cancellingNumberId === num.id}
                          className="px-3 py-1.5 rounded-xl text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition disabled:opacity-50"
                          title="Cancel recurring phone number rental"
                        >
                          {cancellingNumberId === num.id ? 'Canceling...' : 'Cancel Subscription'}
                        </button>
                      )}
                      {/* Retry Button if FAILED */}
                      {isFailed && (
                        <button
                          onClick={() => handleRetryProvisioning(num.id, num.phoneNumber)}
                          disabled={retryingNumberId === num.id}
                          className="px-3 py-1.5 rounded-xl text-xs font-semibold bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 border border-rose-500/30 flex items-center space-x-1.5 disabled:opacity-50"
                        >
                          {retryingNumberId === num.id ? (
                            <>
                              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                              <span>Retrying...</span>
                            </>
                          ) : (
                            <>
                              <RefreshCw className="w-3.5 h-3.5" />
                              <span>Retry Setup</span>
                            </>
                          )}
                        </button>
                      )}

                      {/* Prominent Run Test Call Button if TEST_REQUIRED or ACTIVE */}
                      {(isTestRequired || isActive) && (
                        <button
                          onClick={() => handleRunTestCall(num.id, num.phoneNumber)}
                          disabled={testCallLoadingId === num.id}
                          className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition border flex items-center space-x-1.5 disabled:opacity-50 ${
                            isTestRequired
                              ? 'bg-amber-500 hover:bg-amber-400 text-slate-950 border-amber-400 shadow-md shadow-amber-500/20'
                              : 'bg-slate-800 hover:bg-slate-750 text-slate-200 border-slate-700'
                          }`}
                        >
                          {testCallLoadingId === num.id ? (
                            <>
                              <div className="w-3 h-3 border border-current border-t-transparent rounded-full animate-spin" />
                              <span>Calling AI...</span>
                            </>
                          ) : (
                            <>
                              <Zap className="w-3.5 h-3.5" />
                              <span>{isTestRequired ? 'Run AI Test Call' : 'Test Call'}</span>
                            </>
                          )}
                        </button>
                      )}

                      <button
                        onClick={() => handleDisconnect(num.id)}
                        className="p-1.5 text-slate-400 hover:text-rose-400 transition rounded-xl hover:bg-slate-800"
                        title="Disconnect number"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  {/* Regulatory or action required notice */}
                  {isActionRequired && (
                    <div className="p-3.5 rounded-xl bg-purple-500/10 border border-purple-500/25 text-xs text-purple-300 flex items-start space-x-2">
                      <FileCheck className="w-4 h-4 shrink-0 mt-0.5" />
                      <div>
                        <strong>Document Review Pending: </strong>
                        <span>
                          {num.actionRequiredReason || 'Regulatory address validation required by local telecom authority.'}
                        </span>
                      </div>
                    </div>
                  )}

                  {/* Failure notice */}
                  {isFailed && num.lastError && (
                    <div className="p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/25 text-xs text-rose-300 flex items-start space-x-2">
                      <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                      <div>
                        <strong>Provisioning Error: </strong>
                        <span>{num.lastError}</span>
                      </div>
                    </div>
                  )}

                  {/* Test Required Prompt */}
                  {isTestRequired && (
                    <div className="p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/25 text-xs text-amber-300 flex items-start space-x-2">
                      <Zap className="w-4 h-4 shrink-0 mt-0.5" />
                      <div>
                        <strong>Test Call Required: </strong>
                        <span>
                          Telephony routing is linked to your Vapi AI assistant. Click <strong>Run AI Test Call</strong> above to verify synthesized speech and mark the line ACTIVE.
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Confirmation Modal Before Number Order */}
      {showOrderConfirmModal && selectedNumberForOrder && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-lg w-full p-6 space-y-5 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div>
                <h3 className="font-bold text-white text-base">Confirm Phone Number Purchase</h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Direct Telnyx telephony provisioning with Vapi AI Voice integration
                </p>
              </div>
              <button
                onClick={() => setShowOrderConfirmModal(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div className="p-4 bg-slate-950 rounded-xl border border-slate-850 space-y-2">
                <div className="flex justify-between items-center text-sm font-bold text-white">
                  <span>Selected Phone Number:</span>
                  <span className="font-mono text-emerald-400">{selectedNumberForOrder.phoneNumber}</span>
                </div>
                <div className="flex justify-between items-center text-slate-300 pt-2 border-t border-slate-900">
                  <span>Current Subscription Plan:</span>
                  <span className="font-semibold text-white">{usage?.planTier || 'PRO'} Plan</span>
                </div>
                <div className="flex justify-between items-center text-slate-300">
                  <span>Plan Phone Number Limit:</span>
                  <span className="font-semibold text-slate-300">Maximum {maxPhones} active number{maxPhones === 1 ? '' : 's'}</span>
                </div>
                <div className="flex justify-between items-center text-slate-300">
                  <span>Currently Active Numbers:</span>
                  <span className="font-semibold text-slate-300">{activePhones} / {maxPhones} active</span>
                </div>
                <div className="flex justify-between items-center text-slate-200 font-bold bg-slate-900/60 p-2.5 rounded-lg border border-slate-800">
                  <span>{usage?.planTier === 'TRIAL' ? '14-Day Phone Rental Fee:' : 'Phone Number Recurring Fee:'}</span>
                  <span className="text-emerald-400 font-mono text-sm">
                    {usage?.planTier === 'TRIAL' ? '$3.00 One-Time (14 Days)' : '$3.00 / month'}
                  </span>
                </div>
                {selectedNumberForOrder.setupCostUsd > 0 && (
                  <div className="flex justify-between items-center text-slate-300">
                    <span>One-Time Provider Setup Fee:</span>
                    <span className="font-bold text-white">${selectedNumberForOrder.setupCostUsd.toFixed(2)}</span>
                  </div>
                )}
              </div>

              {selectedNumberForOrder.requiresDocuments && (
                <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-xl text-amber-300 space-y-1">
                  <p className="font-bold flex items-center space-x-1">
                    <AlertTriangle className="w-3.5 h-3.5" />
                    <span>Regulatory Requirements:</span>
                  </p>
                  <p className="text-[11px] leading-relaxed">
                    {selectedNumberForOrder.regulatoryRequirement}
                  </p>
                </div>
              )}

              <div className="p-3.5 bg-emerald-500/10 border border-emerald-500/25 rounded-xl text-emerald-300 text-[11px] leading-relaxed space-y-1">
                <p className="font-semibold">
                  {usage?.planTier === 'TRIAL'
                    ? '14-Day Temporary Rental Notice:'
                    : 'Independent Subscription Notice:'}
                </p>
                <p>
                  {usage?.planTier === 'TRIAL'
                    ? 'This is a 14-day temporary rental billed as a one-time non-recurring charge of $3.00 USD via Creem. It does NOT automatically renew. When the 14 days end, service is suspended, and you have a 30-day retention grace period to manually renew for $3/month before the number is released.'
                    : 'This phone number has its own recurring subscription of $3.00 USD/month via Creem. It is billed independently from your main ONCEClic plan. Canceling or changing your main subscription will never automatically cancel or release your phone number.'}
                </p>
              </div>
            </div>

            <div className="flex justify-end space-x-3 pt-2">
              <button
                type="button"
                onClick={() => setShowOrderConfirmModal(false)}
                disabled={orderingNumber}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white text-xs font-semibold rounded-xl transition"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmOrder}
                disabled={orderingNumber}
                className="px-5 py-2.5 bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-bold rounded-xl transition shadow-md shadow-emerald-500/20 disabled:opacity-50 flex items-center space-x-1.5"
              >
                {orderingNumber ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    <span>{orderProgressState === 'REDIRECTING' ? 'Redirecting to Creem Checkout...' : 'Preparing Checkout...'}</span>
                  </>
                ) : (
                  <span>
                    {usage?.planTier === 'TRIAL'
                      ? 'Proceed to Checkout — $3 (14 Days)'
                      : 'Proceed to Checkout — $3/month'}
                  </span>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Test Call Verification Modal */}
      {testCallResult && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-lg w-full p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div>
                <h3 className="font-bold text-white text-base flex items-center space-x-1.5">
                  <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                  <span>AI Receptionist Test Call Verified</span>
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Line: <strong className="font-mono text-white">{testCallResult.phoneNumber}</strong> &bull; {testCallResult.durationSeconds}s duration
                </p>
              </div>
              <button
                onClick={() => setTestCallResult(null)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-2">
              <span className="text-xs font-semibold text-slate-300 uppercase tracking-wider">
                Test Call Transcript
              </span>
              <div className="p-4 rounded-xl bg-slate-950 font-mono text-xs text-slate-300 whitespace-pre-wrap max-h-60 overflow-y-auto leading-relaxed border border-slate-850">
                {testCallResult.transcript}
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <button
                onClick={() => setTestCallResult(null)}
                className="px-4 py-2 bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-bold rounded-xl transition shadow-md shadow-emerald-500/20"
              >
                Done (Receptionist Active)
              </button>
            </div>
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
                      <div className="flex items-center justify-end gap-2">
                        {/* Recording playback button */}
                        {(c as any).recordingSyncStatus === 'SYNCED' && (
                          <button
                            onClick={() => handlePlayRecording(c.id)}
                            disabled={recordingLoading === c.id}
                            className="inline-flex items-center space-x-1 px-2.5 py-1 rounded-lg text-xs font-medium bg-slate-800 hover:bg-blue-800/60 text-slate-200 transition disabled:opacity-50"
                            title="Play recording"
                          >
                            {recordingLoading === c.id ? (
                              <RefreshCw className="w-3.5 h-3.5 text-blue-400 animate-spin" />
                            ) : playingRecordingId === c.id ? (
                              <Pause className="w-3.5 h-3.5 text-blue-400" />
                            ) : (
                              <Play className="w-3.5 h-3.5 text-blue-400" />
                            )}
                            <span>{playingRecordingId === c.id ? 'Pause' : 'Play'}</span>
                          </button>
                        )}
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
                      </div>
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

      {/* Hidden Audio Element for Recording Playback */}
      {recordingUrl && playingRecordingId && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl p-4 flex items-center gap-4 min-w-80">
          <div className="flex items-center gap-2 flex-shrink-0">
            <Volume2 className="w-4 h-4 text-blue-400" />
            <span className="text-sm text-white font-medium">Recording</span>
          </div>
          <audio
            ref={audioRef}
            src={recordingUrl}
            autoPlay
            controls
            className="flex-1 h-8"
            style={{ accentColor: '#3b82f6' }}
            onEnded={() => { setPlayingRecordingId(null); setRecordingUrl(null); }}
            onError={() => { setRecordingError('Recording failed to load. The signed URL may have expired.'); setPlayingRecordingId(null); setRecordingUrl(null); }}
          />
          <button
            onClick={() => { setPlayingRecordingId(null); setRecordingUrl(null); if (audioRef.current) audioRef.current.pause(); }}
            className="text-slate-400 hover:text-white transition-colors flex-shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}
      {recordingError && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-rose-900/90 border border-rose-700 rounded-xl shadow-2xl p-3 flex items-center gap-3">
          <AlertCircle className="w-4 h-4 text-rose-400 flex-shrink-0" />
          <span className="text-sm text-rose-200">{recordingError}</span>
          <button onClick={() => setRecordingError(null)} className="text-rose-400 hover:text-white">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}
    </div>
  );
};
