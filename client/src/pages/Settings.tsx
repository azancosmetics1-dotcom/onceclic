import React, { useState, useEffect } from 'react';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { Organization, BusinessSettings, ServiceItem, UserRole } from '@onceclic/shared';
import { EmbedSnippet } from '../components/EmbedSnippet';
import { Badge } from '../components/Badge';
import {
  Settings as SettingsIcon,
  Building,
  Save,
  CheckCircle2,
  Users,
  Plus,
  Trash2,
  Code,
  Shield,
} from 'lucide-react';

export const SettingsPage: React.FC = () => {
  const { organization, refreshProfile } = useAuth();
  const [settings, setSettings] = useState<BusinessSettings | null>(null);
  const [orgData, setOrgData] = useState<Organization | null>(null);
  const [members, setMembers] = useState<any[]>([]);
  const [services, setServices] = useState<ServiceItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // New member invite modal
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<UserRole>(UserRole.EMPLOYEE);
  const [inviting, setInviting] = useState(false);

  const loadSettings = async () => {
    try {
      const [current, mems] = await Promise.all([
        api.getOrgCurrent(),
        api.getMembers().catch(() => []),
      ]);
      setOrgData(current.organization);
      setSettings(current.settings);
      setMembers(mems);
      if (current.settings?.services) {
        setServices(current.settings.services);
      }
    } catch (err) {
      console.error('[Settings] Load failed:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadSettings();
  }, []);

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!orgData) return;
    setSaving(true);
    setSaveSuccess(false);

    try {
      await api.updateOrgCurrent({
        name: orgData.name,
        businessType: orgData.businessType,
        phone: orgData.phone,
        email: orgData.email,
        website: orgData.website,
        address: orgData.address,
        timezone: orgData.timezone,
        services,
        websiteChatEnabled: settings?.websiteChatEnabled,
        emailAnsweringEnabled: settings?.emailAnsweringEnabled,
      });

      setSaveSuccess(true);
      await refreshProfile();
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (err) {
      console.error('[Settings] Save failed:', err);
    } finally {
      setSaving(false);
    }
  };

  const handleAddService = () => {
    setServices([
      ...services,
      {
        id: `srv_${Date.now()}`,
        name: 'New Service',
        durationMinutes: 30,
        price: 50,
        description: '',
      },
    ]);
  };

  const handleRemoveService = (index: number) => {
    const updated = [...services];
    updated.splice(index, 1);
    setServices(updated);
  };

  const handleInviteMember = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteEmail) return;
    setInviting(true);

    try {
      await api.addMember({ email: inviteEmail, role: inviteRole });
      setShowInviteModal(false);
      setInviteEmail('');
      await loadSettings();
    } catch (err: any) {
      alert(err.message || 'Failed to add member.');
    } finally {
      setInviting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <div className="w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-8 max-w-5xl">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black text-white flex items-center space-x-2">
            <SettingsIcon className="w-6 h-6 text-emerald-400" />
            <span>Business Profile & Settings</span>
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            Manage your business information, services, working hours, and team access.
          </p>
        </div>

        {saveSuccess && (
          <div className="inline-flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-xs font-semibold">
            <CheckCircle2 className="w-4 h-4" />
            <span>Profile saved successfully!</span>
          </div>
        )}
      </div>

      {/* Main Profile Form */}
      {orgData && (
        <form onSubmit={handleSaveProfile} className="bg-slate-900 border border-slate-800 rounded-3xl p-6 sm:p-8 space-y-6">
          <div className="flex items-center space-x-2 border-b border-slate-800 pb-3">
            <Building className="w-5 h-5 text-emerald-400" />
            <h2 className="text-sm font-bold text-white">General Business Details</h2>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">Business Name</label>
              <input
                type="text"
                required
                value={orgData.name}
                onChange={(e) => setOrgData({ ...orgData, name: e.target.value })}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-xs text-white focus:outline-none focus:border-emerald-500"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">Business Category / Type</label>
              <input
                type="text"
                required
                value={orgData.businessType}
                onChange={(e) => setOrgData({ ...orgData, businessType: e.target.value })}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-xs text-white focus:outline-none focus:border-emerald-500"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">Contact Phone</label>
              <input
                type="tel"
                placeholder="+1 555-0199"
                value={orgData.phone || ''}
                onChange={(e) => setOrgData({ ...orgData, phone: e.target.value })}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-xs text-white focus:outline-none focus:border-emerald-500"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">Public Email</label>
              <input
                type="email"
                placeholder="contact@business.com"
                value={orgData.email || ''}
                onChange={(e) => setOrgData({ ...orgData, email: e.target.value })}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-xs text-white focus:outline-none focus:border-emerald-500"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">Website</label>
              <input
                type="url"
                placeholder="https://yourwebsite.com"
                value={orgData.website || ''}
                onChange={(e) => setOrgData({ ...orgData, website: e.target.value })}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-xs text-white focus:outline-none focus:border-emerald-500"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">Timezone</label>
              <input
                type="text"
                value={orgData.timezone}
                onChange={(e) => setOrgData({ ...orgData, timezone: e.target.value })}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-xs text-white focus:outline-none focus:border-emerald-500"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1.5">Physical Address / Location</label>
            <input
              type="text"
              placeholder="123 Main St, Suite 400, City, State"
              value={orgData.address || ''}
              onChange={(e) => setOrgData({ ...orgData, address: e.target.value })}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-xs text-white focus:outline-none focus:border-emerald-500"
            />
          </div>

          {/* Services Section */}
          <div className="pt-6 border-t border-slate-800 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-white">Bookable Services</h3>
                <p className="text-[11px] text-slate-400">
                  Services that customers can ask about and schedule with your AI receptionist.
                </p>
              </div>
              <button
                type="button"
                onClick={handleAddService}
                className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold rounded-lg transition flex items-center space-x-1"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Add Service</span>
              </button>
            </div>

            <div className="space-y-3">
              {services.map((srv, index) => (
                <div
                  key={srv.id || index}
                  className="flex flex-col sm:flex-row items-center gap-3 p-3 bg-slate-950 border border-slate-800 rounded-xl"
                >
                  <input
                    type="text"
                    placeholder="Service Name"
                    value={srv.name}
                    onChange={(e) => {
                      const updated = [...services];
                      updated[index].name = e.target.value;
                      setServices(updated);
                    }}
                    className="flex-1 bg-slate-900 border border-slate-800 rounded-lg px-3 py-1.5 text-xs text-white"
                  />
                  <div className="flex items-center space-x-2">
                    <input
                      type="number"
                      placeholder="Mins"
                      title="Duration in minutes"
                      value={srv.durationMinutes}
                      onChange={(e) => {
                        const updated = [...services];
                        updated[index].durationMinutes = parseInt(e.target.value, 10) || 30;
                        setServices(updated);
                      }}
                      className="w-20 bg-slate-900 border border-slate-800 rounded-lg px-3 py-1.5 text-xs text-white"
                    />
                    <span className="text-xs text-slate-400">mins</span>
                  </div>
                  <div className="flex items-center space-x-2">
                    <span className="text-xs text-slate-400">$</span>
                    <input
                      type="number"
                      placeholder="Price"
                      value={srv.price}
                      onChange={(e) => {
                        const updated = [...services];
                        updated[index].price = parseFloat(e.target.value) || 0;
                        setServices(updated);
                      }}
                      className="w-24 bg-slate-900 border border-slate-800 rounded-lg px-3 py-1.5 text-xs text-white"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => handleRemoveService(index)}
                    className="p-1.5 text-slate-400 hover:text-rose-400 transition"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          </div>

          <div className="pt-4 border-t border-slate-800 flex justify-end">
            <button
              type="submit"
              disabled={saving}
              className="px-6 py-2.5 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs rounded-xl transition shadow-md shadow-emerald-500/20 disabled:opacity-50 flex items-center space-x-1.5"
            >
              <Save className="w-4 h-4" />
              <span>{saving ? 'Saving...' : 'Save Changes'}</span>
            </button>
          </div>
        </form>
      )}

      {/* Team Members & RBAC */}
      <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 sm:p-8 space-y-6">
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <div className="flex items-center space-x-2">
            <Users className="w-5 h-5 text-emerald-400" />
            <div>
              <h2 className="text-sm font-bold text-white">Team Members & Access Control</h2>
              <p className="text-[11px] text-slate-400">Centralized RBAC: OWNER, MANAGER, EMPLOYEE</p>
            </div>
          </div>
          <button
            onClick={() => setShowInviteModal(true)}
            className="px-3 py-1.5 bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-bold rounded-lg transition flex items-center space-x-1 shadow-sm"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Add Member</span>
          </button>
        </div>

        <div className="divide-y divide-slate-800/60">
          {members.map((m) => (
            <div key={m.id} className="py-3 flex items-center justify-between text-xs">
              <div>
                <p className="font-bold text-white">{m.fullName || m.email}</p>
                <p className="text-slate-400">{m.email}</p>
              </div>
              <Badge variant={m.role === UserRole.OWNER ? 'brand' : m.role === UserRole.MANAGER ? 'info' : 'neutral'}>
                {m.role}
              </Badge>
            </div>
          ))}
        </div>
      </div>

      {/* Website Chat Embed Widget */}
      {organization?.slug && <EmbedSnippet slug={organization.slug} />}

      {/* Invite Member Modal */}
      {showInviteModal && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl max-w-md w-full p-6 space-y-4 shadow-2xl">
            <h3 className="text-base font-bold text-white flex items-center space-x-2">
              <Users className="w-5 h-5 text-emerald-400" />
              <span>Add Team Member</span>
            </h3>

            <form onSubmit={handleInviteMember} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">User Email</label>
                <input
                  type="email"
                  required
                  placeholder="colleague@company.com"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2 text-xs text-white focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">Role & Permissions</label>
                <select
                  value={inviteRole}
                  onChange={(e) => setInviteRole(e.target.value as UserRole)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2 text-xs text-white focus:outline-none focus:border-emerald-500"
                >
                  <option value={UserRole.EMPLOYEE}>EMPLOYEE (Appointments & Conversations)</option>
                  <option value={UserRole.MANAGER}>MANAGER (AI config, Knowledge, Inbox)</option>
                  <option value={UserRole.OWNER}>OWNER (Full access + Billing)</option>
                </select>
              </div>

              <div className="flex justify-end space-x-3 pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowInviteModal(false)}
                  className="px-4 py-2 text-xs text-slate-400 hover:text-white"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={inviting}
                  className="px-5 py-2 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs rounded-xl transition disabled:opacity-50"
                >
                  {inviting ? 'Adding...' : 'Add Member'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
