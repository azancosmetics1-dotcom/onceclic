import React, { useState, useEffect } from 'react';
import { api } from '../api/client';
import {
  Conversation,
  ConversationMessage,
  ConversationStatus,
  ConversationChannel,
  MessageRole,
} from '@onceclic/shared';
import { Badge } from '../components/Badge';
import {
  MessageSquare,
  Mail,
  User,
  Send,
  UserCheck,
  CheckCircle2,
  Archive,
  RefreshCw,
  Bot,
  AlertTriangle,
  Clock,
  Sparkles,
} from 'lucide-react';

export const ConversationsPage: React.FC = () => {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedConv, setSelectedConv] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [channelFilter, setChannelFilter] = useState<string>('ALL');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [replyContent, setReplyContent] = useState('');
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);

  const loadConversations = async (keepSelected = true) => {
    try {
      const channel = channelFilter !== 'ALL' ? channelFilter : undefined;
      const status = statusFilter !== 'ALL' ? statusFilter : undefined;
      const data = await api.getConversations(channel, status);
      setConversations(data);

      if (data.length > 0) {
        if (!selectedConv || !keepSelected) {
          setSelectedConv(data[0]);
        } else {
          // Refresh current selected
          const updated = data.find((c) => c.id === selectedConv.id);
          if (updated) setSelectedConv(updated);
        }
      } else {
        setSelectedConv(null);
      }
    } catch (err) {
      console.error('[Conversations] Load failed:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadConversations(false);
  }, [channelFilter, statusFilter]);

  // Load message history when selected conversation changes
  useEffect(() => {
    if (selectedConv?.id) {
      api
        .getConversationMessages(selectedConv.id)
        .then((msgs) => setMessages(msgs))
        .catch((err) => console.error('[Conversations] Messages fetch error:', err));
    } else {
      setMessages([]);
    }
  }, [selectedConv?.id]);

  const handleSendReply = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedConv || !replyContent.trim() || sending) return;
    setSending(true);

    try {
      const newMsg = await api.sendHumanReply(selectedConv.id, replyContent);
      setMessages((prev) => [...prev, newMsg]);
      setReplyContent('');
      await loadConversations(true);
    } catch (err: any) {
      alert(err.message || 'Failed to send reply.');
    } finally {
      setSending(false);
    }
  };

  const handleStatusUpdate = async (status: ConversationStatus) => {
    if (!selectedConv) return;
    try {
      const updated = await api.updateConversationStatus(selectedConv.id, status);
      setSelectedConv(updated);
      await loadConversations(true);
    } catch (err) {
      console.error('[Conversations] Status update failed:', err);
    }
  };

  return (
    <div className="space-y-6 max-w-7xl">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black text-white flex items-center space-x-2">
            <MessageSquare className="w-6 h-6 text-emerald-400" />
            <span>Conversations & Unified Inbox</span>
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            Real-time messages from website visitors and incoming customer emails.
          </p>
        </div>

        <button
          onClick={() => loadConversations(true)}
          className="inline-flex items-center space-x-1.5 px-3 py-1.5 bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-300 text-xs font-semibold rounded-xl transition self-start sm:self-auto"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          <span>Refresh</span>
        </button>
      </div>

      {/* Main Inbox Layout */}
      <div className="bg-slate-900 border border-slate-800 rounded-3xl overflow-hidden grid grid-cols-1 md:grid-cols-12 min-h-[640px] shadow-2xl">
        {/* Left: Conversations List */}
        <div className="md:col-span-5 border-r border-slate-800 flex flex-col">
          {/* Filters */}
          <div className="p-4 border-b border-slate-800 space-y-3 bg-slate-950/40">
            <div className="flex items-center space-x-2">
              <span className="text-[11px] font-semibold text-slate-400">Channel:</span>
              <div className="flex rounded-lg bg-slate-900 p-1 border border-slate-800 text-xs">
                {['ALL', 'WEB', 'EMAIL'].map((ch) => (
                  <button
                    key={ch}
                    onClick={() => setChannelFilter(ch)}
                    className={`px-2.5 py-1 rounded-md text-[11px] font-semibold transition ${
                      channelFilter === ch ? 'bg-emerald-500 text-slate-950 font-bold' : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    {ch}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center space-x-2">
              <span className="text-[11px] font-semibold text-slate-400">Status:</span>
              <div className="flex rounded-lg bg-slate-900 p-1 border border-slate-800 text-xs">
                {['ALL', 'OPEN', 'HUMAN_HANDOFF', 'RESOLVED'].map((st) => (
                  <button
                    key={st}
                    onClick={() => setStatusFilter(st)}
                    className={`px-2.5 py-1 rounded-md text-[11px] font-semibold transition ${
                      statusFilter === st ? 'bg-emerald-500 text-slate-950 font-bold' : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    {st === 'HUMAN_HANDOFF' ? 'Handoff' : st}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Conversation List Items */}
          <div className="flex-1 overflow-y-auto divide-y divide-slate-800/60 max-h-[550px]">
            {loading ? (
              <div className="flex justify-center py-16">
                <div className="w-6 h-6 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
              </div>
            ) : conversations.length === 0 ? (
              <div className="text-center py-16 text-xs text-slate-500 px-4">
                No conversations matching filter.
              </div>
            ) : (
              conversations.map((c) => {
                const isSelected = selectedConv?.id === c.id;
                const isHandoff = c.status === ConversationStatus.HUMAN_HANDOFF;

                return (
                  <button
                    key={c.id}
                    onClick={() => setSelectedConv(c)}
                    className={`w-full text-left p-4 transition flex flex-col space-y-1.5 ${
                      isSelected
                        ? 'bg-emerald-500/10 border-l-4 border-l-emerald-500'
                        : 'hover:bg-slate-800/50'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-white truncate">
                        {c.customerName || 'Website Visitor'}
                      </span>
                      <span className="text-[10px] text-slate-500 font-mono">
                        {new Date(c.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>

                    <p className="text-xs text-slate-400 truncate">
                      {c.lastMessage?.content || 'No messages yet'}
                    </p>

                    <div className="flex items-center space-x-2 pt-1">
                      <Badge variant={c.channel === ConversationChannel.WEB ? 'info' : 'brand'}>
                        {c.channel}
                      </Badge>

                      {isHandoff && (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/20 text-amber-400 border border-amber-500/30 flex items-center space-x-1">
                          <AlertTriangle className="w-2.5 h-2.5" />
                          <span>Human Handoff</span>
                        </span>
                      )}

                      {c.status === ConversationStatus.RESOLVED && (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-slate-800 text-slate-400">
                          Resolved
                        </span>
                      )}
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* Right: Message Stream & Reply Box */}
        <div className="md:col-span-7 flex flex-col bg-slate-950/40">
          {selectedConv ? (
            <>
              {/* Top Conversation Status Header */}
              <div className="p-4 border-b border-slate-800 flex items-center justify-between bg-slate-900/80">
                <div className="flex items-center space-x-3">
                  <div className="w-9 h-9 rounded-xl bg-slate-800 flex items-center justify-center text-emerald-400 shrink-0">
                    {selectedConv.channel === ConversationChannel.WEB ? (
                      <MessageSquare className="w-4 h-4" />
                    ) : (
                      <Mail className="w-4 h-4" />
                    )}
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-white flex items-center space-x-2">
                      <span>{selectedConv.customerName || 'Website Visitor'}</span>
                      {selectedConv.status === ConversationStatus.HUMAN_HANDOFF && (
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500/20 text-amber-400 border border-amber-500/30">
                          Needs Human Agent
                        </span>
                      )}
                    </h3>
                    <p className="text-xs text-slate-400">
                      {selectedConv.customerEmail || 'No email provided'} &bull; {selectedConv.customerPhone || 'No phone'}
                    </p>
                  </div>
                </div>

                {/* Status Action Buttons */}
                <div className="flex items-center space-x-2">
                  {selectedConv.status === ConversationStatus.HUMAN_HANDOFF && (
                    <button
                      onClick={() => handleStatusUpdate(ConversationStatus.OPEN)}
                      className="px-3 py-1.5 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 text-xs font-semibold rounded-lg transition"
                    >
                      Resume AI
                    </button>
                  )}

                  {selectedConv.status !== ConversationStatus.RESOLVED && (
                    <button
                      onClick={() => handleStatusUpdate(ConversationStatus.RESOLVED)}
                      className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold rounded-lg transition flex items-center space-x-1"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                      <span>Resolve</span>
                    </button>
                  )}

                  {selectedConv.status !== ConversationStatus.ARCHIVED && (
                    <button
                      onClick={() => handleStatusUpdate(ConversationStatus.ARCHIVED)}
                      className="p-1.5 text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded-lg transition"
                      title="Archive"
                    >
                      <Archive className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>

              {/* Message Transcript Area */}
              <div className="flex-1 p-5 overflow-y-auto space-y-4 max-h-[450px]">
                {messages.length === 0 ? (
                  <div className="text-center py-16 text-xs text-slate-500">No messages recorded.</div>
                ) : (
                  messages.map((m) => {
                    const isCustomer = m.role === MessageRole.CUSTOMER;
                    const isAI = m.role === MessageRole.AI;
                    const isHuman = m.role === MessageRole.HUMAN_AGENT;

                    return (
                      <div
                        key={m.id}
                        className={`flex flex-col ${isCustomer ? 'items-start' : 'items-end'}`}
                      >
                        <div className="flex items-center space-x-1.5 text-[11px] text-slate-400 mb-1 px-1">
                          {isAI && <Bot className="w-3 h-3 text-emerald-400" />}
                          {isHuman && <UserCheck className="w-3 h-3 text-sky-400" />}
                          <span className="font-semibold">
                            {isCustomer
                              ? selectedConv.customerName || 'Customer'
                              : isAI
                              ? 'Luna (AI)'
                              : 'Staff Member'}
                          </span>
                          <span>&bull;</span>
                          <span className="font-mono text-[10px]">
                            {new Date(m.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </div>

                        <div
                          className={`max-w-[85%] rounded-2xl p-4 text-xs sm:text-sm leading-relaxed ${
                            isCustomer
                              ? 'bg-slate-800 text-slate-200 border border-slate-700/60'
                              : isAI
                              ? 'bg-emerald-950/50 border border-emerald-800/40 text-emerald-200'
                              : 'bg-sky-950/50 border border-sky-800/40 text-sky-200'
                          }`}
                        >
                          <p className="whitespace-pre-wrap">{m.content}</p>

                          {/* Grounded references indicator */}
                          {m.sourceReferences && m.sourceReferences.length > 0 && (
                            <div className="mt-2 pt-2 border-t border-emerald-800/30 text-[10px] text-emerald-400 flex items-center space-x-1">
                              <Sparkles className="w-3 h-3" />
                              <span>
                                Grounded in: {m.sourceReferences.map((r) => r.title).join(', ')}
                              </span>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              {/* Manual Staff Reply Form */}
              <form onSubmit={handleSendReply} className="p-4 border-t border-slate-800 bg-slate-900/80">
                <div className="flex items-center space-x-2">
                  <input
                    type="text"
                    value={replyContent}
                    onChange={(e) => setReplyContent(e.target.value)}
                    placeholder="Type a manual response as human agent..."
                    className="flex-1 bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-xs sm:text-sm text-white focus:outline-none focus:border-emerald-500"
                  />
                  <button
                    type="submit"
                    disabled={sending || !replyContent.trim()}
                    className="px-4 py-2.5 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs rounded-xl transition flex items-center space-x-1.5 shadow-md shadow-emerald-500/20 disabled:opacity-50 shrink-0"
                  >
                    <Send className="w-3.5 h-3.5" />
                    <span>Send</span>
                  </button>
                </div>
              </form>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-slate-500 text-xs">
              Select a conversation from the left to view messages.
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
