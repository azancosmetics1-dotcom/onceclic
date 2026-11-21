import React, { useState, useEffect } from 'react';
import { api } from '../api/client';
import { KnowledgeSource, KnowledgeSourceType } from '@onceclic/shared';
import { Badge } from '../components/Badge';
import {
  BookOpen,
  Plus,
  Trash2,
  HelpCircle,
  FileText,
  Building,
  CheckCircle2,
  Layers,
  Sparkles,
  RefreshCw,
  UploadCloud,
  AlertCircle,
} from 'lucide-react';

export const KnowledgeBase: React.FC = () => {
  const [sources, setSources] = useState<KnowledgeSource[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [adding, setAdding] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState<{ text: string; error?: boolean } | null>(null);

  const [newSource, setNewSource] = useState({
    sourceType: KnowledgeSourceType.FAQ,
    title: '',
    rawContent: '',
  });

  const loadSources = async () => {
    try {
      const data = await api.getKnowledgeSources();
      setSources(data);
    } catch (err) {
      console.error('[KnowledgeBase] Failed to load sources:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadSources();
  }, []);

  const handleSyncToVapi = async () => {
    setSyncing(true);
    setSyncMessage(null);
    try {
      await api.syncKnowledgeToVapi();
      setSyncMessage({ text: 'Knowledge base successfully synchronized with AI Receptionist!' });
      await loadSources();
    } catch (err: any) {
      setSyncMessage({ text: err.message || 'Failed to sync with AI assistant', error: true });
    } finally {
      setSyncing(false);
      setTimeout(() => setSyncMessage(null), 5000);
    }
  };

  const handleModalFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      if (content) {
        const cleanTitle = file.name.replace(/\.[^/.]+$/, '').replace(/[-_]/g, ' ');
        setNewSource((prev) => ({
          ...prev,
          title: prev.title || cleanTitle,
          rawContent: content.trim(),
        }));
      }
    };
    reader.readAsText(file);
  };

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSource.title || !newSource.rawContent) return;
    setAdding(true);

    try {
      await api.addKnowledgeSource(newSource);
      setShowAddModal(false);
      setNewSource({ sourceType: KnowledgeSourceType.FAQ, title: '', rawContent: '' });
      await loadSources();
    } catch (err) {
      console.error('[KnowledgeBase] Failed to add source:', err);
    } finally {
      setAdding(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this knowledge source and its chunks?')) return;
    try {
      await api.deleteKnowledgeSource(id);
      await loadSources();
    } catch (err) {
      console.error('[KnowledgeBase] Delete failed:', err);
    }
  };

  return (
    <div className="space-y-6 sm:space-y-8 max-w-5xl w-full min-w-0">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 min-w-0">
        <div className="min-w-0">
          <h1 className="text-xl sm:text-2xl font-black text-white flex items-center gap-2 flex-wrap">
            <BookOpen className="w-5 h-5 sm:w-6 sm:h-6 text-emerald-400 flex-shrink-0" />
            <span>Business Knowledge Base</span>
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            Provide FAQs, business policies, and facts for your AI receptionist to answer customer inquiries accurately.
          </p>
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto">
          <button
            onClick={handleSyncToVapi}
            disabled={syncing || sources.length === 0}
            className="inline-flex items-center justify-center space-x-1.5 px-3.5 py-2.5 bg-slate-850 hover:bg-slate-800 text-slate-200 hover:text-emerald-400 border border-slate-750 font-bold text-xs rounded-xl transition disabled:opacity-40 shrink-0 w-full sm:w-auto"
            title="Sync all knowledge documents with Vapi Voice Assistant"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${syncing ? 'animate-spin text-emerald-400' : ''}`} />
            <span>{syncing ? 'Syncing...' : 'Sync to AI Receptionist'}</span>
          </button>

          <button
            onClick={() => setShowAddModal(true)}
            className="inline-flex items-center justify-center space-x-1.5 px-4 py-2.5 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs rounded-xl transition shadow-md shadow-emerald-500/20 shrink-0 w-full sm:w-auto"
          >
            <Plus className="w-4 h-4" />
            <span>Add Knowledge Source</span>
          </button>
        </div>
      </div>

      {syncMessage && (
        <div
          className={`p-3.5 rounded-xl border flex items-center space-x-2 text-xs font-medium transition ${
            syncMessage.error
              ? 'bg-rose-500/10 border-rose-500/30 text-rose-300'
              : 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
          }`}
        >
          {syncMessage.error ? (
            <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
          ) : (
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          )}
          <span>{syncMessage.text}</span>
        </div>
      )}

      {/* Sources List */}
      {loading ? (
        <div className="flex justify-center py-20">
          <div className="w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : sources.length === 0 ? (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl sm:rounded-3xl p-8 sm:p-12 text-center space-y-4 min-w-0">
          <div className="w-12 h-12 rounded-2xl bg-emerald-500/10 text-emerald-400 flex items-center justify-center mx-auto">
            <BookOpen className="w-6 h-6" />
          </div>
          <h3 className="text-base font-bold text-white">No knowledge sources yet</h3>
          <p className="text-xs text-slate-400 max-w-md mx-auto">
            Add FAQs, pricing details, or operating procedures so your AI receptionist knows how to answer your customers.
          </p>
          <button
            onClick={() => setShowAddModal(true)}
            className="w-full sm:w-auto px-4 py-2.5 bg-emerald-500 text-slate-950 text-xs font-bold rounded-xl hover:bg-emerald-400 transition"
          >
            Add Your First Knowledge Source
          </button>
        </div>
      ) : (
        <div className="space-y-4 min-w-0">
          {sources.map((source) => (
            <div
              key={source.id}
              className="bg-slate-900 border border-slate-800 rounded-2xl p-4 sm:p-6 hover:border-slate-750 transition flex flex-col sm:flex-row sm:items-start justify-between gap-4 min-w-0"
            >
              <div className="space-y-2 flex-1 min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="p-1.5 rounded-lg bg-slate-950 border border-slate-800 text-emerald-400 flex-shrink-0">
                    {source.sourceType === KnowledgeSourceType.FAQ ? (
                      <HelpCircle className="w-4 h-4" />
                    ) : source.sourceType === KnowledgeSourceType.BUSINESS_INFO ? (
                      <Building className="w-4 h-4" />
                    ) : (
                      <FileText className="w-4 h-4" />
                    )}
                  </span>
                  <h3 className="text-sm font-bold text-white truncate max-w-xs sm:max-w-md">{source.title}</h3>
                  <Badge variant="brand">{source.sourceType}</Badge>
                  {source.vapiSyncStatus === 'SYNCED' ? (
                    <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-[10px] font-medium">
                      <CheckCircle2 className="w-3 h-3" />
                      <span>Synced with Voice AI</span>
                    </span>
                  ) : source.vapiSyncStatus === 'FAILED' ? (
                    <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded-full bg-rose-500/10 border border-rose-500/30 text-rose-400 text-[10px] font-medium">
                      <AlertCircle className="w-3 h-3" />
                      <span>Voice Sync Failed</span>
                    </span>
                  ) : (
                    <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded-full bg-amber-500/10 border border-amber-500/30 text-amber-400 text-[10px] font-medium">
                      <span>Pending Voice Sync</span>
                    </span>
                  )}
                  <span className="text-[11px] text-slate-400 font-mono flex items-center space-x-1">
                    <Layers className="w-3 h-3 text-slate-500" />
                    <span>{source.chunkCount} RAG chunks</span>
                  </span>
                </div>

                <p className="text-xs text-slate-300 line-clamp-3 bg-slate-950/60 border border-slate-850 p-3 rounded-xl font-mono whitespace-pre-wrap break-words [overflow-wrap:anywhere] min-w-0">
                  {source.rawContent}
                </p>

                <p className="text-[10px] text-slate-400">
                  Added on {new Date(source.createdAt).toLocaleDateString()}
                </p>
              </div>

              <button
                onClick={() => handleDelete(source.id)}
                className="p-2 text-slate-400 hover:text-rose-400 hover:bg-slate-850 rounded-lg transition shrink-0 self-end sm:self-start"
                title="Delete Source"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Add Knowledge Source Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl sm:rounded-3xl max-w-lg w-full p-5 sm:p-8 space-y-5 shadow-2xl max-h-[90vh] overflow-y-auto">
            <h2 className="text-lg font-bold text-white flex items-center space-x-2">
              <Plus className="w-5 h-5 text-emerald-400" />
              <span>Add Knowledge Source</span>
            </h2>

            <form onSubmit={handleAdd} className="space-y-4">
              <div className="flex items-center justify-between pb-1">
                <span className="text-xs font-semibold text-slate-300">Import from File</span>
                <label className="inline-flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-slate-950 border border-slate-800 hover:border-emerald-500/50 text-slate-300 hover:text-emerald-400 text-xs font-medium cursor-pointer transition">
                  <UploadCloud className="w-3.5 h-3.5" />
                  <span>Choose Document</span>
                  <input
                    type="file"
                    accept=".txt,.md,.faq,.csv,.json,.doc,.docx"
                    onChange={handleModalFileUpload}
                    className="hidden"
                  />
                </label>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">Source Type</label>
                <select
                  value={newSource.sourceType}
                  onChange={(e) => setNewSource({ ...newSource, sourceType: e.target.value as KnowledgeSourceType })}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-xs text-white focus:outline-none focus:border-emerald-500"
                >
                  <option value={KnowledgeSourceType.FAQ}>FAQ (Questions & Answers)</option>
                  <option value={KnowledgeSourceType.TEXT}>Plain Text / Business Notes</option>
                  <option value={KnowledgeSourceType.BUSINESS_INFO}>Business Profile / Policies</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">Title</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Return Policy, Pricing FAQ, Parking Guide"
                  value={newSource.title}
                  onChange={(e) => setNewSource({ ...newSource, title: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-xs text-white focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">Content</label>
                <p className="text-[10px] text-slate-400 mb-1.5">
                  Paste full answers or factual notes. The system will automatically chunk and embed the content for RAG retrieval.
                </p>
                <textarea
                  rows={6}
                  required
                  placeholder="Q: What should I bring to my appointment?&#10;A: Please bring a valid photo ID and your insurance card..."
                  value={newSource.rawContent}
                  onChange={(e) => setNewSource({ ...newSource, rawContent: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-xs text-white focus:outline-none focus:border-emerald-500 resize-none font-mono"
                />
              </div>

              <div className="flex flex-wrap sm:flex-nowrap items-center justify-end gap-2 pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="w-full sm:w-auto px-4 py-2.5 text-xs font-semibold text-slate-400 hover:text-white transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={adding}
                  className="w-full sm:w-auto px-5 py-2.5 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs rounded-xl transition shadow-md shadow-emerald-500/20 disabled:opacity-50"
                >
                  {adding ? 'Processing RAG...' : 'Save Source'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
