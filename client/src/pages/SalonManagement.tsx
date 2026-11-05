import React, { useEffect, useState, useCallback } from 'react';
import { api } from '../api/client';
import {
  Scissors,
  Plus,
  Edit2,
  Trash2,
  UserCheck,
  CheckCircle2,
  XCircle,
  RefreshCw,
  Clock,
  DollarSign,
  User,
  Phone,
  Mail,
  Calendar,
  Tag,
  Link as LinkIcon,
} from 'lucide-react';

// ─── Types ───────────────────────────────────────────────────────────────────

interface SalonServiceRecord {
  id: string;
  organizationId: string;
  name: string;
  description?: string;
  price: number;
  durationMinutes: number;
  category?: string;
  isActive: boolean;
  instructions?: string;
  createdAt: string;
  updatedAt: string;
}

interface SalonStaffRecord {
  id: string;
  organizationId: string;
  name: string;
  phone?: string;
  email?: string;
  isActive: boolean;
  workingDays: number[];
  workingHoursStart: string;
  workingHoursEnd: string;
  createdAt: string;
  updatedAt: string;
}

type ActiveTab = 'services' | 'staff';

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// ─── Service Form ─────────────────────────────────────────────────────────────

interface ServiceFormData {
  name: string;
  description: string;
  price: string;
  durationMinutes: string;
  category: string;
  isActive: boolean;
  instructions: string;
}

const defaultServiceForm = (): ServiceFormData => ({
  name: '',
  description: '',
  price: '0',
  durationMinutes: '30',
  category: '',
  isActive: true,
  instructions: '',
});

// ─── Staff Form ───────────────────────────────────────────────────────────────

interface StaffFormData {
  name: string;
  phone: string;
  email: string;
  isActive: boolean;
  workingDays: number[];
  workingHoursStart: string;
  workingHoursEnd: string;
}

const defaultStaffForm = (): StaffFormData => ({
  name: '',
  phone: '',
  email: '',
  isActive: true,
  workingDays: [1, 2, 3, 4, 5, 6],
  workingHoursStart: '09:00',
  workingHoursEnd: '18:00',
});

// ─── Component ───────────────────────────────────────────────────────────────

