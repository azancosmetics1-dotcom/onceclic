import React, { useState, useEffect } from 'react';
import { api } from '../api/client';
import { AIEmployee, AIEmployeeStatus } from '@onceclic/shared';
import { Badge } from '../components/Badge';
import {
  Bot,
  Save,
  CheckCircle2,
  AlertTriangle,
  Zap,
  DollarSign,
  Activity,
  Sparkles,
} from 'lucide-react';

export const AIEmployeePage: React.FC = () => {
  const [employee, setEmployee] = useState<AIEmployee | null>(null);
  const [health, setHealth] = useState<any>(null);
  const [usage, setUsage] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  useEffect(() => {
    async function loadData() {
      try {
        const [emp, h, u] = await Promise.all([
          api.getAIEmployee(),
          api.getAIHealth().catch(() => null),
          api.getAIUsage().catch(() => null),
        ]);
        setEmployee(emp);
        setHealth(h);
        setUsage(u);
      } catch (err) {
        console.error('[AIEmployee] Load failed:', err);
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!employee) return;
    setSaving(true);
    setSaveSuccess(false);

    try {
      await api.updateAIEmployee(employee);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (err) {
      console.error('[AIEmployee] Save failed:', err);
    } finally {
      setSaving(false);
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
            <Bot className="w-6 h-6 text-emerald-400" />
            <span>AI Employee Configuration</span>
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            Customize the behavior, personality, and instructions of your AI Receptionist.
          </p>
        </div>

        {saveSuccess && (
          <div className="inline-flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-xs font-semibold">
            <CheckCircle2 className="w-4 h-4" />
            <span>Changes saved successfully!</span>
          </div>
        )}
      </div>

      {/* Provider Status Diagnostic Banner */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5">
        <div className="flex items-start justify-between">
          <div className="flex items-start space-x-3">
            <div
              className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
                health?.available
                  ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                  : 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
              }`}
            >
              <Zap className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h3 className="text-sm font-bold text-white">AI Provider: OpenAI</h3>
                <Badge variant={health?.available ? 'success' : 'warning'}>
                  {health?.available ? 'Operational' : 'Provider Setup Required'}
                </Badge>
              </div>
              <p className="text-xs text-slate-400 mt-1">
                Model: <span className="font-mono text-slate-300">{health?.model || 'gpt-4o-mini'}</span> &bull; Embeddings: <span className="font-mono text-slate-300">text-embedding-3-small</span>
              </p>
              {!health?.available && (
                <p className="text-xs text-amber-300/90 mt-2 bg-amber-500/10 border border-amber-500/20 rounded-lg p-2.5">
                  <strong>Notice:</strong> {health?.error || 'OPENAI_API_KEY is not set in environment. Set OPENAI_API_KEY on the server to enable live LLM generation and vector embeddings.'}
                </p>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Configuration Form */}
      {employee && (
        <form onSubmit={handleSave} className="bg-slate-900 border border-slate-800 rounded-2xl p-6 sm:p-8 space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">Receptionist Name</label>
              <input
                type="text"
                required
                value={employee.name}
                onChange={(e) => setEmployee({ ...employee, name: e.target.value })}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-emerald-500"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">Role Title</label>
              <input
                type="text"
                required
                value={employee.roleTitle}
                onChange={(e) => setEmployee({ ...employee, roleTitle: e.target.value })}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-emerald-500"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">Tone & Communication Style</label>
              <input
                type="text"
                value={employee.tone}
                onChange={(e) => setEmployee({ ...employee, tone: e.target.value })}
                placeholder="e.g. friendly, professional, courteous, concise"
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-emerald-500"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">Status</label>
              <select
                value={employee.status}
                onChange={(e) => setEmployee({ ...employee, status: e.target.value as AIEmployeeStatus })}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-emerald-500"
              >
                <option value={AIEmployeeStatus.ACTIVE}>ACTIVE (Replies automatically)</option>
                <option value={AIEmployeeStatus.DRAFT}>DRAFT (Testing mode)</option>
                <option value={AIEmployeeStatus.INACTIVE}>INACTIVE (Paused)</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1.5">Welcome Greeting Message</label>
            <textarea
              rows={2}
              required
              value={employee.greetingMessage}
              onChange={(e) => setEmployee({ ...employee, greetingMessage: e.target.value })}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-emerald-500 resize-none"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1.5">Custom Instructions & Business Rules</label>
            <p className="text-[11px] text-slate-400 mb-2">
              Specific instructions for how the AI should answer, booking criteria, or promotional notices.
            </p>
            <textarea
              rows={4}
              required
              value={employee.instructions}
              onChange={(e) => setEmployee({ ...employee, instructions: e.target.value })}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-emerald-500 resize-none font-mono text-xs"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1.5">Fallback & Missing Information Message</label>
            <p className="text-[11px] text-slate-400 mb-2">
              What the AI says when it does not know the answer, instead of hallucinating.
            </p>
            <textarea
              rows={2}
              required
              value={employee.fallbackMessage}
              onChange={(e) => setEmployee({ ...employee, fallbackMessage: e.target.value })}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-emerald-500 resize-none"
            />
          </div>

          <div className="pt-4 border-t border-slate-800 flex justify-end">
            <button
              type="submit"
              disabled={saving}
              className="px-6 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs transition flex items-center space-x-1.5 shadow-md shadow-emerald-500/20 disabled:opacity-50"
            >
              <Save className="w-4 h-4" />
              <span>{saving ? 'Saving...' : 'Save AI Settings'}</span>
            </button>
          </div>
        </form>
      )}

      {/* AI Usage & Cost Summary */}
      {usage && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-4">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <div className="flex items-center space-x-2">
              <Activity className="w-4 h-4 text-emerald-400" />
              <h3 className="text-sm font-bold text-white">AI Token & Cost Tracker</h3>
            </div>
            <span className="text-xs text-slate-400 font-mono">
              Total Incurred: ${usage.summary?.totalCostUsd || '0.0000'}
            </span>
          </div>

          <div className="grid grid-cols-3 gap-4 text-center">
            <div className="bg-slate-950 p-4 rounded-xl border border-slate-800">
              <p className="text-xs text-slate-400">Total Tokens</p>
              <p className="text-lg font-bold text-white font-mono mt-1">{usage.summary?.totalTokens || 0}</p>
            </div>
            <div className="bg-slate-950 p-4 rounded-xl border border-slate-800">
              <p className="text-xs text-slate-400">AI Invocations</p>
              <p className="text-lg font-bold text-white font-mono mt-1">{usage.summary?.totalRequests || 0}</p>
            </div>
            <div className="bg-slate-950 p-4 rounded-xl border border-slate-800">
              <p className="text-xs text-slate-400">Estimated Cost (USD)</p>
              <p className="text-lg font-bold text-emerald-400 font-mono mt-1">
                ${usage.summary?.totalCostUsd || '0.0000'}
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
