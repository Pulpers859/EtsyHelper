import React, { useEffect, useMemo, useState } from 'react';
import {
  Bot,
  Calendar,
  CheckCircle2,
  DollarSign,
  Loader2,
  MessageSquare,
  Package,
  RefreshCw,
  Sparkles,
  TrendingUp,
  Zap
} from 'lucide-react';
import type { User } from 'firebase/auth';
import { addDoc, collection, serverTimestamp } from 'firebase/firestore';
import { motion } from 'framer-motion';

import { db } from '../lib/firebase';
import { cn } from '../lib/utils';
import {
  analyzeTrends,
  generateDailyBriefing
} from '../services/gemini';
import {
  ActionQueueItem,
  clampNonNegativeInteger,
  ConnectedAccounts,
  DerivedMetrics,
  EtsyAnalyticsSnapshot,
  formatDate,
  parseIntegerInput,
  PLATFORM_COLORS,
  ShopProfile,
  Tab,
  toDate,
  type Toast
} from '../app/core';
import {
  isLocalWorkspaceUser,
  upsertLocalBucketRecord
} from '../app/localWorkspace';
import { EmptyState, MetricCard, ProfileField, SectionCard, StatusPill } from '../components/shell';
import type { AgentTask, CustomerInteraction, InventoryItem, SocialPost, TrendAnalysis } from '../types';

type CommandCenterViewProps = {
  user: User;
  shopProfile: ShopProfile;
  connectedAccounts: ConnectedAccounts;
  aiConfigured: boolean;
  savingProfile: boolean;
  inventory: InventoryItem[];
  posts: SocialPost[];
  interactions: CustomerInteraction[];
  trends: TrendAnalysis[];
  agentTasks: AgentTask[];
  metrics: DerivedMetrics;
  setActiveTab: (tab: Tab) => void;
  saveProfile: (profile: ShopProfile, successMessage?: string) => Promise<void>;
  approveAgentTask: (taskId: string) => void;
  deferAgentTask: (taskId: string) => void;
  runAgentTask: (task: AgentTask) => Promise<void>;
  showToast: (message: string, type?: Toast['type']) => void;
  etsyAnalytics: EtsyAnalyticsSnapshot;
  setEtsyAnalytics: React.Dispatch<React.SetStateAction<EtsyAnalyticsSnapshot>>;
  openActionQueueItem: (item: ActionQueueItem) => void;
  openAgentTask: (task: AgentTask) => void;
};

