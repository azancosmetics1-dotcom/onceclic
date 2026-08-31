import React, { useState, useEffect } from 'react';
import { api } from '../api/client';
import { Appointment, AppointmentStatus, AvailabilityRule } from '@onceclic/shared';
import { Badge } from '../components/Badge';
import {
  Calendar as CalendarIcon,
  Clock,
  User,
  Mail,
  Phone,
  CheckCircle2,
  XCircle,
  Plus,
  Settings,
  List,
} from 'lucide-react';

export const AppointmentsPage: React.FC = () => {
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [rules, setRules] = useState<AvailabilityRule[]>([]);
  const [activeTab, setActiveTab] = useState<'list' | 'availability'>('list');
  const [filterStatus, setFilterStatus] = useState<string>('ALL');
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [savingRules, setSavingRules] = useState(false);

  // New appointment form state
  const [newAppt, setNewAppt] = useState({
    serviceName: 'General Consultation',
    customerName: '',
    customerEmail: '',
    customerPhone: '',
    startTime: '',
    notes: '',
  });

  const loadData = async () => {
    try {
      const [appts, r] = await Promise.all([
        api.getAppointments(),
        api.getAvailabilityRules().catch(() => []),
      ]);
      setAppointments(appts);
      setRules(r);
    } catch (err) {
      console.error('[Appointments] Failed to load:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleStatusChange = async (id: string, newStatus: AppointmentStatus) => {
    try {
      await api.updateAppointmentStatus(id, newStatus);
      await loadData();
    } catch (err) {
      console.error('[Appointments] Status update failed:', err);
    }
  };

  const handleCreateAppointment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newAppt.customerName || !newAppt.customerEmail || !newAppt.startTime) return;

    try {
      await api.bookAppointment(newAppt);
      setShowAddModal(false);
      setNewAppt({
        serviceName: 'General Consultation',
        customerName: '',
        customerEmail: '',
        customerPhone: '',
        startTime: '',
        notes: '',
      });
      await loadData();
    } catch (err: any) {
      alert(err.message || 'Failed to book appointment.');
    }
  };

  const handleSaveRules = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingRules(true);
    try {
      await api.updateAvailabilityRules(rules);
      alert('Availability rules updated successfully.');
    } catch (err) {
      console.error('[Appointments] Rules update failed:', err);
    } finally {
      setSavingRules(false);
    }
  };

  const daysOfWeek = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  const filteredAppointments =
    filterStatus === 'ALL'
      ? appointments
      : appointments.filter((a) => a.status === filterStatus);

  return (
    <div className="space-y-8 max-w-5xl">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black text-white flex items-center space-x-2">
            <CalendarIcon className="w-6 h-6 text-emerald-400" />
            <span>Appointments & Scheduling</span>
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            Real-time appointment schedule, booking slots, and business availability rules.
          </p>
        </div>

        <div className="flex items-center space-x-3">
          <div className="flex rounded-xl bg-slate-900 border border-slate-800 p-1">
            <button
              onClick={() => setActiveTab('list')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                activeTab === 'list' ? 'bg-emerald-500 text-slate-950 shadow-sm' : 'text-slate-400 hover:text-white'
              }`}
            >
              Appointments ({appointments.length})
            </button>
            <button
              onClick={() => setActiveTab('availability')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                activeTab === 'availability' ? 'bg-emerald-500 text-slate-950 shadow-sm' : 'text-slate-400 hover:text-white'
              }`}
            >
              Availability Rules
            </button>
          </div>

          {activeTab === 'list' && (
            <button
              onClick={() => setShowAddModal(true)}
              className="inline-flex items-center space-x-1 px-4 py-2 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs rounded-xl transition shadow-md shadow-emerald-500/20 shrink-0"
            >
              <Plus className="w-4 h-4" />
              <span>Book Appointment</span>
            </button>
          )}
        </div>
      </div>

      {activeTab === 'list' && (
        <div className="space-y-4">
          {/* Status Filter */}
          <div className="flex items-center space-x-2 overflow-x-auto pb-1 text-xs">
            {['ALL', 'CONFIRMED', 'REQUESTED', 'COMPLETED', 'CANCELED', 'NO_SHOW'].map((st) => (
              <button
                key={st}
                onClick={() => setFilterStatus(st)}
                className={`px-3 py-1.5 rounded-lg font-medium border transition ${
                  filterStatus === st
                    ? 'bg-slate-800 border-emerald-500/50 text-emerald-400 font-bold'
                    : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
                }`}
              >
                {st}
              </button>
            ))}
          </div>

          {/* Appointment List */}
          {loading ? (
            <div className="flex justify-center py-20">
              <div className="w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : filteredAppointments.length === 0 ? (
            <div className="bg-slate-900 border border-slate-800 rounded-3xl p-12 text-center space-y-3">
              <CalendarIcon className="w-10 h-10 text-slate-600 mx-auto" />
              <h3 className="text-sm font-bold text-white">No appointments found</h3>
              <p className="text-xs text-slate-400">
                Customers can book appointments through the website AI chat or email.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {filteredAppointments.map((appt) => (
                <div
                  key={appt.id}
                  className="bg-slate-900 border border-slate-800 rounded-2xl p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 hover:border-slate-750 transition"
                >
                  <div className="space-y-1.5 min-w-0">
                    <div className="flex items-center space-x-2">
                      <h3 className="text-sm font-bold text-white truncate">{appt.customerName}</h3>
                      <Badge
                        variant={
                          appt.status === AppointmentStatus.CONFIRMED
                            ? 'success'
                            : appt.status === AppointmentStatus.REQUESTED
                            ? 'warning'
                            : appt.status === AppointmentStatus.COMPLETED
                            ? 'info'
                            : 'danger'
                        }
                      >
                        {appt.status}
                      </Badge>
                      <span className="text-xs text-emerald-400 font-semibold">{appt.serviceName}</span>
                    </div>

                    <div className="flex flex-wrap items-center gap-4 text-xs text-slate-400 font-mono">
                      <span className="flex items-center space-x-1 text-slate-200">
                        <Clock className="w-3.5 h-3.5 text-emerald-400" />
                        <span>
                          {new Date(appt.startTime).toLocaleDateString()} at{' '}
                          {new Date(appt.startTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </span>
                      <span className="flex items-center space-x-1">
                        <Mail className="w-3.5 h-3.5" />
                        <span>{appt.customerEmail}</span>
                      </span>
                      {appt.customerPhone && (
                        <span className="flex items-center space-x-1">
                          <Phone className="w-3.5 h-3.5" />
                          <span>{appt.customerPhone}</span>
                        </span>
                      )}
                    </div>

                    {appt.notes && (
                      <p className="text-xs text-slate-300 bg-slate-950/60 border border-slate-850 p-2 rounded-lg mt-2">
                        {appt.notes}
                      </p>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="flex items-center space-x-2 shrink-0">
                    {appt.status !== AppointmentStatus.CONFIRMED && (
                      <button
                        onClick={() => handleStatusChange(appt.id, AppointmentStatus.CONFIRMED)}
                        className="px-3 py-1.5 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/20 text-xs font-semibold rounded-lg transition"
                      >
                        Confirm
                      </button>
                    )}
                    {appt.status === AppointmentStatus.CONFIRMED && (
                      <button
                        onClick={() => handleStatusChange(appt.id, AppointmentStatus.COMPLETED)}
                        className="px-3 py-1.5 bg-sky-500/10 hover:bg-sky-500/20 text-sky-400 border border-sky-500/20 text-xs font-semibold rounded-lg transition"
                      >
                        Complete
                      </button>
                    )}
                    {appt.status !== AppointmentStatus.CANCELED && (
                      <button
                        onClick={() => handleStatusChange(appt.id, AppointmentStatus.CANCELED)}
                        className="px-3 py-1.5 bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/20 text-xs font-semibold rounded-lg transition"
                      >
                        Cancel
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Availability Rules Tab */}
      {activeTab === 'availability' && (
        <form onSubmit={handleSaveRules} className="bg-slate-900 border border-slate-800 rounded-3xl p-6 sm:p-8 space-y-6">
          <div>
            <h3 className="text-base font-bold text-white flex items-center space-x-2">
              <Clock className="w-5 h-5 text-emerald-400" />
              <span>Weekly Availability Rules</span>
            </h3>
            <p className="text-xs text-slate-400 mt-1">
              Configure which days and hours your business accepts appointments.
            </p>
          </div>

          <div className="space-y-3">
            {[0, 1, 2, 3, 4, 5, 6].map((dayIdx) => {
              const rule =
                rules.find((r) => r.dayOfWeek === dayIdx) || {
                  id: `temp_${dayIdx}`,
                  organizationId: '',
                  dayOfWeek: dayIdx,
                  startTime: '09:00',
                  endTime: '17:00',
                  slotDurationMinutes: 30,
                  bufferMinutes: 10,
                  isAvailable: dayIdx >= 1 && dayIdx <= 5,
                  createdAt: '',
                  updatedAt: '',
                };

              return (
                <div
                  key={dayIdx}
                  className="flex flex-col sm:flex-row sm:items-center justify-between p-3.5 bg-slate-950 border border-slate-850 rounded-2xl gap-3"
                >
                  <div className="flex items-center space-x-3 w-36">
                    <input
                      type="checkbox"
                      checked={rule.isAvailable}
                      onChange={(e) => {
                        const updated = [...rules];
                        const idx = updated.findIndex((r) => r.dayOfWeek === dayIdx);
                        if (idx >= 0) {
                          updated[idx] = { ...updated[idx], isAvailable: e.target.checked };
                        } else {
                          updated.push({ ...rule, isAvailable: e.target.checked });
                        }
                        setRules(updated);
                      }}
                      className="w-4 h-4 rounded text-emerald-500 accent-emerald-500"
                    />
                    <span className="text-xs font-bold text-white">{daysOfWeek[dayIdx]}</span>
                  </div>

                  {rule.isAvailable ? (
                    <div className="flex items-center space-x-3 text-xs">
                      <div className="flex items-center space-x-1.5">
                        <span className="text-slate-400">Open:</span>
                        <input
                          type="time"
                          value={rule.startTime}
                          onChange={(e) => {
                            const updated = [...rules];
                            const idx = updated.findIndex((r) => r.dayOfWeek === dayIdx);
                            if (idx >= 0) updated[idx] = { ...updated[idx], startTime: e.target.value };
                            else updated.push({ ...rule, startTime: e.target.value });
                            setRules(updated);
                          }}
                          className="bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1 text-white text-xs"
                        />
                      </div>
                      <div className="flex items-center space-x-1.5">
                        <span className="text-slate-400">Close:</span>
                        <input
                          type="time"
                          value={rule.endTime}
                          onChange={(e) => {
                            const updated = [...rules];
                            const idx = updated.findIndex((r) => r.dayOfWeek === dayIdx);
                            if (idx >= 0) updated[idx] = { ...updated[idx], endTime: e.target.value };
                            else updated.push({ ...rule, endTime: e.target.value });
                            setRules(updated);
                          }}
                          className="bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1 text-white text-xs"
                        />
                      </div>
                    </div>
                  ) : (
                    <span className="text-xs text-slate-500 italic">Closed</span>
                  )}
                </div>
              );
            })}
          </div>

          <div className="pt-4 border-t border-slate-800 flex justify-end">
            <button
              type="submit"
              disabled={savingRules}
              className="px-6 py-2.5 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs rounded-xl transition shadow-md shadow-emerald-500/20 disabled:opacity-50"
            >
              {savingRules ? 'Saving...' : 'Save Availability Rules'}
            </button>
          </div>
        </form>
      )}

      {/* Manual Booking Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl max-w-lg w-full p-6 sm:p-8 space-y-5 shadow-2xl">
            <h2 className="text-lg font-bold text-white flex items-center space-x-2">
              <CalendarIcon className="w-5 h-5 text-emerald-400" />
              <span>Book New Appointment</span>
            </h2>

            <form onSubmit={handleCreateAppointment} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">Service Name</label>
                <input
                  type="text"
                  required
                  value={newAppt.serviceName}
                  onChange={(e) => setNewAppt({ ...newAppt, serviceName: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2 text-xs text-white focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">Customer Full Name</label>
                <input
                  type="text"
                  required
                  placeholder="John Doe"
                  value={newAppt.customerName}
                  onChange={(e) => setNewAppt({ ...newAppt, customerName: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2 text-xs text-white focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">Email</label>
                  <input
                    type="email"
                    required
                    placeholder="john@example.com"
                    value={newAppt.customerEmail}
                    onChange={(e) => setNewAppt({ ...newAppt, customerEmail: e.target.value })}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2 text-xs text-white focus:outline-none focus:border-emerald-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">Phone (Optional)</label>
                  <input
                    type="tel"
                    placeholder="+1 555-0199"
                    value={newAppt.customerPhone}
                    onChange={(e) => setNewAppt({ ...newAppt, customerPhone: e.target.value })}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2 text-xs text-white focus:outline-none focus:border-emerald-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">Appointment Date & Time</label>
                <input
                  type="datetime-local"
                  required
                  value={newAppt.startTime}
                  onChange={(e) => setNewAppt({ ...newAppt, startTime: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2 text-xs text-white focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">Notes</label>
                <textarea
                  rows={2}
                  placeholder="Optional appointment notes..."
                  value={newAppt.notes}
                  onChange={(e) => setNewAppt({ ...newAppt, notes: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2 text-xs text-white focus:outline-none focus:border-emerald-500 resize-none"
                />
              </div>

              <div className="flex items-center justify-end space-x-3 pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-4 py-2 text-xs font-semibold text-slate-400 hover:text-white transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs rounded-xl transition shadow-md shadow-emerald-500/20"
                >
                  Confirm Booking
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
