import { addDays, format } from 'date-fns';
import { Timestamp } from 'firebase/firestore';

import type { CustomerInteraction, EtsyAnalyticsSnapshot, InventoryItem, SocialPost, TrendAnalysis } from '../types';
export type { EtsyAnalyticsSnapshot } from '../types';

export type Tab = 'command' | 'studio' | 'customers' | 'catalog' | 'growth' | 'launchpad';

export type CustomerStatusFilter = 'all' | 'pending' | 'replied' | 'resolved';
export type CustomerPriorityFilter = 'all' | 'urgent' | 'normal' | 'low';
export type StudioQueueFilter = 'scheduled' | 'posted' | 'all';
export type CatalogStatusFilter = 'all' | 'restock' | 'live' | 'backlog';

export type WorkflowFocus =
  | {
      tab: 'command';
      token: number;
      actionId?: string;
    }
  | {
      tab: 'studio';
      token: number;
      queueFilter?: StudioQueueFilter;
      postId?: string;
      mode?: 'overdue' | 'upcoming' | 'composer';
    }
  | {
      tab: 'customers';
      token: number;
      interactionId?: string;
      filterStatus?: CustomerStatusFilter;
      priorityFilter?: CustomerPriorityFilter;
      searchQuery?: string;
    }
  | {
      tab: 'catalog';
      token: number;
      itemId?: string;
      etsyListingId?: string;
      statusFilter?: CatalogStatusFilter;
      searchQuery?: string;
    }
  | {
      tab: 'growth';
      token: number;
      actionId?: string;
    }
  | {
      tab: 'launchpad';
      token: number;
      actionId?: string;
    };

export type Toast = {
  message: string;
  type: 'success' | 'error' | 'info';
};

export type ConnectedAccounts = {
  etsy: boolean;
  instagram: boolean;
};

export type IntegrationCapability = {
  canConnect: boolean;
  directPublishing?: boolean;
  reason?: string;
};

export type AppCapabilities = {
  etsy: IntegrationCapability;
  instagram: IntegrationCapability;
};

export type ShopProfile = {
  shopName: string;
  etsyShopUrl: string;
  niche: string;
  idealCustomer: string;
  brandTone: string;
  focusProduct: string;
  weeklyRevenueGoal: number;
  monthlyRevenueGoal: number;
  shippingLeadTimeDays: number;
  instagramHandle: string;
  etsyApplicationStatus: 'not_started' | 'under_review' | 'connected';
};

export type ActionQueueItem = {
  id: string;
  title: string;
  detail: string;
  tone: 'danger' | 'warning' | 'info' | 'success';
  tab: Tab;
  label: string;
};

export type DerivedMetrics = {
  readinessScore: number;
  profileCompletion: number;
  responseCoverage: number;
  contentCoverage: number;
  inventoryValue: number;
  atRiskRevenue: number;
  averageTrendScore: number;
  pendingReplies: CustomerInteraction[];
  lowStockItems: InventoryItem[];
  upcomingPosts: SocialPost[];
  scheduledPosts: SocialPost[];
  dueNowPosts: SocialPost[];
  overduePosts: SocialPost[];
  failedPosts: SocialPost[];
  manualHandoffPosts: SocialPost[];
  retryableFailedPosts: SocialPost[];
  actionQueue: ActionQueueItem[];
};

export type EtsyShopSnapshot = {
  sourceUrl: string;
  shopName: string;
  location: string;
  sales: number;
  admirers: number;
  rating: number;
  reviewCount: number;
  listingCount: number;
  categories: string[];
  topListings: Array<{ title: string; price: number }>;
  announcement: string;
  recentReviews: string[];
};

export type EtsyConnectedShop = {
  shopId: string;
  shopName: string;
  title?: string;
  announcement?: string;
  currencyCode?: string;
  activeListingCount?: number;
};

export type EtsyLiveInventoryItem = {
  etsyListingId: string;
  name: string;
  description?: string;
  price: number;
  stockLevel: number;
  category?: string;
  tags?: string[];
  imageUrl?: string;
  sku?: string;
};

export type EtsyLiveReceiptItem = {
  receiptId: string;
  customerName: string;
  customerEmail?: string;
  message: string;
  summary: string;
  status: CustomerInteraction['status'];
  priority: CustomerInteraction['priority'];
  category: NonNullable<CustomerInteraction['category']>;
  tags: string[];
  relatedOrderId: string;
  createdAt: string;
  orderStatus: 'paid' | 'shipped' | 'canceled';
};

