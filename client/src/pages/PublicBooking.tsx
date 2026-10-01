import React, { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../api/client';
import { AvailableSlot } from '@onceclic/shared';
import {
  Calendar,
  Clock,
  CheckCircle2,
  AlertTriangle,
  User,
  Mail,
  Phone,
  Sparkles,
  MapPin,
  UtensilsCrossed,
  Scissors,
  Stethoscope,
  ChevronRight,
  ShieldCheck,
  Building2,
} from 'lucide-react';

export const PublicBooking: React.FC = () => {
  const { orgSlug } = useParams<{ orgSlug: string }>();

  const [orgData, setOrgData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Form State
  const [selectedService, setSelectedService] = useState<string>('');
  const [selectedDate, setSelectedDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [availableSlots, setAvailableSlots] = useState<AvailableSlot[]>([]);
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null);
  const [slotsLoading, setSlotsLoading] = useState(false);

  // Customer State
  const [customerName, setCustomerName] = useState('');
  const [customerEmail, setCustomerEmail] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [partySize, setPartySize] = useState<number>(2);
  const [notes, setNotes] = useState('');

  // Submit State
  const [submitting, setSubmitting] = useState(false);
  const [bookingSuccess, setBookingSuccess] = useState<any | null>(null);

  useEffect(() => {
    if (!orgSlug) return;
    loadOrg(orgSlug);
  }, [orgSlug]);

  const loadOrg = async (slug: string) => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.getPublicOrg(slug);
      setOrgData(data);

      // Default service selection
      if (data?.services && data.services.length > 0) {
        setSelectedService(data.services[0].name);
      }
    } catch (err: any) {
      console.error('[PublicBooking] Failed to load org:', err);
      setError(err.message || 'Business profile not found.');
    } finally {
      setLoading(false);
    }
  };

  const loadSlots = async (slug: string, date: string) => {
    setSlotsLoading(true);
    try {
      const slots = await api.getPublicAppointmentSlots(slug, date);
      setAvailableSlots(slots);
      setSelectedSlot(null);
    } catch (err) {
      console.error('[PublicBooking] Failed to load slots:', err);
      setAvailableSlots([]);
    } finally {
      setSlotsLoading(false);
    }
  };

  useEffect(() => {
    if (orgSlug && selectedDate) {
      loadSlots(orgSlug, selectedDate);
    }
  }, [orgSlug, selectedDate]);

  const handleBookingSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedSlot || !customerName || !customerEmail || !orgSlug) return;

    setSubmitting(true);
    try {
      const isRestaurant = (orgData?.organization?.businessType || '').toLowerCase().includes('restaurant');
      const compiledNotes = isRestaurant
        ? `Party size: ${partySize} guests${notes ? ` | Notes: ${notes}` : ''}`
        : notes || undefined;

      const appt = await api.bookPublicAppointment({
        orgSlug,
        serviceName: selectedService || (isRestaurant ? 'Table Reservation' : 'Appointment'),
        customerName,
        customerEmail,
        customerPhone: customerPhone || undefined,
        startTime: selectedSlot,
        notes: compiledNotes,
      });

      setBookingSuccess(appt);
    } catch (err: any) {
      alert(err.message || 'Failed to complete booking.');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (error || !orgData) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-4 text-center">
        <AlertTriangle className="w-12 h-12 text-amber-400 mb-4" />
        <h2 className="text-xl font-bold text-white mb-2">Booking Page Unavailable</h2>
        <p className="text-xs text-slate-400 max-w-sm mb-6">{error || 'Could not find business profile.'}</p>
        <Link to="/" className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white text-xs font-semibold rounded-xl">
          Return Home
        </Link>
      </div>
    );
  }

  const bType = (orgData.organization.businessType || 'services').toLowerCase();
  const isRestaurant = bType.includes('restaurant') || bType.includes('cafe') || bType.includes('dining') || bType.includes('food');
  const isSalon = bType.includes('salon') || bType.includes('spa') || bType.includes('beauty') || bType.includes('hair');
  const isClinic = bType.includes('clinic') || bType.includes('doctor') || bType.includes('medical') || bType.includes('dental');

  const selectedServiceObj = orgData.services?.find((s: any) => s.name === selectedService);
  const resSettings = orgData.reservationSettings;

  // Industry Terms
  const pageTitle = isRestaurant ? 'Reserve a Table' : isSalon ? 'Book a Service' : 'Book Appointment';
  const actionLabel = isRestaurant ? 'Confirm Reservation' : isSalon ? 'Confirm Booking' : 'Confirm Appointment';
  const nameLabel = isRestaurant ? 'Lead Guest Name' : isSalon ? 'Client Name' : isClinic ? 'Patient Name' : 'Full Name';
  const serviceLabel = isRestaurant ? 'Table & Seating Option' : isSalon ? 'Choose Service' : 'Choose Consultation / Service';

  let pricingBadge = 'Price: Contact Business';
  if (selectedServiceObj?.price !== undefined) {
    pricingBadge = selectedServiceObj.price === 0 ? 'Free' : `$${selectedServiceObj.price}`;
  } else if (resSettings?.reservationFee) {
    pricingBadge = `Fee: $${resSettings.reservationFee}`;
  } else if (resSettings?.minimumSpend) {
    pricingBadge = `Min Spend: $${resSettings.minimumSpend}`;
  } else if (resSettings?.depositAmount) {
    pricingBadge = `Deposit: $${resSettings.depositAmount}`;
  } else if (isRestaurant) {
    pricingBadge = 'Reservation: Free';
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col justify-between p-3 sm:p-6 lg:p-10 selection:bg-emerald-500 selection:text-slate-950">
      <div className="max-w-3xl w-full mx-auto space-y-6">
        {/* Business Header Card */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl sm:rounded-3xl p-5 sm:p-7 shadow-xl">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="space-y-1.5 min-w-0">
              <div className="flex items-center space-x-2">
                <div className="w-8 h-8 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400 shrink-0">
                  {isRestaurant ? (
                    <UtensilsCrossed className="w-4 h-4" />
                  ) : isSalon ? (
                    <Scissors className="w-4 h-4" />
                  ) : isClinic ? (
                    <Stethoscope className="w-4 h-4" />
                  ) : (
                    <Building2 className="w-4 h-4" />
                  )}
                </div>
                <span className="text-xs font-semibold uppercase tracking-wider text-emerald-400">
                  {isRestaurant ? 'Restaurant & Dining' : isSalon ? 'Salon & Wellness' : isClinic ? 'Clinic & Healthcare' : 'Professional Service'}
                </span>
              </div>
              <h1 className="text-xl sm:text-2xl font-black text-white tracking-tight truncate">
                {orgData.organization.name}
              </h1>
              {orgData.organization.address && (
                <p className="text-xs text-slate-400 flex items-center gap-1.5">
                  <MapPin className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                  <span>{orgData.organization.address}</span>
                </p>
              )}
            </div>

            <Link
              to={`/chat/${orgData.organization.slug}`}
              className="inline-flex items-center justify-center space-x-2 px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-medium text-xs transition border border-slate-700/60 shadow-sm shrink-0"
            >
              <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
              <span>Ask AI Receptionist</span>
            </Link>
          </div>
        </div>

        {/* Booking Process Container */}
        {bookingSuccess ? (
          <div className="bg-slate-900 border border-slate-800 rounded-2xl sm:rounded-3xl p-6 sm:p-10 text-center space-y-6 shadow-2xl">
            <div className="w-16 h-16 rounded-full bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400 mx-auto">
              <CheckCircle2 className="w-9 h-9" />
            </div>

            <div className="space-y-2">
              <h2 className="text-xl sm:text-2xl font-bold text-white">
                {isRestaurant ? 'Table Reservation Confirmed!' : isSalon ? 'Service Booking Confirmed!' : 'Appointment Confirmed!'}
              </h2>
              <p className="text-xs sm:text-sm text-slate-400 max-w-md mx-auto">
                A confirmation has been recorded and sent to <span className="text-white font-semibold">{bookingSuccess.customerEmail}</span>.
              </p>
            </div>

            {/* Booking Summary Box */}
            <div className="bg-slate-950 p-5 rounded-2xl border border-slate-800 max-w-md mx-auto text-left space-y-2.5 text-xs">
              <div className="flex justify-between border-b border-slate-800/80 pb-2">
                <span className="text-slate-400">{isRestaurant ? 'Reservation:' : 'Service:'}</span>
                <span className="text-white font-bold">{bookingSuccess.serviceName}</span>
              </div>
              <div className="flex justify-between border-b border-slate-800/80 pb-2">
                <span className="text-slate-400">Date:</span>
                <span className="text-white font-semibold">
                  {new Date(bookingSuccess.startTime).toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
                </span>
              </div>
              <div className="flex justify-between border-b border-slate-800/80 pb-2">
                <span className="text-slate-400">Time:</span>
                <span className="text-emerald-400 font-bold font-mono">
                  {new Date(bookingSuccess.startTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} ({orgData.organization.timezone || 'UTC'})
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Reference:</span>
                <span className="text-slate-400 font-mono text-[11px]">{bookingSuccess.id}</span>
              </div>
            </div>

            <div className="pt-2 flex flex-col sm:flex-row justify-center gap-3">
              <button
                onClick={() => {
                  setBookingSuccess(null);
                  setSelectedSlot(null);
                }}
                className="px-5 py-2.5 bg-slate-800 hover:bg-slate-700 text-white rounded-xl text-xs font-semibold transition"
              >
                Book Another
              </button>
              <Link
                to={`/chat/${orgData.organization.slug}`}
                className="px-5 py-2.5 bg-emerald-500 hover:bg-emerald-400 text-slate-950 rounded-xl text-xs font-bold transition"
              >
                Chat with Business
              </Link>
            </div>
          </div>
        ) : (
          <form onSubmit={handleBookingSubmit} className="space-y-6">
            {/* Step 1: Service or Reservation Selection */}
            <div className="bg-slate-900 border border-slate-800 rounded-2xl sm:rounded-3xl p-5 sm:p-7 shadow-sm space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-sm sm:text-base font-bold text-white flex items-center gap-2">
                  <span className="w-5 h-5 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center text-xs">1</span>
                  <span>{serviceLabel}</span>
                </h2>
                <span className="text-xs font-bold text-emerald-400 bg-emerald-950/60 px-2.5 py-1 rounded-lg border border-emerald-800/80">
                  {pricingBadge}
                </span>
              </div>

              {orgData.services && orgData.services.length > 0 ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {orgData.services.map((srv: any) => {
                    const isSelected = selectedService === srv.name;
                    const priceFormatted = srv.price !== undefined ? (srv.price === 0 ? 'Free' : `$${srv.price}`) : '';

                    return (
                      <button
                        key={srv.id || srv.name}
                        type="button"
                        onClick={() => setSelectedService(srv.name)}
                        className={`p-4 rounded-xl text-left border transition flex flex-col justify-between gap-2 ${
                          isSelected
                            ? 'bg-emerald-950/40 border-emerald-500 text-white shadow-sm'
                            : 'bg-slate-950/60 border-slate-800 text-slate-300 hover:border-slate-700'
                        }`}
                      >
                        <div>
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-bold text-xs sm:text-sm text-white">{srv.name}</span>
                            {priceFormatted && (
                              <span className="text-xs font-black text-emerald-400 font-mono">{priceFormatted}</span>
                            )}
                          </div>
                          {srv.description && (
                            <p className="text-[11px] text-slate-400 mt-1 line-clamp-2">{srv.description}</p>
                          )}
                        </div>
                        {srv.durationMinutes && (
                          <div className="text-[10px] text-slate-500 font-mono flex items-center gap-1 mt-1">
                            <Clock className="w-3 h-3" />
                            <span>{srv.durationMinutes} min</span>
                          </div>
                        )}
                      </button>
                    );
                  })}
                </div>
              ) : (
                <p className="text-xs text-slate-400 bg-slate-950 p-3 rounded-xl border border-slate-800">
                  Standard reservation / appointment availability.
                </p>
              )}

              {/* Party size picker for restaurant */}
              {isRestaurant && (
                <div className="pt-2">
                  <label className="block text-xs font-semibold text-slate-300 mb-1.5">Number of Guests / Party Size</label>
                  <div className="flex items-center space-x-2">
                    {[1, 2, 3, 4, 5, 6, 8].map((size) => (
                      <button
                        key={size}
                        type="button"
                        onClick={() => setPartySize(size)}
                        className={`px-3.5 py-2 rounded-xl text-xs font-bold border transition ${
                          partySize === size
                            ? 'bg-emerald-500 text-slate-950 border-emerald-400'
                            : 'bg-slate-950 border-slate-800 text-slate-300 hover:border-slate-700'
                        }`}
                      >
                        {size} {size === 1 ? 'Guest' : 'Guests'}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Step 2: Choose Date & Time */}
            <div className="bg-slate-900 border border-slate-800 rounded-2xl sm:rounded-3xl p-5 sm:p-7 shadow-sm space-y-4">
              <h2 className="text-sm sm:text-base font-bold text-white flex items-center gap-2">
                <span className="w-5 h-5 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center text-xs">2</span>
                <span>Choose Date & Time</span>
              </h2>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="sm:col-span-1 space-y-1.5">
                  <label className="block text-xs font-semibold text-slate-300">Date</label>
                  <input
                    type="date"
                    min={new Date().toISOString().split('T')[0]}
                    value={selectedDate}
                    onChange={(e) => setSelectedDate(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs text-white focus:outline-none focus:border-emerald-500"
                  />
                </div>

                <div className="sm:col-span-2 space-y-1.5">
                  <label className="block text-xs font-semibold text-slate-300">
                    Available Slots ({selectedDate})
                  </label>
                  {slotsLoading ? (
                    <div className="py-6 text-center text-xs text-slate-400">Loading available times...</div>
                  ) : availableSlots.filter((s) => s.available).length === 0 ? (
                    <div className="p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/20 text-xs text-amber-300">
                      No open slots on this date. Please select a different day.
                    </div>
                  ) : (
                    <div className="grid grid-cols-3 sm:grid-cols-4 gap-2 max-h-48 overflow-y-auto p-1">
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
                              className={`p-2.5 rounded-xl text-xs font-mono font-medium border transition ${
                                isSelected
                                  ? 'bg-emerald-500 text-slate-950 border-emerald-400 font-bold shadow-md'
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
              </div>
            </div>

            {/* Step 3: Customer Information */}
            <div className="bg-slate-900 border border-slate-800 rounded-2xl sm:rounded-3xl p-5 sm:p-7 shadow-sm space-y-4">
              <h2 className="text-sm sm:text-base font-bold text-white flex items-center gap-2">
                <span className="w-5 h-5 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center text-xs">3</span>
                <span>Customer & Contact Details</span>
              </h2>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">{nameLabel} *</label>
                  <div className="relative">
                    <User className="w-3.5 h-3.5 text-slate-500 absolute left-3.5 top-3" />
                    <input
                      type="text"
                      required
                      placeholder="Jane Doe"
                      value={customerName}
                      onChange={(e) => setCustomerName(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-9 pr-3 py-2.5 text-xs text-white focus:outline-none focus:border-emerald-500"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">Email Address *</label>
                  <div className="relative">
                    <Mail className="w-3.5 h-3.5 text-slate-500 absolute left-3.5 top-3" />
                    <input
                      type="email"
                      required
                      placeholder="jane@email.com"
                      value={customerEmail}
                      onChange={(e) => setCustomerEmail(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-9 pr-3 py-2.5 text-xs text-white focus:outline-none focus:border-emerald-500"
                    />
                  </div>
                </div>

                <div className="sm:col-span-2">
                  <label className="block text-xs font-semibold text-slate-300 mb-1">Phone Number (Optional)</label>
                  <div className="relative">
                    <Phone className="w-3.5 h-3.5 text-slate-500 absolute left-3.5 top-3" />
                    <input
                      type="tel"
                      placeholder="+1 (555) 000-0000"
                      value={customerPhone}
                      onChange={(e) => setCustomerPhone(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-9 pr-3 py-2.5 text-xs text-white focus:outline-none focus:border-emerald-500"
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Step 4: Transparent Upfront Summary & Confirmation */}
            <div className="bg-gradient-to-br from-slate-900 to-slate-950 border border-slate-800 rounded-2xl sm:rounded-3xl p-5 sm:p-7 shadow-xl space-y-4">
              <div className="space-y-2">
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400">Booking Summary</h3>
                <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-2 text-xs">
                  <div className="flex justify-between">
                    <span className="text-slate-400">{isRestaurant ? 'Reservation:' : 'Service:'}</span>
                    <span className="text-white font-bold">{selectedService || 'Standard'}</span>
                  </div>
                  {isRestaurant && (
                    <div className="flex justify-between">
                      <span className="text-slate-400">Party Size:</span>
                      <span className="text-white font-semibold">{partySize} Guests</span>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <span className="text-slate-400">Selected Time:</span>
                    <span className="text-white font-mono">
                      {selectedSlot
                        ? `${new Date(selectedSlot).toLocaleDateString()} at ${new Date(selectedSlot).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
                        : 'Please choose a slot above'}
                    </span>
                  </div>
                  <div className="flex justify-between border-t border-slate-800/80 pt-2 text-sm">
                    <span className="text-slate-300 font-bold">
                      {isRestaurant ? 'Reservation Charge:' : isSalon ? 'Total Price:' : 'Appointment Price:'}
                    </span>
                    <span className="text-emerald-400 font-black font-mono">
                      {pricingBadge}
                    </span>
                  </div>
                </div>
              </div>

              <button
                type="submit"
                disabled={!selectedSlot || !customerName || !customerEmail || submitting}
                className="w-full py-3.5 bg-gradient-to-r from-emerald-500 to-teal-400 hover:from-emerald-400 hover:to-teal-300 text-slate-950 font-black text-sm rounded-xl transition shadow-lg shadow-emerald-500/25 disabled:opacity-50 disabled:shadow-none"
              >
                {submitting ? 'Processing Confirmation...' : actionLabel}
              </button>
            </div>
          </form>
        )}
      </div>

      <footer className="mt-12 text-center text-xs text-slate-500">
        Powered by <a href="https://onceclic.com" className="text-emerald-400 hover:underline font-semibold">ONCEClic</a> &bull; AI Receptionist
      </footer>
    </div>
  );
};
