import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { api } from '../api/client';
import {
  Building2,
  Stethoscope,
  UtensilsCrossed,
  Scissors,
  CheckCircle2,
  ArrowRight,
  ArrowLeft,
  Sparkles,
  AlertCircle,
  Clock,
  MapPin,
  DollarSign,
  Users,
  ShieldCheck,
  Bot,
  Calendar,
} from 'lucide-react';

type IndustryType = 'CLINIC' | 'RESTAURANT' | 'SALON';

interface IndustryConfig {
  type: IndustryType;
  dbType: string;
  title: string;
  tagline: string;
  description: string;
  icon: React.ElementType;
  defaultServiceName: string;
  defaultServicePrice: number;
  defaultServiceDuration: number;
  placeholderKnowledge: string;
  exampleKnowledge: string;
}

const INDUSTRIES: Record<IndustryType, IndustryConfig> = {
  CLINIC: {
    type: 'CLINIC',
    dbType: 'Clinic & Healthcare',
    title: 'Clinic',
    tagline: 'Medical, Dental & Healthcare Practices',
    description:
      'Manage patients, appointments, services, business information, and AI receptionist conversations.',
    icon: Stethoscope,
    defaultServiceName: 'Dental Cleaning & Consultation',
    defaultServicePrice: 120,
    defaultServiceDuration: 30,
    placeholderKnowledge:
      'Example:\nWe are a family dental clinic in Lahore.\nWe provide dental cleaning, whitening, fillings and consultations.\nOur usual opening hours are Monday to Saturday, 10 AM to 7 PM.',
    exampleKnowledge:
      'We are SmileCare Dental Clinic in Lahore. We provide dental cleaning for PKR 5,000, teeth whitening for PKR 15,000, and consultations for PKR 2,000. Our opening hours are Monday to Saturday from 10 AM to 7 PM.',
  },
  RESTAURANT: {
    type: 'RESTAURANT',
    dbType: 'Restaurant & Hospitality',
    title: 'Restaurant',
    tagline: 'Restaurants, Cafes & Dining Lounges',
    description:
      'Manage reservations, party sizes, deposits/fees, opening hours, and customer questions.',
    icon: UtensilsCrossed,
    defaultServiceName: 'Table Reservation',
    defaultServicePrice: 0,
    defaultServiceDuration: 90,
    placeholderKnowledge:
      'Example:\nWe are Osteria Bella Vista in Downtown.\nWe serve authentic Italian cuisine, handmade pastas, and wood-fired pizzas.\nOpen daily from 12 PM to 11 PM. Max party size for online reservations is 8 guests.',
    exampleKnowledge:
      'We are Osteria Bella Vista, an authentic Italian dining lounge in Downtown. We specialize in artisanal wood-fired pizzas and handmade pastas. Our dining hours are Monday through Sunday from 12:00 PM to 11:00 PM. Reservations are complimentary.',
  },
  SALON: {
    type: 'SALON',
    dbType: 'Salon, Spa & Beauty',
    title: 'Salon',
    tagline: 'Hair Salons, Spas & Beauty Studios',
    description:
      'Manage services, prices, staff/business information, appointments, and customer questions.',
    icon: Scissors,
    defaultServiceName: 'Haircut & Styling',
    defaultServicePrice: 65,
    defaultServiceDuration: 45,
    placeholderKnowledge:
      'Example:\nWe are Glow Hair & Beauty Studio in West End.\nWe offer haircuts (PKR 3,500), hair coloring, blowouts, and facials.\nOpen Tuesday to Sunday from 10 AM to 8 PM.',
    exampleKnowledge:
      'We are Glow Salon in West End. We offer premium haircut and styling for PKR 3,500, balayage hair coloring for PKR 12,000, and express facials for PKR 4,500. We are open Tuesday through Sunday from 10:00 AM to 8:00 PM.',
  },
};