export type EtsyLiveSyncResponse = {
  connected: true;
  syncedAt: string;
  shop: EtsyConnectedShop;
  shopRevenue30d: number | null;
  shopOrders30d: number | null;
  averageConversionRate: number | null;
  listingMetrics: EtsyAnalyticsSnapshot['listingMetrics'];
  inventoryItems: EtsyLiveInventoryItem[];
  receiptItems: EtsyLiveReceiptItem[];
};

export type EtsyListingPushPatch = {
  title?: string;
  description?: string;
  price?: number;
  stockLevel?: number;
};

export type NewInventoryForm = {
  name: string;
  category: string;
  description: string;
  stockLevel: number;
  price: number;
  costPrice: number;
  reorderPoint: number;
  monthlySales: number;
  leadTimeDays: number;
  materialsText: string;
  sku: string;
};

export const SINGLE_STORE_URL = '';

export const DEFAULT_PROFILE: ShopProfile = {
  shopName: '',
  etsyShopUrl: '',
  niche: '',
  idealCustomer: '',
  brandTone: 'warm, premium, handmade, trustworthy',
  focusProduct: '',
  weeklyRevenueGoal: 750,
  monthlyRevenueGoal: 3000,
  shippingLeadTimeDays: 5,
  instagramHandle: '',
  etsyApplicationStatus: 'not_started'
};

export const DEFAULT_ETSY_ANALYTICS: EtsyAnalyticsSnapshot = {
  mode: 'directional',
  listingMetrics: []
};

export const DEFAULT_APP_CAPABILITIES: AppCapabilities = {
  etsy: {
    canConnect: true
  },
  instagram: {
    canConnect: true,
    directPublishing: true
  }
};

export const PLATFORM_OPTIONS: SocialPost['platform'][] = ['instagram', 'pinterest', 'facebook', 'twitter', 'tiktok'];

export const PLATFORM_COLORS: Record<SocialPost['platform'], string> = {
  instagram: 'bg-rose-500',
  pinterest: 'bg-red-500',
  facebook: 'bg-sky-600',
  twitter: 'bg-slate-900',
  tiktok: 'bg-indigo-600'
};

export const PLATFORM_SURFACES: Record<SocialPost['platform'], string> = {
  instagram: 'bg-rose-50 border-rose-100',
  pinterest: 'bg-red-50 border-red-100',
  facebook: 'bg-sky-50 border-sky-100',
  twitter: 'bg-slate-100 border-slate-200',
  tiktok: 'bg-indigo-50 border-indigo-100'
};

export const AUTO_PUBLISH_RETRY_COOLDOWN_MS = 1000 * 60 * 15;

export function toDate(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date) return value;

  const maybeTimestamp = value as { toDate?: () => Date };
  if (typeof maybeTimestamp?.toDate === 'function') {
    return maybeTimestamp.toDate();
  }

  const parsed = new Date(value as string);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function formatDate(value: unknown, formatString: string, fallback = 'No date') {
  const date = toDate(value);
  return date ? format(date, formatString) : fallback;
}

export function getTimeValue(value: unknown) {
  return toDate(value)?.getTime() ?? null;
}

export function splitCommaList(value: string) {
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function parseIntegerInput(value: string, fallback = 0) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function clampNonNegativeInteger(value: number, fallback = 0) {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(0, Math.round(value));
}

export function clampNonNegativeNumber(value: number, fallback = 0) {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(0, value);
}

function clampString(value: unknown, maxChars: number, fallback = '') {
  if (typeof value !== 'string') return fallback;
  return value.trim().slice(0, maxChars);
}

function clampStringArray(values: unknown, maxItems = 20, maxChars = 80) {
  if (!Array.isArray(values)) return [];
  return values
    .filter((value): value is string => typeof value === 'string')
    .map((value) => value.trim())
    .filter(Boolean)
    .slice(0, maxItems)
    .map((value) => value.slice(0, maxChars));
}

export function sortByDateField<T>(items: T[], field: keyof T, direction: 'asc' | 'desc' = 'desc') {
  return [...items].sort((left, right) => {
    const leftTime = toDate(left[field])?.getTime() ?? 0;
    const rightTime = toDate(right[field])?.getTime() ?? 0;
    return direction === 'asc' ? leftTime - rightTime : rightTime - leftTime;
  });
}

export function parseBestTimeWithOffset(bestTime: string, dayOffset = 0) {
  const fallback = addDays(new Date(), dayOffset);
  fallback.setHours(11, 0, 0, 0);

  const normalized = bestTime.trim().toLowerCase().replace(/\./g, '');
  if (!normalized) return fallback;

  const match12 = normalized.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/);
  if (match12) {
    let hours = Number(match12[1]);
    const minutes = Number(match12[2] || '0');
    const suffix = match12[3];
    if (Number.isNaN(hours) || Number.isNaN(minutes) || minutes < 0 || minutes > 59) return fallback;
    if (hours < 1 || hours > 12) return fallback;
    if (suffix === 'pm' && hours !== 12) hours += 12;
    if (suffix === 'am' && hours === 12) hours = 0;
    const date = addDays(new Date(), dayOffset);
    date.setHours(hours, minutes, 0, 0);
    return date;
  }

  const match24 = normalized.match(/^([01]?\d|2[0-3]):([0-5]\d)$/);
  if (match24) {
    const hours = Number(match24[1]);
    const minutes = Number(match24[2]);
    const date = addDays(new Date(), dayOffset);
    date.setHours(hours, minutes, 0, 0);
    return date;
  }

  return fallback;
}

