import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  Copy,
  ExternalLink,
  FileText,
  Loader2,
  MessageSquare,
  Plus,
  Search,
  Send,
  Sparkles
} from 'lucide-react';
import type { User } from 'firebase/auth';
import { addDoc, collection, deleteDoc, doc, serverTimestamp, updateDoc } from 'firebase/firestore';
import { motion } from 'framer-motion';

import { db } from '../lib/firebase';
import { cn } from '../lib/utils';
import { analyzeCustomerSentiment, suggestResponse } from '../services/gemini';
import {
  CustomerPriorityFilter,
  CustomerStatusFilter,
  getSupportPlaybook,
  ShopProfile,
  type Toast,
  type WorkflowFocus
} from '../app/core';
import {
  deleteLocalBucketRecord,
  isLocalWorkspaceUser,
  patchLocalBucketRecord,
  upsertLocalBucketRecord
} from '../app/localWorkspace';
import { EmptyState, MetricCard, ProfileField, SectionCard, StatusPill } from '../components/shell';
import type { CustomerInteraction } from '../types';

type CustomersViewProps = {
  user: User;
  interactions: CustomerInteraction[];
  shopProfile: ShopProfile;
  showToast: (message: string, type?: Toast['type']) => void;
  workflowFocus: Extract<WorkflowFocus, { tab: 'customers' }> | null;
};

function getReplyTarget(interaction: CustomerInteraction) {
  if (interaction.priority === 'urgent') return 'Reply today';
  if (interaction.orderStatus === 'canceled') return 'Confirm next step today';
  if (interaction.orderStatus === 'shipped') return 'Follow up within 24 hours';
  return 'Reply within 24 hours';
}

function getWorkbenchSummary(interaction: CustomerInteraction) {
  if (interaction.status === 'resolved') {
    return 'This thread is resolved. Keep notes only if you need future reference.';
  }
  if (interaction.category === 'order_issue') {
    return 'Lead with order status, what happened, and the next concrete step you can offer.';
  }
  if (interaction.category === 'custom_request') {
    return 'Clarify scope, timing, and whether the request fits your current workflow before promising anything.';
  }
  if (interaction.priority === 'urgent') {
    return 'Protect trust first. Keep the reply calm, specific, and short on turnaround time.';
  }
  if (interaction.category === 'question') {
    return 'Answer directly, remove friction, and close with one clear next action.';
  }
  return 'Keep the reply warm, specific, and easy for the buyer to act on.';
}

function getConversationChecklist(interaction: CustomerInteraction) {
  const checklist = [
    'State the next step clearly.',
    'Match the buyer concern before offering detail.',
    'Keep the reply easy to paste into Etsy messages.'
  ];

  if (interaction.orderStatus) {
    checklist.unshift(`Reference the ${interaction.orderStatus} order status if it helps resolve the issue.`);
  }
  if (interaction.priority === 'urgent') {
    checklist.unshift('Acknowledge the urgency in the first sentence.');
  }
  if (interaction.category === 'custom_request') {
    checklist.push('Confirm timeline, limits, and any added cost before committing.');
  }

  return checklist.slice(0, 4);
}

