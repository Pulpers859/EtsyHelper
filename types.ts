import { Timestamp, FieldValue } from 'firebase/firestore';

type FirestoreTimestamp = Timestamp | FieldValue | Date | string;

export interface InventoryItem {
  id?: string;
  name: string;
  description?: string;
  stockLevel: number;
  price: number;
  costPrice?: number;
  category?: string;
  tags?: string[];
  imageUrl?: string;
  etsyListingId?: string;
  sku?: string;
  source?: 'manual' | 'etsy';
  reorderPoint?: number;
  monthlySales?: number;
  leadTimeDays?: number;
  materials?: string[];
  ownerId: string;
  updatedAt: FirestoreTimestamp;
  createdAt?: FirestoreTimestamp;
}

export interface SocialPost {
  id?: string;
  platform: 'instagram' | 'pinterest' | 'facebook' | 'twitter' | 'tiktok';
  content: string;
  imageUrl?: string;
  assetPath?: string;
  status: 'draft' | 'scheduled' | 'posted' | 'failed';
  scheduledAt?: Timestamp | Date | string;
  postedAt?: Timestamp | Date | string;
  ownerId: string;
  updatedAt: FirestoreTimestamp;
  createdAt?: FirestoreTimestamp;
  hashtags?: string[];
  pillar?: string;
  campaignName?: string;
  objective?: string;
  handoffStatus?: 'draft' | 'ready' | 'posted';
  handoffChannel?: 'manual' | 'instagram' | 'pinterest' | 'facebook' | 'twitter' | 'tiktok';
  externalPostId?: string;
  publishedPermalink?: string;
  publishError?: string;
  lastPublishAttemptAt?: FirestoreTimestamp;
  engagement?: {
    likes: number;
    shares: number;
    comments: number;
    reach?: number;
    clicks?: number;
  };
}

export interface CustomerInteraction {
  id?: string;
  customerName: string;
  customerEmail?: string;
  message: string;
  response?: string;
  status: 'pending' | 'replied' | 'resolved';
  priority: 'urgent' | 'normal' | 'low';
  sentiment?: 'positive' | 'neutral' | 'negative';
  category?: 'question' | 'complaint' | 'feedback' | 'order_issue' | 'custom_request' | 'other';
  notes?: string;
  summary?: string;
  timestamp: FirestoreTimestamp;
  respondedAt?: FirestoreTimestamp;
  ownerId: string;
  relatedOrderId?: string;
  tags?: string[];
  source?: 'manual' | 'etsy_receipt';
  etsyReceiptId?: string;
  orderStatus?: 'paid' | 'shipped' | 'canceled';
}

export interface TrendAnalysis {
  id?: string;
  keyword: string;
  popularityScore: number;
  suggestedIdeas: string[];
  analysis?: string;
  competitionLevel?: 'low' | 'medium' | 'high';
  opportunityWindow?: string;
  lastAnalyzed: FirestoreTimestamp;
  ownerId: string;
}

export interface AIInsight {
  id?: string;
  type: 'briefing' | 'suggestion' | 'alert' | 'opportunity';
  title: string;
  content: string;
  priority: 'high' | 'medium' | 'low';
  actionable: boolean;
  actionLabel?: string;
  actionTab?: string;
  createdAt: FirestoreTimestamp;
  dismissed?: boolean;
  ownerId: string;
}

export interface AgentTask {
  id?: string;
  title: string;
  detail: string;
  category: 'support' | 'content' | 'catalog' | 'growth' | 'trend';
  risk: 'low' | 'medium' | 'high';
  status: 'suggested' | 'approved' | 'running' | 'completed' | 'deferred' | 'failed';
  actionType: 'draft_replies' | 'queue_campaign' | 'run_trend_scan' | 'review_stock' | 'optimize_listing' | 'plan_growth' | 'review_publish_runway';
  targetTab: 'command' | 'studio' | 'customers' | 'catalog' | 'growth' | 'launchpad';
  ownerId: string;
  createdAt: FirestoreTimestamp;
  updatedAt: FirestoreTimestamp;
  note?: string;
  payload?: {
    keyword?: string;
    productName?: string;
    listingId?: string;
    interactionIds?: string[];
    count?: number;
  };
}

export interface AudienceTargetingInsight {
  headline: string;
  summary: string;
  audienceAngle: string;
  reasonToAct: string;
  priority: 'high' | 'medium' | 'low';
}

export interface ProductIdea {
  name: string;
  description: string;
  estimatedPrice: number;
  demandLevel: string;
  reasoning?: string;
}

export interface EtsyListingMetric {
  listingId: string;
  title: string;
  price?: number;
  views30d?: number | null;
  favorites30d?: number | null;
  orders30d?: number | null;
  revenue30d?: number | null;
  conversionRate?: number | null;
  confidence: 'directional' | 'live';
}

export interface EtsyAnalyticsSnapshot {
  mode: 'directional' | 'live_etsy';
  syncedAt?: string;
  shopRevenue30d?: number | null;
  shopOrders30d?: number | null;
  averageConversionRate?: number | null;
  listingMetrics: EtsyListingMetric[];
}