export function getRunwayDays(item: InventoryItem) {
  if (!item.monthlySales || item.monthlySales <= 0) return null;
  return Math.max(1, Math.round(item.stockLevel / (item.monthlySales / 30)));
}

export function getProfileFromDoc(data: Record<string, unknown> | undefined): ShopProfile {
  if (!data) return DEFAULT_PROFILE;
  return {
    shopName: typeof data.shopName === 'string' ? data.shopName : DEFAULT_PROFILE.shopName,
    etsyShopUrl: typeof data.etsyShopUrl === 'string' && data.etsyShopUrl.trim()
      ? data.etsyShopUrl
      : DEFAULT_PROFILE.etsyShopUrl,
    niche: typeof data.niche === 'string' ? data.niche : DEFAULT_PROFILE.niche,
    idealCustomer: typeof data.idealCustomer === 'string' ? data.idealCustomer : DEFAULT_PROFILE.idealCustomer,
    brandTone: typeof data.brandTone === 'string' ? data.brandTone : DEFAULT_PROFILE.brandTone,
    focusProduct: typeof data.focusProduct === 'string' ? data.focusProduct : DEFAULT_PROFILE.focusProduct,
    weeklyRevenueGoal: typeof data.weeklyRevenueGoal === 'number' ? data.weeklyRevenueGoal : DEFAULT_PROFILE.weeklyRevenueGoal,
    monthlyRevenueGoal: typeof data.monthlyRevenueGoal === 'number' ? data.monthlyRevenueGoal : DEFAULT_PROFILE.monthlyRevenueGoal,
    shippingLeadTimeDays: typeof data.shippingLeadTimeDays === 'number' ? data.shippingLeadTimeDays : DEFAULT_PROFILE.shippingLeadTimeDays,
    instagramHandle: typeof data.instagramHandle === 'string' ? data.instagramHandle : DEFAULT_PROFILE.instagramHandle,
    etsyApplicationStatus: data.etsyApplicationStatus === 'not_started' || data.etsyApplicationStatus === 'connected'
      ? data.etsyApplicationStatus
      : DEFAULT_PROFILE.etsyApplicationStatus
  };
}

export function toPersistedUserProfile(profile: ShopProfile) {
  return {
    ...profile
  };
}

export function sortByScheduledDate(posts: SocialPost[]) {
  return sortByDateField(posts, 'scheduledAt', 'asc');
}

export function getLastPublishAttemptTime(post: SocialPost) {
  return getTimeValue(post.lastPublishAttemptAt);
}

export function isPostDue(post: SocialPost, now = Date.now()) {
  const scheduledTime = getTimeValue(post.scheduledAt);
  return scheduledTime !== null && scheduledTime <= now;
}

export function isPostOverdue(post: SocialPost, now = Date.now()) {
  return post.status === 'scheduled' && isPostDue(post, now);
}

export function isPublishRetryCoolingDown(post: SocialPost, now = Date.now(), cooldownMs = AUTO_PUBLISH_RETRY_COOLDOWN_MS) {
  const lastAttempt = getLastPublishAttemptTime(post);
  return lastAttempt !== null && (now - lastAttempt) < cooldownMs;
}

export function isPublicImageUrl(value?: string | null) {
  return typeof value === 'string' && /^https?:\/\//i.test(value.trim());
}

export function getOwnerScopedEtsyInventoryDocId(ownerId: string, listingId: string) {
  return `${ownerId}-etsy-${listingId}`;
}

export function getOwnerScopedEtsyReceiptDocId(ownerId: string, receiptId: string) {
  return `${ownerId}-etsy-receipt-${receiptId}`;
}