export default function CustomersView({
  user,
  interactions,
  shopProfile,
  showToast,
  workflowFocus
}: CustomersViewProps) {
  const [filterStatus, setFilterStatus] = useState<CustomerStatusFilter>('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [replyDraft, setReplyDraft] = useState('');
  const [noteDraft, setNoteDraft] = useState('');
  const [loadingReply, setLoadingReply] = useState(false);
  const [savingNote, setSavingNote] = useState(false);
  const [showAddPanel, setShowAddPanel] = useState(false);
  const [creating, setCreating] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [priorityFilter, setPriorityFilter] = useState<CustomerPriorityFilter>('all');
  const [newInteraction, setNewInteraction] = useState({
    customerName: '',
    customerEmail: '',
    message: ''
  });

  const filtered = interactions.filter((interaction) => {
    const statusMatch = filterStatus === 'all' || interaction.status === filterStatus;
    const priorityMatch = priorityFilter === 'all' || interaction.priority === priorityFilter;
    const searchHaystack = [
      interaction.customerName,
      interaction.customerEmail,
      interaction.message,
      interaction.summary,
      interaction.relatedOrderId
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    const searchMatch = !searchQuery.trim() || searchHaystack.includes(searchQuery.trim().toLowerCase());

    return statusMatch && priorityMatch && searchMatch;
  });
  const pendingCount = interactions.filter((interaction) => interaction.status === 'pending').length;
  const urgentCount = interactions.filter((interaction) => interaction.priority === 'urgent').length;
  const draftReadyCount = interactions.filter((interaction) => !!interaction.response && interaction.status !== 'resolved').length;

  useEffect(() => {
    if (filtered.length === 0) {
      if (selectedId) {
        setSelectedId(null);
      }
      return;
    }

    if (!selectedId || !filtered.some((interaction) => interaction.id === selectedId)) {
      setSelectedId(filtered[0].id!);
    }
  }, [filtered, selectedId]);

  const selectedInteraction = interactions.find((interaction) => interaction.id === selectedId) || filtered[0] || null;

  useEffect(() => {
    if (selectedInteraction) {
      setReplyDraft(selectedInteraction.response || '');
      setNoteDraft(selectedInteraction.notes || '');
    }
  }, [selectedInteraction?.id]);

  useEffect(() => {
    if (!workflowFocus) return;

    setFilterStatus(workflowFocus.filterStatus || 'all');
    setPriorityFilter(workflowFocus.priorityFilter || 'all');

    if (workflowFocus.searchQuery !== undefined) {
      setSearchQuery(workflowFocus.searchQuery);
    }

    if (workflowFocus.interactionId) {
      setSelectedId(workflowFocus.interactionId);
    }
  }, [workflowFocus]);

  const persistInteractionPatch = async (patch: Record<string, unknown>, successMessage: string) => {
    if (!selectedInteraction?.id) return;

    try {
      if (isLocalWorkspaceUser(user)) {
        patchLocalBucketRecord(user.uid, 'interactions', selectedInteraction.id, {
          ...patch,
          ...(patch.respondedAt ? { respondedAt: new Date().toISOString() } : {})
        });
      } else {
        await updateDoc(doc(db, 'interactions', selectedInteraction.id), patch);
      }
      showToast(successMessage, 'success');
    } catch (error) {
      console.error('Interaction patch failed:', error);
      showToast('Unable to save this conversation update right now', 'error');
    }
  };

  const generateReply = async () => {
    if (!selectedInteraction) return;
    setLoadingReply(true);
    try {
      const reply = await suggestResponse(
        selectedInteraction.message,
        `${shopProfile.shopName || 'Etsy shop'} | niche: ${shopProfile.niche} | tone: ${shopProfile.brandTone}`
      );
      setReplyDraft(reply);
    } catch (error) {
      console.error('Reply generation failed:', error);
      showToast('Unable to generate a reply draft right now', 'error');
    } finally {
      setLoadingReply(false);
    }
  };

  const saveReplyDraft = async () => {
    if (!selectedInteraction?.id || !replyDraft.trim()) return;
    try {
      if (isLocalWorkspaceUser(user)) {
        patchLocalBucketRecord(user.uid, 'interactions', selectedInteraction.id, {
          response: replyDraft
        });
      } else {
        await updateDoc(doc(db, 'interactions', selectedInteraction.id), {
          response: replyDraft
        });
      }
      showToast('Reply draft saved. Mark it replied after you actually send it.', 'success');
    } catch (error) {
      console.error('Reply draft save failed:', error);
      showToast('Unable to save the reply draft right now', 'error');
    }
  };

  const markAsReplied = async () => {
    if (!selectedInteraction?.id) return;
    const patch: Record<string, unknown> = {
      status: 'replied',
      respondedAt: serverTimestamp()
    };
    if (replyDraft.trim()) {
      patch.response = replyDraft.trim();
    }
    await persistInteractionPatch(patch, 'Conversation marked replied');
  };

  const copyReplyDraft = async () => {
    if (!replyDraft.trim()) return;
    try {
      await navigator.clipboard.writeText(replyDraft.trim());
      showToast('Reply draft copied', 'success');
    } catch (error) {
      console.error('Reply copy failed:', error);
      showToast('Unable to copy this reply draft right now', 'error');
    }
  };

  const copyAndOpenEtsy = async () => {
    if (!replyDraft.trim()) return;
    try {
      await navigator.clipboard.writeText(replyDraft.trim());
      window.open('https://www.etsy.com/your/orders/sold', '_blank', 'noopener,noreferrer');
      showToast('Reply copied — paste it into the Etsy conversation', 'success');
    } catch (error) {
      console.error('Copy & open Etsy failed:', error);
      showToast('Unable to copy the reply draft right now', 'error');
    }
  };

  const saveNote = async () => {
    if (!selectedInteraction?.id) return;
    setSavingNote(true);
    try {
      if (isLocalWorkspaceUser(user)) {
        patchLocalBucketRecord(user.uid, 'interactions', selectedInteraction.id, {
          notes: noteDraft
        });
      } else {
        await updateDoc(doc(db, 'interactions', selectedInteraction.id), {
          notes: noteDraft
        });
      }
      showToast('Internal note updated', 'info');
    } catch (error) {
      console.error('Note save failed:', error);
      showToast('Unable to save the internal note right now', 'error');
    } finally {
      setSavingNote(false);
    }
  };

  const resolveInteraction = async () => {
    if (!selectedInteraction?.id) return;
    await persistInteractionPatch({ status: 'resolved' }, 'Conversation marked resolved');
  };

  const updatePriority = async (priority: CustomerInteraction['priority']) => {
    if (!selectedInteraction || selectedInteraction.priority === priority) return;
    await persistInteractionPatch({ priority }, `Priority updated to ${priority}`);
  };

  const updateCategory = async (category: NonNullable<CustomerInteraction['category']>) => {
    if (!selectedInteraction || selectedInteraction.category === category) return;
    await persistInteractionPatch({ category }, 'Conversation category updated');
  };

  const copyCustomerEmail = async () => {
    if (!selectedInteraction?.customerEmail) return;
    try {
      await navigator.clipboard.writeText(selectedInteraction.customerEmail);
      showToast('Buyer email copied', 'success');
    } catch (error) {
      console.error('Buyer email copy failed:', error);
      showToast('Unable to copy the buyer email right now', 'error');
    }
  };

  const deleteInteraction = async (id: string) => {
    try {
      if (isLocalWorkspaceUser(user)) {
        deleteLocalBucketRecord(user.uid, 'interactions', id);
      } else {
        await deleteDoc(doc(db, 'interactions', id));
      }
      if (selectedId === id) setSelectedId(null);
      showToast('Conversation removed', 'info');
    } catch (error) {
      console.error('Conversation delete failed:', error);
      showToast('Unable to remove this conversation right now', 'error');
    }
  };

  const addInteraction = async () => {
    if (!newInteraction.customerName.trim() || !newInteraction.message.trim()) return;
    setCreating(true);
    try {
      const analysis = await analyzeCustomerSentiment(newInteraction.message);

      const interactionPayload = {
        customerName: newInteraction.customerName.trim(),
        customerEmail: newInteraction.customerEmail.trim() || null,
        message: newInteraction.message.trim(),
        status: 'pending' as const,
        priority: (analysis.priority || 'normal') as CustomerInteraction['priority'],
        sentiment: (analysis.sentiment || 'neutral') as CustomerInteraction['sentiment'],
        category: (analysis.category || 'other') as CustomerInteraction['category'],
        summary: analysis.summary || '',
        timestamp: new Date().toISOString(),
        ownerId: user.uid
      };

      if (isLocalWorkspaceUser(user)) {
        upsertLocalBucketRecord(user.uid, 'interactions', interactionPayload);
      } else {
        await addDoc(collection(db, 'interactions'), {
          ...interactionPayload,
          timestamp: serverTimestamp()
        });
      }

      setNewInteraction({ customerName: '', customerEmail: '', message: '' });
      setShowAddPanel(false);
      showToast('Conversation added and triaged', 'success');
    } catch (error) {
      console.error('Conversation creation failed:', error);
      showToast('Unable to add the conversation right now', 'error');
    } finally {
      setCreating(false);
    }
  };

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="space-y-6">
      <SectionCard className="p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-[11px] font-black uppercase tracking-[0.28em] text-amber-500">Inbox</p>
            <h2 className="mt-2 text-3xl font-extrabold tracking-tight text-slate-950">Inbox and buyer replies</h2>
          </div>
          <div className="flex flex-wrap gap-3">
            <div className="flex rounded-full border border-slate-200 bg-white p-1">
              {(['all', 'pending', 'replied', 'resolved'] as const).map((status) => (
                <button
                  key={status}
                  onClick={() => setFilterStatus(status)}
                  className={cn(
                    'rounded-full px-4 py-2 text-xs font-semibold transition',
                    filterStatus === status ? 'bg-slate-950 text-white' : 'text-slate-700'
                  )}
                >
                  {status}
                </button>
              ))}
            </div>
            <button
              onClick={() => setShowAddPanel((current) => !current)}
              className="inline-flex items-center gap-2 rounded-full bg-slate-950 px-5 py-3 text-xs font-black uppercase tracking-[0.22em] text-white transition hover:bg-slate-800"
            >
              <Plus className="h-4 w-4" />
              Add conversation
            </button>
          </div>
        </div>

        <div className="mt-5 grid gap-4 md:grid-cols-3">
          <MetricCard title="Pending" value={pendingCount} detail="Conversations still waiting on seller action" icon={<MessageSquare className="h-5 w-5" />} accent="rose" />
          <MetricCard title="Urgent" value={urgentCount} detail="Messages most likely to affect trust or refunds" icon={<AlertTriangle className="h-5 w-5" />} accent="amber" />
          <MetricCard title="Draft ready" value={draftReadyCount} detail="Conversations that already have a saved reply" icon={<Send className="h-5 w-5" />} accent="emerald" />
        </div>

        {showAddPanel && (
          <div className="mt-6 rounded-[1.8rem] border border-slate-200 bg-slate-50 p-5">
            <p className="text-[11px] font-black uppercase tracking-[0.24em] text-slate-500">Add from message</p>
            <p className="mt-2 text-sm leading-7 text-slate-600">
              Paste a message from Etsy or email to triage it and draft a response path.
            </p>
            <div className="mt-5 grid gap-4 md:grid-cols-2">
              <ProfileField label="Customer name" value={newInteraction.customerName} onChange={(value) => setNewInteraction((current) => ({ ...current, customerName: value }))} placeholder="Jane Doe" />
              <ProfileField label="Customer email" value={newInteraction.customerEmail} onChange={(value) => setNewInteraction((current) => ({ ...current, customerEmail: value }))} placeholder="jane@example.com" />
            </div>
            <div className="mt-4">
              <p className="mb-2 text-[11px] font-black uppercase tracking-[0.24em] text-slate-500">Customer message</p>
              <textarea
                value={newInteraction.message}
                onChange={(event) => setNewInteraction((current) => ({ ...current, message: event.target.value }))}
                className="h-36 w-full rounded-[1.7rem] border border-slate-200 bg-white p-5 text-sm font-medium leading-7 text-slate-700"
                placeholder="Paste the buyer's note here..."
              />
            </div>
            <div className="mt-5 flex justify-end">
              <button
                onClick={addInteraction}
                disabled={creating}
                className="inline-flex items-center gap-2 rounded-full bg-slate-950 px-5 py-3 text-xs font-black uppercase tracking-[0.22em] text-white transition hover:bg-slate-800 disabled:opacity-60"
              >
                {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                Add and triage
              </button>
            </div>
          </div>
        )}
      </SectionCard>

      <div className="grid gap-6 xl:grid-cols-[0.78fr_1.22fr]">
        <SectionCard className="max-h-[calc(100vh-240px)] overflow-hidden p-5">
          <div className="flex items-center justify-between gap-3 border-b border-slate-100 pb-4">
            <div>
              <p className="text-[11px] font-black uppercase tracking-[0.24em] text-slate-500">Queue</p>
              <p className="mt-2 text-lg font-extrabold text-slate-950">{filtered.length} visible conversations</p>
            </div>
            <StatusPill tone={filtered.some((entry) => entry.priority === 'urgent') ? 'danger' : 'info'}>
              {filtered.some((entry) => entry.priority === 'urgent') ? 'Urgent items present' : 'Stable queue'}
            </StatusPill>
          </div>

          <div className="mt-4 space-y-3">
            <div className="flex items-center gap-3 rounded-[1.4rem] border border-slate-200 bg-slate-50 px-4 py-3">
              <Search className="h-4 w-4 text-slate-400" />
              <input
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Search buyer, order, email, or message..."
                className="w-full bg-transparent text-sm font-medium text-slate-700"
              />
            </div>

            <div className="flex flex-wrap gap-2">
              {(['all', 'urgent', 'normal', 'low'] as const).map((priority) => (
                <button
                  key={priority}
                  onClick={() => setPriorityFilter(priority)}
                  className={cn(
                    'rounded-full px-4 py-2 text-[11px] font-black uppercase tracking-[0.2em] transition',
                    priorityFilter === priority ? 'bg-slate-950 text-white' : 'border border-slate-200 bg-white text-slate-600'
                  )}
                >
                  {priority}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-4 space-y-3 overflow-y-auto pr-1 custom-scrollbar">
            {filtered.length === 0 ? (
              <EmptyState icon={<MessageSquare className="h-6 w-6" />} title="No conversations in this filter" subtitle="Try another status or add a buyer message manually." />
            ) : (
              filtered.map((interaction) => (
                <button
                  key={interaction.id}
                  onClick={() => setSelectedId(interaction.id!)}
                  className={cn(
                    'w-full rounded-[1.6rem] border p-4 text-left transition',
                    selectedInteraction?.id === interaction.id
                      ? 'border-slate-950 bg-slate-950 text-white shadow-xl'
                      : 'border-slate-200 bg-white hover:border-slate-300 hover:shadow-sm'
                  )}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <span className={cn('h-2.5 w-2.5 rounded-full', interaction.priority === 'urgent' ? 'bg-rose-500' : interaction.priority === 'normal' ? 'bg-amber-400' : 'bg-slate-300')} />
                      <p className="text-sm font-black">{interaction.customerName}</p>
                    </div>
                    <span className={cn(
                      'rounded-full px-3 py-1 text-[10px] font-black uppercase tracking-[0.18em]',
                      selectedInteraction?.id === interaction.id ? 'bg-white/10 text-white' : 'bg-slate-100 text-slate-500'
                    )}>
                      {interaction.status === 'pending' ? 'open' : interaction.status}
                    </span>
                  </div>
                  <p className={cn('mt-3 line-clamp-2 text-sm leading-6', selectedInteraction?.id === interaction.id ? 'text-slate-200' : 'text-slate-600')}>
                    {interaction.summary || interaction.message}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {interaction.source === 'etsy_receipt' && <StatusPill tone="info">Etsy</StatusPill>}
                    {interaction.status === 'pending' && interaction.response && <StatusPill tone="warning">Draft ready</StatusPill>}
                    {interaction.sentiment && <StatusPill tone={interaction.sentiment === 'negative' ? 'danger' : interaction.sentiment === 'positive' ? 'success' : 'info'}>{interaction.sentiment}</StatusPill>}
                    {interaction.category && <StatusPill tone="info">{interaction.category.replace('_', ' ')}</StatusPill>}
                  </div>
                </button>
              ))
            )}
          </div>
        </SectionCard>

        <SectionCard className="p-6">
          {selectedInteraction ? (
            <>
              <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-100 pb-5">
                <div>
                  <p className="text-[11px] font-black uppercase tracking-[0.24em] text-amber-500">Conversation detail</p>
                  <h3 className="mt-2 text-2xl font-extrabold tracking-tight text-slate-950">{selectedInteraction.customerName}</h3>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <StatusPill tone={selectedInteraction.priority === 'urgent' ? 'danger' : selectedInteraction.priority === 'normal' ? 'warning' : 'info'}>
                      {selectedInteraction.priority}
                    </StatusPill>
                    {selectedInteraction.source === 'etsy_receipt' && <StatusPill tone="info">Etsy receipt</StatusPill>}
                    {selectedInteraction.status === 'pending' && selectedInteraction.response && <StatusPill tone="warning">Draft ready</StatusPill>}
                    {selectedInteraction.orderStatus && <StatusPill tone={selectedInteraction.orderStatus === 'paid' ? 'warning' : selectedInteraction.orderStatus === 'shipped' ? 'success' : 'info'}>{selectedInteraction.orderStatus}</StatusPill>}
                    {selectedInteraction.sentiment && <StatusPill tone={selectedInteraction.sentiment === 'negative' ? 'danger' : selectedInteraction.sentiment === 'positive' ? 'success' : 'info'}>{selectedInteraction.sentiment}</StatusPill>}
                    {selectedInteraction.category && <StatusPill tone="info">{selectedInteraction.category.replace('_', ' ')}</StatusPill>}
                  </div>
                </div>

                <div className="flex flex-wrap gap-3">
                  {selectedInteraction.status === 'pending' && (selectedInteraction.response || replyDraft.trim()) && (
                    <button
                      onClick={markAsReplied}
                      className="rounded-full border border-sky-200 bg-sky-50 px-4 py-2 text-[11px] font-black uppercase tracking-[0.22em] text-sky-700 transition hover:bg-sky-100"
                    >
                      Mark replied
                    </button>
                  )}
                  {selectedInteraction.status !== 'resolved' && (
                    <button
                      onClick={resolveInteraction}
                      className="rounded-full border border-emerald-200 bg-emerald-50 px-4 py-2 text-[11px] font-black uppercase tracking-[0.22em] text-emerald-700 transition hover:bg-emerald-100"
                    >
                      Mark resolved
                    </button>
                  )}
                  {selectedInteraction.id && (
                    <button
                      onClick={() => deleteInteraction(selectedInteraction.id!)}
                      className="rounded-full border border-rose-200 bg-rose-50 px-4 py-2 text-[11px] font-black uppercase tracking-[0.22em] text-rose-600 transition hover:bg-rose-100"
                    >
                      Delete
                    </button>
                  )}
                </div>
              </div>

              <div className="mt-5 grid gap-5 xl:grid-cols-[0.95fr_1.05fr]">
                <div className="space-y-5">
                  <div className="rounded-[1.7rem] border border-slate-200 bg-white p-5">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="text-[11px] font-black uppercase tracking-[0.22em] text-slate-500">Next move</p>
                        <p className="mt-2 text-lg font-extrabold text-slate-950">{getReplyTarget(selectedInteraction)}</p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {(['urgent', 'normal', 'low'] as const).map((priority) => (
                          <button
                            key={priority}
                            onClick={() => void updatePriority(priority)}
                            className={cn(
                              'rounded-full px-3 py-2 text-[11px] font-black uppercase tracking-[0.18em] transition',
                              selectedInteraction.priority === priority
                                ? 'bg-slate-950 text-white'
                                : 'border border-slate-200 bg-slate-50 text-slate-600 hover:border-slate-300 hover:text-slate-900'
                            )}
                          >
                            {priority}
                          </button>
                        ))}
                      </div>
                    </div>
                    <p className="mt-4 text-sm leading-7 text-slate-700">{getWorkbenchSummary(selectedInteraction)}</p>
                    <div className="mt-4 space-y-2">
                      {getConversationChecklist(selectedInteraction).map((item) => (
                        <p key={item} className="text-sm leading-6 text-slate-600">• {item}</p>
                      ))}
                    </div>
                    <div className="mt-4 flex flex-wrap gap-2">
                      {(['question', 'order_issue', 'custom_request', 'feedback', 'complaint', 'other'] as const).map((category) => (
                        <button
                          key={category}
                          onClick={() => void updateCategory(category)}
                          className={cn(
                            'rounded-full px-3 py-2 text-[11px] font-black uppercase tracking-[0.16em] transition',
                            selectedInteraction.category === category
                              ? 'bg-amber-400 text-slate-950'
                              : 'border border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:text-slate-900'
                          )}
                        >
                          {category.replace('_', ' ')}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="rounded-[1.7rem] border border-slate-200 bg-slate-50 p-5">
                    <p className="text-[11px] font-black uppercase tracking-[0.22em] text-slate-500">Buyer message</p>
                    <p className="mt-4 whitespace-pre-line text-sm leading-7 text-slate-700">{selectedInteraction.message}</p>
                  </div>

                  <div className="rounded-[1.7rem] border border-slate-200 bg-white p-5">
                    <p className="text-[11px] font-black uppercase tracking-[0.22em] text-slate-500">Support playbook</p>
                    <p className="mt-4 text-sm leading-7 text-slate-700">{selectedInteraction.summary || 'No summary was stored for this message.'}</p>
                    <p className="mt-4 rounded-2xl border border-amber-100 bg-amber-50 p-4 text-sm leading-6 text-slate-700">
                      {getSupportPlaybook(selectedInteraction)}
                    </p>
                  </div>

                  <div className="rounded-[1.7rem] border border-slate-200 bg-white p-5">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <p className="text-[11px] font-black uppercase tracking-[0.22em] text-slate-500">Buyer context</p>
                      <div className="flex flex-wrap gap-2">
                        {selectedInteraction.customerEmail && (
                          <button
                            onClick={copyCustomerEmail}
                            className="inline-flex items-center gap-2 rounded-full border border-slate-200 px-3 py-2 text-[11px] font-black uppercase tracking-[0.18em] text-slate-600 transition hover:border-slate-300 hover:text-slate-900"
                          >
                            <Copy className="h-3.5 w-3.5" />
                            Copy email
                          </button>
                        )}
                        {selectedInteraction.source === 'etsy_receipt' && (
                          <button
                            onClick={() => window.open('https://www.etsy.com/your/orders/sold', '_blank', 'noopener,noreferrer')}
                            className="inline-flex items-center gap-2 rounded-full border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] font-black uppercase tracking-[0.18em] text-amber-700 transition hover:bg-amber-100"
                          >
                            <ExternalLink className="h-3.5 w-3.5" />
                            Open order queue
                          </button>
                        )}
                      </div>
                    </div>
                    <div className="mt-4 grid gap-3 sm:grid-cols-2">
                      <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                        <p className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-500">Buyer email</p>
                        <p className="mt-2 text-sm font-semibold text-slate-900">{selectedInteraction.customerEmail || 'Not captured'}</p>
                      </div>
                      <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                        <p className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-500">Order reference</p>
                        <p className="mt-2 text-sm font-semibold text-slate-900">{selectedInteraction.relatedOrderId || 'Not linked'}</p>
                      </div>
                    </div>
                  </div>

                  <div className="rounded-[1.7rem] border border-slate-200 bg-white p-5">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-[11px] font-black uppercase tracking-[0.22em] text-slate-500">Internal notes</p>
                      <button
                        onClick={saveNote}
                        disabled={savingNote}
                        className="inline-flex items-center gap-2 rounded-full border border-slate-200 px-4 py-2 text-[11px] font-black uppercase tracking-[0.2em] text-slate-500 transition hover:border-slate-300 hover:text-slate-900 disabled:opacity-60"
                      >
                        {savingNote ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileText className="h-3.5 w-3.5" />}
                        Save note
                      </button>
                    </div>
                    <textarea
                      value={noteDraft}
                      onChange={(event) => setNoteDraft(event.target.value)}
                      className="mt-4 h-28 w-full rounded-[1.5rem] border border-slate-200 bg-slate-50 p-4 text-sm font-medium leading-7 text-slate-700"
                      placeholder="Shipping context, promised follow-up, custom request limits, refund notes..."
                    />
                  </div>
                </div>

                <div className="rounded-[1.8rem] border border-slate-200 bg-white p-5 shadow-sm">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-[11px] font-black uppercase tracking-[0.22em] text-slate-500">Reply lab</p>
                      <p className="mt-2 text-lg font-extrabold text-slate-950">Draft, review, then send manually</p>
                    </div>
                    <button
                      onClick={generateReply}
                      disabled={loadingReply}
                      className="inline-flex items-center gap-2 rounded-full bg-slate-950 px-4 py-2 text-[11px] font-black uppercase tracking-[0.2em] text-white transition hover:bg-slate-800 disabled:opacity-60"
                    >
                      {loadingReply ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                      Draft with AI
                    </button>
                  </div>

                  <textarea
                    value={replyDraft}
                    onChange={(event) => setReplyDraft(event.target.value)}
                    className="mt-5 h-[320px] w-full rounded-[1.7rem] border border-slate-200 bg-slate-50 p-5 text-sm font-medium leading-7 text-slate-700"
                    placeholder="Use AI for the first draft, then make the tone and facts yours."
                  />

                  <div className="mt-5 flex flex-wrap justify-end gap-3">
                    <button
                      onClick={copyReplyDraft}
                      disabled={!replyDraft.trim()}
                      className="inline-flex items-center gap-2 rounded-full border border-slate-200 px-5 py-3 text-xs font-black uppercase tracking-[0.22em] text-slate-600 transition hover:border-slate-300 hover:text-slate-950 disabled:opacity-60"
                    >
                      Copy draft
                    </button>
                    <button
                      onClick={copyAndOpenEtsy}
                      disabled={!replyDraft.trim()}
                      className="inline-flex items-center gap-2 rounded-full border border-amber-200 bg-amber-50 px-5 py-3 text-xs font-black uppercase tracking-[0.22em] text-amber-700 transition hover:bg-amber-100 disabled:opacity-60"
                    >
                      <ExternalLink className="h-4 w-4" />
                      Copy & Open Etsy
                    </button>
                    <button
                      onClick={saveReplyDraft}
                      disabled={!replyDraft.trim()}
                      className="inline-flex items-center gap-2 rounded-full bg-slate-950 px-5 py-3 text-xs font-black uppercase tracking-[0.22em] text-white transition hover:bg-slate-800 disabled:opacity-60"
                    >
                      <Send className="h-4 w-4" />
                      Save reply draft
                    </button>
                    {selectedInteraction.status === 'pending' && (
                      <button
                        onClick={markAsReplied}
                        disabled={!replyDraft.trim() && !selectedInteraction.response}
                        className="inline-flex items-center gap-2 rounded-full border border-sky-200 bg-sky-50 px-5 py-3 text-xs font-black uppercase tracking-[0.22em] text-sky-700 transition hover:bg-sky-100 disabled:opacity-60"
                      >
                        Save and mark replied
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </>
          ) : (
            <div className="flex min-h-[420px] items-center justify-center">
              <div className="w-full max-w-xl">
                <EmptyState icon={<MessageSquare className="h-6 w-6" />} title="Pick a conversation" subtitle="The detail panel will show message context, a reply draft, and internal notes." />
              </div>
            </div>
          )}
        </SectionCard>
      </div>
    </motion.div>
  );
}