export const Onboarding: React.FC = () => {
  const { organization, refreshProfile } = useAuth();
  const navigate = useNavigate();

  const [currentStep, setCurrentStep] = useState<number>(1);
  const [selectedIndustry, setSelectedIndustry] = useState<IndustryType | null>(null);
  const [businessKnowledge, setBusinessKnowledge] = useState<string>('');
  const [knowledgeError, setKnowledgeError] = useState<string | null>(null);

  // Industry-specific optional fields
  const [businessName, setBusinessName] = useState<string>(organization?.name || '');
  const [address, setAddress] = useState<string>('');
  const [serviceName, setServiceName] = useState<string>('');
  const [servicePrice, setServicePrice] = useState<number | ''>('');
  const [serviceDuration, setServiceDuration] = useState<number>(30);
  const [openingHoursStr, setOpeningHoursStr] = useState<string>('Monday to Saturday, 10:00 AM - 7:00 PM');
  const [maxPartySize, setMaxPartySize] = useState<number>(8);
  const [reservationFee, setReservationFee] = useState<number | ''>('');
  const [additionalNotes, setAdditionalNotes] = useState<string>('');

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const handleSelectIndustry = (type: IndustryType) => {
    setSelectedIndustry(type);
    const ind = INDUSTRIES[type];
    if (!serviceName) setServiceName(ind.defaultServiceName);
    if (servicePrice === '') setServicePrice(ind.defaultServicePrice);
    if (serviceDuration === 30) setServiceDuration(ind.defaultServiceDuration);
  };

  const handleKnowledgeChange = (val: string) => {
    setBusinessKnowledge(val);
    if (val.trim().length >= 15) {
      setKnowledgeError(null);
    }
  };

  const validateStep2 = (): boolean => {
    const trimmed = businessKnowledge.trim();
    if (!trimmed || trimmed.length === 0) {
      setKnowledgeError('Business knowledge is required so your AI receptionist can assist customers accurately.');
      return false;
    }
    if (trimmed.length < 15) {
      setKnowledgeError('Please enter at least 15 characters of meaningful business information.');
      return false;
    }
    setKnowledgeError(null);
    return true;
  };

  const handleNext = () => {
    if (currentStep === 1) {
      if (!selectedIndustry) {
        setSaveError('Please select your business type to proceed.');
        return;
      }
      setSaveError(null);
      setCurrentStep(2);
    } else if (currentStep === 2) {
      if (!validateStep2()) return;
      setSaveError(null);
      setCurrentStep(3);
    } else if (currentStep === 3) {
      setCurrentStep(4);
    }
  };

  const handleBack = () => {
    if (currentStep > 1) {
      setSaveError(null);
      setCurrentStep(currentStep - 1);
    }
  };

  const handleCompleteOnboarding = async () => {
    if (!selectedIndustry || !validateStep2()) {
      setCurrentStep(2);
      return;
    }

    setSaving(true);
    setSaveError(null);

    try {
      const ind = INDUSTRIES[selectedIndustry];
      const finalName = businessName.trim() || organization?.name || `${ind.title} Business`;

      // 1. Compile Services
      const parsedPrice = typeof servicePrice === 'number' ? servicePrice : 0;
      const initialServices = [
        {
          id: 'srv_primary',
          name: serviceName.trim() || ind.defaultServiceName,
          durationMinutes: serviceDuration || ind.defaultServiceDuration,
          price: parsedPrice,
          description: `Primary ${ind.title.toLowerCase()} service configured during onboarding.`,
        },
      ];

      // 2. Reservation settings for restaurant
      const reservationSettings =
        selectedIndustry === 'RESTAURANT'
          ? {
              pricingType: reservationFee && Number(reservationFee) > 0 ? 'reservation_fee' : 'free',
              feeAmount: reservationFee && Number(reservationFee) > 0 ? Number(reservationFee) : 0,
              maxPartySize: maxPartySize || 8,
              minPartySize: 1,
              specialInstructions: additionalNotes.trim() || 'Please arrive 5 minutes prior to your booking.',
            }
          : null;

      // 3. Update Organization & Business Settings
      await api.updateOrgCurrent({
        name: finalName,
        businessType: ind.dbType,
        address: address.trim() || undefined,
        websiteChatEnabled: true,
        emailAnsweringEnabled: true,
        services: initialServices,
        reservationSettings: reservationSettings || undefined,
        contactInstructions: `For any specialized inquiries, you can reach out directly via chat or email.`,
      });

      // 4. Update AI Receptionist
      const aiRole =
        selectedIndustry === 'CLINIC'
          ? 'Medical & Clinic Receptionist'
          : selectedIndustry === 'RESTAURANT'
          ? 'Restaurant Host & Receptionist'
          : 'Salon & Spa Receptionist';

      const aiInstructions =
        selectedIndustry === 'CLINIC'
          ? `You are the AI receptionist for ${finalName}. Help patients understand available treatments and prices, and direct them to schedule an appointment. Never offer clinical diagnoses.`
          : selectedIndustry === 'RESTAURANT'
          ? `You are the AI host for ${finalName}. Help guests with table reservations, party sizes, and menu questions. Use reservation terminology.`
          : `You are the AI receptionist for ${finalName}. Help clients book styling and beauty appointments, explain service durations and pricing.`;

      await api.updateAIEmployee({
        name: 'Luna',
        roleTitle: aiRole,
        instructions: aiInstructions,
        businessContext: `Business: ${finalName}. Address: ${address || 'Configured online'}. Industry: ${ind.dbType}. Hours: ${openingHoursStr}.`,
        status: 'ACTIVE' as any,
      });

      // 5. Add Required Business Knowledge to Knowledge Base & Embeddings
      await api.addKnowledgeSource({
        sourceType: 'BUSINESS_INFO' as any,
        title: `${finalName} - Core Business Knowledge`,
        rawContent: `${businessKnowledge.trim()}\n\nAddress: ${address.trim() || 'Not specified'}\nOpening Hours: ${openingHoursStr}\nServices: ${serviceName} (${parsedPrice > 0 ? `$${parsedPrice}` : 'Free'})\nAdditional Details: ${additionalNotes.trim() || 'None'}`,
      });

      // 6. Refresh profile and navigate to dashboard
      await refreshProfile();
      navigate('/app');
    } catch (err: any) {
      console.error('[Onboarding] Error completing setup:', err);
      setSaveError(err.message || 'Failed to complete onboarding. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col justify-between py-6 sm:py-10 px-3.5 sm:px-6 lg:px-8 selection:bg-emerald-500 selection:text-slate-950">
      <div className="max-w-3xl w-full mx-auto space-y-6">
        {/* Step Indicator & Header */}
        <div className="text-center space-y-2">
          <div className="inline-flex items-center space-x-2 px-3.5 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-bold uppercase tracking-wider">
            <Sparkles className="w-3.5 h-3.5" />
            <span>Step {currentStep} of 4 &bull; Onboarding</span>
          </div>

          <div className="w-full bg-slate-900 h-1.5 rounded-full overflow-hidden border border-slate-800 max-w-xs mx-auto mt-2">
            <div
              className="bg-gradient-to-r from-emerald-500 to-teal-400 h-full transition-all duration-300"
              style={{ width: `${(currentStep / 4) * 100}%` }}
            />
          </div>
        </div>

        {saveError && (
          <div className="bg-rose-500/10 border border-rose-500/20 rounded-2xl p-4 flex items-start space-x-3 text-xs text-rose-300">
            <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
            <span>{saveError}</span>
          </div>
        )}

        {/* STEP 1: CHOOSE INDUSTRY */}
        {currentStep === 1 && (
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 sm:p-10 shadow-2xl space-y-6">
            <div className="text-center space-y-2 max-w-xl mx-auto">
              <h1 className="text-2xl sm:text-3xl font-black text-white tracking-tight">
                What type of business do you run?
              </h1>
              <p className="text-xs sm:text-sm text-slate-400">
                Select your industry to customize your AI receptionist's terminology, booking behavior, and customer experience.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2">
              {(Object.keys(INDUSTRIES) as IndustryType[]).map((key) => {
                const item = INDUSTRIES[key];
                const Icon = item.icon;
                const isSelected = selectedIndustry === key;

                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => handleSelectIndustry(key)}
                    className={`p-6 rounded-2xl border text-left transition-all duration-200 flex flex-col justify-between space-y-4 relative group ${
                      isSelected
                        ? 'bg-emerald-950/40 border-emerald-500 shadow-xl shadow-emerald-500/10 ring-2 ring-emerald-500/50'
                        : 'bg-slate-950/60 border-slate-800 hover:border-slate-700 hover:bg-slate-950'
                    }`}
                  >
                    <div className="space-y-3">
                      <div
                        className={`w-12 h-12 rounded-2xl flex items-center justify-center transition ${
                          isSelected
                            ? 'bg-emerald-500 text-slate-950'
                            : 'bg-slate-900 border border-slate-800 text-emerald-400 group-hover:border-emerald-500/40'
                        }`}
                      >
                        <Icon className="w-6 h-6" />
                      </div>

                      <div>
                        <h3 className="text-lg font-bold text-white flex items-center justify-between">
                          <span>{item.title}</span>
                          {isSelected && <CheckCircle2 className="w-5 h-5 text-emerald-400" />}
                        </h3>
                        <p className="text-[11px] text-emerald-400/90 font-medium mt-0.5">{item.tagline}</p>
                      </div>

                      <p className="text-xs text-slate-400 leading-relaxed">{item.description}</p>
                    </div>

                    <div className="pt-2 border-t border-slate-800/80 text-[11px] font-semibold text-slate-300">
                      {key === 'CLINIC' && 'Appointments & Patients'}
                      {key === 'RESTAURANT' && 'Reservations & Parties'}
                      {key === 'SALON' && 'Services & Clients'}
                    </div>
                  </button>
                );
              })}
            </div>

            <div className="pt-4 flex justify-end">
              <button
                type="button"
                onClick={handleNext}
                disabled={!selectedIndustry}
                className="inline-flex items-center space-x-2 px-6 py-3 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-sm rounded-xl transition shadow-lg shadow-emerald-500/20 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <span>Continue to Business Details</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {/* STEP 2: BUSINESS KNOWLEDGE & INDUSTRY DETAILS */}
        {currentStep === 2 && selectedIndustry && (
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 sm:p-10 shadow-2xl space-y-6">
            <div className="space-y-1">
              <div className="flex items-center space-x-2 text-emerald-400 text-xs font-bold uppercase tracking-wider">
                {React.createElement(INDUSTRIES[selectedIndustry].icon, { className: 'w-4 h-4' })}
                <span>{INDUSTRIES[selectedIndustry].title} Configuration</span>
              </div>
              <h2 className="text-2xl font-black text-white tracking-tight">
                Tell your AI receptionist about your business
              </h2>
              <p className="text-xs text-slate-400">
                Your AI assistant will strictly answer customer inquiries based on the facts provided below.
              </p>
            </div>

            {/* MANDATORY KNOWLEDGE FIELD */}
            <div className="space-y-2 bg-slate-950 p-5 rounded-2xl border border-slate-800">
              <div className="flex items-center justify-between">
                <label className="block text-xs font-bold text-white uppercase tracking-wider">
                  Tell your AI receptionist about your business <span className="text-rose-400">*</span>
                </label>
                <span className="text-[11px] text-slate-500 font-mono">
                  {businessKnowledge.trim().length} characters (min 15)
                </span>
              </div>

              <textarea
                required
                rows={4}
                value={businessKnowledge}
                onChange={(e) => handleKnowledgeChange(e.target.value)}
                placeholder={INDUSTRIES[selectedIndustry].placeholderKnowledge}
                className={`w-full bg-slate-900 border rounded-xl p-3.5 text-xs sm:text-sm text-white focus:outline-none transition leading-relaxed ${
                  knowledgeError
                    ? 'border-rose-500 focus:border-rose-400'
                    : 'border-slate-800 focus:border-emerald-500'
                }`}
              />

              {knowledgeError && (
                <p className="text-xs text-rose-400 flex items-center gap-1.5 pt-1">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                  <span>{knowledgeError}</span>
                </p>
              )}

              <button
                type="button"
                onClick={() => handleKnowledgeChange(INDUSTRIES[selectedIndustry].exampleKnowledge)}
                className="text-[11px] text-emerald-400 hover:text-emerald-300 font-medium underline inline-block"
              >
                Insert sample {INDUSTRIES[selectedIndustry].title.toLowerCase()} knowledge
              </button>
            </div>

            {/* INDUSTRY-SPECIFIC OPTIONAL FIELDS */}
            <div className="space-y-4 pt-2">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400">
                Industry-Specific Details (Optional & Customizable Later)
              </h3>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">
                    {selectedIndustry === 'CLINIC'
                      ? 'Clinic Name'
                      : selectedIndustry === 'RESTAURANT'
                      ? 'Restaurant Name'
                      : 'Salon Name'}
                  </label>
                  <input
                    type="text"
                    value={businessName}
                    onChange={(e) => setBusinessName(e.target.value)}
                    placeholder={
                      selectedIndustry === 'CLINIC'
                        ? 'SmileCare Dental Clinic'
                        : selectedIndustry === 'RESTAURANT'
                        ? 'Osteria Bella Vista'
                        : 'Glow Hair Studio'
                    }
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs text-white focus:outline-none focus:border-emerald-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">Physical Address / Location</label>
                  <input
                    type="text"
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    placeholder="12 Main Street, Lahore"
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs text-white focus:outline-none focus:border-emerald-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">
                    {selectedIndustry === 'RESTAURANT' ? 'Seating / Table Option' : 'Primary Service Name'}
                  </label>
                  <input
                    type="text"
                    value={serviceName}
                    onChange={(e) => setServiceName(e.target.value)}
                    placeholder={INDUSTRIES[selectedIndustry].defaultServiceName}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs text-white focus:outline-none focus:border-emerald-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">
                    {selectedIndustry === 'RESTAURANT' ? 'Deposit / Reservation Fee ($)' : 'Service Price ($)'}
                  </label>
                  <input
                    type="number"
                    min="0"
                    value={selectedIndustry === 'RESTAURANT' ? reservationFee : servicePrice}
                    onChange={(e) => {
                      const val = e.target.value === '' ? '' : Number(e.target.value);
                      if (selectedIndustry === 'RESTAURANT') setReservationFee(val);
                      else setServicePrice(val);
                    }}
                    placeholder="0"
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs text-white focus:outline-none focus:border-emerald-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">Opening Hours</label>
                  <input
                    type="text"
                    value={openingHoursStr}
                    onChange={(e) => setOpeningHoursStr(e.target.value)}
                    placeholder="Mon-Sat, 10:00 AM - 7:00 PM"
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs text-white focus:outline-none focus:border-emerald-500"
                  />
                </div>

                {selectedIndustry === 'RESTAURANT' ? (
                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1">Max Party Size (Guests)</label>
                    <input
                      type="number"
                      min="1"
                      max="30"
                      value={maxPartySize}
                      onChange={(e) => setMaxPartySize(Number(e.target.value))}
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs text-white focus:outline-none focus:border-emerald-500"
                    />
                  </div>
                ) : (
                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1">Appointment Duration (Minutes)</label>
                    <input
                      type="number"
                      min="15"
                      step="15"
                      value={serviceDuration}
                      onChange={(e) => setServiceDuration(Number(e.target.value))}
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs text-white focus:outline-none focus:border-emerald-500"
                    />
                  </div>
                )}
              </div>
            </div>

            <div className="pt-4 flex items-center justify-between border-t border-slate-800">
              <button
                type="button"
                onClick={handleBack}
                className="inline-flex items-center space-x-1.5 px-4 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold rounded-xl transition"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span>Back</span>
              </button>

              <button
                type="button"
                onClick={handleNext}
                className="inline-flex items-center space-x-2 px-6 py-3 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-sm rounded-xl transition shadow-lg shadow-emerald-500/20"
              >
                <span>Review & Confirm</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {/* STEP 3: REVIEW & CONFIRM */}
        {currentStep === 3 && selectedIndustry && (
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 sm:p-10 shadow-2xl space-y-6">
            <div className="space-y-1">
              <div className="inline-flex items-center space-x-2 text-emerald-400 text-xs font-bold uppercase tracking-wider">
                <ShieldCheck className="w-4 h-4" />
                <span>Verification & Review</span>
              </div>
              <h2 className="text-2xl font-black text-white tracking-tight">Confirm Your Business Setup</h2>
              <p className="text-xs text-slate-400">
                Review how your AI receptionist and booking workspace will be initialized.
              </p>
            </div>

            <div className="bg-slate-950 border border-slate-800 rounded-2xl p-5 space-y-4 text-xs">
              <div className="flex justify-between border-b border-slate-800/80 pb-2.5">
                <span className="text-slate-400">Business Name:</span>
                <span className="font-bold text-white">{businessName || organization?.name || 'My Business'}</span>
              </div>

              <div className="flex justify-between border-b border-slate-800/80 pb-2.5">
                <span className="text-slate-400">Selected Industry:</span>
                <span className="font-bold text-emerald-400">{INDUSTRIES[selectedIndustry].title} ({INDUSTRIES[selectedIndustry].dbType})</span>
              </div>

              <div className="flex justify-between border-b border-slate-800/80 pb-2.5">
                <span className="text-slate-400">AI Receptionist:</span>
                <span className="font-bold text-white">Luna (Active)</span>
              </div>

              <div className="flex justify-between border-b border-slate-800/80 pb-2.5">
                <span className="text-slate-400">Address:</span>
                <span className="font-semibold text-slate-200">{address || 'Not specified (strictly grounded)'}</span>
              </div>

              <div className="flex justify-between border-b border-slate-800/80 pb-2.5">
                <span className="text-slate-400">Primary Offering:</span>
                <span className="font-semibold text-white">
                  {serviceName || INDUSTRIES[selectedIndustry].defaultServiceName}
                  {servicePrice !== '' ? ` ($${servicePrice})` : ''}
                </span>
              </div>

              <div className="space-y-1 pt-1">
                <span className="text-slate-400 font-semibold">Configured AI Knowledge:</span>
                <p className="bg-slate-900 p-3 rounded-xl border border-slate-800/80 text-slate-300 text-[11px] leading-relaxed whitespace-pre-line">
                  {businessKnowledge}
                </p>
              </div>
            </div>

            <div className="pt-4 flex items-center justify-between border-t border-slate-800">
              <button
                type="button"
                onClick={handleBack}
                className="inline-flex items-center space-x-1.5 px-4 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold rounded-xl transition"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span>Back</span>
              </button>

              <button
                type="button"
                onClick={handleNext}
                className="inline-flex items-center space-x-2 px-6 py-3 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-sm rounded-xl transition shadow-lg shadow-emerald-500/20"
              >
                <span>Continue to Trial Activation</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {/* STEP 4: 7-DAY FREE TRIAL ACTIVATION */}
        {currentStep === 4 && selectedIndustry && (
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 sm:p-10 shadow-2xl space-y-6 text-center">
            <div className="w-16 h-16 rounded-3xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400 mx-auto">
              <Bot className="w-9 h-9" />
            </div>

            <div className="space-y-2 max-w-md mx-auto">
              <h2 className="text-2xl sm:text-3xl font-black text-white">Start Your 7-Day Free Trial</h2>
              <div className="inline-flex items-baseline space-x-2">
                <span className="text-3xl font-black text-emerald-400">$0</span>
                <span className="text-xs text-slate-400 font-semibold uppercase tracking-wider">
                  No Credit Card Required
                </span>
              </div>
              <p className="text-xs text-slate-400 leading-relaxed pt-1">
                Your AI receptionist is fully configured and ready to answer inquiries, book appointments, and capture leads across your website and connected channels.
              </p>
            </div>

            {/* Trial Feature Highlights */}
            <div className="bg-slate-950 border border-slate-800 rounded-2xl p-5 max-w-md mx-auto text-left space-y-2.5 text-xs text-slate-300">
              <div className="flex items-center space-x-2.5">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                <span>24/7 AI Receptionist customized for {INDUSTRIES[selectedIndustry].title}</span>
              </div>
              <div className="flex items-center space-x-2.5">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                <span>Dedicated public booking page & calendar management</span>
              </div>
              <div className="flex items-center space-x-2.5">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                <span>Strict grounding against your verified business knowledge</span>
              </div>
              <div className="flex items-center space-x-2.5">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                <span>Website Chat, Gmail, Instagram & Facebook integrations</span>
              </div>
              <div className="pt-2 border-t border-slate-800 text-[11px] text-slate-400">
                Limited AI usage during your free trial. AI usage is subject to reasonable-use limits.
              </div>
            </div>

            <div className="pt-4 flex flex-col sm:flex-row justify-center gap-3">
              <button
                type="button"
                onClick={handleBack}
                disabled={saving}
                className="px-5 py-3 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold rounded-xl transition"
              >
                Back
              </button>

              <button
                type="button"
                onClick={handleCompleteOnboarding}
                disabled={saving}
                className="px-8 py-3.5 bg-gradient-to-r from-emerald-500 to-teal-400 hover:from-emerald-400 hover:to-teal-300 text-slate-950 font-black text-sm rounded-xl transition shadow-lg shadow-emerald-500/25 disabled:opacity-50 inline-flex items-center justify-center space-x-2"
              >
                {saving ? (
                  <div className="w-5 h-5 border-2 border-slate-950 border-t-transparent rounded-full animate-spin" />
                ) : (
                  <>
                    <span>Launch ONCEClic Dashboard</span>
                    <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </button>
            </div>
          </div>
        )}
      </div>

      <footer className="mt-8 text-center text-xs text-slate-500">
        ONCEClic &bull; AI Receptionist for Clinics, Restaurants, and Salons
      </footer>
    </div>
  );
};