export function sanitizeEtsyInventoryForFirestore(item: EtsyLiveInventoryItem) {
  const etsyListingId = clampString(item.etsyListingId, 128);
  const name = clampString(item.name, 200);

  if (!etsyListingId || !name) {
    return null;
  }

  return {
    etsyListingId,
    name,
    description: clampString(item.description, 10000),
    stockLevel: clampNonNegativeInteger(item.stockLevel),
    price: clampNonNegativeNumber(item.price),
    category: clampString(item.category, 200),
    tags: clampStringArray(item.tags, 25, 80),
    imageUrl: clampString(item.imageUrl, 2000000),
    sku: clampString(item.sku, 128)
  };
}

export function sanitizeEtsyReceiptForFirestore(item: EtsyLiveReceiptItem) {
  const receiptId = clampString(item.receiptId, 128);
  const customerName = clampString(item.customerName, 200) || `Etsy buyer ${receiptId || 'unknown'}`;
  const createdAt = new Date(item.createdAt);

  if (!receiptId) {
    return null;
  }

  return {
    receiptId,
    customerName,
    customerEmail: clampString(item.customerEmail, 320),
    message: clampString(item.message, 10000) || 'Etsy order update imported from sync.',
    summary: clampString(item.summary, 2000),
    priority: item.priority === 'urgent' || item.priority === 'low' ? item.priority : 'normal',
    status: item.status === 'replied' || item.status === 'resolved' ? item.status : 'pending',
    category: item.category || 'other',
    tags: clampStringArray(item.tags, 20, 64),
    relatedOrderId: clampString(item.relatedOrderId, 128) || receiptId,
    orderStatus: item.orderStatus === 'shipped' || item.orderStatus === 'canceled' ? item.orderStatus : 'paid',
    timestamp: Number.isNaN(createdAt.getTime()) ? new Date() : createdAt
  };
}

export function createLocalInventoryFromEtsy(ownerId: string, item: EtsyLiveInventoryItem): InventoryItem | null {
  const sanitized = sanitizeEtsyInventoryForFirestore(item);
  if (!sanitized) return null;

  return {
    id: getOwnerScopedEtsyInventoryDocId(ownerId, sanitized.etsyListingId),
    ...sanitized,
    source: 'etsy',
    ownerId,
    updatedAt: Timestamp.fromDate(new Date())
  };
}

export function createLocalInteractionFromEtsy(
  ownerId: string,
  item: EtsyLiveReceiptItem,
  existing?: CustomerInteraction | null
): CustomerInteraction | null {
  const sanitized = sanitizeEtsyReceiptForFirestore(item);
  if (!sanitized) return null;

  const preservedStatus = existing?.status === 'replied' || existing?.status === 'resolved'
    ? existing.status
    : sanitized.status as CustomerInteraction['status'];

  return {
    id: getOwnerScopedEtsyReceiptDocId(ownerId, sanitized.receiptId),
    customerName: sanitized.customerName,
    customerEmail: sanitized.customerEmail,
    message: sanitized.message,
    response: existing?.response,
    status: preservedStatus,
    priority: sanitized.priority as CustomerInteraction['priority'],
    sentiment: existing?.sentiment,
    category: sanitized.category as CustomerInteraction['category'],
    notes: existing?.notes,
    summary: sanitized.summary,
    timestamp: existing?.timestamp || Timestamp.fromDate(sanitized.timestamp),
    respondedAt: existing?.respondedAt,
    ownerId,
    relatedOrderId: sanitized.relatedOrderId,
    tags: sanitized.tags,
    source: 'etsy_receipt',
    etsyReceiptId: sanitized.receiptId,
    orderStatus: sanitized.orderStatus as CustomerInteraction['orderStatus']
  };
}

export function mergeInventoryRecords(primary: InventoryItem[], fallback: InventoryItem[]) {
  const map = new Map<string, InventoryItem>();

  for (const item of fallback) {
    const key = item.etsyListingId || item.id || item.name;
    if (!key) continue;
    map.set(key, item);
  }

  for (const item of primary) {
    const key = item.etsyListingId || item.id || item.name;
    if (!key) continue;
    const existing = map.get(key);
    if (!existing) {
      map.set(key, item);
      continue;
    }

    map.set(key, {
      ...existing,
      ...item,
      id: item.id || existing.id,
      name: item.name || existing.name,
      description: item.description ?? existing.description,
      stockLevel: item.stockLevel,
      price: item.price,
      costPrice: item.costPrice ?? existing.costPrice,
      category: item.category ?? existing.category,
      tags: item.tags ?? existing.tags,
      imageUrl: item.imageUrl ?? existing.imageUrl,
      etsyListingId: item.etsyListingId ?? existing.etsyListingId,
      sku: item.sku ?? existing.sku,
      source: item.source ?? existing.source,
      reorderPoint: item.reorderPoint ?? existing.reorderPoint,
      monthlySales: item.monthlySales ?? existing.monthlySales,
      leadTimeDays: item.leadTimeDays ?? existing.leadTimeDays,
      materials: item.materials ?? existing.materials,
      ownerId: item.ownerId || existing.ownerId,
      updatedAt: item.updatedAt ?? existing.updatedAt,
      createdAt: item.createdAt ?? existing.createdAt
    });
  }

  return sortByDateField(Array.from(map.values()), 'updatedAt');
}

