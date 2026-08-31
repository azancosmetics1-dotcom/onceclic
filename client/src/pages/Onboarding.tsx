import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { api } from '../api/client';
import {
  Bot,
  Building2,
  CheckCircle2,
  ArrowRight,
  ArrowLeft,
  Calendar,
  MessageSquare,
  Mail,
  CreditCard,
  Sparkles,
  HelpCircle,
  Clock,
} from 'lucide-react';

export const Onboarding: React.FC = () => {
  const { organization, refreshProfile } = useAuth();
  const navigate = useNavigate();

  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);

  // Form State across steps
  const [formData, setFormData] = useState({
    businessName: organization?.name || 'My Business',
    businessType: 'Consulting & Professional Services',
    timezone: 'UTC',
    phone: '',
    email: '',
    address: '',
    aiName: 'Luna',
    aiTone: 'friendly, professional, concise',
    aiGreeting: 'Hi! Welcome to our business. How can I help you today?',
    serviceName: 'Standard Consultation',
    serviceDuration: 30,
    servicePrice: 0,
    faqQuestion: 'What are your working hours?',
    faqAnswer: 'We are open Monday through Friday from 9:00 AM to 5:00 PM.',
    availableDays: [1, 2, 3, 4, 5],
    startTime: '09:00',
    endTime: '17:00',
    chatEnabled: true,
    emailEnabled: false,
  });

  const businessTypes = [
    'Clinic & Healthcare',
    'Salon, Spa & Beauty',
    'Consulting & Professional Services',
    'Agency & Marketing',
    'Contractor & Home Services',
    'Restaurant & Hospitality',
    'Other Small Business',
  ];

  const handleNext = async () => {
    if (step < 8) {
      setStep(step + 1);
    } else {
      // Save all configured onboarding parameters
      setLoading(true);
      try {
        // 1. Update Organization & Settings
        await api.updateOrgCurrent({
          name: formData.businessName,
          businessType: formData.businessType,
          timezone: formData.timezone,
          phone: formData.phone,
          email: formData.email,
          address: formData.address,
          websiteChatEnabled: formData.chatEnabled,
          emailAnsweringEnabled: formData.emailEnabled,
          services: [
            {
              id: 'srv_initial',
              name: formData.serviceName,
              durationMinutes: formData.serviceDuration,
              price: formData.servicePrice,
              description: 'Initial booking service configured during onboarding.',
            },
          ],
        });

        // 2. Update AI Receptionist
        await api.updateAIEmployee({
          name: formData.aiName,
          tone: formData.aiTone,
          greetingMessage: formData.aiGreeting,
          status: 'ACTIVE' as any,
        });

        // 3. Add initial FAQ to Knowledge Base
        if (formData.faqQuestion && formData.faqAnswer) {
          await api.addKnowledgeSource({
            sourceType: 'FAQ',
            title: 'Onboarding FAQ',
            rawContent: `Q: ${formData.faqQuestion}\nA: ${formData.faqAnswer}`,
          });
        }

        await refreshProfile();
        navigate('/app');
      } catch (err) {
        console.error('[Onboarding] Error saving settings:', err);
        navigate('/app');
      } finally {
        setLoading(false);
      }
    }
  };

  const stepsList = [
    'Business Info',
    'Business Type',
    'AI Receptionist',
    'Services & FAQ',
    'Appointments',
    'Website Chat',
    'Email Answering',
    'Ready to Launch',
  ];

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col justify-center py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-2xl w-full mx-auto">
        {/* Progress Bar & Header */}
        <div className="mb-8 text-center">
          <div className="inline-flex items-center space-x-2 text-emerald-400 text-xs font-bold uppercase tracking-wider mb-2">
            <Sparkles className="w-4 h-4" />
            <span>Step {step} of 8: {stepsList[step - 1]}</span>
          </div>
          <div className="w-full bg-slate-900 h-2 rounded-full overflow-hidden border border-slate-800">
            <div
              className="bg-gradient-to-r from-emerald-500 to-teal-400 h-full transition-all duration-300"
              style={{ width: `${(step / 8) * 100}%` }}
            />
          </div>
        </div>

        {/* Step Card */}
        <div className="bg-slate-900 border border-slate-800 rounded-3xl p-8 shadow-2xl">
          {/* Step 1: Business Info */}
          {step === 1 && (
            <div className="space-y-4">
              <h2 className="text-xl font-bold text-white flex items-center space-x-2">
                <Building2 className="w-5 h-5 text-emerald-400" />
                <span>Confirm Your Business Name & Location</span>
              </h2>
              <p className="text-xs text-slate-400">
                Your AI receptionist will use these details to greet your customers and coordinate timezones.
              </p>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">Business Name</label>
                <input
                  type="text"
                  value={formData.businessName}
                  onChange={(e) => setFormData({ ...formData, businessName: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">Timezone</label>
                <select
                  value={formData.timezone}
                  onChange={(e) => setFormData({ ...formData, timezone: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-emerald-500"
                >
                  <option value="UTC">UTC (Coordinated Universal Time)</option>
                  <option value="America/New_York">Eastern Time (US & Canada)</option>
                  <option value="America/Chicago">Central Time (US & Canada)</option>
                  <option value="America/Denver">Mountain Time (US & Canada)</option>
                  <option value="America/Los_Angeles">Pacific Time (US & Canada)</option>
                  <option value="Europe/London">London (GMT / BST)</option>
                  <option value="Europe/Paris">Paris, Berlin, Rome (CET)</option>
                  <option value="Asia/Dubai">Dubai (GST)</option>
                  <option value="Asia/Karachi">Karachi (PKT)</option>
                </select>
              </div>
            </div>
          )}

          {/* Step 2: Choose Business Type */}
          {step === 2 && (
            <div className="space-y-4">
              <h2 className="text-xl font-bold text-white">Select Your Business Category</h2>
              <p className="text-xs text-slate-400">
                This helps the AI tune its vocabulary and service booking suggestions.
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
                {businessTypes.map((type) => (
                  <button
                    key={type}
                    type="button"
                    onClick={() => setFormData({ ...formData, businessType: type })}
                    className={`p-3.5 rounded-xl text-left text-xs font-semibold border transition ${
                      formData.businessType === type
                        ? 'bg-emerald-500/10 border-emerald-500 text-emerald-300 shadow-sm'
                        : 'bg-slate-950 border-slate-800 text-slate-300 hover:border-slate-700'
                    }`}
                  >
                    {type}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Step 3: Configure AI Receptionist */}
          {step === 3 && (
            <div className="space-y-4">
              <h2 className="text-xl font-bold text-white flex items-center space-x-2">
                <Bot className="w-5 h-5 text-emerald-400" />
                <span>Configure Your AI Receptionist</span>
              </h2>
              <p className="text-xs text-slate-400">
                Give your assistant a name and personalized initial welcome message.
              </p>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">AI Assistant Name</label>
                <input
                  type="text"
                  value={formData.aiName}
                  onChange={(e) => setFormData({ ...formData, aiName: e.target.value })}
                  placeholder="e.g. Luna, Alex, Jordan"
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">Greeting Message</label>
                <textarea
                  rows={3}
                  value={formData.aiGreeting}
                  onChange={(e) => setFormData({ ...formData, aiGreeting: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-emerald-500 resize-none"
                />
              </div>
            </div>
          )}

          {/* Step 4: Services and FAQs */}
          {step === 4 && (
            <div className="space-y-4">
              <h2 className="text-xl font-bold text-white flex items-center space-x-2">
                <HelpCircle className="w-5 h-5 text-emerald-400" />
                <span>Add Primary Service & Common FAQ</span>
              </h2>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">Initial Service Name</label>
                  <input
                    type="text"
                    value={formData.serviceName}
                    onChange={(e) => setFormData({ ...formData, serviceName: e.target.value })}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2 text-xs text-white focus:outline-none focus:border-emerald-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">Duration (Minutes)</label>
                  <input
                    type="number"
                    value={formData.serviceDuration}
                    onChange={(e) => setFormData({ ...formData, serviceDuration: parseInt(e.target.value, 10) || 30 })}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2 text-xs text-white focus:outline-none focus:border-emerald-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">Frequently Asked Question</label>
                <input
                  type="text"
                  value={formData.faqQuestion}
                  onChange={(e) => setFormData({ ...formData, faqQuestion: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2 text-xs text-white focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">FAQ Answer</label>
                <textarea
                  rows={2}
                  value={formData.faqAnswer}
                  onChange={(e) => setFormData({ ...formData, faqAnswer: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2 text-xs text-white focus:outline-none focus:border-emerald-500 resize-none"
                />
              </div>
            </div>
          )}

          {/* Step 5: Appointment Availability */}
          {step === 5 && (
            <div className="space-y-4">
              <h2 className="text-xl font-bold text-white flex items-center space-x-2">
                <Clock className="w-5 h-5 text-emerald-400" />
                <span>Configure Available Hours</span>
              </h2>
              <p className="text-xs text-slate-400">
                The AI will only allow bookings during these working hours.
              </p>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">Opening Time</label>
                  <input
                    type="time"
                    value={formData.startTime}
                    onChange={(e) => setFormData({ ...formData, startTime: e.target.value })}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-emerald-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">Closing Time</label>
                  <input
                    type="time"
                    value={formData.endTime}
                    onChange={(e) => setFormData({ ...formData, endTime: e.target.value })}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-emerald-500"
                  />
                </div>
              </div>
            </div>
          )}

          {/* Step 6: Enable Website Chat */}
          {step === 6 && (
            <div className="space-y-4">
              <h2 className="text-xl font-bold text-white flex items-center space-x-2">
                <MessageSquare className="w-5 h-5 text-emerald-400" />
                <span>Enable Website Chat Widget</span>
              </h2>
              <p className="text-xs text-slate-400">
                Enable 24/7 customer chat for website visitors.
              </p>

              <div className="flex items-center justify-between p-4 bg-slate-950 border border-slate-800 rounded-2xl">
                <div>
                  <h4 className="text-sm font-semibold text-white">Live Website Chat</h4>
                  <p className="text-xs text-slate-400">Allow customers to chat and book appointments online</p>
                </div>
                <input
                  type="checkbox"
                  checked={formData.chatEnabled}
                  onChange={(e) => setFormData({ ...formData, chatEnabled: e.target.checked })}
                  className="w-5 h-5 rounded text-emerald-500 accent-emerald-500 cursor-pointer"
                />
              </div>
            </div>
          )}

          {/* Step 7: Connect Email */}
          {step === 7 && (
            <div className="space-y-4">
              <h2 className="text-xl font-bold text-white flex items-center space-x-2">
                <Mail className="w-5 h-5 text-emerald-400" />
                <span>Email Answering (Optional)</span>
              </h2>
              <p className="text-xs text-slate-400">
                You can forward business emails to your dedicated ONCEClic inbox address or connect SMTP later.
              </p>

              <div className="p-4 bg-slate-950 border border-slate-800 rounded-2xl text-xs space-y-2">
                <div className="flex items-center space-x-2 text-emerald-400 font-semibold">
                  <CheckCircle2 className="w-4 h-4" />
                  <span>Email Channel Ready</span>
                </div>
                <p className="text-slate-400">
                  You can configure forwarding and SMTP credentials anytime in the Email settings tab.
                </p>
              </div>
            </div>
          )}

          {/* Step 8: Ready to Launch */}
          {step === 8 && (
            <div className="space-y-6 text-center py-4">
              <div className="w-16 h-16 rounded-3xl bg-emerald-500/20 border border-emerald-500/40 text-emerald-400 flex items-center justify-center mx-auto">
                <CheckCircle2 className="w-8 h-8" />
              </div>

              <div>
                <h2 className="text-2xl font-black text-white">Your AI Receptionist is Ready!</h2>
                <p className="text-xs text-slate-400 mt-2 max-w-md mx-auto">
                  Your 7-day free trial of ONCEClic Pro has started. You can now access your dashboard, test the live chat, and start taking appointments.
                </p>
              </div>

              <div className="bg-slate-950 border border-slate-800 rounded-2xl p-4 text-left text-xs space-y-2">
                <div className="flex items-center justify-between text-slate-300">
                  <span>Plan:</span>
                  <span className="font-semibold text-white">ONCEClic Pro ($49/mo)</span>
                </div>
                <div className="flex items-center justify-between text-slate-300">
                  <span>Trial Period:</span>
                  <span className="font-semibold text-emerald-400">7 Days Free</span>
                </div>
              </div>
            </div>
          )}

          {/* Navigation Controls */}
          <div className="mt-8 pt-6 border-t border-slate-800 flex items-center justify-between">
            {step > 1 ? (
              <button
                type="button"
                onClick={() => setStep(step - 1)}
                className="px-4 py-2 text-xs font-semibold text-slate-400 hover:text-white transition flex items-center space-x-1"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span>Back</span>
              </button>
            ) : <div />}

            <button
              type="button"
              disabled={loading}
              onClick={handleNext}
              className="px-6 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs transition flex items-center space-x-1.5 shadow-lg shadow-emerald-500/20"
            >
              {loading ? (
                <span>Launching...</span>
              ) : step === 8 ? (
                <>
                  <span>Enter Dashboard</span>
                  <ArrowRight className="w-4 h-4" />
                </>
              ) : (
                <>
                  <span>Continue</span>
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
