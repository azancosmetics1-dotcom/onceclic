import React, { useEffect, useState } from 'react';
import { api } from '../api/client';
import {
  CustomerVoiceConfig,
  VoicePhoneNumber,
  VoiceCallRecord,
  VoiceAnalyticsSummary,
  VoiceConnectionMethod,
  VoiceProvisioningStatus,
  TelephonyCountryInfo,
  AvailablePhoneNumber,
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
  Globe,
  ShieldCheck,
  AlertTriangle,
  RefreshCw,
  Info,
  FileCheck,
} from 'lucide-react';
import { Badge } from '../components/Badge';

export const AIReceptionistPage: React.FC = () => {
  const [config, setConfig] = useState<CustomerVoiceConfig | null>(null);
  const [calls, setCalls] = useState<VoiceCallRecord[]>([]);
  const [analytics, setAnalytics] = useState<VoiceAnalyticsSummary | null>(null);
  const [countries, setCountries] = useState<TelephonyCountryInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Setup Form State
  const [activeTab, setActiveTab] = useState<'NEW' | 'EXISTING'>('NEW');

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

  // Existing Number Flow State
  const [existingCountry, setExistingCountry] = useState<string>('US');
  const [existingMethod, setExistingMethod] = useState<VoiceConnectionMethod>(
    VoiceConnectionMethod.EXISTING_FORWARDING
  );
  const [inputPhoneNumber, setInputPhoneNumber] = useState('');
  const [validatingExisting, setValidatingExisting] = useState(false);
  const [existingValidationResult, setExistingValidationResult] = useState<any | null>(null);
  const [verificationCode, setVerificationCode] = useState('');
  const [verifyingCode, setVerifyingCode] = useState(false);
  const [submittingExisting, setSubmittingExisting] = useState(false);

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

  const loadData = async () => {
    try {
      setLoading(true);
      setError(null);

      const [statusRes, callsRes, analyticsRes, countriesRes] = await Promise.all([
        api.getVoiceStatus().catch(() => null),
        api.getVoiceCalls(50).catch(() => []),
        api.getVoiceAnalytics().catch(() => null),
        api.getVoiceCountries().catch(() => []),
      ]);

      if (statusRes) setConfig(statusRes);
      if (callsRes) setCalls(callsRes);
      if (analyticsRes) setAnalytics(analyticsRes);
      if (countriesRes && countriesRes.length > 0) setCountries(countriesRes);
    } catch (err: any) {
      setError(err.message || 'Failed to load voice receptionist data.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

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

  // Execute server-side order with explicit confirmation & idempotency key
  const handleConfirmOrder = async () => {
    if (!selectedNumberForOrder) return;

    try {
      setOrderingNumber(true);
      setError(null);
      setOrderProgressState('PROVISIONING');

      const idempotencyKey = `ord_${selectedCountry}_${selectedNumberForOrder.phoneNumber}_${Date.now()}`;

      await api.orderNewVoiceNumber({
        phoneNumber: selectedNumberForOrder.phoneNumber,
        countryCode: selectedNumberForOrder.countryCode,
        numberType: selectedNumberForOrder.numberType,
        idempotencyKey,
        confirmPurchase: true,
        expectedMonthlyCostUsd: selectedNumberForOrder.monthlyCostUsd,
        expectedSetupCostUsd: selectedNumberForOrder.setupCostUsd,
      });

      setOrderProgressState('CONNECTING');
      await new Promise((r) => setTimeout(r, 600));

      setOrderProgressState('TEST_REQUIRED');
      setSuccessMsg(`Phone number ${selectedNumberForOrder.phoneNumber} provisioned! Run a test call below to activate your AI receptionist.`);
      setShowOrderConfirmModal(false);
      setSelectedNumberForOrder(null);
      setAvailableNumbers([]);
      await loadData();
    } catch (err: any) {
      setError(err.message || 'Phone number provisioning failed.');
      setOrderProgressState('FAILED');
    } finally {
      setOrderingNumber(false);
    }
  };

  // Validate existing number
  const handleValidateExisting = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputPhoneNumber.trim()) {
      setError('Please enter your business phone number.');
      return;
    }

    try {
      setValidatingExisting(true);
      setError(null);
      const res = await api.validateExistingVoiceNumber({
        phoneNumber: inputPhoneNumber.trim(),
        countryCode: existingCountry,
      });
      setExistingValidationResult(res.data || res);
    } catch (err: any) {
      setError(err.message || 'Failed to validate phone number.');
      setExistingValidationResult(null);
    } finally {
      setValidatingExisting(false);
    }
  };

  // Connect existing number
  const handleConnectExisting = async () => {
    if (!inputPhoneNumber.trim()) return;

    try {
      setSubmittingExisting(true);
      setError(null);
      await api.connectExistingVoiceNumber({
        phoneNumber: inputPhoneNumber.trim(),
        countryCode: existingCountry,
        connectionMethod: existingMethod,
        forwardingTarget: existingValidationResult?.forwardingTarget,
      });
      setSuccessMsg('Your business phone number has been linked! Perform a test call to activate.');
      setInputPhoneNumber('');
      setExistingValidationResult(null);
      await loadData();
    } catch (err: any) {
      setError(err.message || 'Failed to connect phone number.');
    } finally {
      setSubmittingExisting(false);
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

      {/* Voice Usage Meter & Plan Allowance */}
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
              <span>Voice AI conversation limits automatically reset at the start of each billing cycle.</span>
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
                    <span>Connected ({config.connectionMethod?.replace(/_/g, ' ')})</span>
                  </p>
                </div>
              ) : (
                <div>
                  <p className="text-sm text-slate-400 font-medium">No active business phone</p>
                  <p className="text-xs text-slate-500 mt-1">Get a new dedicated number or link your existing line below</p>
                </div>
              )}
            </div>
          </div>

          <div className="mt-4 pt-4 border-t border-slate-800 text-xs text-slate-400 flex items-center justify-between">
            <span>Telephony Routing:</span>
            <span className="text-slate-200 font-medium">Vapi + Telnyx Global</span>
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

      {/* Phone Number Setup Section (Two Choices) */}
      <div className="rounded-2xl bg-slate-900 border border-slate-800 overflow-hidden">
        <div className="p-6 border-b border-slate-800">
          <h2 className="text-lg font-bold text-white">Setup Your Business Phone Line</h2>
          <p className="text-sm text-slate-400 mt-1">
            Choose whether to get a new dedicated phone number or connect your existing carrier number.
          </p>

          {/* Option Tabs */}
          <div className="mt-6 flex flex-wrap gap-3">
            <button
              onClick={() => setActiveTab('NEW')}
              className={`px-4 py-2.5 rounded-xl text-sm font-semibold transition flex items-center space-x-2 ${
                activeTab === 'NEW'
                  ? 'bg-emerald-500 text-slate-950 shadow-md shadow-emerald-500/20'
                  : 'bg-slate-800 text-slate-300 hover:text-white hover:bg-slate-750'
              }`}
            >
              <Plus className="w-4 h-4" />
              <span>Get a New Number</span>
              <span className="px-1.5 py-0.5 rounded text-[10px] uppercase font-bold bg-slate-950/30 text-emerald-950">
                Direct Line
              </span>
            </button>

            <button
              onClick={() => setActiveTab('EXISTING')}
              className={`px-4 py-2.5 rounded-xl text-sm font-semibold transition flex items-center space-x-2 ${
                activeTab === 'EXISTING'
                  ? 'bg-emerald-500 text-slate-950 shadow-md shadow-emerald-500/20'
                  : 'bg-slate-800 text-slate-300 hover:text-white hover:bg-slate-750'
              }`}
            >
              <PhoneForwarded className="w-4 h-4" />
              <span>Connect Existing Number</span>
            </button>
          </div>
        </div>

        {/* ======================================================== */}
        {/* CHOICE 1: GET A NEW NUMBER (VAPI + TELNYX) */}
        {/* ======================================================== */}
        {activeTab === 'NEW' && (
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
                            ${num.monthlyCostUsd.toFixed(2)}/mo
                          </span>
                          <span className="text-[10px] uppercase font-bold text-slate-500 bg-slate-900 px-1.5 py-0.5 rounded border border-slate-800">
                            {num.numberType}
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
        )}

        {/* ======================================================== */}
        {/* CHOICE 2: CONNECT AN EXISTING NUMBER */}
        {/* ======================================================== */}
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
                  Keep your current carrier. Route unanswered or business calls to ONCEClic using carrier dial codes.
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
                  Connect your existing VoIP PBX or Telnyx/Twilio SIP trunk to Vapi AI voice endpoints.
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
                  Transfer full number ownership to ONCEClic where carrier porting is supported.
                </p>
              </button>
            </div>

            <form onSubmit={handleValidateExisting} className="space-y-4 max-w-xl">
              <div>
                <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">
                  Your Current Business Phone Number (International E.164)
                </label>
                <div className="relative">
                  <Phone className="w-5 h-5 text-slate-500 absolute left-3.5 top-3" />
                  <input
                    type="tel"
                    value={inputPhoneNumber}
                    onChange={(e) => setInputPhoneNumber(e.target.value)}
                    placeholder="+1 (555) 234-5678"
                    className="w-full pl-11 pr-4 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500 transition font-mono text-sm"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={validatingExisting}
                className="px-5 py-2.5 bg-slate-800 hover:bg-slate-700 text-white font-semibold rounded-xl text-xs transition disabled:opacity-50"
              >
                {validatingExisting ? 'Validating Format...' : 'Validate Number & View Carrier Setup'}
              </button>
            </form>

            {/* Carrier-specific setup and activation guide */}
            {existingValidationResult && (
              <div className="p-5 rounded-2xl bg-slate-950 border border-slate-800 space-y-4 max-w-2xl">
                <div className="flex items-center space-x-2 text-emerald-400 font-semibold text-sm">
                  <CheckCircle2 className="w-4 h-4" />
                  <span>Number Validated: {existingValidationResult.normalized}</span>
                </div>

                <div className="text-xs text-slate-300 space-y-2">
                  <p>
                    Routing Target for AI Receptionist:{' '}
                    <strong className="font-mono text-white bg-slate-900 px-2 py-0.5 rounded border border-slate-800">
                      {existingValidationResult.forwardingTarget}
                    </strong>
                  </p>

                  <h4 className="font-bold text-white pt-2">Carrier Forwarding Instructions:</h4>
                  <div className="space-y-2">
                    {(existingValidationResult.carrierGuides || []).map((cg: any) => (
                      <div key={cg.carrierName} className="p-3 bg-slate-900 rounded-xl border border-slate-850">
                        <span className="font-semibold text-slate-200">{cg.carrierName}:</span>
                        <p className="text-slate-400 mt-1">{cg.instructions}</p>
                        <p className="mt-1 text-[11px] font-mono text-emerald-300">
                          Dial code: {cg.enableCode}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>

                <button
                  type="button"
                  onClick={handleConnectExisting}
                  disabled={submittingExisting}
                  className="px-5 py-2.5 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold rounded-xl transition shadow-md shadow-emerald-500/20 disabled:opacity-50 text-xs"
                >
                  {submittingExisting ? 'Connecting...' : 'Confirm Connection & Add Number'}
                </button>
              </div>
            )}
          </div>
        )}
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
                        </div>
                        <div className="flex items-center space-x-3 text-xs text-slate-400 mt-1">
                          <span>Method: {num.connectionMethod?.replace(/_/g, ' ')}</span>
                          {num.countryCode && <span>&bull; Country: {num.countryCode}</span>}
                          {num.monthlyCostUsd !== undefined && num.monthlyCostUsd > 0 && (
                            <span>&bull; ${num.monthlyCostUsd.toFixed(2)}/mo</span>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center space-x-2">
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
                  <span>Actual Telnyx Provider Cost:</span>
                  <span className="font-semibold text-slate-300">${(selectedNumberForOrder.providerCostUsd ?? (selectedNumberForOrder.monthlyCostUsd - 1)).toFixed(2)} / month</span>
                </div>
                <div className="flex justify-between items-center text-slate-300">
                  <span>ONCEClic Number Markup:</span>
                  <span className="font-semibold text-emerald-400">+$1.00 / month (fixed)</span>
                </div>
                <div className="flex justify-between items-center text-slate-200 font-bold bg-slate-900/60 p-2 rounded-lg">
                  <span>Customer Phone Number Price:</span>
                  <span className="text-emerald-400">${selectedNumberForOrder.monthlyCostUsd.toFixed(2)} / month</span>
                </div>
                {selectedNumberForOrder.setupCostUsd > 0 && (
                  <div className="flex justify-between items-center text-slate-300">
                    <span>One-Time Provider Setup Fee:</span>
                    <span className="font-bold text-white">${selectedNumberForOrder.setupCostUsd.toFixed(2)}</span>
                  </div>
                )}
                <div className="flex justify-between items-center text-slate-400 text-[11px] pt-1 border-t border-slate-900">
                  <span>ONCEClic Pro Plan (Separate):</span>
                  <span>$19.00 / month</span>
                </div>
                <div className="flex justify-between items-center text-white font-bold text-xs">
                  <span>Combined Recurring Total:</span>
                  <span>${(19.00 + selectedNumberForOrder.monthlyCostUsd).toFixed(2)} / month</span>
                </div>
                <div className="flex justify-between items-center text-slate-300">
                  <span>Included Monthly AI Minutes:</span>
                  <span className="font-semibold text-white">{usage?.includedMinutes || 150} min ({usage?.planTier || 'PRO'} Plan)</span>
                </div>
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

              <p className="text-slate-400 text-[11px] leading-relaxed">
                Phone-number rental is billed separately from the $19.00/month ONCEClic Pro subscription. Applicable taxes and payment processing are calculated at checkout.
              </p>
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
                className="px-5 py-2 bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-bold rounded-xl transition shadow-md shadow-emerald-500/20 disabled:opacity-50 flex items-center space-x-1.5"
              >
                {orderingNumber ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    <span>{orderProgressState || 'Provisioning...'}</span>
                  </>
                ) : (
                  <span>Confirm & Provision (${selectedNumberForOrder.monthlyCostUsd.toFixed(2)}/mo)</span>
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