export function mergeInteractionRecords(primary: CustomerInteraction[], fallback: CustomerInteraction[]) {
  const map = new Map<string, CustomerInteraction>();

  for (const item of fallback) {
    const key = item.etsyReceiptId || item.relatedOrderId || item.id || item.customerName;
    if (!key) continue;
    map.set(key, item);
  }

  for (const item of primary) {
    const key = item.etsyReceiptId || item.relatedOrderId || item.id || item.customerName;
    if (!key) continue;
    const existing = map.get(key);
    if (!existing) {
      map.set(key, item);
      continue;
    }

    const preservedStatus = existing.status === 'resolved' || existing.status === 'replied'
      ? existing.status
      : item.status;

    map.set(key, {
      ...existing,
      ...item,
      id: item.id || existing.id,
      customerName: item.customerName || existing.customerName,
      customerEmail: item.customerEmail ?? existing.customerEmail,
      message: item.message || existing.message,
      response: item.response ?? existing.response,
      status: preservedStatus,
      priority: item.priority || existing.priority,
      sentiment: item.sentiment ?? existing.sentiment,
      category: item.category ?? existing.category,
      notes: item.notes ?? existing.notes,
      summary: item.summary ?? existing.summary,
      timestamp: item.timestamp ?? existing.timestamp,
      respondedAt: item.respondedAt ?? existing.respondedAt,
      ownerId: item.ownerId || existing.ownerId,
      relatedOrderId: item.relatedOrderId ?? existing.relatedOrderId,
      tags: item.tags ?? existing.tags,
      source: item.source ?? existing.source,
      etsyReceiptId: item.etsyReceiptId ?? existing.etsyReceiptId,
      orderStatus: item.orderStatus ?? existing.orderStatus
    });
  }

  return sortByDateField(Array.from(map.values()), 'timestamp');
}

export function buildProfileFromEtsySync(current: ShopProfile, payload: EtsyLiveSyncResponse): ShopProfile {
  const categorySummary = Array.from(
    new Set(payload.inventoryItems.map((item) => item.category).filter((value): value is string => !!value))
  ).slice(0, 3).join(', ');

  return {
    ...current,
    shopName: payload.shop.shopName || current.shopName,
    etsyShopUrl: current.etsyShopUrl || DEFAULT_PROFILE.etsyShopUrl,
    niche: current.niche || categorySummary,
    focusProduct: current.focusProduct || payload.inventoryItems[0]?.name || '',
    idealCustomer: current.idealCustomer || 'Gift-minded Etsy shoppers looking for thoughtful, niche-specific products.',
    brandTone: current.brandTone || 'Warm, polished, trustworthy, and crafted with care.',
    etsyApplicationStatus: 'connected'
  };
}

export function getSupportPlaybook(interaction: CustomerInteraction) {
  if (interaction.priority === 'urgent') {
    return 'Lead with reassurance, confirm the issue, and give a time-bound next step.';
  }
  if (interaction.category === 'custom_request') {
    return 'Clarify the scope, set boundaries, and offer a clear yes, no, or paid customization path.';
  }
  if (interaction.category === 'order_issue') {
    return 'Acknowledge the shipping or fulfillment concern first, then explain the fix or investigation plan.';
  }
  if (interaction.category === 'complaint') {
    return 'Avoid defensiveness. Restate the problem, apologize for the friction, and propose one concrete resolution.';
  }
  return 'Keep it short, warm, and specific. End with the exact next step the buyer should expect.';
}

export function createNewInventoryForm(shippingLeadTimeDays: number): NewInventoryForm {
  return {
    name: '',
    category: '',
    description: '',
    stockLevel: 0,
    price: 0,
    costPrice: 0,
    reorderPoint: 5,
    monthlySales: 0,
    leadTimeDays: shippingLeadTimeDays,
    materialsText: '',
    sku: ''
  };
}
