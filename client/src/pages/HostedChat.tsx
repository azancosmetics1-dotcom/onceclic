import React, { useState, useEffect, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../api/client';
import { ConversationMessage, AvailableSlot } from '@onceclic/shared';
import {
  Bot,
  Send,
  Calendar,
  Clock,
  Sparkles,
  CheckCircle2,
  AlertTriangle,
  User,
  X,
} from 'lucide-react';

export const HostedChat: React.FC = () => {
  const { orgSlug } = useParams<{ orgSlug: string }>();

  const [orgData, setOrgData] = useState<any>(null);
  const [sessionToken, setSessionToken] = useState<string | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [inputMessage, setInputMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Customer contact info (can be set during conversation or booking)
  const [customerName, setCustomerName] = useState('');
  const [customerEmail, setCustomerEmail] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');

  // Booking Modal State
  const [showBookingModal, setShowBookingModal] = useState(false);
  const [selectedService, setSelectedService] = useState('');
  const [bookingDate, setBookingDate] = useState(new Date().toISOString().split('T')[0]);
  const [availableSlots, setAvailableSlots] = useState<AvailableSlot[]>([]);
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null);
  const [bookingLoading, setBookingLoading] = useState(false);
  const [bookingSuccess, setBookingSuccess] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, sending]);

  // Load public organization profile & initialize session
  useEffect(() => {
    const targetSlug = orgSlug;
    if (!targetSlug) return;

    async function init(slug: string) {
      try {
        const data = await api.getPublicOrg(slug);
        setOrgData(data);

        // Resume or create chat session
        const sessionRes = await api.startPublicChatSession({
          orgSlug: slug,
          customerName: customerName || undefined,
          customerEmail: customerEmail || undefined,
        });

        setSessionToken(sessionRes.sessionToken);
        setConversationId(sessionRes.conversationId);

        if (sessionRes.messages && sessionRes.messages.length > 0) {
          setMessages(sessionRes.messages);
        } else {
          // Add default welcome greeting
          setMessages([
            {
              id: 'init_welcome',
              conversationId: sessionRes.conversationId,
              organizationId: sessionRes.organizationId,
              role: 'AI' as any,
              content: data.aiEmployee.greetingMessage,
              status: 'DELIVERED',
              grounded: true,
              handoffRequired: false,
              createdAt: new Date().toISOString(),
            },
          ]);
        }
      } catch (err: any) {
        console.error('[HostedChat] Init failed:', err);
        setError(err.message || 'Failed to connect to business chat.');
      } finally {
        setLoading(false);
      }
    }

    init(targetSlug);
  }, [orgSlug]);

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputMessage.trim() || !sessionToken || sending) return;

    const userText = inputMessage;
    const clientMessageId = `msg_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    setInputMessage('');
    setSending(true);

    // Optimistic user message
    const tempUserMsg: ConversationMessage = {
      id: `temp_${Date.now()}`,
      conversationId: conversationId || '',
      organizationId: orgData?.organization?.id || '',
      role: 'CUSTOMER' as any,
      content: userText,
      clientMessageId,
      status: 'SENT',
      grounded: true,
      handoffRequired: false,
      createdAt: new Date().toISOString(),
    };

    setMessages((prev) => [...prev, tempUserMsg]);

    try {
      const response = await api.sendPublicChatMessage({
        sessionToken,
        content: userText,
        clientMessageId,
        customerName: customerName || undefined,
        customerEmail: customerEmail || undefined,
        customerPhone: customerPhone || undefined,
      });

      if (response.aiMessage) {
        setMessages((prev) => [...prev, response.aiMessage!]);
      }
    } catch (err: any) {
      console.error('[HostedChat] Send failed:', err);
      // Fallback message if AI unavailable
      setMessages((prev) => [
        ...prev,
        {
          id: `err_${Date.now()}`,
          conversationId: conversationId || '',
          organizationId: orgData?.organization?.id || '',
          role: 'AI' as any,
          content:
            err.message ||
            'I am currently unable to process your request. Please try again shortly.',
          status: 'DELIVERED',
          grounded: false,
          handoffRequired: true,
          createdAt: new Date().toISOString(),
        },
      ]);
    } finally {
      setSending(false);
    }
  };

  // Query available booking slots
  const handleOpenBooking = async () => {
    if (!orgSlug) return;
    setShowBookingModal(true);
    setBookingLoading(true);
    setSelectedSlot(null);
    setBookingSuccess(false);

    try {
      const slots = await api.getPublicAppointmentSlots(orgSlug, bookingDate);
      setAvailableSlots(slots);
      if (orgData?.services?.length > 0 && !selectedService) {
        setSelectedService(orgData.services[0].name);
      }
    } catch (err) {
      console.error('[HostedChat] Slots fetch failed:', err);
    } finally {
      setBookingLoading(false);
    }
  };

  const handleDateChange = async (newDate: string) => {
    setBookingDate(newDate);
    setBookingLoading(true);
    setSelectedSlot(null);
    try {
      const slots = await api.getPublicAppointmentSlots(orgSlug!, newDate);
      setAvailableSlots(slots);
    } catch (err) {
      console.error('[HostedChat] Slots reload failed:', err);
    } finally {
      setBookingLoading(false);
    }
  };

  const handleConfirmBooking = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedSlot || !customerName || !customerEmail || !orgSlug) return;
    setBookingLoading(true);

    try {
      const appt = await api.bookPublicAppointment({
        orgSlug,
        serviceName: selectedService || 'Consultation',
        customerName,
        customerEmail,
        customerPhone,
        startTime: selectedSlot,
        conversationId: conversationId || undefined,
      });

      setBookingSuccess(true);

      // Add confirmation message to chat
      const confirmMsg: ConversationMessage = {
        id: `book_confirm_${Date.now()}`,
        conversationId: conversationId || '',
        organizationId: orgData?.organization?.id || '',
        role: 'AI' as any,
        content: `🎉 Your appointment for "${appt.serviceName}" has been confirmed for ${new Date(
          appt.startTime
        ).toLocaleDateString()} at ${new Date(appt.startTime).toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit',
        })}! A confirmation has been recorded for ${customerEmail}.`,
        status: 'DELIVERED',
        grounded: true,
        handoffRequired: false,
        createdAt: new Date().toISOString(),
      };

      setMessages((prev) => [...prev, confirmMsg]);
      setTimeout(() => setShowBookingModal(false), 2500);
    } catch (err: any) {
      alert(err.message || 'Failed to book appointment.');
    } finally {
      setBookingLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-4 text-center">
        <AlertTriangle className="w-12 h-12 text-amber-400 mb-4" />
        <h2 className="text-xl font-bold text-white mb-2">Business Chat Unavailable</h2>
        <p className="text-xs text-slate-400 max-w-sm">{error}</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col sm:p-6 lg:p-10 justify-center items-center">
      <div className="w-full max-w-2xl bg-slate-900 border border-slate-800 rounded-3xl shadow-2xl flex flex-col h-[90vh] max-h-[800px] overflow-hidden">
        {/* Chat Topbar */}
        <div className="p-4 sm:p-5 border-b border-slate-800 bg-slate-950/80 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-tr from-emerald-500 to-teal-400 flex items-center justify-center text-slate-950 shadow-md shadow-emerald-500/20">
              <Bot className="w-5 h-5 stroke-[2.5]" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-white flex items-center space-x-2">
                <span>{orgData?.organization?.name}</span>
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              </h2>
              <p className="text-[11px] text-slate-400">
                {orgData?.aiEmployee?.name || 'Luna'} &bull; {orgData?.aiEmployee?.roleTitle || 'AI Receptionist'}
              </p>
            </div>
          </div>

          <button
            onClick={handleOpenBooking}
            className="inline-flex items-center space-x-1.5 px-3.5 py-1.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs transition shadow-md shadow-emerald-500/20"
          >
            <Calendar className="w-3.5 h-3.5" />
            <span>Book Appointment</span>
          </button>
        </div>

        {/* Message Stream */}
        <div className="flex-1 p-5 overflow-y-auto space-y-4">
          {messages.map((m) => {
            const isCustomer = m.role === 'CUSTOMER';
            const isAI = m.role === 'AI';

            return (
              <div
                key={m.id}
                className={`flex flex-col ${isCustomer ? 'items-end' : 'items-start'}`}
              >
                <div className="flex items-center space-x-1.5 text-[10px] text-slate-400 mb-1 px-1">
                  <span>{isCustomer ? customerName || 'You' : orgData?.aiEmployee?.name || 'Luna'}</span>
                  <span>&bull;</span>
                  <span className="font-mono">
                    {new Date(m.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>

                <div
                  className={`max-w-[85%] rounded-2xl px-4 py-3 text-xs sm:text-sm leading-relaxed ${
                    isCustomer
                      ? 'bg-emerald-500 text-slate-950 font-medium'
                      : 'bg-slate-800 text-slate-200 border border-slate-700/60'
                  }`}
                >
                  <p className="whitespace-pre-wrap">{m.content}</p>
                </div>
              </div>
            );
          })}

          {sending && (
            <div className="flex items-center space-x-2 text-xs text-slate-400 italic py-2">
              <div className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
              <span>{orgData?.aiEmployee?.name || 'Luna'} is typing...</span>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Customer Quick Info (optional inputs) */}
        {!customerEmail && (
          <div className="px-4 py-2 bg-slate-950/60 border-t border-slate-800/80 flex flex-wrap gap-2 text-xs">
            <input
              type="text"
              placeholder="Your Name (optional)"
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
              className="bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1 text-[11px] text-white focus:outline-none focus:border-emerald-500"
            />
            <input
              type="email"
              placeholder="Your Email (for updates)"
              value={customerEmail}
              onChange={(e) => setCustomerEmail(e.target.value)}
              className="bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1 text-[11px] text-white focus:outline-none focus:border-emerald-500"
            />
          </div>
        )}

        {/* Chat Input Bar */}
        <form onSubmit={handleSendMessage} className="p-4 border-t border-slate-800 bg-slate-950/90">
          <div className="flex items-center space-x-2">
            <input
              type="text"
              value={inputMessage}
              onChange={(e) => setInputMessage(e.target.value)}
              placeholder="Ask a question or request a booking..."
              className="flex-1 bg-slate-900 border border-slate-800 rounded-xl px-4 py-3 text-xs sm:text-sm text-white focus:outline-none focus:border-emerald-500"
            />
            <button
              type="submit"
              disabled={sending || !inputMessage.trim()}
              className="p-3 bg-emerald-500 hover:bg-emerald-400 text-slate-950 rounded-xl transition font-bold disabled:opacity-50 shrink-0"
            >
              <Send className="w-4 h-4" />
            </button>
          </div>
          <div className="mt-2 text-center text-[10px] text-slate-500">
            Powered by <span className="font-semibold text-slate-400">ONCEClic.com</span> &bull; 24/7 AI Receptionist
          </div>
        </form>
      </div>

      {/* Appointment Booking Modal */}
      {showBookingModal && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl max-w-md w-full p-6 space-y-5 shadow-2xl relative">
            <button
              onClick={() => setShowBookingModal(false)}
              className="absolute top-4 right-4 text-slate-400 hover:text-white p-1"
            >
              <X className="w-4 h-4" />
            </button>

            <h3 className="text-base font-bold text-white flex items-center space-x-2">
              <Calendar className="w-5 h-5 text-emerald-400" />
              <span>Schedule an Appointment</span>
            </h3>

            {bookingSuccess ? (
              <div className="text-center py-6 space-y-2">
                <CheckCircle2 className="w-12 h-12 text-emerald-400 mx-auto" />
                <h4 className="text-base font-bold text-white">Appointment Confirmed!</h4>
                <p className="text-xs text-slate-400">
                  Your appointment has been booked. You can view the details in the chat transcript.
                </p>
              </div>
            ) : (
              <form onSubmit={handleConfirmBooking} className="space-y-4">
                {/* Service Selection */}
                {orgData?.services?.length > 0 && (
                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1">Select Service</label>
                    <select
                      value={selectedService}
                      onChange={(e) => setSelectedService(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-500"
                    >
                      {orgData.services.map((srv: any) => (
                        <option key={srv.id || srv.name} value={srv.name}>
                          {srv.name} ({srv.durationMinutes} mins - ${srv.price})
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                {/* Date Picker */}
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">Select Date</label>
                  <input
                    type="date"
                    min={new Date().toISOString().split('T')[0]}
                    value={bookingDate}
                    onChange={(e) => handleDateChange(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-500"
                  />
                </div>

                {/* Time Slots */}
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                    Available Time Slots ({bookingDate})
                  </label>
                  {bookingLoading ? (
                    <div className="py-4 text-center text-xs text-slate-400">Loading slots...</div>
                  ) : availableSlots.filter((s) => s.available).length === 0 ? (
                    <p className="text-xs text-amber-400 bg-amber-500/10 p-2.5 rounded-lg border border-amber-500/20">
                      No available slots on this date. Please pick another day.
                    </p>
                  ) : (
                    <div className="grid grid-cols-3 gap-2 max-h-36 overflow-y-auto p-1">
                      {availableSlots
                        .filter((s) => s.available)
                        .map((slot) => {
                          const isSelected = selectedSlot === slot.startTime;
                          const timeStr = new Date(slot.startTime).toLocaleTimeString([], {
                            hour: '2-digit',
                            minute: '2-digit',
                          });

                          return (
                            <button
                              key={slot.startTime}
                              type="button"
                              onClick={() => setSelectedSlot(slot.startTime)}
                              className={`p-2 rounded-lg text-xs font-mono font-medium border transition ${
                                isSelected
                                  ? 'bg-emerald-500 text-slate-950 border-emerald-400 font-bold'
                                  : 'bg-slate-950 border-slate-800 text-slate-300 hover:border-slate-700'
                              }`}
                            >
                              {timeStr}
                            </button>
                          );
                        })}
                    </div>
                  )}
                </div>

                {/* Contact details */}
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-300 mb-1">Your Name</label>
                    <input
                      type="text"
                      required
                      placeholder="Jane Doe"
                      value={customerName}
                      onChange={(e) => setCustomerName(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-1.5 text-xs text-white focus:outline-none focus:border-emerald-500"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-300 mb-1">Email</label>
                    <input
                      type="email"
                      required
                      placeholder="jane@email.com"
                      value={customerEmail}
                      onChange={(e) => setCustomerEmail(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-1.5 text-xs text-white focus:outline-none focus:border-emerald-500"
                    />
                  </div>
                </div>

                <div className="pt-2">
                  <button
                    type="submit"
                    disabled={!selectedSlot || !customerName || !customerEmail || bookingLoading}
                    className="w-full py-2.5 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs rounded-xl transition shadow-md disabled:opacity-50"
                  >
                    {bookingLoading ? 'Booking...' : 'Confirm Appointment'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