export default function CommandCenterView({
  user,
  shopProfile,
  savingProfile,
  inventory,
  trends,
  agentTasks,
  metrics,
  setActiveTab,
  saveProfile,
  approveAgentTask,
  deferAgentTask,
  runAgentTask,
  showToast,
  etsyAnalytics,
  openActionQueueItem,
  openAgentTask
}: CommandCenterViewProps) {
  const [profileDraft, setProfileDraft] = useState(shopProfile);
  const [briefing, setBriefing] = useState<string>('');
  const [loadingBriefing, setLoadingBriefing] = useState(false);
  const [trendKeyword, setTrendKeyword] = useState('');
  const [analyzingTrend, setAnalyzingTrend] = useState(false);

  useEffect(() => {
    setProfileDraft(shopProfile);
  }, [shopProfile]);

  const pullBriefing = async () => {
    setLoadingBriefing(true);
    try {
      const text = await generateDailyBriefing({
        inventory: inventory.length,
        lowStock: metrics.lowStockItems.length,
        pendingMessages: metrics.pendingReplies.length,
        scheduledPosts: metrics.scheduledPosts.length,
        recentTrends: trends.slice(0, 4).map((trend) => trend.keyword)
      });
      setBriefing(text);
    } catch (error) {
      console.error('Daily briefing failed:', error);
      showToast('Unable to generate the briefing right now', 'error');
    } finally {
      setLoadingBriefing(false);
    }
  };

  const runTrendScan = async () => {
    if (!trendKeyword.trim()) return;

    setAnalyzingTrend(true);
    try {
      const result = await analyzeTrends(trendKeyword.trim());

      const trendPayload = {
        keyword: trendKeyword.trim(),
        popularityScore: result.popularityScore,
        suggestedIdeas: result.ideas,
        analysis: result.analysis,
        competitionLevel: (result.competitionLevel || 'medium') as 'low' | 'medium' | 'high',
        opportunityWindow: result.opportunityWindow,
        ownerId: user.uid
      };

      if (isLocalWorkspaceUser(user)) {
        upsertLocalBucketRecord(user.uid, 'trends', {
          ...trendPayload,
          lastAnalyzed: new Date().toISOString()
        });
      } else {
        await addDoc(collection(db, 'trends'), {
          ...trendPayload,
          lastAnalyzed: serverTimestamp()
        });
      }
      showToast('Opportunity scan saved', 'info');
      setTrendKeyword('');
    } catch (error) {
      console.error('Trend analysis failed:', error);
      showToast('Trend analysis failed', 'error');
    } finally {
      setAnalyzingTrend(false);
    }
  };

  const publishWindowPosts = useMemo(() => {
    const now = Date.now();
    const cutoff = now + (1000 * 60 * 60 * 48);
    return metrics.upcomingPosts.filter((post) => {
      const scheduled = toDate(post.scheduledAt);
      if (!scheduled) return false;
      const time = scheduled.getTime();
      return time >= now && time <= cutoff;
    });
  }, [metrics.upcomingPosts]);

  const overdueQueue = useMemo(() => metrics.overduePosts, [metrics.overduePosts]);

  const urgentReplies = useMemo(
    () => metrics.pendingReplies.filter((interaction) => interaction.priority === 'urgent'),
    [metrics.pendingReplies]
  );

  const liveOpportunity = useMemo(() => {
    return [...etsyAnalytics.listingMetrics]
      .filter((metric) => (metric.views30d || 0) >= 15 || (metric.favorites30d || 0) >= 5)
      .sort((left, right) => ((right.views30d || 0) + (right.favorites30d || 0)) - ((left.views30d || 0) + (left.favorites30d || 0)))
      .find((metric) => (metric.orders30d || 0) === 0 || ((metric.conversionRate || 0) < 1.2));
  }, [etsyAnalytics.listingMetrics]);

  const monthlyRevenueGap = useMemo(() => {
    if (!shopProfile.monthlyRevenueGoal || etsyAnalytics.shopRevenue30d == null) return null;
    return Math.max(0, shopProfile.monthlyRevenueGoal - etsyAnalytics.shopRevenue30d);
  }, [etsyAnalytics.shopRevenue30d, shopProfile.monthlyRevenueGoal]);

  const todayFocus = useMemo(() => {
    const items: Array<{
      id: string;
      title: string;
      detail: string;
      tab: Tab;
      label: string;
      tone: 'danger' | 'warning' | 'info' | 'success';
    }> = [];

    if (urgentReplies.length > 0) {
      items.push({
        id: 'today-urgent-inbox',
        title: `Reply to ${urgentReplies.length} urgent buyer ${urgentReplies.length === 1 ? 'thread' : 'threads'}`,
        detail: urgentReplies.slice(0, 2).map((entry) => entry.customerName).join(', '),
        tab: 'customers',
        label: 'Inbox',
        tone: 'danger'
      });
    }

    if (overdueQueue.length > 0) {
      items.push({
        id: 'today-overdue-posts',
        title: `Clear ${overdueQueue.length} overdue queued ${overdueQueue.length === 1 ? 'post' : 'posts'}`,
        detail: 'These posts are already past their scheduled time and need a publish decision.',
        tab: 'studio',
        label: 'Studio',
        tone: 'warning'
      });
    } else if (metrics.retryableFailedPosts.length > 0) {
      const nextFailed = metrics.retryableFailedPosts[0];
      items.push({
        id: 'today-retry-failed',
        title: `Retry ${metrics.retryableFailedPosts.length} failed publish${metrics.retryableFailedPosts.length === 1 ? '' : 'es'}`,
        detail: nextFailed?.publishError || 'Instagram publishing failed and needs a retry pass.',
        tab: 'studio',
        label: 'Retry',
        tone: 'danger'
      });
    } else if (metrics.manualHandoffPosts.length > 0) {
      const nextManual = metrics.manualHandoffPosts[0];
      items.push({
        id: 'today-manual-publish',
        title: `Hand off ${metrics.manualHandoffPosts.length} due post${metrics.manualHandoffPosts.length === 1 ? '' : 's'}`,
        detail: nextManual ? `${nextManual.platform} is due now and still needs a publish decision.` : 'Publishing work is due now.',
        tab: 'studio',
        label: 'Publish',
        tone: 'warning'
      });
    } else if (publishWindowPosts.length > 0) {
      const nextPost = publishWindowPosts[0];
      items.push({
        id: 'today-publish',
        title: `Hand off ${publishWindowPosts.length} post${publishWindowPosts.length === 1 ? '' : 's'} in the next 48 hours`,
        detail: nextPost ? `${nextPost.platform} is next at ${formatDate(nextPost.scheduledAt, 'MMM d, h:mm a')}` : 'Content is ready for this window.',
        tab: 'studio',
        label: 'Publish',
        tone: 'info'
      });
    }

    if (metrics.lowStockItems.length > 0) {
      const highestRisk = [...metrics.lowStockItems].sort((left, right) => left.stockLevel - right.stockLevel)[0];
      items.push({
        id: 'today-restock',
        title: `Restock ${highestRisk.name}`,
        detail: `${highestRisk.stockLevel} left with reorder point ${highestRisk.reorderPoint || 5}.`,
        tab: 'catalog',
        label: 'Catalog',
        tone: 'danger'
      });
    }

    if (liveOpportunity) {
      items.push({
        id: 'today-optimize-live',
        title: `Tighten ${liveOpportunity.title}`,
        detail: `${liveOpportunity.views30d || 0} views and ${liveOpportunity.orders30d || 0} orders suggest a conversion gap.`,
        tab: 'catalog',
        label: 'Optimize',
        tone: 'warning'
      });
    }

    if (monthlyRevenueGap && monthlyRevenueGap > 0) {
      items.push({
        id: 'today-revenue-gap',
        title: `Close the $${monthlyRevenueGap.toFixed(0)} monthly revenue gap`,
        detail: 'Use the weekly plan to focus next on the listing or message most likely to move revenue.',
        tab: 'growth',
        label: 'Growth',
        tone: 'info'
      });
    }

    if (items.length === 0) {
      items.push({
        id: 'today-clear',
        title: 'Today is clear for growth work',
        detail: 'Use this block to sharpen one listing, build one campaign, or queue next week of content.',
        tab: 'growth',
        label: 'Plan next',
        tone: 'success'
      });
    }

    return items.slice(0, 5);
  }, [liveOpportunity, metrics.lowStockItems, metrics.manualHandoffPosts, metrics.retryableFailedPosts, monthlyRevenueGap, overdueQueue, publishWindowPosts, urgentReplies]);

  const openAgentTasks = useMemo(
    () => agentTasks.filter((task) => task.status === 'suggested' || task.status === 'approved' || task.status === 'running'),
    [agentTasks]
  );

  const recentAgentTasks = useMemo(
    () => agentTasks.filter((task) => task.status === 'completed' || task.status === 'failed' || task.status === 'deferred').slice(0, 4),
    [agentTasks]
  );

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="space-y-6">
      <SectionCard className="bg-slate-950 p-6 text-white">
        <div className="flex flex-wrap items-center justify-between gap-6">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-[11px] font-black uppercase tracking-[0.26em] text-amber-300">
              <Zap className="h-3.5 w-3.5" />
              Command Center
            </div>
            <h2 className="mt-3 text-2xl font-extrabold tracking-tight">
              {shopProfile.shopName || user.displayName || 'Your shop'}
            </h2>
          </div>
          <div className="flex items-center gap-6">
            <div className="text-center">
              <p className="text-4xl font-black">{metrics.readinessScore}%</p>
              <p className="mt-1 text-[11px] font-black uppercase tracking-[0.22em] text-slate-400">Readiness</p>
            </div>
            <div className="hidden gap-3 sm:flex">
              <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-center">
                <p className="text-lg font-black">{metrics.profileCompletion}%</p>
                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Profile</p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-center">
                <p className="text-lg font-black">{metrics.responseCoverage}%</p>
                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Response</p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-center">
                <p className="text-lg font-black">{metrics.contentCoverage}%</p>
                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Content</p>
              </div>
            </div>
          </div>
        </div>
      </SectionCard>

      <SectionCard className="p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-[11px] font-black uppercase tracking-[0.28em] text-amber-500">Today</p>
            <h3 className="mt-2 text-2xl font-extrabold tracking-tight text-slate-950">What to do next</h3>
          </div>
          <StatusPill tone={todayFocus[0]?.tone || 'success'}>
            {todayFocus[0]?.tone === 'danger' ? 'Immediate attention' : todayFocus[0]?.tone === 'warning' ? 'Action window open' : todayFocus[0]?.tone === 'info' ? 'Good working block' : 'Clear runway'}
          </StatusPill>
        </div>

        <div className="mt-5 grid gap-6 xl:grid-cols-[0.88fr_1.12fr]">
          <div className="grid gap-4 md:grid-cols-3 xl:grid-cols-1">
            <div className="rounded-[1.7rem] border border-slate-200 bg-slate-50 p-5">
              <p className="text-[11px] font-black uppercase tracking-[0.22em] text-slate-500">Urgent buyers</p>
              <p className="mt-3 text-3xl font-black text-slate-950">{urgentReplies.length}</p>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                {urgentReplies.length > 0 ? 'Start here to protect trust and refunds.' : 'No urgent buyer threads are waiting.'}
              </p>
            </div>
            <div className="rounded-[1.7rem] border border-slate-200 bg-slate-50 p-5">
              <p className="text-[11px] font-black uppercase tracking-[0.22em] text-slate-500">Publish window</p>
              <p className="mt-3 text-3xl font-black text-slate-950">{publishWindowPosts.length + overdueQueue.length}</p>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                {overdueQueue.length > 0 ? `${overdueQueue.length} queued post${overdueQueue.length === 1 ? '' : 's'} are overdue.` : 'Posts scheduled for the next 48 hours.'}
              </p>
            </div>
            <div className="rounded-[1.7rem] border border-slate-200 bg-slate-50 p-5">
              <p className="text-[11px] font-black uppercase tracking-[0.22em] text-slate-500">Revenue gap</p>
              <p className="mt-3 text-3xl font-black text-slate-950">
                {monthlyRevenueGap != null ? `$${monthlyRevenueGap.toFixed(0)}` : '--'}
              </p>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                {monthlyRevenueGap != null ? 'Difference between current 30-day revenue and your monthly goal.' : 'Connect more live sales data or set a monthly goal for tighter pacing.'}
              </p>
            </div>
          </div>

          <div className="space-y-3">
            {todayFocus.map((item, index) => (
              <button
                key={item.id}
                onClick={() => setActiveTab(item.tab)}
                className={cn(
                  'w-full rounded-[1.7rem] border p-5 text-left transition hover:-translate-y-0.5 hover:shadow-lg',
                  item.tone === 'danger' && 'border-rose-200 bg-rose-50',
                  item.tone === 'warning' && 'border-amber-200 bg-amber-50',
                  item.tone === 'info' && 'border-indigo-200 bg-indigo-50',
                  item.tone === 'success' && 'border-emerald-200 bg-emerald-50'
                )}
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-3">
                      <span className="flex h-8 w-8 items-center justify-center rounded-2xl bg-white/80 text-sm font-black text-slate-900">
                        {index + 1}
                      </span>
                      <p className="text-base font-black text-slate-950">{item.title}</p>
                    </div>
                    <p className="mt-3 text-sm leading-6 text-slate-700">{item.detail}</p>
                  </div>
                  <span className="rounded-full bg-white/80 px-3 py-1 text-[11px] font-black uppercase tracking-[0.2em] text-slate-600">
                    {item.label}
                  </span>
                </div>
              </button>
            ))}
          </div>
        </div>
      </SectionCard>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          title="Pending replies"
          value={metrics.pendingReplies.length}
          detail={metrics.pendingReplies.length > 0 ? 'Buyers waiting on a response' : 'Inbox is under control'}
          icon={<MessageSquare className="h-5 w-5" />}
          accent="rose"
        />
        <MetricCard
          title="Low stock risk"
          value={metrics.lowStockItems.length}
          detail={metrics.lowStockItems.length > 0 ? 'Revenue exposed to stock-outs' : 'No immediate stock alerts'}
          icon={<Package className="h-5 w-5" />}
          accent="amber"
        />
        <MetricCard
          title="Queued content"
          value={metrics.scheduledPosts.length}
          detail="Approved posts waiting in the pipeline"
          icon={<Calendar className="h-5 w-5" />}
          accent="indigo"
        />
        <MetricCard
          title="Inventory value"
          value={`$${metrics.inventoryValue.toFixed(0)}`}
          detail={metrics.atRiskRevenue > 0 ? `$${metrics.atRiskRevenue.toFixed(0)} at risk if stock-outs hit` : 'No immediate revenue risk flagged'}
          icon={<DollarSign className="h-5 w-5" />}
          accent="emerald"
        />
      </div>

      <SectionCard className="p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-[11px] font-black uppercase tracking-[0.28em] text-amber-500">Autopilot</p>
            <h3 className="mt-2 text-2xl font-extrabold tracking-tight text-slate-950">Agent task queue</h3>
          </div>
          <StatusPill tone={openAgentTasks.some((task) => task.risk === 'high') ? 'danger' : openAgentTasks.length > 0 ? 'warning' : 'success'}>
            {openAgentTasks.length > 0 ? `${openAgentTasks.length} active task${openAgentTasks.length === 1 ? '' : 's'}` : 'Queue is clear'}
          </StatusPill>
        </div>

        <div className="mt-5 space-y-4">
          {openAgentTasks.length > 0 ? (
            openAgentTasks.map((task) => (
              <div key={task.id} className="rounded-[1.7rem] border border-slate-200 bg-slate-50 p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap gap-2">
                      <StatusPill tone={task.risk === 'high' ? 'danger' : task.risk === 'medium' ? 'warning' : 'success'}>
                        {task.risk} risk
                      </StatusPill>
                      <StatusPill tone={task.status === 'approved' ? 'info' : task.status === 'running' ? 'warning' : 'success'}>
                        {task.status}
                      </StatusPill>
                      <StatusPill tone="info">{task.category}</StatusPill>
                    </div>
                    <p className="mt-3 text-lg font-extrabold text-slate-950">{task.title}</p>
                    <p className="mt-2 text-sm leading-7 text-slate-700">{task.detail}</p>
                    {task.note && <p className="mt-2 text-sm leading-6 text-slate-500">{task.note}</p>}
                  </div>
                  <button
                    onClick={() => openAgentTask(task)}
                    className="rounded-full border border-slate-200 bg-white px-4 py-2 text-[11px] font-black uppercase tracking-[0.18em] text-slate-600 transition hover:border-slate-300 hover:text-slate-900"
                  >
                    Open {task.targetTab}
                  </button>
                </div>

                <div className="mt-4 flex flex-wrap gap-2">
                  {task.status === 'suggested' && (
                    <button
                      onClick={() => approveAgentTask(task.id!)}
                      className="rounded-full border border-emerald-200 bg-emerald-50 px-4 py-2 text-[11px] font-black uppercase tracking-[0.18em] text-emerald-700 transition hover:bg-emerald-100"
                    >
                      Approve
                    </button>
                  )}
                  {(task.status === 'suggested' || task.status === 'approved') && (
                    <button
                      onClick={() => { void runAgentTask(task); }}
                      className="rounded-full bg-slate-950 px-4 py-2 text-[11px] font-black uppercase tracking-[0.18em] text-white transition hover:bg-slate-800"
                    >
                      {task.status === 'approved' ? 'Run now' : 'Run once'}
                    </button>
                  )}
                  {task.status !== 'running' && (
                    <button
                      onClick={() => deferAgentTask(task.id!)}
                      className="rounded-full border border-slate-200 bg-white px-4 py-2 text-[11px] font-black uppercase tracking-[0.18em] text-slate-600 transition hover:border-slate-300 hover:text-slate-900"
                    >
                      Defer
                    </button>
                  )}
                </div>
              </div>
            ))
          ) : (
            <EmptyState
              icon={<Bot className="h-6 w-6" />}
              title="No active agent tasks"
              subtitle="As new support, content, stock, and trend signals appear, Autopilot will queue them here."
              actions={(
                <>
                  <button
                    onClick={() => setActiveTab('studio')}
                    className="rounded-full bg-slate-950 px-4 py-2 text-xs font-semibold text-white transition hover:bg-slate-800"
                  >
                    Open Studio
                  </button>
                  <button
                    onClick={() => setActiveTab('growth')}
                    className="rounded-full border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 transition hover:border-slate-300 hover:text-slate-950"
                  >
                    Open Growth
                  </button>
                </>
              )}
            />
          )}
        </div>

        {recentAgentTasks.length > 0 && (
          <div className="mt-5 rounded-[1.7rem] border border-slate-200 bg-white p-5">
            <p className="text-[11px] font-black uppercase tracking-[0.22em] text-slate-500">Recent execution log</p>
            <div className="mt-3 space-y-3">
              {recentAgentTasks.map((task) => (
                <div key={task.id} className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-black text-slate-900">{task.title}</p>
                    <StatusPill tone={task.status === 'completed' ? 'success' : task.status === 'failed' ? 'danger' : 'info'}>
                      {task.status}
                    </StatusPill>
                  </div>
                  {task.note && <p className="mt-2 text-sm leading-6 text-slate-600">{task.note}</p>}
                </div>
              ))}
            </div>
          </div>
        )}
      </SectionCard>

      <div className="grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
        <SectionCard className="p-6">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-[11px] font-black uppercase tracking-[0.28em] text-amber-500">Action queue</p>
              <h3 className="mt-2 text-2xl font-extrabold tracking-tight text-slate-950">What deserves your next hour</h3>
            </div>
            <button
              onClick={pullBriefing}
              disabled={loadingBriefing}
              className="inline-flex items-center gap-2 rounded-full border border-slate-200 px-4 py-2 text-[11px] font-black uppercase tracking-[0.24em] text-slate-500 transition hover:border-slate-300 hover:text-slate-900 disabled:opacity-60"
            >
              {loadingBriefing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              Briefing
            </button>
          </div>

          <div className="mt-5 space-y-3">
            {metrics.actionQueue.map((item) => (
              <button
                key={item.id}
                onClick={() => openActionQueueItem(item)}
                className={cn(
                  'w-full rounded-[1.6rem] border p-4 text-left transition hover:-translate-y-0.5 hover:shadow-lg',
                  item.tone === 'danger' && 'border-rose-200 bg-rose-50',
                  item.tone === 'warning' && 'border-amber-200 bg-amber-50',
                  item.tone === 'info' && 'border-indigo-200 bg-indigo-50',
                  item.tone === 'success' && 'border-emerald-200 bg-emerald-50'
                )}
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-sm font-black text-slate-900">{item.title}</p>
                    <p className="mt-1 text-sm leading-6 text-slate-600">{item.detail}</p>
                  </div>
                  <span className="rounded-full bg-white/80 px-3 py-1 text-[11px] font-black uppercase tracking-[0.2em] text-slate-600">
                    {item.label}
                  </span>
                </div>
              </button>
            ))}
          </div>

          <div className="mt-6 rounded-[1.7rem] border border-slate-200 bg-slate-50 p-5">
            <p className="text-[11px] font-black uppercase tracking-[0.26em] text-slate-500">Daily brief</p>
            {briefing ? (
              <p className="mt-4 whitespace-pre-line text-sm leading-7 text-slate-700">{briefing}</p>
            ) : (
              <p className="mt-4 text-sm leading-7 text-slate-500">
                Generate a quick brief to prioritize support, stock, and content.
              </p>
            )}
          </div>
        </SectionCard>

        <SectionCard className="p-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-[11px] font-black uppercase tracking-[0.28em] text-amber-500">Operator radar</p>
              <h3 className="mt-2 text-2xl font-extrabold tracking-tight text-slate-950">Your near-term runway</h3>
            </div>
            <div className="flex items-center gap-2 rounded-full bg-slate-100 px-3 py-2 text-[11px] font-black uppercase tracking-[0.24em] text-slate-500">
              <TrendingUp className="h-3.5 w-3.5 text-amber-500" />
              Trend score {metrics.averageTrendScore || 'n/a'}
            </div>
          </div>

          <div className="mt-5 grid gap-4 md:grid-cols-2">
            <div className="rounded-[1.6rem] border border-slate-200 bg-white p-5">
              <p className="text-[11px] font-black uppercase tracking-[0.24em] text-slate-500">Next scheduled posts</p>
              <div className="mt-4 space-y-3">
                {metrics.upcomingPosts.slice(0, 4).length === 0 ? (
                  <EmptyState
                    icon={<Calendar className="h-6 w-6" />}
                    title="No content queued"
                    subtitle="Build a campaign pack in the Studio tab and push it into the queue."
                    actions={(
                      <>
                        <button
                          onClick={() => setActiveTab('studio')}
                          className="rounded-full bg-slate-950 px-4 py-2 text-xs font-semibold text-white transition hover:bg-slate-800"
                        >
                          Open Studio
                        </button>
                        <button
                          onClick={() => setActiveTab('launchpad')}
                          className="rounded-full border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 transition hover:border-slate-300 hover:text-slate-950"
                        >
                          Check setup
                        </button>
                      </>
                    )}
                  />
                ) : (
                  metrics.upcomingPosts.slice(0, 4).map((post) => (
                    <div key={post.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2">
                          <span className={cn('h-2.5 w-2.5 rounded-full', PLATFORM_COLORS[post.platform])} />
                          <span className="text-[11px] font-black uppercase tracking-[0.22em] text-slate-500">{post.platform}</span>
                        </div>
                        <span className="text-[11px] font-bold text-slate-500">{formatDate(post.scheduledAt, 'MMM d, h:mm a')}</span>
                      </div>
                      <p className="mt-3 line-clamp-2 text-sm font-medium leading-6 text-slate-700">{post.content}</p>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="rounded-[1.6rem] border border-slate-200 bg-white p-5">
              <div className="flex items-center justify-between gap-3">
                <p className="text-[11px] font-black uppercase tracking-[0.24em] text-slate-500">Opportunity scan</p>
                <StatusPill tone="info">Directional AI</StatusPill>
              </div>
              <div className="mt-4 flex gap-3">
                <input
                  value={trendKeyword}
                  onChange={(event) => setTrendKeyword(event.target.value)}
                  onKeyDown={(event) => event.key === 'Enter' && runTrendScan()}
                  placeholder="Try: bridal keepsakes, farmhouse decor, herbal apothecary..."
                  className="w-full rounded-full border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-medium text-slate-700"
                />
                <button
                  onClick={runTrendScan}
                  disabled={analyzingTrend || !trendKeyword.trim()}
                  className="inline-flex items-center gap-2 rounded-full bg-slate-950 px-5 py-3 text-xs font-black uppercase tracking-[0.22em] text-white transition hover:bg-slate-800 disabled:opacity-60"
                >
                  {analyzingTrend ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                  Scan
                </button>
              </div>

              <div className="mt-5 space-y-3">
                {trends.slice(0, 3).length === 0 ? (
                  <EmptyState
                    icon={<TrendingUp className="h-6 w-6" />}
                    title="No opportunity scans yet"
                    subtitle="Directional scans give the product and marketing tabs something specific to work with."
                    actions={(
                      <>
                        <button
                          onClick={() => setActiveTab('growth')}
                          className="rounded-full bg-slate-950 px-4 py-2 text-xs font-semibold text-white transition hover:bg-slate-800"
                        >
                          Open Growth
                        </button>
                        <button
                          onClick={() => setActiveTab('launchpad')}
                          className="rounded-full border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 transition hover:border-slate-300 hover:text-slate-950"
                        >
                          Check setup
                        </button>
                      </>
                    )}
                  />
                ) : (
                  trends.slice(0, 3).map((trend) => (
                    <div key={trend.id} className="rounded-2xl border border-amber-100 bg-amber-50 p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-black text-slate-900">{trend.keyword}</p>
                          <p className="mt-1 text-xs font-bold uppercase tracking-[0.2em] text-amber-700">
                            {trend.competitionLevel || 'medium'} competition
                          </p>
                        </div>
                        <span className="text-2xl font-black text-slate-900">{trend.popularityScore}</span>
                      </div>
                      <p className="mt-3 text-sm leading-6 text-slate-700">{trend.analysis}</p>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </SectionCard>
      </div>

      <SectionCard className="p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-[11px] font-black uppercase tracking-[0.28em] text-amber-500">Shop profile</p>
            <h3 className="mt-2 text-2xl font-extrabold tracking-tight text-slate-950">Keep the workspace accurate</h3>
          </div>
          <button
            onClick={() => saveProfile(profileDraft)}
            disabled={savingProfile}
            className="inline-flex items-center gap-2 rounded-full bg-slate-950 px-5 py-3 text-xs font-black uppercase tracking-[0.22em] text-white transition hover:bg-slate-800 disabled:opacity-60"
          >
            {savingProfile ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
            Save profile
          </button>
        </div>

        <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <ProfileField label="Shop name" value={profileDraft.shopName} onChange={(value) => setProfileDraft((current) => ({ ...current, shopName: value }))} placeholder="Sage Meadow Studio" />
          <ProfileField label="Etsy shop URL" value={profileDraft.etsyShopUrl} onChange={(value) => setProfileDraft((current) => ({ ...current, etsyShopUrl: value }))} placeholder="https://www.etsy.com/shop/PipersPress" />
          <ProfileField label="Niche" value={profileDraft.niche} onChange={(value) => setProfileDraft((current) => ({ ...current, niche: value }))} placeholder="Botanical home decor" />
          <ProfileField label="Ideal customer" value={profileDraft.idealCustomer} onChange={(value) => setProfileDraft((current) => ({ ...current, idealCustomer: value }))} placeholder="Gift-minded women 28-45 who like slow living aesthetics" />
          <ProfileField label="Brand tone" value={profileDraft.brandTone} onChange={(value) => setProfileDraft((current) => ({ ...current, brandTone: value }))} placeholder="Warm, modern, trustworthy, handmade" />
          <ProfileField label="Focus product" value={profileDraft.focusProduct} onChange={(value) => setProfileDraft((current) => ({ ...current, focusProduct: value }))} placeholder="Pressed-flower keepsake frame" />
          <ProfileField label="Instagram handle" value={profileDraft.instagramHandle} onChange={(value) => setProfileDraft((current) => ({ ...current, instagramHandle: value }))} placeholder="@sage.meadow.studio" />
          <ProfileField
            label="Weekly revenue goal"
            value={String(profileDraft.weeklyRevenueGoal)}
            onChange={(value) => setProfileDraft((current) => ({ ...current, weeklyRevenueGoal: Number(value) || 0 }))}
            placeholder="750"
            type="number"
          />
          <ProfileField
            label="Monthly revenue goal"
            value={String(profileDraft.monthlyRevenueGoal)}
            onChange={(value) => setProfileDraft((current) => ({ ...current, monthlyRevenueGoal: Number(value) || 0 }))}
            placeholder="3000"
            type="number"
          />
          <ProfileField
            label="Shipping lead time (days)"
            value={String(profileDraft.shippingLeadTimeDays)}
            onChange={(value) => setProfileDraft((current) => ({ ...current, shippingLeadTimeDays: clampNonNegativeInteger(parseIntegerInput(value)) }))}
            placeholder="5"
            type="number"
          />
        </div>
      </SectionCard>
    </motion.div>
  );
}
