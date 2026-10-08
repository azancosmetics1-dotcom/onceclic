import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Navbar } from '../components/Navbar';
import { Footer } from '../components/Footer';
import {
  Bot,
  MessageSquare,
  Mail,
  Calendar,
  ShieldCheck,
  CheckCircle2,
  ArrowRight,
  Sparkles,
  Zap,
  Clock,
  Send,
  UserCheck,
} from 'lucide-react';

export const Home: React.FC = () => {
  useEffect(() => {
    document.title = 'ONCEClic — AI Receptionist for Small Businesses';
  }, []);

  const [demoInput, setDemoInput] = useState('');
  const [demoMessages, setDemoMessages] = useState<Array<{ role: 'user' | 'ai'; text: string }>>([
    { role: 'ai', text: 'Hi! Welcome to Apex Dental & Wellness. I am Luna, the AI receptionist. How can I help you today?' },
  ]);

  const handleDemoSend = (e: React.FormEvent) => {
    e.preventDefault();
    if (!demoInput.trim()) return;

    const userText = demoInput;
    setDemoMessages((prev) => [...prev, { role: 'user', text: userText }]);
    setDemoInput('');

    setTimeout(() => {
      let reply = "I'd be happy to assist you! We are open Mon-Fri 9:00 AM - 5:00 PM and offer initial consultations. Would you like me to schedule an appointment for you?";
      if (userText.toLowerCase().includes('book') || userText.toLowerCase().includes('appointment')) {
        reply = 'I can help you book right now! We have openings this Tuesday at 10:00 AM and 2:00 PM. Which time works best for you?';
      } else if (userText.toLowerCase().includes('price') || userText.toLowerCase().includes('cost')) {
        reply = 'Our initial consultation is complimentary, and comprehensive treatments start from $95. Would you like to reserve a time?';
      }
      setDemoMessages((prev) => [...prev, { role: 'ai', text: reply }]);
    }, 600);
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col selection:bg-emerald-500 selection:text-slate-950">
      <Navbar />

      {/* Hero Section */}
      <section className="relative pt-20 pb-28 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto text-center flex-1 flex flex-col items-center justify-center">
        {/* Ambient Glow */}
        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-emerald-500/10 blur-[120px] rounded-full pointer-events-none" />

        <div className="inline-flex items-center space-x-2 px-3.5 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-semibold uppercase tracking-wider mb-6">
          <Sparkles className="w-3.5 h-3.5" />
          <span>AI Phone Receptionist & Booking Automation</span>
        </div>

        <h1 className="text-4xl sm:text-6xl lg:text-7xl font-black tracking-tight text-white max-w-4xl leading-[1.1]">
          Never Miss Another{' '}
          <span className="text-transparent bg-clip-text bg-gradient-to-r from-emerald-400 via-teal-300 to-emerald-500">
            Customer Call.
          </span>
        </h1>

        <p className="mt-6 text-lg sm:text-xl text-slate-300 max-w-2xl font-normal leading-relaxed">
          ONCEClic's AI receptionist answers customer calls, answers questions, and books appointments automatically — 24/7.
        </p>

        {/* CTA Buttons */}
        <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-4 w-full max-w-md">
          <Link
            to="/signup"
            className="w-full sm:w-auto px-8 py-4 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-base transition duration-200 shadow-xl shadow-emerald-500/25 flex items-center justify-center space-x-2"
          >
            <span>Start 7-Day Free Trial</span>
            <ArrowRight className="w-4 h-4" />
          </Link>
          <Link
            to="/pricing"
            className="w-full sm:w-auto px-6 py-4 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-200 font-semibold text-base transition flex items-center justify-center"
          >
            <span>View Pricing & Plans</span>
          </Link>
        </div>

        <p className="mt-3 text-xs text-slate-400 flex items-center justify-center space-x-1.5">
          <ShieldCheck className="w-4 h-4 text-emerald-400" />
          <span>7-Day Free Trial &bull; $0 &bull; No credit card required</span>
        </p>

        {/* Interactive Live Demo Preview Box */}
        <div className="mt-16 w-full max-w-2xl bg-slate-900/90 border border-slate-800 rounded-2xl p-6 shadow-2xl backdrop-blur text-left">
          <div className="flex items-center justify-between border-b border-slate-800 pb-4 mb-4">
            <div className="flex items-center space-x-3">
              <div className="w-10 h-10 rounded-xl bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-emerald-400">
                <Bot className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-white flex items-center space-x-2">
                  <span>Luna — AI Receptionist</span>
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                </h3>
                <p className="text-xs text-slate-400">Instant Website & Email Assistant</p>
              </div>
            </div>
            <span className="text-[11px] bg-slate-800 text-emerald-400 px-2.5 py-1 rounded-md font-mono">
              Live Preview
            </span>
          </div>

          {/* Messages */}
          <div className="space-y-3 h-52 overflow-y-auto pr-2 mb-4 scrollbar-thin">
            {demoMessages.map((msg, i) => (
              <div
                key={i}
                className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-xs sm:text-sm leading-relaxed ${
                    msg.role === 'user'
                      ? 'bg-emerald-500 text-slate-950 font-medium'
                      : 'bg-slate-800 text-slate-200 border border-slate-700/60'
                  }`}
                >
                  {msg.text}
                </div>
              </div>
            ))}
          </div>

          {/* Input */}
          <form onSubmit={handleDemoSend} className="flex items-center space-x-2">
            <input
              type="text"
              value={demoInput}
              onChange={(e) => setDemoInput(e.target.value)}
              placeholder="Ask a question or request an appointment..."
              className="flex-1 bg-slate-950 border border-slate-700/80 rounded-xl px-4 py-2.5 text-xs sm:text-sm text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500"
            />
            <button
              type="submit"
              className="p-2.5 bg-emerald-500 hover:bg-emerald-400 text-slate-950 rounded-xl transition font-medium shrink-0"
            >
              <Send className="w-4 h-4" />
            </button>
          </form>
        </div>
      </section>

      {/* Feature Grid */}
      <section className="py-20 bg-slate-900/50 border-t border-slate-800/80">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center max-w-3xl mx-auto mb-16">
            <h2 className="text-3xl font-black text-white tracking-tight sm:text-4xl">
              Everything your business needs to automate customer intake
            </h2>
            <p className="mt-4 text-base text-slate-400">
              Designed specifically for clinics, salons, consultants, contractors, and local service businesses.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {/* Feature 1 */}
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-8 hover:border-emerald-500/40 transition group">
              <div className="w-12 h-12 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400 mb-6 group-hover:scale-110 transition">
                <MessageSquare className="w-6 h-6" />
              </div>
              <h3 className="text-lg font-bold text-white mb-2">24/7 Website AI Chat</h3>
              <p className="text-sm text-slate-400 leading-relaxed">
                Add an intelligent receptionist to your website in seconds. Answers visitor questions accurately using your customized business knowledge and FAQs.
              </p>
            </div>

            {/* Feature 2 */}
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-8 hover:border-emerald-500/40 transition group">
              <div className="w-12 h-12 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400 mb-6 group-hover:scale-110 transition">
                <Calendar className="w-6 h-6" />
              </div>
              <h3 className="text-lg font-bold text-white mb-2">Real-Time Appointment Booking</h3>
              <p className="text-sm text-slate-400 leading-relaxed">
                Checks your real availability, prevents double-booking, and schedules client appointments automatically while you focus on doing real work.
              </p>
            </div>

            {/* Feature 3 */}
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-8 hover:border-emerald-500/40 transition group">
              <div className="w-12 h-12 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400 mb-6 group-hover:scale-110 transition">
                <Mail className="w-6 h-6" />
              </div>
              <h3 className="text-lg font-bold text-white mb-2">Automated Email Answering</h3>
              <p className="text-sm text-slate-400 leading-relaxed">
                Connect your business email. ONCEClic reads inbound customer inquiries and drafts or sends grounded, accurate responses instantly.
              </p>
            </div>

            {/* Feature 4 */}
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-8 hover:border-emerald-500/40 transition group">
              <div className="w-12 h-12 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400 mb-6 group-hover:scale-110 transition">
                <UserCheck className="w-6 h-6" />
              </div>
              <h3 className="text-lg font-bold text-white mb-2">Seamless Human Handoff</h3>
              <p className="text-sm text-slate-400 leading-relaxed">
                When a complex inquiry or sensitive request arrives, the AI automatically pauses and notifies you so a team member can reply manually.
              </p>
            </div>

            {/* Feature 5 */}
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-8 hover:border-emerald-500/40 transition group">
              <div className="w-12 h-12 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400 mb-6 group-hover:scale-110 transition">
                <ShieldCheck className="w-6 h-6" />
              </div>
              <h3 className="text-lg font-bold text-white mb-2">Strict Grounding Guardrails</h3>
              <p className="text-sm text-slate-400 leading-relaxed">
                Built-in prompt injection defense and strict fact-grounding ensures your AI only answers what it knows from your verified knowledge base.
              </p>
            </div>

            {/* Feature 6 */}
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-8 hover:border-emerald-500/40 transition group">
              <div className="w-12 h-12 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400 mb-6 group-hover:scale-110 transition">
                <Zap className="w-6 h-6" />
              </div>
              <h3 className="text-lg font-bold text-white mb-2">10-Minute Fast Setup</h3>
              <p className="text-sm text-slate-400 leading-relaxed">
                Our guided 8-step onboarding gets your receptionist live in minutes without technical complexity.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Pricing CTA Banner */}
      <section className="py-20 px-4 sm:px-6 lg:px-8 max-w-5xl mx-auto text-center">
        <div className="bg-gradient-to-b from-slate-900 to-slate-950 border border-emerald-500/30 rounded-3xl p-10 sm:p-14 shadow-2xl relative overflow-hidden">
          <div className="absolute top-0 right-0 w-64 h-64 bg-emerald-500/10 blur-[80px] rounded-full pointer-events-none" />

          <h2 className="text-3xl sm:text-4xl font-black text-white tracking-tight">
            Ready to give your business a 24/7 AI Receptionist?
          </h2>
          <p className="mt-4 text-base text-slate-300 max-w-xl mx-auto">
            Start your 7-day free trial with no credit card required. Experience ONCEClic Pro and upgrade for $19/month when you're ready.
          </p>

          <div className="mt-8 flex justify-center">
            <Link
              to="/signup"
              className="px-8 py-4 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-base transition shadow-lg shadow-emerald-500/25 flex items-center space-x-2"
            >
              <span>Start 7-Day Free Trial</span>
              <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        </div>
      </section>

      {/* CEO / Founder Section */}
      <section className="pb-16 px-4 sm:px-6 lg:px-8 max-w-5xl mx-auto w-full">
        <div className="bg-slate-900/80 border border-slate-800 rounded-3xl p-8 sm:p-10 shadow-xl relative overflow-hidden backdrop-blur-sm">
          <div className="flex flex-col sm:flex-row items-center sm:items-start gap-8">
            {/* CEO Photo */}
            <div className="relative shrink-0">
              <div className="w-32 h-32 sm:w-36 sm:h-36 rounded-2xl overflow-hidden border-2 border-emerald-500/40 shadow-lg shadow-emerald-500/10 bg-slate-950">
                <img
                  src="/founder.jpg"
                  alt="Kamran Ali, Founder & CEO of ONCEClic"
                  className="w-full h-full object-cover object-center"
                  loading="lazy"
                />
              </div>
              <div className="absolute -bottom-2 -right-2 px-2.5 py-0.5 rounded-full bg-emerald-500 text-slate-950 text-[10px] font-bold uppercase tracking-wider shadow-sm">
                Founder
              </div>
            </div>

            {/* CEO Message & Details */}
            <div className="flex-1 text-center sm:text-left space-y-3">
              <div className="inline-flex items-center space-x-1.5 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-semibold uppercase tracking-wider">
                <Sparkles className="w-3.5 h-3.5" />
                <span>Meet the Founder</span>
              </div>

              <h2 className="text-2xl sm:text-3xl font-black text-white tracking-tight leading-snug">
                Built with a clear mission: make business communication simpler with AI.
              </h2>

              <p className="text-sm text-slate-300 leading-relaxed max-w-2xl">
                ONCEClic was founded with a single focus: empower small businesses and service professionals to handle customer inquiries, voice phone reception, and real-time appointment bookings 24/7 without technical complexity or lost opportunities.
              </p>

              <div className="pt-2">
                <div className="font-bold text-white text-base">Kamran Ali</div>
                <div className="text-xs text-emerald-400 font-medium">Founder &amp; CEO, ONCEClic</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Global Unified Footer */}
      <Footer />
    </div>
  );
};
