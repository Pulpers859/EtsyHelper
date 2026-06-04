import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  ArrowUp,
  BarChart3,
  Bot,
  CheckCircle2,
  HeartHandshake,
  LayoutDashboard,
  Loader2,
  Menu,
  MessageSquare,
  Package,
  RefreshCw,
  Settings,
  ShieldCheck,
  Sparkles,
  Store,
  X
} from 'lucide-react';
import { auth, db } from './lib/firebase';
import {
  GoogleAuthProvider,
  User,
  onAuthStateChanged,
  signInWithRedirect,
  signInWithPopup,
  signOut
} from 'firebase/auth';
import {
  addDoc,
  collection,
  doc,
  getDoc,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where
} from 'firebase/firestore';
import { motion, AnimatePresence } from 'framer-motion';
import Markdown from 'react-markdown';
import { cn } from './lib/utils';
import {
  AvatarBadge,
  PreviewCard,
  RoadmapLine,
  SectionCard,
  StatusPill
} from './components/shell';
import {
  aiConfigured,
  agentChat,
  analyzeTrends,
  generateCampaignPack,
  suggestResponse
} from './services/gemini';
import {
  AgentTask,
  CustomerInteraction,
  InventoryItem,
  SocialPost,
  TrendAnalysis
} from './types';
import {
  AppCapabilities,
  ActionQueueItem,
  buildProfileFromEtsySync,
  formatDate,
  ConnectedAccounts,
  createLocalInteractionFromEtsy,
  createLocalInventoryFromEtsy,
  DEFAULT_APP_CAPABILITIES,
  AUTO_PUBLISH_RETRY_COOLDOWN_MS,
  DEFAULT_ETSY_ANALYTICS,
  DEFAULT_PROFILE,
  DerivedMetrics,
  EtsyAnalyticsSnapshot,
  EtsyListingPushPatch,
  EtsyLiveSyncResponse,
  getOwnerScopedEtsyInventoryDocId,
  getOwnerScopedEtsyReceiptDocId,
  getProfileFromDoc,
  ShopProfile,
  mergeInteractionRecords,
  mergeInventoryRecords,
  isPostDue,
  isPostOverdue,
  isPublishRetryCoolingDown,
  isPublicImageUrl,
  parseBestTimeWithOffset,
  sanitizeEtsyInventoryForFirestore,
  sanitizeEtsyReceiptForFirestore,
  sortByDateField,
  sortByScheduledDate,
  Tab,
  Toast,
  toDate,
  toPersistedUserProfile,
  WorkflowFocus
} from './app/core';
import {
  DEMO_CONNECTED_ACCOUNTS,
  DEMO_ETSY_ANALYTICS,
  DEMO_INTERACTIONS,
  DEMO_INVENTORY,
  DEMO_MODE_QUERY_PARAM,
  DEMO_POSTS,
  DEMO_SHOP_PROFILE,
  DEMO_TRENDS,
  DEMO_USER,
  isDemoModeEnabled
} from './app/demo';
import {
  LOCAL_WORKSPACE_EVENT,
  LOCAL_WORKSPACE_USER,
  isLocalWorkspaceUser,
  patchLocalBucketRecord,
  readLocalBucket,
  upsertLocalBucketRecord,
  writeLocalBucket
} from './app/localWorkspace';
import CommandCenterView from './views/CommandCenterView';
import CatalogView from './views/CatalogView';
import CustomersView from './views/CustomersView';
import StudioView from './views/StudioView';
import { GrowthView, LaunchpadView } from './views/OverviewViews';

const TAB_META: Array<{ key: Tab; label: string; icon: React.ReactNode }> = [
  { key: 'command', label: 'Command', icon: <LayoutDashboard className="w-4 h-4" /> },
  { key: 'studio', label: 'Studio', icon: <Sparkles className="w-4 h-4" /> },
  { key: 'customers', label: 'Inbox', icon: <MessageSquare className="w-4 h-4" /> },
  { key: 'catalog', label: 'Catalog', icon: <Package className="w-4 h-4" /> },
  { key: 'growth', label: 'Growth', icon: <BarChart3 className="w-4 h-4" /> },
  { key: 'launchpad', label: 'Launchpad', icon: <Settings className="w-4 h-4" /> }
];

type WorkflowFocusInput =
  | Omit<Extract<WorkflowFocus, { tab: 'command' }>, 'token'>
  | Omit<Extract<WorkflowFocus, { tab: 'studio' }>, 'token'>
  | Omit<Extract<WorkflowFocus, { tab: 'customers' }>, 'token'>
  | Omit<Extract<WorkflowFocus, { tab: 'catalog' }>, 'token'>
  | Omit<Extract<WorkflowFocus, { tab: 'growth' }>, 'token'>
  | Omit<Extract<WorkflowFocus, { tab: 'launchpad' }>, 'token'>;

