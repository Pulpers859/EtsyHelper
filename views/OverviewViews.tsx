import React, { useMemo, useState } from 'react';
import { format } from 'date-fns';
import { motion } from 'framer-motion';
import {
  Calendar,
  ExternalLink,
  Globe,
  HeartHandshake,
  Instagram,
  ShieldCheck,
  Sparkles,
  Target,
  TrendingUp
} from 'lucide-react';

import { cn } from '../lib/utils';
import { generateWeeklyMarketingPlan, type WeeklyMarketingPlan } from '../services/gemini';
import {
  AppCapabilities,
  ConnectedAccounts,
  DerivedMetrics,
  EtsyLiveSyncResponse,
  formatDate,
  PLATFORM_COLORS,
  ShopProfile,
  toDate,
  type Toast
} from '../app/core';
import { ConnectorCard, EmptyState, LaunchItem, MetricCard, RoadmapLine, SectionCard, StatusPill, UrlCard } from '../components/shell';
import type { CustomerInteraction, EtsyAnalyticsSnapshot, InventoryItem, SocialPost, TrendAnalysis } from '../types';

type GrowthViewProps = {
  inventory: InventoryItem[];
  posts: SocialPost[];
  interactions: CustomerInteraction[];
  trends: TrendAnalysis[];
  metrics: DerivedMetrics;
  shopProfile: ShopProfile;
  etsyAnalytics: EtsyAnalyticsSnapshot;
  showToast: (message: string, type?: Toast['type']) => void;
};