export const SalonManagement: React.FC = () => {
  const [activeTab, setActiveTab] = useState<ActiveTab>('services');
  const [services, setServices] = useState<SalonServiceRecord[]>([]);
  const [staff, setStaff] = useState<SalonStaffRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Service form state
  const [showServiceForm, setShowServiceForm] = useState(false);
  const [editingService, setEditingService] = useState<SalonServiceRecord | null>(null);
  const [serviceForm, setServiceForm] = useState<ServiceFormData>(defaultServiceForm());
  const [savingService, setSavingService] = useState(false);

  // Staff form state
  const [showStaffForm, setShowStaffForm] = useState(false);
  const [editingStaff, setEditingStaff] = useState<SalonStaffRecord | null>(null);
  const [staffForm, setStaffForm] = useState<StaffFormData>(defaultStaffForm());
  const [savingStaff, setSavingStaff] = useState(false);

  // Staff-service assignment modal
  const [assigningStaff, setAssigningStaff] = useState<SalonStaffRecord | null>(null);
  const [staffServices, setStaffServices] = useState<SalonServiceRecord[]>([]);
  const [loadingStaffServices, setLoadingStaffServices] = useState(false);

  const showSuccess = (msg: string) => {
    setSuccessMsg(msg);
    setTimeout(() => setSuccessMsg(null), 3500);
  };

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [svc, st] = await Promise.all([
        api.getSalonServices().catch(() => []),
        api.getSalonStaff().catch(() => []),
      ]);
      setServices(svc as SalonServiceRecord[]);
      setStaff(st as SalonStaffRecord[]);
    } catch (err: any) {
      setError(err.message || 'Failed to load salon data.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // ── Service handlers ──────────────────────────────────────────────────────

  const openServiceForm = (service?: SalonServiceRecord) => {
    if (service) {
      setEditingService(service);
      setServiceForm({
        name: service.name,
        description: service.description || '',
        price: String(service.price),
        durationMinutes: String(service.durationMinutes),
        category: service.category || '',
        isActive: service.isActive,
        instructions: service.instructions || '',
      });
    } else {
      setEditingService(null);
      setServiceForm(defaultServiceForm());
    }
    setShowServiceForm(true);
  };

  const saveService = async () => {
    if (!serviceForm.name.trim()) {
      setError('Service name is required.');
      return;
    }
    setSavingService(true);
    setError(null);
    try {
      const payload = {
        name: serviceForm.name.trim(),
        description: serviceForm.description || undefined,
        price: parseFloat(serviceForm.price) || 0,
        durationMinutes: parseInt(serviceForm.durationMinutes, 10) || 30,
        category: serviceForm.category || undefined,
        isActive: serviceForm.isActive,
        instructions: serviceForm.instructions || undefined,
      };
      if (editingService) {
        await api.updateSalonService(editingService.id, payload);
        showSuccess('Service updated successfully.');
      } else {
        await api.createSalonService(payload);
        showSuccess('Service created successfully.');
      }
      setShowServiceForm(false);
      await loadData();
    } catch (err: any) {
      setError(err.message || 'Failed to save service.');
    } finally {
      setSavingService(false);
    }
  };

  const deleteService = async (service: SalonServiceRecord) => {
    if (!window.confirm(`Deactivate "${service.name}"? It will no longer be bookable.`)) return;
    try {
      await api.deleteSalonService(service.id);
      showSuccess(`"${service.name}" deactivated.`);
      await loadData();
    } catch (err: any) {
      setError(err.message || 'Failed to deactivate service.');
    }
  };

  // ── Staff handlers ────────────────────────────────────────────────────────

  const openStaffForm = (member?: SalonStaffRecord) => {
    if (member) {
      setEditingStaff(member);
      setStaffForm({
        name: member.name,
        phone: member.phone || '',
        email: member.email || '',
        isActive: member.isActive,
        workingDays: member.workingDays,
        workingHoursStart: member.workingHoursStart,
        workingHoursEnd: member.workingHoursEnd,
      });
    } else {
      setEditingStaff(null);
      setStaffForm(defaultStaffForm());
    }
    setShowStaffForm(true);
  };

  const saveStaff = async () => {
    if (!staffForm.name.trim()) {
      setError('Staff name is required.');
      return;
    }
    setSavingStaff(true);
    setError(null);
    try {
      const payload = {
        name: staffForm.name.trim(),
        phone: staffForm.phone || undefined,
        email: staffForm.email || undefined,
        isActive: staffForm.isActive,
        workingDays: staffForm.workingDays,
        workingHoursStart: staffForm.workingHoursStart,
        workingHoursEnd: staffForm.workingHoursEnd,
      };
      if (editingStaff) {
        await api.updateSalonStaff(editingStaff.id, payload);
        showSuccess('Staff member updated.');
      } else {
        await api.createSalonStaff(payload);
        showSuccess('Staff member added.');
      }
      setShowStaffForm(false);
      await loadData();
    } catch (err: any) {
      setError(err.message || 'Failed to save staff member.');
    } finally {
      setSavingStaff(false);
    }
  };

  const deleteStaff = async (member: SalonStaffRecord) => {
    if (!window.confirm(`Deactivate "${member.name}"? They will no longer be bookable.`)) return;
    try {
      await api.deleteSalonStaff(member.id);
      showSuccess(`${member.name} deactivated.`);
      await loadData();
    } catch (err: any) {
      setError(err.message || 'Failed to deactivate staff member.');
    }
  };

  const toggleDay = (day: number) => {
    setStaffForm((prev) => ({
      ...prev,
      workingDays: prev.workingDays.includes(day)
        ? prev.workingDays.filter((d) => d !== day)
        : [...prev.workingDays, day].sort(),
    }));
  };

  // ── Staff-service assignment ──────────────────────────────────────────────

  const openAssignModal = async (member: SalonStaffRecord) => {
    setAssigningStaff(member);
    setLoadingStaffServices(true);
    try {
      const svcList = await api.getStaffServices(member.id);
      setStaffServices(svcList as SalonServiceRecord[]);
    } catch {
      setStaffServices([]);
    } finally {
      setLoadingStaffServices(false);
    }
  };

  const toggleServiceAssignment = async (serviceId: string) => {
    if (!assigningStaff) return;
    const isAssigned = staffServices.some((s) => s.id === serviceId);
    try {
      if (isAssigned) {
        await api.removeStaffService(assigningStaff.id, serviceId);
        setStaffServices((prev) => prev.filter((s) => s.id !== serviceId));
      } else {
        await api.assignStaffService(assigningStaff.id, serviceId);
        const svc = services.find((s) => s.id === serviceId);
        if (svc) setStaffServices((prev) => [...prev, svc]);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to update service assignment.');
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-64">
        <div className="w-8 h-8 border-2 border-purple-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-purple-500/10 rounded-lg">
            <Scissors className="w-6 h-6 text-purple-400" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-white">Salon Management</h1>
            <p className="text-sm text-slate-400">Manage your salon services, staff, and scheduling</p>
          </div>
        </div>
        <button
          onClick={loadData}
          className="p-2 text-slate-400 hover:text-white transition-colors"
          title="Refresh"
        >
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      {/* Alerts */}
      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 flex items-start gap-2">
          <XCircle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
          <span className="text-red-300 text-sm">{error}</span>
        </div>
      )}
      {successMsg && (
        <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-lg p-3 flex items-start gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0 mt-0.5" />
          <span className="text-emerald-300 text-sm">{successMsg}</span>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 bg-slate-800 rounded-lg p-1 w-fit">
        <button
          onClick={() => setActiveTab('services')}
          className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
            activeTab === 'services'
              ? 'bg-purple-600 text-white'
              : 'text-slate-400 hover:text-white'
          }`}
        >
          Services ({services.filter((s) => s.isActive).length})
        </button>
        <button
          onClick={() => setActiveTab('staff')}
          className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
            activeTab === 'staff'
              ? 'bg-purple-600 text-white'
              : 'text-slate-400 hover:text-white'
          }`}
        >
          Staff ({staff.filter((s) => s.isActive).length})
        </button>
      </div>

      {/* ── Services Tab ── */}
      {activeTab === 'services' && (
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <h2 className="text-lg font-semibold text-white">Services</h2>
            <button
              onClick={() => openServiceForm()}
              className="flex items-center gap-2 px-3 py-2 bg-purple-600 hover:bg-purple-700 text-white text-sm font-medium rounded-lg transition-colors"
            >
              <Plus className="w-4 h-4" />
              Add Service
            </button>
          </div>

          {services.length === 0 ? (
            <div className="bg-slate-800 rounded-lg p-8 text-center">
              <Scissors className="w-10 h-10 text-slate-600 mx-auto mb-3" />
              <p className="text-slate-400">No services added yet. Add your first service to get started.</p>
            </div>
          ) : (
            <div className="grid gap-3">
              {services.map((svc) => (
                <div
                  key={svc.id}
                  className={`bg-slate-800 rounded-lg p-4 border ${
                    svc.isActive ? 'border-slate-700' : 'border-slate-700/50 opacity-60'
                  }`}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="font-medium text-white">{svc.name}</h3>
                        {svc.category && (
                          <span className="px-2 py-0.5 bg-purple-500/20 text-purple-300 text-xs rounded-full flex items-center gap-1">
                            <Tag className="w-3 h-3" />
                            {svc.category}
                          </span>
                        )}
                        <span
                          className={`px-2 py-0.5 text-xs rounded-full ${
                            svc.isActive
                              ? 'bg-emerald-500/20 text-emerald-300'
                              : 'bg-slate-700 text-slate-400'
                          }`}
                        >
                          {svc.isActive ? 'Active' : 'Inactive'}
                        </span>
                      </div>
                      {svc.description && (
                        <p className="text-slate-400 text-sm mt-1">{svc.description}</p>
                      )}
                      <div className="flex items-center gap-4 mt-2">
                        <span className="flex items-center gap-1 text-sm text-slate-300">
                          <DollarSign className="w-3.5 h-3.5 text-emerald-400" />
                          {Number(svc.price).toFixed(2)}
                        </span>
                        <span className="flex items-center gap-1 text-sm text-slate-300">
                          <Clock className="w-3.5 h-3.5 text-blue-400" />
                          {svc.durationMinutes} min
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <button
                        onClick={() => openServiceForm(svc)}
                        className="p-1.5 text-slate-400 hover:text-white transition-colors"
                        title="Edit service"
                      >
                        <Edit2 className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => deleteService(svc)}
                        className="p-1.5 text-slate-400 hover:text-red-400 transition-colors"
                        title="Deactivate service"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Staff Tab ── */}
      {activeTab === 'staff' && (
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <h2 className="text-lg font-semibold text-white">Staff Members</h2>
            <button
              onClick={() => openStaffForm()}
              className="flex items-center gap-2 px-3 py-2 bg-purple-600 hover:bg-purple-700 text-white text-sm font-medium rounded-lg transition-colors"
            >
              <Plus className="w-4 h-4" />
              Add Staff
            </button>
          </div>

          {staff.length === 0 ? (
            <div className="bg-slate-800 rounded-lg p-8 text-center">
              <User className="w-10 h-10 text-slate-600 mx-auto mb-3" />
              <p className="text-slate-400">No staff added yet.</p>
            </div>
          ) : (
            <div className="grid gap-3">
              {staff.map((member) => (
                <div
                  key={member.id}
                  className={`bg-slate-800 rounded-lg p-4 border ${
                    member.isActive ? 'border-slate-700' : 'border-slate-700/50 opacity-60'
                  }`}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="font-medium text-white">{member.name}</h3>
                        <span
                          className={`px-2 py-0.5 text-xs rounded-full ${
                            member.isActive
                              ? 'bg-emerald-500/20 text-emerald-300'
                              : 'bg-slate-700 text-slate-400'
                          }`}
                        >
                          {member.isActive ? 'Active' : 'Inactive'}
                        </span>
                      </div>
                      <div className="flex items-center gap-4 mt-1 flex-wrap">
                        {member.phone && (
                          <span className="flex items-center gap-1 text-sm text-slate-400">
                            <Phone className="w-3.5 h-3.5" />
                            {member.phone}
                          </span>
                        )}
                        {member.email && (
                          <span className="flex items-center gap-1 text-sm text-slate-400">
                            <Mail className="w-3.5 h-3.5" />
                            {member.email}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 mt-2 flex-wrap">
                        <span className="flex items-center gap-1 text-xs text-slate-400">
                          <Calendar className="w-3 h-3" />
                          {member.workingHoursStart} – {member.workingHoursEnd}
                        </span>
                        <div className="flex gap-1">
                          {DAY_LABELS.map((d, i) => (
                            <span
                              key={i}
                              className={`text-xs px-1.5 py-0.5 rounded ${
                                member.workingDays.includes(i)
                                  ? 'bg-purple-500/20 text-purple-300'
                                  : 'bg-slate-700 text-slate-600'
                              }`}
                            >
                              {d}
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <button
                        onClick={() => openAssignModal(member)}
                        className="p-1.5 text-slate-400 hover:text-purple-400 transition-colors"
                        title="Assign services"
                      >
                        <LinkIcon className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => openStaffForm(member)}
                        className="p-1.5 text-slate-400 hover:text-white transition-colors"
                        title="Edit staff"
                      >
                        <Edit2 className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => deleteStaff(member)}
                        className="p-1.5 text-slate-400 hover:text-red-400 transition-colors"
                        title="Deactivate staff"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Service Form Modal ── */}
      {showServiceForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-xl w-full max-w-lg shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="p-6 space-y-4">
              <h3 className="text-lg font-bold text-white">
                {editingService ? 'Edit Service' : 'Add Service'}
              </h3>

              <div className="space-y-3">
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-1">Service Name *</label>
                  <input
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-purple-500"
                    value={serviceForm.name}
                    onChange={(e) => setServiceForm((f) => ({ ...f, name: e.target.value }))}
                    placeholder="e.g. Haircut, Facial, Manicure"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-1">Category</label>
                  <input
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-purple-500"
                    value={serviceForm.category}
                    onChange={(e) => setServiceForm((f) => ({ ...f, category: e.target.value }))}
                    placeholder="e.g. Hair, Nails, Skin, Makeup"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-1">Description</label>
                  <textarea
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-purple-500 resize-none"
                    rows={2}
                    value={serviceForm.description}
                    onChange={(e) => setServiceForm((f) => ({ ...f, description: e.target.value }))}
                    placeholder="Brief description of the service"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-medium text-slate-300 mb-1">Price ($)</label>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-purple-500"
                      value={serviceForm.price}
                      onChange={(e) => setServiceForm((f) => ({ ...f, price: e.target.value }))}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-300 mb-1">Duration (min)</label>
                    <input
                      type="number"
                      min="5"
                      step="5"
                      className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-purple-500"
                      value={serviceForm.durationMinutes}
                      onChange={(e) => setServiceForm((f) => ({ ...f, durationMinutes: e.target.value }))}
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-1">Instructions (optional)</label>
                  <textarea
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-purple-500 resize-none"
                    rows={2}
                    value={serviceForm.instructions}
                    onChange={(e) => setServiceForm((f) => ({ ...f, instructions: e.target.value }))}
                    placeholder="Preparation or aftercare instructions"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="svc-active"
                    checked={serviceForm.isActive}
                    onChange={(e) => setServiceForm((f) => ({ ...f, isActive: e.target.checked }))}
                    className="accent-purple-500"
                  />
                  <label htmlFor="svc-active" className="text-sm text-slate-300">Active (bookable by AI receptionist)</label>
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <button
                  onClick={() => setShowServiceForm(false)}
                  className="px-4 py-2 text-slate-400 hover:text-white text-sm transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={saveService}
                  disabled={savingService}
                  className="px-4 py-2 bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors"
                >
                  {savingService ? 'Saving…' : editingService ? 'Update Service' : 'Create Service'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Staff Form Modal ── */}
      {showStaffForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-xl w-full max-w-lg shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="p-6 space-y-4">
              <h3 className="text-lg font-bold text-white">
                {editingStaff ? 'Edit Staff Member' : 'Add Staff Member'}
              </h3>

              <div className="space-y-3">
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-1">Full Name *</label>
                  <input
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-purple-500"
                    value={staffForm.name}
                    onChange={(e) => setStaffForm((f) => ({ ...f, name: e.target.value }))}
                    placeholder="e.g. Sarah Johnson"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-medium text-slate-300 mb-1">Phone</label>
                    <input
                      className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-purple-500"
                      value={staffForm.phone}
                      onChange={(e) => setStaffForm((f) => ({ ...f, phone: e.target.value }))}
                      placeholder="+1 555 000 0000"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-300 mb-1">Email</label>
                    <input
                      type="email"
                      className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-purple-500"
                      value={staffForm.email}
                      onChange={(e) => setStaffForm((f) => ({ ...f, email: e.target.value }))}
                      placeholder="staff@example.com"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-1">Working Days</label>
                  <div className="flex gap-2 flex-wrap">
                    {DAY_LABELS.map((d, i) => (
                      <button
                        key={i}
                        type="button"
                        onClick={() => toggleDay(i)}
                        className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                          staffForm.workingDays.includes(i)
                            ? 'bg-purple-600 text-white'
                            : 'bg-slate-700 text-slate-400 hover:bg-slate-600'
                        }`}
                      >
                        {d}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-medium text-slate-300 mb-1">Start Time</label>
                    <input
                      type="time"
                      className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-purple-500"
                      value={staffForm.workingHoursStart}
                      onChange={(e) => setStaffForm((f) => ({ ...f, workingHoursStart: e.target.value }))}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-300 mb-1">End Time</label>
                    <input
                      type="time"
                      className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-purple-500"
                      value={staffForm.workingHoursEnd}
                      onChange={(e) => setStaffForm((f) => ({ ...f, workingHoursEnd: e.target.value }))}
                    />
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="staff-active"
                    checked={staffForm.isActive}
                    onChange={(e) => setStaffForm((f) => ({ ...f, isActive: e.target.checked }))}
                    className="accent-purple-500"
                  />
                  <label htmlFor="staff-active" className="text-sm text-slate-300">Active</label>
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <button
                  onClick={() => setShowStaffForm(false)}
                  className="px-4 py-2 text-slate-400 hover:text-white text-sm transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={saveStaff}
                  disabled={savingStaff}
                  className="px-4 py-2 bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors"
                >
                  {savingStaff ? 'Saving…' : editingStaff ? 'Update Staff' : 'Add Staff'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Staff Service Assignment Modal ── */}
      {assigningStaff && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-xl w-full max-w-md shadow-2xl max-h-[80vh] overflow-y-auto">
            <div className="p-6 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-bold text-white">
                  <span className="text-purple-400">{assigningStaff.name}</span> — Assigned Services
                </h3>
                <button
                  onClick={() => setAssigningStaff(null)}
                  className="text-slate-400 hover:text-white transition-colors"
                >
                  <XCircle className="w-5 h-5" />
                </button>
              </div>
              <p className="text-sm text-slate-400">
                Toggle which services this staff member can perform. Only assigned services can be booked with them.
              </p>

              {loadingStaffServices ? (
                <div className="flex justify-center py-6">
                  <div className="w-6 h-6 border-2 border-purple-500 border-t-transparent rounded-full animate-spin" />
                </div>
              ) : (
                <div className="space-y-2">
                  {services.filter((s) => s.isActive).map((svc) => {
                    const assigned = staffServices.some((s) => s.id === svc.id);
                    return (
                      <button
                        key={svc.id}
                        onClick={() => toggleServiceAssignment(svc.id)}
                        className={`w-full flex items-center justify-between p-3 rounded-lg border transition-colors ${
                          assigned
                            ? 'bg-purple-500/10 border-purple-500/50 text-white'
                            : 'bg-slate-800 border-slate-700 text-slate-400 hover:border-slate-600'
                        }`}
                      >
                        <div className="text-left">
                          <span className="font-medium text-sm">{svc.name}</span>
                          <span className="text-xs text-slate-500 ml-2">{svc.durationMinutes}min</span>
                        </div>
                        {assigned ? (
                          <UserCheck className="w-4 h-4 text-purple-400" />
                        ) : (
                          <Plus className="w-4 h-4" />
                        )}
                      </button>
                    );
                  })}
                  {services.filter((s) => s.isActive).length === 0 && (
                    <p className="text-slate-500 text-sm text-center py-4">No active services to assign.</p>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default SalonManagement;