export default function App() {
  const isDemoMode = useMemo(
    () => typeof window !== 'undefined' && isDemoModeEnabled(window.location.search),
    []
  );
  const forceLoginRequested = useMemo(
    () => typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('forceLogin') === '1',
    []
  );
  const localWorkspaceMode = useMemo(() => {
    if (typeof window === 'undefined' || forceLoginRequested) return false;
    return ['localhost', '127.0.0.1', '::1'].includes(window.location.hostname);
  }, [forceLoginRequested]);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<Tab>('command');
  const [workflowFocus, setWorkflowFocus] = useState<WorkflowFocus | null>(null);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [agentOpen, setAgentOpen] = useState(false);
  const [toast, setToast] = useState<Toast | null>(null);
  const [savingProfile, setSavingProfile] = useState(false);
  const [appCapabilities, setAppCapabilities] = useState<AppCapabilities>(DEFAULT_APP_CAPABILITIES);

  const [connectedAccounts, setConnectedAccounts] = useState<ConnectedAccounts>({ etsy: false, instagram: false });
  const [shopProfile, setShopProfile] = useState<ShopProfile>(DEFAULT_PROFILE);
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [inventoryFallback, setInventoryFallback] = useState<InventoryItem[]>([]);
  const [posts, setPosts] = useState<SocialPost[]>([]);
  const [interactions, setInteractions] = useState<CustomerInteraction[]>([]);
  const [interactionFallback, setInteractionFallback] = useState<CustomerInteraction[]>([]);
  const [trends, setTrends] = useState<TrendAnalysis[]>([]);
  const [agentTasks, setAgentTasks] = useState<AgentTask[]>([]);
  const [etsyAnalytics, setEtsyAnalytics] = useState<EtsyAnalyticsSnapshot>(DEFAULT_ETSY_ANALYTICS);
  const etsyBootstrapAttemptedRef = useRef(false);
  const publishingPostIdsRef = useRef<Set<string>>(new Set());
  const connectedAccountsRef = useRef(connectedAccounts);
  const shopProfileRef = useRef(shopProfile);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    connectedAccountsRef.current = connectedAccounts;
  }, [connectedAccounts]);

  useEffect(() => {
    shopProfileRef.current = shopProfile;
  }, [shopProfile]);

  const showToast = (message: string, type: Toast['type'] = 'success') => {
    setToast({ message, type });
    window.setTimeout(() => setToast(null), 3000);
  };

  const openWorkflow = (focus: WorkflowFocusInput) => {
    setWorkflowFocus({
      ...focus,
      token: Date.now()
    } as WorkflowFocus);
    setActiveTab(focus.tab);
    setMobileNavOpen(false);
  };

  const navigateToTab = (tab: Tab) => {
    setWorkflowFocus(null);
    setActiveTab(tab);
    setMobileNavOpen(false);
  };

  const getReadableErrorMessage = (error: unknown, fallback: string) => {
    if (error instanceof Error && error.message.trim()) {
      return error.message;
    }
    return fallback;
  };

  const getInventoryCacheKey = (ownerId: string) => `etsyhelper:etsy-sync:${ownerId}:inventory`;
  const getInteractionCacheKey = (ownerId: string) => `etsyhelper:etsy-sync:${ownerId}:interactions`;
  const getShopProfileCacheKey = (ownerId: string) => `etsyhelper:shop-profile:${ownerId}`;
  const getLocalSettingsCacheKey = (ownerId: string) => `etsyhelper:local-settings:${ownerId}`;

  const readCachedRecords = <T,>(key: string): T[] => {
    if (typeof window === 'undefined') return [];
    try {
      const raw = window.localStorage.getItem(key);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed as T[] : [];
    } catch (error) {
      console.error('Failed to read cached Etsy sync records:', error);
      return [];
    }
  };

  const writeCachedRecords = <T,>(key: string, records: T[]) => {
    if (typeof window === 'undefined') return;
    try {
      if (records.length === 0) {
        window.localStorage.removeItem(key);
        return;
      }
      window.localStorage.setItem(key, JSON.stringify(records));
    } catch (error) {
      console.error('Failed to cache Etsy sync records:', error);
    }
  };

  const readCachedProfile = (ownerId: string): ShopProfile | null => {
    if (typeof window === 'undefined') return null;
    try {
      const raw = window.localStorage.getItem(getShopProfileCacheKey(ownerId));
      if (!raw) return null;
      const parsed = JSON.parse(raw) as Partial<ShopProfile>;
      return {
        ...DEFAULT_PROFILE,
        ...parsed,
        etsyShopUrl: typeof parsed.etsyShopUrl === 'string' && parsed.etsyShopUrl.trim()
          ? parsed.etsyShopUrl
          : DEFAULT_PROFILE.etsyShopUrl
      };
    } catch (error) {
      console.error('Failed to read cached shop profile:', error);
      return null;
    }
  };

  const writeCachedProfile = (ownerId: string, profile: ShopProfile) => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(getShopProfileCacheKey(ownerId), JSON.stringify(profile));
    } catch (error) {
      console.error('Failed to cache shop profile:', error);
    }
  };

  const readLocalSettings = (ownerId: string) => {
    if (typeof window === 'undefined') return null;
    try {
      const raw = window.localStorage.getItem(getLocalSettingsCacheKey(ownerId));
      if (!raw) return null;
      const parsed = JSON.parse(raw) as Partial<ConnectedAccounts>;
      return {
        etsy: !!parsed.etsy,
        instagram: !!parsed.instagram
      } satisfies ConnectedAccounts;
    } catch (error) {
      console.error('Failed to read local workspace settings:', error);
      return null;
    }
  };

  const writeLocalSettings = (ownerId: string, accounts: ConnectedAccounts) => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(getLocalSettingsCacheKey(ownerId), JSON.stringify(accounts));
    } catch (error) {
      console.error('Failed to write local workspace settings:', error);
    }
  };

  const buildUserSettingsPayload = (profile: ShopProfile, accounts: ConnectedAccounts) => ({
    ...toPersistedUserProfile(profile),
    etsyConnected: accounts.etsy,
    instagramConnected: accounts.instagram,
    updatedAt: serverTimestamp()
  });

  const persistUserSettings = async (uid: string, profile: ShopProfile, accounts: ConnectedAccounts) => {
    if (localWorkspaceMode) {
      writeCachedProfile(uid, profile);
      writeLocalSettings(uid, accounts);
      return;
    }
    await setDoc(doc(db, 'users', uid), buildUserSettingsPayload(profile, accounts));
  };

  const persistAgentTasks = (ownerId: string, tasks: AgentTask[]) => {
    writeLocalBucket(ownerId, 'agentTasks', tasks);
  };

  const disconnectEtsyConnection = async (message: string) => {
    setConnectedAccounts((current) => ({ ...current, etsy: false }));
    setEtsyAnalytics(DEFAULT_ETSY_ANALYTICS);
    setInventoryFallback([]);
    setInteractionFallback([]);

    if (user) {
      writeCachedRecords(getInventoryCacheKey(user.uid), []);
      writeCachedRecords(getInteractionCacheKey(user.uid), []);
      try {
        await persistUserSettings(user.uid, shopProfile, { ...connectedAccounts, etsy: false });
      } catch (error) {
        console.error('Failed to persist Etsy disconnect state:', error);
      }
    }

    showToast(message, 'error');
  };

  async function syncConnectedEtsy(options?: { silent?: boolean }) {
    if (!user) return;
    if (isDemoMode) {
      if (!options?.silent) {
        showToast('Demo mode does not perform live Etsy sync.', 'info');
      }
      return;
    }

    const response = await fetch('/api/etsy/sync', {
      credentials: 'include'
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok && payload?.code === 'no_shop') {
      await disconnectEtsyConnection('Etsy connected the wrong account or a buyer-only account. Reconnect with the seller account that owns your shop.');
      throw new Error(payload.error || 'No Etsy seller shop was returned');
    }
    if (!response.ok && response.status === 401) {
      setConnectedAccounts((current) => ({ ...current, etsy: false }));
      throw new Error(payload?.error || 'Your Etsy session is no longer active. Reconnect Etsy to restore live sync.');
    }
    if (!response.ok || !payload?.shop || !Array.isArray(payload?.inventoryItems) || !Array.isArray(payload?.receiptItems)) {
      throw new Error(payload?.error || 'Unable to sync live Etsy data');
    }

    const sync = payload as EtsyLiveSyncResponse;
    const nextProfile = buildProfileFromEtsySync(shopProfile, sync);
    const importedInventory = sync.inventoryItems
      .map((item) => createLocalInventoryFromEtsy(user.uid, item))
      .filter((item): item is InventoryItem => !!item);
    const importedInteractions = sync.receiptItems
      .map((item) => createLocalInteractionFromEtsy(
        user.uid,
        item,
        interactions.find((existing) =>
          existing.etsyReceiptId === item.receiptId
          || (!!item.relatedOrderId && existing.relatedOrderId === item.relatedOrderId)
        ) || null
      ))
      .filter((item): item is CustomerInteraction => !!item);

    setEtsyAnalytics({
      mode: 'live_etsy',
      syncedAt: sync.syncedAt,
      shopRevenue30d: sync.shopRevenue30d,
      shopOrders30d: sync.shopOrders30d,
      averageConversionRate: sync.averageConversionRate,
      listingMetrics: sync.listingMetrics
    });

    setShopProfile(nextProfile);
    setConnectedAccounts((current) => ({ ...current, etsy: true }));
    writeCachedProfile(user.uid, nextProfile);
    setInventory((current) => mergeInventoryRecords(importedInventory, current));
    setInteractions((current) => mergeInteractionRecords(importedInteractions, current));

    if (localWorkspaceMode) {
      writeLocalBucket(user.uid, 'inventory', mergeInventoryRecords(importedInventory, readLocalBucket(user.uid, 'inventory')));
      writeLocalBucket(user.uid, 'interactions', mergeInteractionRecords(importedInteractions, readLocalBucket(user.uid, 'interactions')));
      await persistUserSettings(user.uid, nextProfile, { ...connectedAccounts, etsy: true });

      if (!options?.silent) {
        showToast(
          `Synced ${sync.inventoryItems.length} Etsy listing${sync.inventoryItems.length === 1 ? '' : 's'} and ${sync.receiptItems.length} order-linked inbox item${sync.receiptItems.length === 1 ? '' : 's'} into the local workspace.`,
          'success'
        );
      }

      return sync;
    }

    let skippedInventoryCount = 0;
    let failedInventoryCount = 0;
    try {
      const inventoryWrites = await Promise.allSettled(sync.inventoryItems.map(async (item) => {
        const sanitized = sanitizeEtsyInventoryForFirestore(item);
        if (!sanitized) {
          skippedInventoryCount += 1;
          return;
        }

        const existingInventory = inventory.find((entry) =>
          entry.ownerId === user.uid && entry.etsyListingId === sanitized.etsyListingId
        ) || null;

        const inventoryPayload: Record<string, unknown> = {
          name: sanitized.name,
          description: sanitized.description,
          stockLevel: sanitized.stockLevel,
          price: sanitized.price,
          category: sanitized.category,
          tags: sanitized.tags,
          imageUrl: sanitized.imageUrl,
          etsyListingId: sanitized.etsyListingId,
          sku: sanitized.sku,
          source: 'etsy',
          ownerId: user.uid,
          updatedAt: serverTimestamp()
        };

        if (existingInventory?.costPrice !== undefined) {
          inventoryPayload.costPrice = existingInventory.costPrice;
        }
        if (existingInventory?.reorderPoint !== undefined) {
          inventoryPayload.reorderPoint = existingInventory.reorderPoint;
        }
        if (existingInventory?.monthlySales !== undefined) {
          inventoryPayload.monthlySales = existingInventory.monthlySales;
        }
        if (existingInventory?.leadTimeDays !== undefined) {
          inventoryPayload.leadTimeDays = existingInventory.leadTimeDays;
        }
        if (existingInventory?.materials !== undefined) {
          inventoryPayload.materials = existingInventory.materials;
        }
        if (existingInventory?.createdAt !== undefined) {
          inventoryPayload.createdAt = existingInventory.createdAt;
        }

        const inventoryRef = doc(db, 'inventory', getOwnerScopedEtsyInventoryDocId(user.uid, sanitized.etsyListingId));
        await setDoc(inventoryRef, inventoryPayload, { merge: true });
      }));

      const failedWrites = inventoryWrites.filter((result) => result.status === 'rejected');
      failedInventoryCount = failedWrites.length;
      if (failedWrites.length > 0) {
        setInventoryFallback(importedInventory);
        writeCachedRecords(getInventoryCacheKey(user.uid), importedInventory);
      } else {
        setInventoryFallback([]);
        writeCachedRecords(getInventoryCacheKey(user.uid), []);
      }
    } catch (error) {
      console.error('Inventory persistence fallback engaged:', error);
      failedInventoryCount = importedInventory.length;
      setInventoryFallback(importedInventory);
      writeCachedRecords(getInventoryCacheKey(user.uid), importedInventory);
    }

    let skippedReceiptCount = 0;
    let failedReceiptCount = 0;
    try {
      const receiptWrites = await Promise.allSettled(sync.receiptItems.map(async (item) => {
        const sanitized = sanitizeEtsyReceiptForFirestore(item);
        if (!sanitized) {
          skippedReceiptCount += 1;
          return;
        }

        const existingInteraction = interactions.find((existing) =>
          existing.ownerId === user.uid
          && (existing.etsyReceiptId === sanitized.receiptId || existing.relatedOrderId === sanitized.relatedOrderId)
        ) || null;

        const interactionPayload: Record<string, unknown> = {
          customerName: sanitized.customerName,
          customerEmail: sanitized.customerEmail,
          message: sanitized.message,
          status: sanitized.status,
          priority: sanitized.priority,
          category: sanitized.category,
          summary: sanitized.summary,
          timestamp: sanitized.timestamp,
          ownerId: user.uid,
          relatedOrderId: sanitized.relatedOrderId,
          tags: sanitized.tags,
          source: 'etsy_receipt',
          etsyReceiptId: sanitized.receiptId,
          orderStatus: sanitized.orderStatus
        };

        const fallbackRef = doc(db, 'interactions', getOwnerScopedEtsyReceiptDocId(user.uid, sanitized.receiptId));
        const preservedStatus = existingInteraction?.status === 'replied' || existingInteraction?.status === 'resolved'
          ? existingInteraction.status
          : sanitized.status;

        if (existingInteraction?.response) {
          interactionPayload.response = existingInteraction.response;
        }
        if (existingInteraction?.notes) {
          interactionPayload.notes = existingInteraction.notes;
        }
        if (existingInteraction?.sentiment) {
          interactionPayload.sentiment = existingInteraction.sentiment;
        }
        if (existingInteraction?.respondedAt) {
          interactionPayload.respondedAt = existingInteraction.respondedAt;
        }

        await setDoc(fallbackRef, {
          ...interactionPayload,
          status: preservedStatus,
          timestamp: existingInteraction?.timestamp || sanitized.timestamp
        }, { merge: true });
      }));

      const failedWrites = receiptWrites.filter((result) => result.status === 'rejected');
      failedReceiptCount = failedWrites.length;
      if (failedWrites.length > 0) {
        setInteractionFallback(importedInteractions);
        writeCachedRecords(getInteractionCacheKey(user.uid), importedInteractions);
      } else {
        setInteractionFallback([]);
        writeCachedRecords(getInteractionCacheKey(user.uid), []);
      }
    } catch (error) {
      console.error('Interaction persistence fallback engaged:', error);
      failedReceiptCount = importedInteractions.length;
      setInteractionFallback(importedInteractions);
      writeCachedRecords(getInteractionCacheKey(user.uid), importedInteractions);
    }

    try {
      await persistUserSettings(user.uid, nextProfile, { ...connectedAccounts, etsy: true });
    } catch (error) {
      throw new Error(`Etsy connected, but the connection state could not be saved to Firebase. ${getReadableErrorMessage(error, 'Check Firestore access for the users collection.')}`);
    }

    if (!options?.silent) {
      const importedListingCount = sync.inventoryItems.length - skippedInventoryCount;
      const importedReceiptCount = sync.receiptItems.length - skippedReceiptCount;
      const persistenceWarning = failedInventoryCount || failedReceiptCount
        ? ` Live Etsy data loaded, but ${failedInventoryCount} listing${failedInventoryCount === 1 ? '' : 's'} and ${failedReceiptCount} inbox item${failedReceiptCount === 1 ? '' : 's'} are using browser cache because Firestore blocked the import.`
        : '';
      showToast(
        `Synced ${importedListingCount} Etsy listing${importedListingCount === 1 ? '' : 's'} and ${importedReceiptCount} order-linked inbox item${importedReceiptCount === 1 ? '' : 's'}${skippedInventoryCount || skippedReceiptCount ? ` (${skippedInventoryCount} listing${skippedInventoryCount === 1 ? '' : 's'} and ${skippedReceiptCount} inbox item${skippedReceiptCount === 1 ? '' : 's'} skipped)` : ''}.${persistenceWarning}`,
        skippedInventoryCount || skippedReceiptCount || failedInventoryCount || failedReceiptCount ? 'info' : 'success'
      );
    }

    return sync;
  }

  async function pushEtsyListingUpdate(listingId: string, patch: EtsyListingPushPatch) {
    const response = await fetch(`/api/etsy/listings/${encodeURIComponent(listingId)}/push`, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(patch)
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(payload?.error || 'Unable to push the listing update to Etsy');
    }
  }

  async function publishInstagramPost(
    post: SocialPost,
    options?: { suppressToast?: boolean }
  ): Promise<{ ok: true } | { ok: false; error: string }> {
    if (!user) {
      const error = 'Sign in before trying to publish from the queue.';
      if (!options?.suppressToast) {
        showToast(error, 'error');
      }
      return { ok: false, error };
    }

    if (!post.id) {
      const error = 'This post is missing a saved id, so it cannot publish yet.';
      if (!options?.suppressToast) {
        showToast(error, 'error');
      }
      return { ok: false, error };
    }

    if (post.platform !== 'instagram') {
      const error = 'Direct publish is only wired for Instagram in this batch.';
      if (!options?.suppressToast) {
        showToast(error, 'info');
      }
      return { ok: false, error };
    }

    if (!connectedAccounts.instagram || !appCapabilities.instagram.directPublishing) {
      const error = appCapabilities.instagram.reason || 'Connect Instagram before trying to publish from the queue.';
      if (!options?.suppressToast) {
        showToast(error, 'info');
      }
      return { ok: false, error };
    }

    if (!isPublicImageUrl(post.imageUrl)) {
      const error = 'Instagram direct publish needs a public image URL. Upload the asset in Studio before trying again.';
      if (!options?.suppressToast) {
        showToast(error, 'error');
      }
      return { ok: false, error };
    }

    if (publishingPostIdsRef.current.has(post.id)) {
      return { ok: false, error: 'This post is already being published.' };
    }

    publishingPostIdsRef.current.add(post.id);

    try {
      const response = await fetch('/api/instagram/publish', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          postId: post.id,
          caption: post.content,
          imageUrl: post.imageUrl
        })
      });

      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.error || 'Unable to publish this Instagram post right now');
      }

      if (isLocalWorkspaceUser(user)) {
        const timestamp = new Date().toISOString();
        patchLocalBucketRecord(user.uid, 'posts', post.id, {
          status: 'posted',
          handoffStatus: 'posted',
          handoffChannel: 'instagram',
          postedAt: timestamp,
          lastPublishAttemptAt: timestamp,
          publishError: '',
          externalPostId: typeof payload?.publishedMediaId === 'string' ? payload.publishedMediaId : '',
          publishedPermalink: typeof payload?.permalink === 'string' ? payload.permalink : '',
          updatedAt: timestamp
        });
      } else {
        await updateDoc(doc(db, 'posts', post.id), {
          status: 'posted',
          handoffStatus: 'posted',
          handoffChannel: 'instagram',
          postedAt: serverTimestamp(),
          lastPublishAttemptAt: serverTimestamp(),
          publishError: '',
          externalPostId: typeof payload?.publishedMediaId === 'string' ? payload.publishedMediaId : '',
          publishedPermalink: typeof payload?.permalink === 'string' ? payload.permalink : '',
          updatedAt: serverTimestamp()
        });
      }

      if (!options?.suppressToast) {
        showToast('Instagram published successfully', 'success');
      }
      return { ok: true };
    } catch (error) {
      const message = getReadableErrorMessage(error, 'Instagram publish failed');
      try {
        if (isLocalWorkspaceUser(user)) {
          const timestamp = new Date().toISOString();
          patchLocalBucketRecord(user.uid, 'posts', post.id, {
            status: 'failed',
            handoffStatus: 'ready',
            handoffChannel: 'instagram',
            postedAt: null,
            publishError: message,
            lastPublishAttemptAt: timestamp,
            updatedAt: timestamp
          });
        } else {
          await updateDoc(doc(db, 'posts', post.id), {
            status: 'failed',
            handoffStatus: 'ready',
            handoffChannel: 'instagram',
            postedAt: null,
            publishError: message,
            lastPublishAttemptAt: serverTimestamp(),
            updatedAt: serverTimestamp()
          });
        }
      } catch (persistError) {
        console.error('Instagram publish failure state could not be saved:', persistError);
      }

      if (!options?.suppressToast) {
        showToast(message, 'error');
      }
      return { ok: false, error: message };
    } finally {
      publishingPostIdsRef.current.delete(post.id);
    }
  }

  useEffect(() => {
    let cancelled = false;

    const loadCapabilities = async () => {
      try {
        const response = await fetch('/api/capabilities', { credentials: 'include' });
        const payload = await response.json().catch(() => null);
        if (!response.ok || !payload) {
          return;
        }

        if (!cancelled) {
          setAppCapabilities({
            etsy: {
              canConnect: !!payload.etsy?.canConnect,
              reason: typeof payload.etsy?.reason === 'string' ? payload.etsy.reason : undefined
            },
            instagram: {
              canConnect: !!payload.instagram?.canConnect,
              directPublishing: !!payload.instagram?.directPublishing,
              reason: typeof payload.instagram?.reason === 'string' ? payload.instagram.reason : undefined
            }
          });
        }
      } catch (error) {
        console.error('Capability status check failed:', error);
      }
    };

    void loadCapabilities();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (isDemoMode) {
      setUser(DEMO_USER);
      setConnectedAccounts(DEMO_CONNECTED_ACCOUNTS);
      setShopProfile(DEMO_SHOP_PROFILE);
      setInventory(DEMO_INVENTORY);
      setPosts(DEMO_POSTS);
      setInteractions(DEMO_INTERACTIONS);
      setTrends(DEMO_TRENDS);
      setEtsyAnalytics(DEMO_ETSY_ANALYTICS);
      setLoading(false);
      return;
    }

    if (localWorkspaceMode) {
      const localUser = LOCAL_WORKSPACE_USER;
      const cachedProfile = readCachedProfile(localUser.uid);
      const cachedInventory = readLocalBucket(localUser.uid, 'inventory');
      const cachedPosts = readLocalBucket(localUser.uid, 'posts');
      const cachedInteractions = readLocalBucket(localUser.uid, 'interactions');
      const cachedTrends = readLocalBucket(localUser.uid, 'trends');
      const cachedAgentTasks = readLocalBucket(localUser.uid, 'agentTasks');
      const cachedSettings = readLocalSettings(localUser.uid);
      const baseProfile = cachedProfile || {
        ...DEMO_SHOP_PROFILE,
        etsyApplicationStatus: cachedSettings?.etsy ? 'connected' as const : DEMO_SHOP_PROFILE.etsyApplicationStatus
      };

      setUser(localUser);
      setConnectedAccounts(cachedSettings || DEMO_CONNECTED_ACCOUNTS);
      setShopProfile(baseProfile);
      setInventory(cachedInventory);
      setInventoryFallback([]);
      setPosts(cachedPosts);
      setInteractions(cachedInteractions);
      setInteractionFallback([]);
      setTrends(cachedTrends);
      setAgentTasks(cachedAgentTasks);
      setEtsyAnalytics(DEFAULT_ETSY_ANALYTICS);
      setLoading(false);

      const handleLocalWorkspaceUpdate = (event: Event) => {
        const detail = (event as CustomEvent<{ ownerId?: string; bucket?: string }>).detail;
        if (detail?.ownerId && detail.ownerId !== localUser.uid) {
          return;
        }

        const bucket = detail?.bucket;
        if (!bucket || bucket === 'inventory') {
          setInventory(readLocalBucket(localUser.uid, 'inventory'));
        }
        if (!bucket || bucket === 'posts') {
          setPosts(readLocalBucket(localUser.uid, 'posts'));
        }
        if (!bucket || bucket === 'interactions') {
          setInteractions(readLocalBucket(localUser.uid, 'interactions'));
        }
        if (!bucket || bucket === 'trends') {
          setTrends(readLocalBucket(localUser.uid, 'trends'));
        }
        if (!bucket || bucket === 'agentTasks') {
          setAgentTasks(readLocalBucket(localUser.uid, 'agentTasks'));
        }
      };

      window.addEventListener(LOCAL_WORKSPACE_EVENT, handleLocalWorkspaceUpdate);
      return () => window.removeEventListener(LOCAL_WORKSPACE_EVENT, handleLocalWorkspaceUpdate);
    }

    const unsubscribe = onAuthStateChanged(auth, async (nextUser) => {
      setUser(nextUser);
      etsyBootstrapAttemptedRef.current = false;

      if (nextUser) {
        const cachedInventory = readCachedRecords<InventoryItem>(getInventoryCacheKey(nextUser.uid));
        const cachedInteractions = readCachedRecords<CustomerInteraction>(getInteractionCacheKey(nextUser.uid));
        const cachedProfile = readCachedProfile(nextUser.uid);
        const cachedAgentTasks = readLocalBucket(nextUser.uid, 'agentTasks');
        const settingsRef = doc(db, 'users', nextUser.uid);
        const settingsDoc = await getDoc(settingsRef);
        const settings = settingsDoc.exists() ? settingsDoc.data() : undefined;
        const persistedProfile = getProfileFromDoc(settings);
        const baseProfile = cachedProfile || (
          localWorkspaceMode && nextUser.isAnonymous
            ? {
                ...persistedProfile,
                shopName: persistedProfile.shopName || DEMO_SHOP_PROFILE.shopName,
                niche: persistedProfile.niche || DEMO_SHOP_PROFILE.niche,
                idealCustomer: persistedProfile.idealCustomer || DEMO_SHOP_PROFILE.idealCustomer,
                brandTone: persistedProfile.brandTone || DEMO_SHOP_PROFILE.brandTone,
                focusProduct: persistedProfile.focusProduct || DEMO_SHOP_PROFILE.focusProduct,
                instagramHandle: persistedProfile.instagramHandle || DEMO_SHOP_PROFILE.instagramHandle
              }
            : persistedProfile
        );

        const storedAccounts = {
          etsy: !!settings?.etsyConnected,
          instagram: !!settings?.instagramConnected
        } satisfies ConnectedAccounts;

        setConnectedAccounts(storedAccounts);
        setShopProfile(baseProfile);
        setInventoryFallback(cachedInventory);
        setInteractionFallback(cachedInteractions);
        setInventory(cachedInventory);
        setInteractions(cachedInteractions);
        setAgentTasks(cachedAgentTasks);
        setEtsyAnalytics(DEFAULT_ETSY_ANALYTICS);

        let recoveredEtsyConnected = storedAccounts.etsy;

        if (!settings?.etsyConnected) {
          try {
            const response = await fetch('/api/etsy/status', { credentials: 'include' });
            const payload = await response.json().catch(() => null);
            if (response.ok && payload?.connected && payload?.shop) {
              recoveredEtsyConnected = true;
              setConnectedAccounts((current) => ({ ...current, etsy: true }));
              const recoveredProfile = {
                ...baseProfile,
                shopName: payload.shop.shopName || baseProfile.shopName,
                etsyApplicationStatus: 'connected' as const
              } satisfies ShopProfile;
              setShopProfile(recoveredProfile);
              writeCachedProfile(nextUser.uid, recoveredProfile);

              await persistUserSettings(
                nextUser.uid,
                recoveredProfile,
                {
                  etsy: true,
                  instagram: storedAccounts.instagram
                }
              );
            }
          } catch (error) {
            console.error('Etsy status recovery check failed:', error);
          }
        }

        if (!storedAccounts.instagram) {
          try {
            const response = await fetch('/api/instagram/status', { credentials: 'include' });
            const payload = await response.json().catch(() => null);
            if (response.ok && payload?.connected) {
              setConnectedAccounts((current) => ({ ...current, instagram: true }));
              await persistUserSettings(
                nextUser.uid,
                baseProfile,
                {
                  etsy: recoveredEtsyConnected,
                  instagram: true
                }
              );
            }
          } catch (error) {
            console.error('Instagram status recovery check failed:', error);
          }
        }
      } else {
        setConnectedAccounts({ etsy: false, instagram: false });
        setShopProfile(DEFAULT_PROFILE);
        setInventory([]);
        setInventoryFallback([]);
        setEtsyAnalytics(DEFAULT_ETSY_ANALYTICS);
        setInteractions([]);
        setInteractionFallback([]);
        setAgentTasks([]);
      }

      setLoading(false);
    });

    return () => unsubscribe();
  }, [isDemoMode, localWorkspaceMode]);

  useEffect(() => {
    if (isDemoMode || localWorkspaceMode) return;
    if (!user) return;

    const unsubs: Array<() => void> = [];

    unsubs.push(
      onSnapshot(
        query(collection(db, 'inventory'), where('ownerId', '==', user.uid)),
        (snapshot) => setInventory(mergeInventoryRecords(
          sortByDateField(snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() } as InventoryItem)), 'updatedAt'),
          inventoryFallback
        )),
        (error) => {
          console.error('Inventory subscription failed:', error);
          showToast('Inventory feed could not be loaded. Check Firestore rules and indexes.', 'error');
        }
      )
    );

    unsubs.push(
      onSnapshot(
        query(collection(db, 'posts'), where('ownerId', '==', user.uid)),
        (snapshot) => setPosts(sortByDateField(snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() } as SocialPost)), 'updatedAt')),
        (error) => {
          console.error('Posts subscription failed:', error);
          showToast('Content queue could not be loaded. Check Firestore rules and indexes.', 'error');
        }
      )
    );

    unsubs.push(
      onSnapshot(
        query(collection(db, 'interactions'), where('ownerId', '==', user.uid)),
        (snapshot) => setInteractions(mergeInteractionRecords(
          sortByDateField(snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() } as CustomerInteraction)), 'timestamp'),
          interactionFallback
        )),
        (error) => {
          console.error('Interactions subscription failed:', error);
          showToast('Customer inbox could not be loaded. Check Firestore rules and indexes.', 'error');
        }
      )
    );

    unsubs.push(
      onSnapshot(
        query(collection(db, 'trends'), where('ownerId', '==', user.uid)),
        (snapshot) => setTrends(sortByDateField(snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() } as TrendAnalysis)), 'lastAnalyzed')),
        (error) => {
          console.error('Trend subscription failed:', error);
          showToast('Trend history could not be loaded. Check Firestore rules and indexes.', 'error');
        }
      )
    );

    return () => {
      unsubs.forEach((unsubscribe) => unsubscribe());
    };
  }, [interactionFallback, inventoryFallback, isDemoMode, localWorkspaceMode, user]);

  useEffect(() => {
    if (isDemoMode) return;
    if (!user || !connectedAccounts.etsy || etsyBootstrapAttemptedRef.current) return;

    etsyBootstrapAttemptedRef.current = true;
    syncConnectedEtsy({ silent: true }).catch((error) => {
      console.error('Initial Etsy bootstrap sync failed:', error);
    });
  }, [connectedAccounts.etsy, isDemoMode, user]);

  useEffect(() => {
    if (isDemoMode) return;
    const handleOAuthMessage = async (event: MessageEvent) => {
      if (event.origin !== window.location.origin || !user) return;

      if (event.data?.type === 'OAUTH_AUTH_SUCCESS') {
        const provider = event.data.provider as keyof ConnectedAccounts;
        if (provider !== 'etsy' && provider !== 'instagram') return;

        const nextAccounts = { ...connectedAccountsRef.current, [provider]: true };
        connectedAccountsRef.current = nextAccounts;
        setConnectedAccounts(nextAccounts);
        if (provider === 'etsy') {
          const nextProfile = { ...shopProfileRef.current, etsyApplicationStatus: 'connected' as const };
          shopProfileRef.current = nextProfile;
          setShopProfile(nextProfile);
          writeCachedProfile(user.uid, nextProfile);
          try {
            await syncConnectedEtsy({ silent: true });
            showToast('Etsy connected and live shop data synced', 'success');
          } catch (error) {
            console.error('Etsy post-connect sync failed:', error);
            if (error instanceof Error && error.message.toLowerCase().includes('no etsy seller shop')) {
              return;
            }
            showToast('Etsy connected, but the first live sync did not complete yet.', 'info');
          }
          return;
        }
        await persistUserSettings(user.uid, shopProfileRef.current, nextAccounts);
        showToast('Instagram connected and ready for direct image posts', 'success');
        return;
      }

      if (event.data?.type === 'OAUTH_AUTH_PENDING') {
        const provider = event.data.provider as keyof ConnectedAccounts;
        if (provider !== 'etsy' && provider !== 'instagram') return;
        showToast(provider === 'etsy' ? 'Etsy callback verified. Final connection is still finishing.' : 'Instagram callback verified. Final connection is still finishing.', 'info');
      }
    };

    window.addEventListener('message', handleOAuthMessage);
    return () => window.removeEventListener('message', handleOAuthMessage);
  }, [isDemoMode, user]);

  const saveProfile = async (nextProfile: ShopProfile, successMessage = 'Shop profile updated') => {
    if (!user) return;
    if (isDemoMode) {
      setShopProfile(nextProfile);
      showToast('Demo mode keeps profile edits local to this browser tab.', 'info');
      return;
    }
    if (localWorkspaceMode) {
      setShopProfile(nextProfile);
      writeCachedProfile(user.uid, nextProfile);
      showToast(successMessage, 'success');
      return;
    }

    setSavingProfile(true);
    const previousProfile = shopProfile;
    setShopProfile(nextProfile);
    writeCachedProfile(user.uid, nextProfile);

    try {
      await setDoc(doc(db, 'users', user.uid), buildUserSettingsPayload(nextProfile, connectedAccounts), { merge: true });
      showToast(successMessage, 'success');
    } catch (error) {
      console.error('Profile save error:', error);
      setShopProfile(previousProfile);
      writeCachedProfile(user.uid, previousProfile);
      showToast('Unable to save shop profile right now', 'error');
    } finally {
      setSavingProfile(false);
    }
  };

  const metrics = useMemo<DerivedMetrics>(() => {
    const now = Date.now();
    const pendingReplies = interactions.filter((interaction) => interaction.status === 'pending');
    const lowStockItems = inventory.filter((item) => item.stockLevel <= (item.reorderPoint || 5));
    const scheduledPosts = posts.filter((post) => post.status === 'scheduled');
    const dueNowPosts = sortByScheduledDate(scheduledPosts.filter((post) => {
      const scheduled = toDate(post.scheduledAt);
      if (!scheduled) return false;
      const time = scheduled.getTime();
      return time >= now && time <= now + (1000 * 60 * 60);
    }));
    const overduePosts = sortByScheduledDate(scheduledPosts.filter((post) => isPostOverdue(post, now)));
    const failedPosts = sortByDateField(posts.filter((post) => post.status === 'failed'), 'lastPublishAttemptAt');
    const instagramDirectReady = connectedAccounts.instagram && !!appCapabilities.instagram.directPublishing;
    const autoPublishEligibleDuePosts = sortByScheduledDate(scheduledPosts.filter((post) =>
      post.platform === 'instagram'
      && !!post.imageUrl
      && instagramDirectReady
      && isPostDue(post, now)
      && !isPublishRetryCoolingDown(post, now, AUTO_PUBLISH_RETRY_COOLDOWN_MS)
    ));
    const manualHandoffPosts = sortByScheduledDate(scheduledPosts.filter((post) =>
      isPostDue(post, now)
      && !autoPublishEligibleDuePosts.some((candidate) => candidate.id === post.id)
    ));
    const retryableFailedPosts = sortByDateField(failedPosts.filter((post) =>
      post.platform === 'instagram'
      && !!post.imageUrl
      && instagramDirectReady
      && !isPublishRetryCoolingDown(post, now, AUTO_PUBLISH_RETRY_COOLDOWN_MS)
    ), 'lastPublishAttemptAt');
    const upcomingPosts = sortByScheduledDate(posts.filter((post) => toDate(post.scheduledAt)));

    const inventoryValue = inventory.reduce((sum, item) => sum + item.price * item.stockLevel, 0);
    const atRiskRevenue = lowStockItems.reduce((sum, item) => sum + item.price * Math.max((item.reorderPoint || 5) - item.stockLevel, 0), 0);
    const averageTrendScore = trends.length > 0 ? Math.round(trends.reduce((sum, trend) => sum + trend.popularityScore, 0) / trends.length) : 0;

    const completionChecks = [
      !!shopProfile.shopName,
      !!shopProfile.niche,
      !!shopProfile.idealCustomer,
      !!shopProfile.focusProduct,
      !!shopProfile.brandTone,
      shopProfile.monthlyRevenueGoal > 0
    ];

    const profileCompletion = Math.round((completionChecks.filter(Boolean).length / completionChecks.length) * 100);
    const responseCoverage = interactions.length > 0
      ? Math.round(((interactions.length - pendingReplies.length) / interactions.length) * 100)
      : 100;
    const contentCoverage = Math.min(100, scheduledPosts.length * 18);
    const integrationScore = [connectedAccounts.etsy, aiConfigured].filter(Boolean).length * 50;
    const readinessScore = Math.round(
      (profileCompletion * 0.3) +
      (responseCoverage * 0.2) +
      (contentCoverage * 0.2) +
      (integrationScore * 0.3)
    );

    const actionQueue: ActionQueueItem[] = [];

    if (pendingReplies.length > 0) {
      actionQueue.push({
        id: 'pending-replies',
        title: `${pendingReplies.length} buyer conversation${pendingReplies.length === 1 ? '' : 's'} need attention`,
        detail: 'Reply drafts can be approved inside the inbox even before Etsy messaging is connected.',
        tone: pendingReplies.some((entry) => entry.priority === 'urgent') ? 'danger' : 'warning',
        tab: 'customers',
        label: 'Open inbox'
      });
    }

    if (lowStockItems.length > 0) {
      actionQueue.push({
        id: 'low-stock',
        title: `${lowStockItems.length} catalog item${lowStockItems.length === 1 ? '' : 's'} are below reorder threshold`,
        detail: 'Low stock is immediate revenue risk. Update quantities or plan restocks.',
        tone: 'danger',
        tab: 'catalog',
        label: 'Review stock'
      });
    }

    if (retryableFailedPosts.length > 0) {
      actionQueue.push({
        id: 'retry-failed-posts',
        title: `${retryableFailedPosts.length} publish ${retryableFailedPosts.length === 1 ? 'failure needs' : 'failures need'} a retry`,
        detail: 'Instagram rejected or failed one or more posts. Review the error and retry from the runway.',
        tone: 'danger',
        tab: 'studio',
        label: 'Retry publish'
      });
    }

    if (manualHandoffPosts.length > 0) {
      actionQueue.push({
        id: 'manual-handoff-due',
        title: `${manualHandoffPosts.length} post${manualHandoffPosts.length === 1 ? '' : 's'} need a publish decision now`,
        detail: 'These queue items are due or overdue and still need a manual handoff or asset fix.',
        tone: overduePosts.length > 0 ? 'danger' : 'warning',
        tab: 'studio',
        label: 'Publish now'
      });
    }

    if (overduePosts.length > 0) {
      actionQueue.push({
        id: 'overdue-posts',
        title: `${overduePosts.length} queued post${overduePosts.length === 1 ? '' : 's'} missed the publish window`,
        detail: 'Clear the overdue handoff queue before adding more campaign work.',
        tone: 'warning',
        tab: 'studio',
        label: 'Clear runway'
      });
    }

    if (scheduledPosts.length < 3) {
      actionQueue.push({
        id: 'content-gap',
        title: 'Your content runway is thin',
        detail: 'Queue at least three approved posts so you are not creating under pressure.',
        tone: 'info',
        tab: 'studio',
        label: 'Plan content'
      });
    }

    if (trends.length === 0) {
      actionQueue.push({
        id: 'trend-gap',
        title: 'No demand signals captured yet',
        detail: 'Run at least one opportunity scan so product and marketing ideas have direction.',
        tone: 'warning',
        tab: 'command',
        label: 'Run scan'
      });
    }

    if (profileCompletion < 100) {
      actionQueue.push({
        id: 'profile-gap',
        title: 'The shop profile is still incomplete',
        detail: 'Your AI outputs get more specific once the shop niche, customer, and hero product are defined.',
        tone: 'info',
        tab: 'command',
        label: 'Complete profile'
      });
    }

    if (actionQueue.length === 0) {
      actionQueue.push({
        id: 'clear',
        title: 'The operating queue is in good shape',
        detail: 'You can spend this block on growth work: campaign planning, new products, or better listings.',
        tone: 'success',
        tab: 'growth',
        label: 'Explore growth'
      });
    }

    return {
      readinessScore,
      profileCompletion,
      responseCoverage,
      contentCoverage,
      inventoryValue,
      atRiskRevenue,
      averageTrendScore,
      pendingReplies,
      lowStockItems,
      upcomingPosts,
      scheduledPosts,
      dueNowPosts,
      overduePosts,
      failedPosts,
      manualHandoffPosts,
      retryableFailedPosts,
      actionQueue
    };
  }, [appCapabilities.instagram.directPublishing, connectedAccounts, interactions, inventory, posts, shopProfile, trends]);

  useEffect(() => {
    if (isDemoMode || !user) return;
    if (!connectedAccounts.instagram || !appCapabilities.instagram.directPublishing) return;

    let cancelled = false;

    const runAutoPublishPass = async () => {
      const now = Date.now();
      const dueInstagramPosts = sortByScheduledDate(posts.filter((post) =>
        !!post.id
        && post.status === 'scheduled'
        && post.platform === 'instagram'
        && isPublicImageUrl(post.imageUrl)
        && isPostDue(post, now)
        && !isPublishRetryCoolingDown(post, now, AUTO_PUBLISH_RETRY_COOLDOWN_MS)
        && !publishingPostIdsRef.current.has(post.id!)
      )).slice(0, 3);

      if (dueInstagramPosts.length === 0) {
        return;
      }

      let publishedCount = 0;
      let failedCount = 0;

      for (const post of dueInstagramPosts) {
        if (cancelled) return;
        const result = await publishInstagramPost(post, { suppressToast: true });
        if (result.ok) {
          publishedCount += 1;
        } else {
          failedCount += 1;
        }
      }

      if (cancelled || (publishedCount === 0 && failedCount === 0)) {
        return;
      }

      if (publishedCount > 0 && failedCount === 0) {
        showToast(`Auto-published ${publishedCount} Instagram post${publishedCount === 1 ? '' : 's'}.`, 'success');
        return;
      }

      showToast(
        `Automation published ${publishedCount} post${publishedCount === 1 ? '' : 's'} and left ${failedCount} ${failedCount === 1 ? 'post' : 'posts'} for review.`,
        failedCount > 0 ? 'info' : 'success'
      );
    };

    void runAutoPublishPass();
    const intervalId = window.setInterval(() => {
      void runAutoPublishPass();
    }, 60_000);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [appCapabilities.instagram.directPublishing, connectedAccounts.instagram, isDemoMode, posts, user]);

  const syncLocalWorkspaceState = (ownerId: string) => {
    setInventory(readLocalBucket(ownerId, 'inventory'));
    setPosts(readLocalBucket(ownerId, 'posts'));
    setInteractions(readLocalBucket(ownerId, 'interactions'));
    setTrends(readLocalBucket(ownerId, 'trends'));
    setAgentTasks(readLocalBucket(ownerId, 'agentTasks'));
  };

  const suggestedAgentTasks = useMemo<AgentTask[]>(() => {
    if (!user) return [];

    const ownerId = user.uid;
    const timestamp = new Date().toISOString();
    const urgentPending = metrics.pendingReplies.filter((interaction) => interaction.priority === 'urgent');
    const staleQueuedPosts = metrics.manualHandoffPosts.filter((post) => isPostOverdue(post));
    const strongestTrend = trends[0];
    const weakLiveListing = [...etsyAnalytics.listingMetrics]
      .filter((metric) => (metric.views30d || 0) >= 20 && ((metric.orders30d || 0) === 0 || (metric.conversionRate || 0) < 1.2))
      .sort((left, right) => (right.views30d || 0) - (left.views30d || 0))[0];

    const nextTasks: AgentTask[] = [];

    if (urgentPending.length > 0) {
      nextTasks.push({
        id: 'agent-urgent-replies',
        title: `Draft replies for ${urgentPending.length} urgent buyer ${urgentPending.length === 1 ? 'thread' : 'threads'}`,
        detail: 'Generate safe reply drafts so buyer trust issues are handled first.',
        category: 'support',
        risk: 'low',
        status: 'suggested',
        actionType: 'draft_replies',
        targetTab: 'customers',
        ownerId,
        createdAt: timestamp,
        updatedAt: timestamp,
        payload: {
          interactionIds: urgentPending.slice(0, 5).map((interaction) => interaction.id!).filter(Boolean),
          count: urgentPending.length
        }
      });
    }

    if (metrics.scheduledPosts.length < 4) {
      nextTasks.push({
        id: 'agent-queue-campaign',
        title: 'Queue the next campaign block',
        detail: 'Build a fresh batch of approved content so the publishing runway stays full.',
        category: 'content',
        risk: 'medium',
        status: 'suggested',
        actionType: 'queue_campaign',
        targetTab: 'studio',
        ownerId,
        createdAt: timestamp,
        updatedAt: timestamp,
        payload: {
          productName: shopProfile.focusProduct || inventory[0]?.name || 'featured product',
          count: 3
        }
      });
    } else if (staleQueuedPosts.length > 0) {
      nextTasks.push({
        id: 'agent-publish-runway',
        title: `Clear ${staleQueuedPosts.length} overdue queued ${staleQueuedPosts.length === 1 ? 'post' : 'posts'}`,
        detail: 'The queue has posts past their scheduled time and needs a publish decision.',
        category: 'content',
        risk: 'medium',
        status: 'suggested',
        actionType: 'review_publish_runway',
        targetTab: 'studio',
        ownerId,
        createdAt: timestamp,
        updatedAt: timestamp,
        payload: {
          count: staleQueuedPosts.length
        }
      });
    }

    if (metrics.lowStockItems.length > 0) {
      nextTasks.push({
        id: 'agent-stock-risk',
        title: `Review stock risk on ${metrics.lowStockItems[0].name}`,
        detail: `${metrics.lowStockItems.length} item${metrics.lowStockItems.length === 1 ? '' : 's'} are under their reorder threshold.`,
        category: 'catalog',
        risk: 'high',
        status: 'suggested',
        actionType: 'review_stock',
        targetTab: 'catalog',
        ownerId,
        createdAt: timestamp,
        updatedAt: timestamp,
        payload: {
          productName: metrics.lowStockItems[0].name,
          count: metrics.lowStockItems.length
        }
      });
    }

    if (weakLiveListing) {
      nextTasks.push({
        id: 'agent-optimize-listing',
        title: `Optimize ${weakLiveListing.title}`,
        detail: `${weakLiveListing.views30d || 0} views with ${weakLiveListing.orders30d || 0} orders suggests a conversion gap.`,
        category: 'catalog',
        risk: 'medium',
        status: 'suggested',
        actionType: 'optimize_listing',
        targetTab: 'catalog',
        ownerId,
        createdAt: timestamp,
        updatedAt: timestamp,
        payload: {
          listingId: weakLiveListing.listingId,
          productName: weakLiveListing.title
        }
      });
    }

    if (!strongestTrend || metrics.averageTrendScore < 70) {
      nextTasks.push({
        id: 'agent-trend-refresh',
        title: strongestTrend ? `Refresh trend coverage around ${strongestTrend.keyword}` : 'Run a new trend scan',
        detail: 'Trend intelligence is light enough that the shop could miss a timely audience angle.',
        category: 'trend',
        risk: 'low',
        status: 'suggested',
        actionType: 'run_trend_scan',
        targetTab: 'command',
        ownerId,
        createdAt: timestamp,
        updatedAt: timestamp,
        payload: {
          keyword: strongestTrend?.keyword || shopProfile.niche || shopProfile.focusProduct || 'gift ideas'
        }
      });
    }

    nextTasks.push({
      id: 'agent-growth-plan',
      title: 'Refresh the weekly growth plan',
      detail: 'Rebuild the seven-day plan from the latest Etsy activity, stock pressure, and queued content.',
      category: 'growth',
      risk: 'low',
      status: 'suggested',
      actionType: 'plan_growth',
      targetTab: 'growth',
      ownerId,
      createdAt: timestamp,
      updatedAt: timestamp
    });

    return nextTasks;
  }, [etsyAnalytics.listingMetrics, inventory, metrics, shopProfile, trends, user]);

  const openWorkflowFromActionQueue = (item: ActionQueueItem) => {
    if (item.id === 'pending-replies') {
      const urgentPending = metrics.pendingReplies.filter((interaction) => interaction.priority === 'urgent');
      const target = urgentPending[0] || metrics.pendingReplies[0];
      openWorkflow({
        tab: 'customers',
        filterStatus: 'pending',
        priorityFilter: urgentPending.length > 0 ? 'urgent' : 'all',
        interactionId: target?.id
      });
      return;
    }

    if (item.id === 'low-stock') {
      const target = metrics.lowStockItems[0];
      openWorkflow({
        tab: 'catalog',
        statusFilter: 'restock',
        itemId: target?.id,
        etsyListingId: target?.etsyListingId,
        searchQuery: target?.name
      });
      return;
    }

    if (item.id === 'overdue-posts') {
      const overdue = metrics.overduePosts;
      openWorkflow({
        tab: 'studio',
        queueFilter: 'scheduled',
        postId: overdue[0]?.id,
        mode: 'overdue'
      });
      return;
    }

    if (item.id === 'manual-handoff-due') {
      const target = metrics.manualHandoffPosts[0];
      openWorkflow({
        tab: 'studio',
        queueFilter: 'scheduled',
        postId: target?.id,
        mode: 'upcoming'
      });
      return;
    }

    if (item.id === 'retry-failed-posts') {
      const target = metrics.retryableFailedPosts[0] || metrics.failedPosts[0];
      openWorkflow({
        tab: 'studio',
        queueFilter: 'all',
        postId: target?.id,
        mode: 'upcoming'
      });
      return;
    }

    if (item.id === 'content-gap') {
      openWorkflow({
        tab: 'studio',
        queueFilter: 'scheduled',
        mode: 'composer'
      });
      return;
    }

    if (item.id === 'trend-gap') {
      openWorkflow({
        tab: 'command',
        actionId: 'trend-scan'
      });
      return;
    }

    if (item.id === 'profile-gap') {
      openWorkflow({
        tab: 'command',
        actionId: 'profile'
      });
      return;
    }

    openWorkflow({
      tab: item.tab
    });
  };

  const openWorkflowFromAgentTask = (task: AgentTask) => {
    if (task.actionType === 'draft_replies') {
      const targetIds = new Set(task.payload?.interactionIds || []);
      const target = interactions.find((interaction) => interaction.id && targetIds.has(interaction.id))
        || metrics.pendingReplies[0];
      openWorkflow({
        tab: 'customers',
        filterStatus: 'pending',
        priorityFilter: task.risk === 'high' ? 'urgent' : 'all',
        interactionId: target?.id
      });
      return;
    }

    if (task.actionType === 'review_publish_runway') {
      const overdue = metrics.overduePosts;
      openWorkflow({
        tab: 'studio',
        queueFilter: 'scheduled',
        postId: overdue[0]?.id,
        mode: 'overdue'
      });
      return;
    }

    if (task.actionType === 'queue_campaign') {
      openWorkflow({
        tab: 'studio',
        queueFilter: 'scheduled',
        mode: 'composer'
      });
      return;
    }

    if (task.actionType === 'review_stock') {
      const target = metrics.lowStockItems.find((item) => item.name === task.payload?.productName)
        || metrics.lowStockItems[0];
      openWorkflow({
        tab: 'catalog',
        statusFilter: 'restock',
        itemId: target?.id,
        etsyListingId: target?.etsyListingId,
        searchQuery: target?.name || task.payload?.productName
      });
      return;
    }

    if (task.actionType === 'optimize_listing') {
      const target = inventory.find((item) => item.etsyListingId === task.payload?.listingId)
        || inventory.find((item) => item.name === task.payload?.productName);
      openWorkflow({
        tab: 'catalog',
        statusFilter: 'live',
        itemId: target?.id,
        etsyListingId: task.payload?.listingId || target?.etsyListingId,
        searchQuery: task.payload?.productName || target?.name
      });
      return;
    }

    if (task.actionType === 'plan_growth') {
      openWorkflow({
        tab: 'growth',
        actionId: 'weekly-plan'
      });
      return;
    }

    if (task.actionType === 'run_trend_scan') {
      openWorkflow({
        tab: 'command',
        actionId: 'trend-scan'
      });
      return;
    }

    openWorkflow({
      tab: task.targetTab
    });
  };

  useEffect(() => {
    if (!user) return;

    setAgentTasks((current) => {
      const existingById = new Map(current.map((task) => [task.id, task]));
      const suggestedIds = new Set(suggestedAgentTasks.map((task) => task.id));

      const mergedSuggestions = suggestedAgentTasks.map((task) => {
        const existing = existingById.get(task.id);
        if (!existing) {
          return task;
        }

        const keepStatus = existing.status === 'approved' || existing.status === 'running' || existing.status === 'failed';

        return {
          ...task,
          status: keepStatus ? existing.status : task.status,
          note: existing.note,
          createdAt: existing.createdAt || task.createdAt,
          updatedAt: existing.updatedAt || task.updatedAt
        };
      });

      const retainedHistory = current.filter((task) =>
        !suggestedIds.has(task.id) && ['completed', 'deferred', 'failed'].includes(task.status)
      );

      const next = [...mergedSuggestions, ...retainedHistory]
        .sort((left, right) => {
          const rank = { running: 0, approved: 1, suggested: 2, failed: 3, deferred: 4, completed: 5 } as const;
          return rank[left.status] - rank[right.status];
        });

      if (JSON.stringify(current) === JSON.stringify(next)) {
        return current;
      }

      persistAgentTasks(user.uid, next);
      return next;
    });
  }, [suggestedAgentTasks, user]);

  const patchAgentTask = (taskId: string, patch: Partial<AgentTask>) => {
    if (!user) return;

    setAgentTasks((current) => {
      const next = current.map((task) => (
        task.id === taskId
          ? {
              ...task,
              ...patch,
              updatedAt: new Date().toISOString()
            }
          : task
      ));
      persistAgentTasks(user.uid, next);
      return next;
    });
  };

  const approveAgentTask = (taskId: string) => {
    patchAgentTask(taskId, {
      status: 'approved',
      note: 'Approved for the next execution pass.'
    });
  };

  const deferAgentTask = (taskId: string) => {
    patchAgentTask(taskId, {
      status: 'deferred',
      note: 'Deferred by the seller for later review.'
    });
  };

  const executeAgentTask = async (task: AgentTask) => {
    if (!user) return;

    patchAgentTask(task.id!, { status: 'running', note: '' });

    try {
      if (task.actionType === 'run_trend_scan') {
        const keyword = task.payload?.keyword?.trim();
        if (!keyword) {
          throw new Error('No trend keyword was attached to this task.');
        }

        const result = await analyzeTrends(keyword);
        const trendPayload = {
          keyword,
          popularityScore: result.popularityScore,
          suggestedIdeas: result.ideas,
          analysis: result.analysis,
          competitionLevel: (result.competitionLevel || 'medium') as 'low' | 'medium' | 'high',
          opportunityWindow: result.opportunityWindow,
          ownerId: user.uid
        };

        if (localWorkspaceMode) {
          upsertLocalBucketRecord(user.uid, 'trends', {
            ...trendPayload,
            lastAnalyzed: new Date().toISOString()
          });
          syncLocalWorkspaceState(user.uid);
        } else {
          await addDoc(collection(db, 'trends'), {
            ...trendPayload,
            lastAnalyzed: serverTimestamp()
          });
        }

        patchAgentTask(task.id!, { status: 'completed', note: `Trend scan saved for ${keyword}.` });
        showToast(`Trend scan saved for ${keyword}`, 'success');
        return;
      }

      if (task.actionType === 'draft_replies') {
        const targetIds = new Set(task.payload?.interactionIds || []);
        const targets = interactions.filter((interaction) =>
          interaction.id &&
          interaction.status === 'pending' &&
          (!interaction.response || !interaction.response.trim()) &&
          (targetIds.size === 0 || targetIds.has(interaction.id))
        );

        if (targets.length === 0) {
          patchAgentTask(task.id!, { status: 'completed', note: 'No pending threads still needed reply drafts.' });
          return;
        }

        for (const interaction of targets) {
          const reply = await suggestResponse(
            interaction.message,
            `${shopProfile.shopName || 'Etsy shop'} | niche: ${shopProfile.niche} | tone: ${shopProfile.brandTone}`
          );

          if (localWorkspaceMode) {
            patchLocalBucketRecord(user.uid, 'interactions', interaction.id!, {
              response: reply
            });
          } else {
            await updateDoc(doc(db, 'interactions', interaction.id!), {
              response: reply
            });
          }
        }

        if (localWorkspaceMode) {
          syncLocalWorkspaceState(user.uid);
        }

        patchAgentTask(task.id!, { status: 'completed', note: `Drafted ${targets.length} reply ${targets.length === 1 ? 'response' : 'responses'}.` });
        showToast(`Drafted ${targets.length} buyer reply ${targets.length === 1 ? '' : 'drafts'}`, 'success');
        return;
      }

      if (task.actionType === 'queue_campaign') {
        const pack = await generateCampaignPack({
          shopName: shopProfile.shopName || user.displayName || 'Etsy shop',
          niche: shopProfile.niche,
          productName: task.payload?.productName || shopProfile.focusProduct || inventory[0]?.name || 'featured product',
          objective: 'Build the next ready-to-approve campaign block.',
          audience: shopProfile.idealCustomer,
          tone: shopProfile.brandTone,
          trendKeywords: trends.slice(0, 5).map((trend) => trend.keyword)
        });

        const entries = pack.calendar.slice(0, Math.max(1, Math.min(task.payload?.count || 3, 5)));
        for (const item of entries) {
          const scheduledAt = parseBestTimeWithOffset(item.bestTime, item.dayOffset);
          const postPayload = {
            platform: item.platform,
            content: `${item.caption}\n\n${item.hashtags.map((tag) => tag.startsWith('#') ? tag : `#${tag}`).join(' ')}`,
            imageUrl: null,
            status: 'scheduled' as const,
            scheduledAt,
            postedAt: null,
            hashtags: item.hashtags,
            campaignName: pack.campaignName,
            objective: 'Autopilot campaign queue',
            handoffStatus: 'ready' as const,
            handoffChannel: 'manual' as const,
            ownerId: user.uid,
            updatedAt: localWorkspaceMode ? new Date().toISOString() : serverTimestamp()
          };

          if (localWorkspaceMode) {
            upsertLocalBucketRecord(user.uid, 'posts', {
              ...postPayload,
              createdAt: new Date().toISOString()
            });
          } else {
            await addDoc(collection(db, 'posts'), {
              ...postPayload,
              createdAt: serverTimestamp()
            });
          }
        }

        if (localWorkspaceMode) {
          syncLocalWorkspaceState(user.uid);
        }

        patchAgentTask(task.id!, { status: 'completed', note: `Queued ${entries.length} new campaign ${entries.length === 1 ? 'post' : 'posts'}.` });
        showToast(`Queued ${entries.length} new campaign post${entries.length === 1 ? '' : 's'}`, 'success');
        return;
      }

      if (
        task.actionType === 'review_stock'
        || task.actionType === 'optimize_listing'
        || task.actionType === 'plan_growth'
        || task.actionType === 'review_publish_runway'
      ) {
        patchAgentTask(task.id!, {
          status: 'approved',
          note: `Open ${task.targetTab} to complete this ${task.category} workflow.`
        });
        openWorkflowFromAgentTask(task);
        showToast(`${task.title} is ready in ${TAB_META.find((entry) => entry.key === task.targetTab)?.label || task.targetTab}`, 'info');
        return;
      }

      patchAgentTask(task.id!, { status: 'failed', note: 'This task type is not wired yet.' });
    } catch (error) {
      const message = getReadableErrorMessage(error, 'Agent task failed');
      patchAgentTask(task.id!, { status: 'failed', note: message });
      showToast(message, 'error');
    }
  };

  const handleManualSync = async () => {
    if (syncing || !connectedAccounts.etsy) return;
    setSyncing(true);
    try {
      await syncConnectedEtsy();
    } catch (error) {
      console.error('Manual sync failed:', error);
      showToast(error instanceof Error ? error.message : 'Sync failed', 'error');
    } finally {
      setSyncing(false);
    }
  };

  const pendingCount = metrics.pendingReplies.length;
  const lowStockCount = metrics.lowStockItems.length;

  const manualMode = !connectedAccounts.etsy || shopProfile.etsyApplicationStatus !== 'connected';
  const aiMode = aiConfigured ? 'AI ready' : 'Fallback mode';
  const isLocalAnonymousWorkspace = localWorkspaceMode;
  const accountDisplayName = shopProfile.shopName || user?.displayName || (isLocalAnonymousWorkspace ? 'Local Workspace' : 'Operator');
  const accountDisplayEmail = isLocalAnonymousWorkspace ? 'Local workspace' : (user?.email || 'No email on file');

  const handleLogin = async () => {
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });

    try {
      await signInWithPopup(auth, provider);
    } catch (error: any) {
      console.error('Login failed:', error);
      const code = error?.code as string | undefined;
      const popupIssueCodes = new Set([
        'auth/popup-blocked',
        'auth/popup-closed-by-user',
        'auth/cancelled-popup-request'
      ]);

      if (code && popupIssueCodes.has(code)) {
        try {
          await signInWithRedirect(auth, provider);
          return;
        } catch (redirectError) {
          console.error('Redirect sign-in failed:', redirectError);
          showToast('Google sign-in failed in this browser. Try opening EtsyHelper in a regular Chrome tab.', 'error');
          return;
        }
      }

      if (code === 'auth/unauthorized-domain') {
        showToast('This domain is not authorized in Firebase Auth yet. Add localhost:3000 to Authorized Domains.', 'error');
        return;
      }

      showToast('Google sign-in failed. Try opening EtsyHelper in a regular Chrome tab.', 'error');
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center px-6">
        <div className="flex flex-col items-center gap-5 rounded-[2rem] border border-white/70 bg-white/80 px-10 py-10 shadow-2xl backdrop-blur">
          <div className="flex h-16 w-16 items-center justify-center rounded-[1.4rem] bg-slate-900 text-white shadow-lg">
            <Loader2 className="h-7 w-7 animate-spin" />
          </div>
          <div className="text-center">
            <p className="text-xs font-black uppercase tracking-[0.35em] text-amber-500">EtsyHelper</p>
            <p className="mt-2 text-sm font-semibold text-slate-500">Opening EtsyHelper...</p>
          </div>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen px-6 py-10">
        <div className="mx-auto flex min-h-[calc(100vh-5rem)] max-w-6xl items-center">
          <div className="grid w-full gap-8 lg:grid-cols-[1.15fr_0.85fr]">
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              className="rounded-[2.75rem] border border-white/70 bg-white/85 p-10 shadow-[0_30px_100px_-35px_rgba(15,23,42,0.35)] backdrop-blur"
            >
              <div className="mb-10 flex items-center gap-4">
                <div className="flex h-16 w-16 items-center justify-center rounded-[1.6rem] bg-slate-900 text-white shadow-xl">
                  <Store className="h-8 w-8" />
                </div>
                <div>
                  <p className="text-xs font-black uppercase tracking-[0.35em] text-amber-500">EtsyHelper</p>
                  <h1 className="mt-2 text-4xl font-extrabold tracking-tight text-slate-950">Run your shop in one place.</h1>
                </div>
              </div>

              <p className="max-w-2xl text-lg leading-8 text-slate-600">
                Plan content, manage buyer replies, track stock, and keep product ideas moving without jumping between tools.
              </p>

              <div className="mt-10 grid gap-4 md:grid-cols-3">
                <PreviewCard
                  icon={<Sparkles className="h-5 w-5" />}
                  title="Campaign packs"
                  text="Generate platform-specific content plans and queue them for manual or future automated publishing."
                />
                <PreviewCard
                  icon={<HeartHandshake className="h-5 w-5" />}
                  title="Support triage"
                  text="Classify customer risk, draft replies, and keep manual handling organized until Etsy messaging is live."
                />
                <PreviewCard
                  icon={<Package className="h-5 w-5" />}
                  title="Catalog planning"
                  text="Track restock pressure, listing improvements, and new product ideas from directional trend scans."
                />
              </div>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.05 }}
              className="rounded-[2.75rem] border border-slate-900/10 bg-slate-950 p-10 text-white shadow-[0_30px_120px_-35px_rgba(15,23,42,0.65)]"
            >
              <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-[11px] font-black uppercase tracking-[0.28em] text-amber-300">
                <ShieldCheck className="h-3.5 w-3.5" />
                Ready to work
              </div>

              <h2 className="mt-6 text-3xl font-extrabold tracking-tight">Keep daily shop work moving.</h2>
              <p className="mt-4 text-sm leading-7 text-slate-300">
                Use EtsyHelper to stage content, organize support, manage inventory, and keep the next step clear.
              </p>

              <div className="mt-8 rounded-[2rem] border border-white/10 bg-white/5 p-6">
                <p className="text-[11px] font-black uppercase tracking-[0.28em] text-slate-400">Connect later</p>
                <div className="mt-4 space-y-4">
                  <RoadmapLine title="Etsy API approval" subtitle="Add live listings, orders, and inventory sync." />
                  <RoadmapLine title="Instagram connection" subtitle="Send queued posts into a real publishing handoff." />
                  <RoadmapLine title="Metrics enrichment" subtitle="Expand into deeper traffic and conversion reporting." />
                </div>
              </div>

              <button
                onClick={handleLogin}
                className="mt-8 inline-flex w-full items-center justify-center gap-3 rounded-full bg-amber-400 px-6 py-4 text-sm font-black uppercase tracking-[0.22em] text-slate-950 transition hover:bg-amber-300"
              >
                Sign In With Google
                <ArrowRight className="h-4 w-4" />
              </button>
              <a
                href={`/?${DEMO_MODE_QUERY_PARAM}=1`}
                className="mt-4 inline-flex w-full items-center justify-center gap-3 rounded-full border border-white/10 bg-white/5 px-6 py-4 text-sm font-black uppercase tracking-[0.22em] text-white transition hover:bg-white/10"
              >
                Open Demo Workspace
                <Sparkles className="h-4 w-4" />
              </a>
            </motion.div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen text-slate-900">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_top_left,rgba(251,191,36,0.08),transparent_30%),radial-gradient(circle_at_bottom_right,rgba(244,114,182,0.08),transparent_28%)]" />

      {mobileNavOpen && (
        <div
          role="presentation"
          className="fixed inset-0 z-40 bg-slate-950/30 backdrop-blur-sm md:hidden"
          onClick={() => setMobileNavOpen(false)}
          onKeyDown={(event) => event.key === 'Escape' && setMobileNavOpen(false)}
        />
      )}

      <aside
        className={cn(
          'fixed left-0 top-0 z-50 flex h-full w-[280px] flex-col border-r border-white/60 bg-white/85 p-4 shadow-2xl backdrop-blur-xl transition-transform duration-300',
          mobileNavOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'
        )}
      >
        <div className="rounded-[2rem] border border-slate-900/10 bg-slate-950 p-5 text-white shadow-lg">
          <div className="flex items-center gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-[1.2rem] bg-amber-400 text-slate-950">
              <Store className="h-6 w-6" />
            </div>
            <div>
              <p className="text-[11px] font-black uppercase tracking-[0.32em] text-amber-300">EtsyHelper</p>
              <p className="mt-1 text-sm font-semibold text-slate-300">Shop workspace</p>
            </div>
          </div>

          <div className="mt-6 rounded-[1.4rem] border border-white/10 bg-white/5 p-4">
            <p className="text-[11px] font-black uppercase tracking-[0.26em] text-slate-400">Readiness</p>
            <div className="mt-3 flex items-end justify-between">
              <span className="text-4xl font-black text-white">{metrics.readinessScore}%</span>
              <StatusPill tone={manualMode ? 'warning' : 'success'}>
                {manualMode ? 'Manual mode' : 'Connected'}
              </StatusPill>
            </div>
            {connectedAccounts.etsy && etsyAnalytics.syncedAt && (
              <p className="mt-3 text-xs text-slate-400">
                Last sync: {formatDate(etsyAnalytics.syncedAt, 'MMM d, h:mm a')}
              </p>
            )}
            {!connectedAccounts.etsy && (
              <p className="mt-3 text-sm leading-6 text-slate-300">
                Connect Etsy in Launchpad to enable live sync.
              </p>
            )}
          </div>
        </div>

        <div className="mt-4 flex-1 space-y-2 overflow-y-auto pb-4">
          {TAB_META.map((tab) => (
            <SidebarItem
              key={tab.key}
              active={activeTab === tab.key}
              icon={tab.icon}
              label={tab.label}
              badge={
                tab.key === 'customers'
                  ? pendingCount || undefined
                  : tab.key === 'catalog'
                    ? lowStockCount || undefined
                    : tab.key === 'studio'
                      ? metrics.scheduledPosts.length || undefined
                      : undefined
              }
              onClick={() => {
                navigateToTab(tab.key);
              }}
            />
          ))}
        </div>

        <div className="rounded-[1.7rem] border border-slate-900/10 bg-white/80 p-4 shadow-sm">
          <div className="flex items-center gap-3">
            <AvatarBadge name={accountDisplayName} imageUrl={user.photoURL} />
            <div className="min-w-0">
              <p className="truncate text-sm font-bold text-slate-900">{accountDisplayName}</p>
              <p className="truncate text-xs font-medium text-slate-500">{accountDisplayEmail}</p>
            </div>
          </div>

          {isLocalAnonymousWorkspace ? (
            <button
              onClick={() => {
                void signOut(auth).finally(() => {
                  window.location.href = '/?forceLogin=1';
                });
              }}
              className="mt-4 inline-flex w-full items-center justify-center rounded-full border border-slate-200 px-4 py-3 text-[11px] font-black uppercase tracking-[0.24em] text-slate-500 transition hover:border-slate-300 hover:text-slate-800"
            >
              Use Google Account
            </button>
          ) : (
            <button
              onClick={() => {
                if (isDemoMode) {
                  window.location.href = '/';
                  return;
                }
                void signOut(auth);
              }}
              className="mt-4 inline-flex w-full items-center justify-center rounded-full border border-slate-200 px-4 py-3 text-[11px] font-black uppercase tracking-[0.24em] text-slate-500 transition hover:border-slate-300 hover:text-slate-800"
            >
              {isDemoMode ? 'Exit Demo' : 'Sign Out'}
            </button>
          )}
        </div>
      </aside>

      <main className="min-h-screen md:pl-[280px]">
        <header className="sticky top-0 z-30 border-b border-white/60 bg-[#fff9f5]/85 backdrop-blur-xl">
          <div className="mx-auto flex max-w-[1500px] flex-col gap-3 px-4 py-4 md:px-8 xl:flex-row xl:items-center xl:justify-between">
            <div className="flex min-w-0 flex-1 items-center gap-3">
              <button
                onClick={() => setMobileNavOpen(true)}
                aria-label="Open navigation"
                aria-expanded={mobileNavOpen}
                className="rounded-2xl border border-white/70 bg-white/80 p-2.5 shadow-sm transition hover:bg-white md:hidden"
              >
                <Menu className="h-5 w-5 text-slate-700" />
              </button>
              <div className="min-w-0">
                <p className="text-[11px] font-black uppercase tracking-[0.3em] text-amber-500">{TAB_META.find((tab) => tab.key === activeTab)?.label}</p>
                <h1 className="mt-1 max-w-[34rem] text-2xl font-extrabold leading-tight tracking-tight text-slate-950 lg:text-[2rem]">
                  {shopProfile.shopName || 'Your Etsy shop'} workspace
                </h1>
              </div>
            </div>

            <div className="hidden flex-wrap items-center justify-start gap-2 lg:max-w-[48rem] lg:justify-end md:flex">
              {isDemoMode && (
                <StatusPill tone="info">
                  Demo mode
                </StatusPill>
              )}
              {isLocalAnonymousWorkspace && (
                <StatusPill tone="info">
                  Local workspace
                </StatusPill>
              )}
              <StatusPill tone={metrics.pendingReplies.length > 0 ? 'warning' : 'success'}>
                {metrics.pendingReplies.length > 0 ? `${metrics.pendingReplies.length} replies pending` : 'Inbox calm'}
              </StatusPill>
              <StatusPill tone={manualMode ? 'info' : 'success'}>
                {manualMode ? 'Approval queue' : 'Automation ready'}
              </StatusPill>
              {connectedAccounts.etsy && (
                <button
                  onClick={handleManualSync}
                  disabled={syncing}
                  className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3.5 py-1.5 text-xs font-semibold text-slate-600 transition hover:border-slate-300 hover:text-slate-900 disabled:opacity-60"
                >
                  <RefreshCw className={cn('h-3.5 w-3.5', syncing && 'animate-spin')} />
                  {syncing ? 'Syncing...' : etsyAnalytics.syncedAt ? `Synced ${formatDate(etsyAnalytics.syncedAt, 'h:mm a')}` : 'Sync Etsy'}
                </button>
              )}
            </div>
          </div>
        </header>

        <div className="mx-auto max-w-[1500px] px-4 py-6 pb-24 md:px-8">
          <AnimatePresence mode="wait">
            {activeTab === 'command' && (
              <CommandCenterView
                key="command"
                user={user}
                shopProfile={shopProfile}
                connectedAccounts={connectedAccounts}
                aiConfigured={aiConfigured}
                savingProfile={savingProfile}
                inventory={inventory}
                posts={posts}
                interactions={interactions}
                trends={trends}
                agentTasks={agentTasks}
                metrics={metrics}
                setActiveTab={navigateToTab}
                saveProfile={saveProfile}
                approveAgentTask={approveAgentTask}
                deferAgentTask={deferAgentTask}
                runAgentTask={executeAgentTask}
                showToast={showToast}
                etsyAnalytics={etsyAnalytics}
                setEtsyAnalytics={setEtsyAnalytics}
                openActionQueueItem={openWorkflowFromActionQueue}
                openAgentTask={openWorkflowFromAgentTask}
              />
            )}
            {activeTab === 'studio' && (
              <StudioView
                key="studio"
                user={user}
                posts={posts}
                trends={trends}
                shopProfile={shopProfile}
                connectedAccounts={connectedAccounts}
                appCapabilities={appCapabilities}
                showToast={showToast}
                workflowFocus={workflowFocus?.tab === 'studio' ? workflowFocus : null}
                publishInstagramPost={publishInstagramPost}
              />
            )}
            {activeTab === 'customers' && (
              <CustomersView
                key="customers"
                user={user}
                interactions={interactions}
                shopProfile={shopProfile}
                showToast={showToast}
                workflowFocus={workflowFocus?.tab === 'customers' ? workflowFocus : null}
              />
            )}
            {activeTab === 'catalog' && (
              <CatalogView
                key="catalog"
                user={user}
                inventory={inventory}
                trends={trends}
                shopProfile={shopProfile}
                etsyAnalytics={etsyAnalytics}
                showToast={showToast}
                pushEtsyListingUpdate={pushEtsyListingUpdate}
                workflowFocus={workflowFocus?.tab === 'catalog' ? workflowFocus : null}
              />
            )}
            {activeTab === 'growth' && (
              <GrowthView
                key="growth"
                inventory={inventory}
                posts={posts}
                interactions={interactions}
                trends={trends}
                metrics={metrics}
                shopProfile={shopProfile}
                etsyAnalytics={etsyAnalytics}
                showToast={showToast}
              />
            )}
            {activeTab === 'launchpad' && (
              <LaunchpadView
                key="launchpad"
                connectedAccounts={connectedAccounts}
                appCapabilities={appCapabilities}
                aiConfigured={aiConfigured}
                shopProfile={shopProfile}
                saveProfile={saveProfile}
                showToast={showToast}
                syncConnectedEtsy={syncConnectedEtsy}
              />
            )}
          </AnimatePresence>
        </div>
      </main>

      <button
        onClick={() => setAgentOpen((current) => !current)}
        className="fixed bottom-6 right-4 z-50 inline-flex h-14 items-center justify-center gap-2 rounded-full bg-slate-950 px-4 text-white shadow-[0_24px_60px_-20px_rgba(15,23,42,0.65)] transition hover:scale-[1.02] md:right-6"
      >
          {agentOpen ? <X className="h-5 w-5" /> : <Bot className="h-5 w-5" />}
          <span className="hidden text-sm font-bold lg:inline">
          {agentOpen ? 'Close assistant' : 'AI assistant'}
          </span>
      </button>

      <AnimatePresence>
        {agentOpen && (
          <AgentPanel
            inventory={inventory}
            posts={posts}
            interactions={interactions}
            trends={trends}
            shopProfile={shopProfile}
            onClose={() => setAgentOpen(false)}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 18 }}
            className={cn(
              'fixed bottom-8 left-1/2 z-[70] flex -translate-x-1/2 items-center gap-3 rounded-full px-5 py-3 text-sm font-bold text-white shadow-2xl',
              toast.type === 'success' && 'bg-emerald-600',
              toast.type === 'error' && 'bg-rose-600',
              toast.type === 'info' && 'bg-slate-900'
            )}
          >
            {toast.type === 'success' ? <CheckCircle2 className="h-4 w-4" /> : toast.type === 'error' ? <AlertTriangle className="h-4 w-4" /> : <Sparkles className="h-4 w-4" />}
            {toast.message}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function AgentPanel({
  inventory,
  posts,
  interactions,
  trends,
  shopProfile,
  onClose
}: {
  inventory: InventoryItem[];
  posts: SocialPost[];
  interactions: CustomerInteraction[];
  trends: TrendAnalysis[];
  shopProfile: ShopProfile;
  onClose: () => void;
}) {
  const [messages, setMessages] = useState<Array<{ role: 'user' | 'agent'; text: string }>>([
    {
      role: 'agent',
      text: 'I can help you prioritize the queue, outline a campaign, spot stock risk, or suggest the next best move.'
    }
  ]);
  const [input, setInput] = useState('');
  const [thinking, setThinking] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, thinking]);

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  const buildContext = () => {
    const lowStock = inventory.filter((item) => item.stockLevel <= (item.reorderPoint || 5));
    const pending = interactions.filter((interaction) => interaction.status === 'pending');
    const queued = posts.filter((post) => post.status === 'scheduled');

    return [
      `Shop profile: ${shopProfile.shopName || 'Unknown shop'} | niche: ${shopProfile.niche || 'unspecified'} | focus product: ${shopProfile.focusProduct || 'unspecified'} | tone: ${shopProfile.brandTone}`,
      `Inventory: ${inventory.length} items. Low stock: ${lowStock.map((item) => `${item.name} (${item.stockLevel})`).join(', ') || 'none'}.`,
      `Support queue: ${interactions.length} conversations, ${pending.length} pending.`,
      `Content queue: ${queued.length} scheduled posts. Upcoming platforms: ${queued.slice(0, 5).map((post) => post.platform).join(', ') || 'none'}.`,
      `Trend signals: ${trends.slice(0, 4).map((trend) => `${trend.keyword} (${trend.popularityScore})`).join(', ') || 'none'}.`
    ].join('\n');
  };

  const sendPrompt = async (raw?: string) => {
    const nextMessage = (raw ?? input).trim();
    if (!nextMessage || thinking) return;

    setMessages((current) => [...current, { role: 'user', text: nextMessage }]);
    setInput('');
    setThinking(true);
    try {
      const reply = await agentChat(nextMessage, buildContext());
      setMessages((current) => [...current, { role: 'agent', text: reply }]);
    } catch (error) {
      console.error('Agent chat failed:', error);
      setMessages((current) => [...current, { role: 'agent', text: 'I hit a temporary issue while drafting a response. Try again in a moment.' }]);
    } finally {
      setThinking(false);
    }
  };

  const starterPrompts = [
    'What should I focus on this week?',
    'Give me a three-post campaign idea for my hero product.',
    'Which catalog items need attention first?',
    'How should I clear my inbox backlog?'
  ];

  return (
    <motion.div
      initial={{ opacity: 0, y: 16, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 16, scale: 0.96 }}
      className="fixed bottom-28 right-4 z-50 flex max-h-[620px] w-[calc(100vw-2rem)] max-w-[460px] flex-col overflow-hidden rounded-[2rem] border border-white/80 bg-white/95 shadow-[0_30px_90px_-40px_rgba(15,23,42,0.75)] backdrop-blur-xl"
    >
      <div className="border-b border-slate-100 bg-slate-950 p-5 text-white">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white/10">
              <Bot className="h-5 w-5" />
            </div>
            <div>
              <p className="text-sm font-black uppercase tracking-[0.22em]">EtsyHelper Agent</p>
              <p className="mt-1 text-xs text-slate-300">Operator-minded advice, not fake omniscience.</p>
            </div>
          </div>
          <button onClick={onClose} className="rounded-full p-2 transition hover:bg-white/10">
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        {messages.length === 1 && (
          <div className="flex flex-wrap gap-2">
            {starterPrompts.map((prompt) => (
              <button
                key={prompt}
                onClick={() => sendPrompt(prompt)}
                className="rounded-full border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-black text-slate-600 transition hover:border-slate-300 hover:text-slate-900"
              >
                {prompt}
              </button>
            ))}
          </div>
        )}

        {messages.map((message, index) => (
          <div key={`${message.role}-${index}`} className={cn('flex', message.role === 'user' ? 'justify-end' : 'justify-start')}>
            <div className={cn(
              'max-w-[88%] rounded-[1.4rem] px-4 py-3 text-sm leading-7',
              message.role === 'user'
                ? 'rounded-br-md bg-slate-950 text-white'
                : 'rounded-bl-md border border-slate-200 bg-slate-50 text-slate-700'
            )}>
              {message.role === 'agent' ? (
                <div className="prose prose-sm prose-slate max-w-none [&_p]:my-1 [&_ul]:my-1 [&_ol]:my-1 [&_li]:my-0.5 [&_h1]:text-base [&_h2]:text-sm [&_h3]:text-sm [&_code]:text-xs [&_code]:bg-slate-200 [&_code]:px-1 [&_code]:rounded">
                  <Markdown>{message.text}</Markdown>
                </div>
              ) : (
                <p className="whitespace-pre-line">{message.text}</p>
              )}
            </div>
          </div>
        ))}

        {thinking && (
          <div className="flex justify-start">
            <div className="rounded-[1.4rem] rounded-bl-md border border-slate-200 bg-slate-50 px-4 py-3 text-slate-500">
              <div className="flex gap-1.5">
                <span className="h-2 w-2 animate-bounce rounded-full bg-slate-400" style={{ animationDelay: '0ms' }} />
                <span className="h-2 w-2 animate-bounce rounded-full bg-slate-400" style={{ animationDelay: '150ms' }} />
                <span className="h-2 w-2 animate-bounce rounded-full bg-slate-400" style={{ animationDelay: '300ms' }} />
              </div>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      <div className="border-t border-slate-100 p-4">
        <div className="flex gap-2">
          <input
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => event.key === 'Enter' && sendPrompt()}
            placeholder="Ask about priorities, content, customers, or stock risk..."
            autoComplete="off"
            className="w-full rounded-full border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-medium text-slate-700"
          />
          <button
            onClick={() => sendPrompt()}
            disabled={!input.trim() || thinking}
            aria-label="Send message"
            className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-950 text-white transition hover:bg-slate-800 disabled:opacity-60"
          >
            <ArrowUp className="h-5 w-5" />
          </button>
        </div>
      </div>
    </motion.div>
  );
}

function SidebarItem({
  active,
  icon,
  label,
  badge,
  onClick
}: {
  active: boolean;
  icon: React.ReactNode;
  label: string;
  badge?: number;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex w-full items-center justify-between rounded-[1.4rem] px-4 py-3 text-left transition',
        active ? 'bg-slate-950 text-white shadow-lg' : 'text-slate-600 hover:bg-white hover:text-slate-950'
      )}
    >
      <span className="flex items-center gap-3 text-sm font-black">
        {icon}
        {label}
      </span>
      {badge ? (
        <span className={cn(
          'rounded-full px-2.5 py-1 text-[11px] font-black',
          active ? 'bg-white/10 text-white' : 'bg-slate-100 text-slate-500'
        )}>
          {badge}
        </span>
      ) : null}
    </button>
  );
}