export function GrowthView({
  inventory,
  posts,
  interactions,
  trends,
  metrics,
  shopProfile,
  etsyAnalytics,
  showToast
}: GrowthViewProps) {
  const postedCount = posts.filter((post) => post.status === 'posted').length;
  const totalEngagement = posts.reduce((sum, post) => sum + (post.engagement?.likes || 0) + (post.engagement?.shares || 0) + (post.engagement?.comments || 0), 0);
  const responseDrafts = interactions.filter((interaction) => !!interaction.response).length;

  const platformBreakdown = useMemo(() => {
    const map: Partial<Record<SocialPost['platform'], number>> = {};
    posts.forEach((post) => {
      map[post.platform] = (map[post.platform] || 0) + 1;
    });
    return Object.entries(map) as Array<[SocialPost['platform'], number]>;
  }, [posts]);

  const hasConnectedEtsy = etsyAnalytics.mode === 'live_etsy';
  const hasDetailedListingTelemetry =
    hasConnectedEtsy &&
    etsyAnalytics.listingMetrics.some((item) =>
      [item.views30d, item.favorites30d, item.orders30d, item.revenue30d].some((value) => typeof value === 'number')
    );
  const topLiveListings = [...etsyAnalytics.listingMetrics]
    .sort((left, right) => (right.revenue30d || 0) - (left.revenue30d || 0) || (right.orders30d || 0) - (left.orders30d || 0))
    .slice(0, 3);
  const syncedAtDate = etsyAnalytics.syncedAt ? toDate(etsyAnalytics.syncedAt) : null;
  const [weeklyPlan, setWeeklyPlan] = useState<WeeklyMarketingPlan | null>(null);
  const [generatingWeeklyPlan, setGeneratingWeeklyPlan] = useState(false);

  const buildWeeklyPlan = async () => {
    setGeneratingWeeklyPlan(true);
    try {
      const plan = await generateWeeklyMarketingPlan({
        shopName: shopProfile.shopName || 'Your Etsy shop',
        niche: shopProfile.niche,
        focusProduct: shopProfile.focusProduct,
        monthlyRevenueGoal: shopProfile.monthlyRevenueGoal,
        liveRevenue30d: etsyAnalytics.shopRevenue30d,
        queuedPostCount: metrics.scheduledPosts.length,
        lowStockItems: metrics.lowStockItems.slice(0, 3).map((item) => item.name),
        urgentConversations: metrics.pendingReplies.filter((item) => item.priority === 'urgent').slice(0, 3).map((item) => item.customerName),
        trendKeywords: trends.slice(0, 5).map((trend) => trend.keyword),
        topListings: topLiveListings.map((listing) => listing.title)
      });
      setWeeklyPlan(plan);
      showToast('Weekly plan generated', 'success');
    } catch (error) {
      console.error('Weekly plan generation failed:', error);
      showToast('Unable to build the weekly plan right now', 'error');
    } finally {
      setGeneratingWeeklyPlan(false);
    }
  };

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="space-y-6">
      <SectionCard className="p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-[11px] font-black uppercase tracking-[0.28em] text-amber-500">Growth</p>
            <h2 className="mt-2 text-3xl font-extrabold tracking-tight text-slate-950">Growth overview</h2>
          </div>
          <StatusPill tone={metrics.readinessScore >= 75 ? 'success' : 'warning'}>
            {metrics.readinessScore >= 75 ? 'Ready for scale moves' : 'Tighten operations first'}
          </StatusPill>
        </div>

        <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <MetricCard title="Operator score" value={`${metrics.readinessScore}%`} detail={`${shopProfile.shopName || 'Your shop'} setup strength`} icon={<Target className="h-5 w-5" />} accent="indigo" />
          <MetricCard title="Response draft rate" value={`${interactions.length ? Math.round((responseDrafts / interactions.length) * 100) : 0}%`} detail="How often the inbox has a prepared answer" icon={<HeartHandshake className="h-5 w-5" />} accent="rose" />
          <MetricCard title="Engagement total" value={totalEngagement} detail={`${postedCount} posts marked as published`} icon={<Sparkles className="h-5 w-5" />} accent="emerald" />
          <MetricCard title="Trend pressure" value={metrics.averageTrendScore || 0} detail="Directional demand strength across saved scans" icon={<TrendingUp className="h-5 w-5" />} accent="amber" />
        </div>
      </SectionCard>

      <div className="grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
        <SectionCard className="p-6">
          <p className="text-[11px] font-black uppercase tracking-[0.28em] text-amber-500">Content mix</p>
          <h3 className="mt-2 text-2xl font-extrabold tracking-tight text-slate-950">Where your content energy is going</h3>
          <div className="mt-5 space-y-4">
            {platformBreakdown.length === 0 ? (
              <EmptyState icon={<Calendar className="h-6 w-6" />} title="No content data yet" subtitle="Queue or post content in the Studio tab to populate the mix." />
            ) : (
              platformBreakdown.map(([platform, count]) => (
                <div key={platform}>
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-sm font-black capitalize text-slate-900">{platform}</span>
                    <span className="text-sm font-bold text-slate-500">{count}</span>
                  </div>
                  <div className="h-3 overflow-hidden rounded-full bg-slate-100">
                    <div className={cn('h-full rounded-full', PLATFORM_COLORS[platform])} style={{ width: `${Math.max((count / posts.length) * 100, 8)}%` }} />
                  </div>
                </div>
              ))
            )}
          </div>

        </SectionCard>

        <SectionCard className="p-6">
          <p className="text-[11px] font-black uppercase tracking-[0.28em] text-amber-500">Opportunity board</p>
          <h3 className="mt-2 text-2xl font-extrabold tracking-tight text-slate-950">Where growth may come from next</h3>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <StatusPill tone={hasConnectedEtsy ? 'success' : 'warning'}>
              {hasConnectedEtsy ? 'Live Etsy connection' : 'Directional intelligence'}
            </StatusPill>
            <StatusPill tone="info">
              {syncedAtDate ? `Synced ${format(syncedAtDate, 'MMM d, h:mm a')}` : 'No Etsy sync timestamp yet'}
            </StatusPill>
          </div>

          <div className="mt-5 space-y-3">
            {hasConnectedEtsy ? (
              topLiveListings.length === 0 ? (
                <EmptyState icon={<TrendingUp className="h-6 w-6" />} title="No live listings returned yet" subtitle="Sync Etsy from the header to pull your listing data." />
              ) : (
                topLiveListings.map((listing) => (
                  <div key={listing.listingId} className="flex items-center justify-between gap-4 rounded-[1.5rem] border border-slate-200 bg-white p-4">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-black text-slate-950">{listing.title}</p>
                      <p className="mt-1 text-xs font-semibold text-slate-500">
                        {hasDetailedListingTelemetry
                          ? `${listing.views30d || 0} views • ${listing.favorites30d || 0} fav • ${listing.orders30d || 0} orders${typeof listing.conversionRate === 'number' ? ` • ${listing.conversionRate.toFixed(1)}% conv` : ''}`
                          : `${listing.orders30d || 0} orders tracked`}
                      </p>
                    </div>
                    <p className="text-lg font-black text-slate-950">
                      {typeof listing.revenue30d === 'number'
                        ? `$${listing.revenue30d.toFixed(0)}`
                        : typeof listing.price === 'number'
                          ? `$${listing.price.toFixed(2)}`
                          : '--'}
                    </p>
                  </div>
                ))
              )
            ) : (
              trends.slice(0, 3).length === 0 ? (
                <EmptyState icon={<TrendingUp className="h-6 w-6" />} title="No trend scans saved yet" subtitle="Run an opportunity scan from the Command Center to populate growth signals." />
              ) : (
                trends.slice(0, 3).map((trend) => (
                  <div key={trend.id} className="rounded-[1.5rem] border border-amber-100 bg-amber-50 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-black text-slate-950">{trend.keyword}</p>
                      <span className="text-lg font-black text-slate-950">{trend.popularityScore}</span>
                    </div>
                    <p className="mt-2 text-sm leading-6 text-slate-700">{trend.analysis}</p>
                  </div>
                ))
              )
            )}
          </div>
        </SectionCard>
      </div>

      <SectionCard className="p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-[11px] font-black uppercase tracking-[0.28em] text-amber-500">Weekly plan</p>
            <h3 className="mt-2 text-2xl font-extrabold tracking-tight text-slate-950">Build the next seven days</h3>
          </div>
          <button
            onClick={() => void buildWeeklyPlan()}
            disabled={generatingWeeklyPlan}
            className="inline-flex items-center gap-2 rounded-full bg-slate-950 px-5 py-3 text-[11px] font-black uppercase tracking-[0.22em] text-white transition hover:bg-slate-800 disabled:opacity-60"
          >
            {generatingWeeklyPlan ? <Calendar className="h-4 w-4 animate-pulse" /> : <Sparkles className="h-4 w-4" />}
            {generatingWeeklyPlan ? 'Building plan...' : 'Build weekly plan'}
          </button>
        </div>

        {weeklyPlan ? (
          <div className="mt-5 space-y-4">
            <div className="rounded-[1.7rem] border border-amber-100 bg-amber-50 p-5">
              <p className="text-[11px] font-black uppercase tracking-[0.22em] text-amber-700">{weeklyPlan.headline}</p>
              <p className="mt-3 text-lg font-extrabold text-slate-950">{weeklyPlan.primaryFocus}</p>
              <p className="mt-3 text-sm leading-7 text-slate-700">{weeklyPlan.weeklyGoal}</p>
            </div>

            <div className="grid gap-4 lg:grid-cols-3">
              <div className="rounded-[1.7rem] border border-slate-200 bg-slate-50 p-5">
                <p className="text-[11px] font-black uppercase tracking-[0.22em] text-slate-500">Content</p>
                <div className="mt-3 space-y-2">
                  {weeklyPlan.contentMoves.map((move) => (
                    <p key={move} className="text-sm leading-6 text-slate-700">• {move}</p>
                  ))}
                </div>
              </div>
              <div className="rounded-[1.7rem] border border-slate-200 bg-slate-50 p-5">
                <p className="text-[11px] font-black uppercase tracking-[0.22em] text-slate-500">Listings and merch</p>
                <div className="mt-3 space-y-2">
                  {weeklyPlan.merchandisingMoves.map((move) => (
                    <p key={move} className="text-sm leading-6 text-slate-700">• {move}</p>
                  ))}
                </div>
              </div>
              <div className="rounded-[1.7rem] border border-slate-200 bg-slate-50 p-5">
                <p className="text-[11px] font-black uppercase tracking-[0.22em] text-slate-500">Support and checkpoints</p>
                <div className="mt-3 space-y-2">
                  {weeklyPlan.supportMoves.map((move) => (
                    <p key={move} className="text-sm leading-6 text-slate-700">• {move}</p>
                  ))}
                  <div className="pt-2">
                    {weeklyPlan.checkpoints.map((checkpoint) => (
                      <p key={checkpoint} className="text-sm leading-6 text-slate-500">- {checkpoint}</p>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="mt-5">
            <EmptyState
              icon={<Target className="h-6 w-6" />}
              title="No weekly plan yet"
              subtitle="Build a seven-day plan from live Etsy data, current stock pressure, queued posts, and recent trend signals."
            />
          </div>
        )}
      </SectionCard>
    </motion.div>
  );
}

type LaunchpadViewProps = {
  connectedAccounts: ConnectedAccounts;
  appCapabilities: AppCapabilities;
  aiConfigured: boolean;
  shopProfile: ShopProfile;
  saveProfile: (profile: ShopProfile, successMessage?: string) => Promise<void>;
  showToast: (message: string, type?: Toast['type']) => void;
  syncConnectedEtsy: (options?: { silent?: boolean }) => Promise<EtsyLiveSyncResponse | void>;
};

export function LaunchpadView({
  connectedAccounts,
  appCapabilities,
  aiConfigured,
  shopProfile,
  saveProfile,
  showToast,
  syncConnectedEtsy
}: LaunchpadViewProps) {
  const [copyState, setCopyState] = useState<string | null>(null);
  const [syncingEtsy, setSyncingEtsy] = useState(false);
  const origin = window.location.origin;

  const copyToClipboard = async (value: string, key: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopyState(key);
      window.setTimeout(() => setCopyState(null), 1800);
    } catch (error) {
      console.error('Clipboard copy failed:', error);
      showToast('Clipboard access failed in this browser tab', 'error');
    }
  };

  const connectProvider = async (provider: 'etsy' | 'instagram') => {
    const capability = provider === 'etsy' ? appCapabilities.etsy : appCapabilities.instagram;
    if (!capability.canConnect) {
      showToast(capability.reason || `${provider} is not configured yet`, 'error');
      return;
    }

    try {
      const response = await fetch(`/api/auth/url/${provider}`);
      const payload = await response.json();
      if (!response.ok || !payload.url) {
        throw new Error(payload.error || 'No authorization URL available');
      }

      const width = 680;
      const height = 760;
      const popup = window.open(
        payload.url,
        `${provider}_oauth`,
        `width=${width},height=${height},left=${window.innerWidth / 2 - width / 2},top=${window.innerHeight / 2 - height / 2}`
      );
      if (!popup) {
        throw new Error('Popup blocked');
      }
    } catch (error) {
      console.error('OAuth launch failed:', error);
      showToast(`Unable to start ${provider} authorization${error instanceof Error && error.message === 'Popup blocked' ? ' because the popup was blocked' : ''}`, 'error');
    }
  };

  const setApplicationStatus = async (status: ShopProfile['etsyApplicationStatus']) => {
    await saveProfile({ ...shopProfile, etsyApplicationStatus: status }, 'Application status updated');
  };

  const syncEtsyNow = async () => {
    setSyncingEtsy(true);
    try {
      await syncConnectedEtsy();
    } catch (error) {
      console.error('Manual Etsy sync failed:', error);
      showToast(error instanceof Error && error.message.trim() ? error.message : 'Unable to sync live Etsy data right now', 'error');
    } finally {
      setSyncingEtsy(false);
    }
  };

  const etsyConnectBlocked = !appCapabilities.etsy.canConnect;
  const instagramConnectBlocked = !appCapabilities.instagram.canConnect;
  const instagramDirectReady = connectedAccounts.instagram && !!appCapabilities.instagram.directPublishing;
  const etsyStatus = connectedAccounts.etsy
    ? 'Connected'
    : etsyConnectBlocked
      ? 'Config required'
      : shopProfile.etsyApplicationStatus === 'under_review'
        ? 'Under review'
        : 'Not connected';
  const instagramStatus = connectedAccounts.instagram
    ? 'Connected'
    : instagramConnectBlocked
      ? 'Config required'
      : 'Ready to connect';

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="space-y-6">
      <SectionCard className="overflow-hidden bg-slate-950 p-8 text-white">
        <div className="grid gap-6 lg:grid-cols-[1.08fr_0.92fr]">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-[11px] font-black uppercase tracking-[0.28em] text-amber-300">
              <ShieldCheck className="h-3.5 w-3.5" />
              Launchpad
            </div>
            <h2 className="mt-5 text-3xl font-extrabold tracking-tight">Set up your live connections.</h2>
            <p className="mt-4 text-sm leading-7 text-slate-300">
              Connect Etsy, check sync status, and keep callback details close by while you finish setup.
            </p>
          </div>

          <div className="rounded-[1.8rem] border border-white/10 bg-white/5 p-5">
            <p className="text-[11px] font-black uppercase tracking-[0.22em] text-slate-400">Etsy access</p>
            <div className="mt-4 flex flex-wrap gap-3">
              {(['not_started', 'under_review', 'connected'] as const).map((status) => (
                <button
                  key={status}
                  onClick={() => setApplicationStatus(status)}
                  className={cn(
                    'rounded-full px-4 py-2 text-[11px] font-black uppercase tracking-[0.2em] transition',
                    shopProfile.etsyApplicationStatus === status ? 'bg-amber-400 text-slate-950' : 'border border-white/10 bg-white/5 text-slate-300'
                  )}
                >
                  {status.replace('_', ' ')}
                </button>
              ))}
            </div>
            <p className="mt-4 text-sm leading-7 text-slate-300">
              Use this status to keep the connection state accurate inside the app.
            </p>
          </div>
        </div>
      </SectionCard>

      <SectionCard className="p-6">
        <p className="text-[11px] font-black uppercase tracking-[0.28em] text-amber-500">Connection status</p>
        <h3 className="mt-2 text-2xl font-extrabold tracking-tight text-slate-950">What is active right now</h3>
        <div className="mt-5 grid gap-4 md:grid-cols-3">
          <LaunchItem
            title={aiConfigured ? 'AI drafting is ready' : 'AI drafting is in fallback mode'}
            text={aiConfigured
              ? 'Campaign packs, reply drafts, descriptions, and planning prompts can use Gemini directly.'
              : 'The app still works, but AI actions use simpler fallback behavior until a Gemini key is present.'}
          />
          <LaunchItem
            title={connectedAccounts.etsy ? 'Etsy sync is live' : 'Etsy sync is not connected'}
            text={connectedAccounts.etsy
              ? 'Listings, inventory, and order-linked inbox items can sync from Etsy into the workspace.'
              : etsyConnectBlocked
                ? appCapabilities.etsy.reason || 'The Etsy connection cannot start until the backend configuration is finished.'
                : 'Planning and imports still work, but live Etsy sync needs a successful shop connection.'}
          />
          <LaunchItem
            title={instagramDirectReady ? 'Instagram publishing is connected' : 'Instagram publishing is not connected'}
            text={instagramDirectReady
              ? 'Image posts with public https assets can publish straight from the Studio queue, and failed posts stay visible with the retry error.'
              : instagramConnectBlocked
                ? appCapabilities.instagram.reason || 'Instagram direct publishing is blocked until OAuth configuration is finished.'
                : 'The direct publishing path is wired, but it still needs a successful Instagram connection.'}
          />
        </div>
      </SectionCard>

      <div className="grid gap-6 xl:grid-cols-[1fr_1fr]">
        <ConnectorCard
          title="Etsy marketplace"
          description="Connect Etsy for live listings, orders, customer context, and inventory sync."
          tone="amber"
          status={etsyStatus}
          buttonLabel={connectedAccounts.etsy ? (syncingEtsy ? 'Syncing Etsy...' : 'Sync Etsy now') : etsyConnectBlocked ? 'Needs config' : 'Connect Etsy'}
          onClick={() => connectedAccounts.etsy ? syncEtsyNow() : connectProvider('etsy')}
          disabled={syncingEtsy || etsyConnectBlocked}
          footnote={etsyConnectBlocked ? appCapabilities.etsy.reason : shopProfile.etsyApplicationStatus === 'under_review' ? 'Your app review can stay under review while the rest of the workspace is still useful.' : undefined}
          icon={<Globe className="h-8 w-8" />}
        />

        <ConnectorCard
          title="Instagram"
          description="Connect Instagram so queued image posts can publish directly instead of falling back to manual handoff."
          tone="rose"
          status={instagramStatus}
          buttonLabel={connectedAccounts.instagram ? 'Reconnect Instagram' : instagramConnectBlocked ? 'Needs config' : 'Connect Instagram'}
          onClick={() => connectProvider('instagram')}
          disabled={instagramConnectBlocked}
          footnote={instagramConnectBlocked ? appCapabilities.instagram.reason : 'Only Instagram image posts with public https URLs can publish direct today. Failed posts remain in the queue until you retry them.'}
          icon={<Instagram className="h-8 w-8" />}
        />
      </div>

      <SectionCard className="p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-[11px] font-black uppercase tracking-[0.28em] text-amber-500">Callback URLs</p>
            <h3 className="mt-2 text-2xl font-extrabold tracking-tight text-slate-950">Setup links</h3>
          </div>
          <div className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-4 py-2 text-[11px] font-black uppercase tracking-[0.22em] text-emerald-700">
            <ShieldCheck className="h-3.5 w-3.5" />
            App setup
          </div>
        </div>

        <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <UrlCard label="Base URL" value={origin} copied={copyState === 'base'} onCopy={() => copyToClipboard(origin, 'base')} />
          <UrlCard label="Etsy callback" value={`${origin}/auth/callback/etsy`} copied={copyState === 'etsy'} onCopy={() => copyToClipboard(`${origin}/auth/callback/etsy`, 'etsy')} />
          <UrlCard label="Instagram callback" value={`${origin}/auth/callback/instagram`} copied={copyState === 'instagram'} onCopy={() => copyToClipboard(`${origin}/auth/callback/instagram`, 'instagram')} />
        </div>

        <div className="mt-5 flex flex-wrap gap-4">
          <a href="https://www.etsy.com/developers/api" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 text-[11px] font-black uppercase tracking-[0.22em] text-slate-600 transition hover:border-slate-300 hover:text-slate-950">
            Etsy developer console
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
          <a href="https://developers.facebook.com/" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 text-[11px] font-black uppercase tracking-[0.22em] text-slate-600 transition hover:border-slate-300 hover:text-slate-950">
            Meta developer console
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        </div>
      </SectionCard>
    </motion.div>
  );
}
