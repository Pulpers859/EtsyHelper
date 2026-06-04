import type { User } from 'firebase/auth';
import { Timestamp } from 'firebase/firestore';

import type { ConnectedAccounts, ShopProfile } from './core';
import type { CustomerInteraction, EtsyAnalyticsSnapshot, InventoryItem, SocialPost, TrendAnalysis } from '../types';

export const DEMO_MODE_QUERY_PARAM = 'demo';

const demoNow = new Date();

export function isDemoModeEnabled(search: string) {
  return new URLSearchParams(search).get(DEMO_MODE_QUERY_PARAM) === '1';
}

export const DEMO_USER = {
  uid: 'demo-user',
  displayName: 'PipersPress Demo',
  email: 'demo@etsyhelper.local',
  photoURL: ''
} as User;

export const DEMO_CONNECTED_ACCOUNTS: ConnectedAccounts = {
  etsy: false,
  instagram: false
};

export const DEMO_SHOP_PROFILE: ShopProfile = {
  shopName: 'PipersPress',
  etsyShopUrl: 'https://www.etsy.com/shop/PipersPress',
  niche: 'Stickers, thank-you cards, and cheerful giftable paper goods',
  idealCustomer: 'Gift-minded shoppers who want warm, affordable, personality-driven products.',
  brandTone: 'Warm, upbeat, handmade, trustworthy',
  focusProduct: 'Vehicle Sticker',
  weeklyRevenueGoal: 900,
  monthlyRevenueGoal: 3600,
  shippingLeadTimeDays: 3,
  instagramHandle: '@piperspress',
  etsyApplicationStatus: 'under_review'
};

const demoTimestamp = (offsetMs = 0) => Timestamp.fromDate(new Date(Date.now() + offsetMs));

export const DEMO_INVENTORY: InventoryItem[] = [
  {
    id: 'demo-item-1',
    name: 'Vehicle Sticker',
    description: 'A fast-moving vinyl sticker with broad gift appeal.',
    stockLevel: 18,
    price: 3.25,
    costPrice: 0.85,
    category: 'Stickers',
    tags: ['vehicle', 'vinyl', 'gift'],
    ownerId: DEMO_USER.uid,
    monthlySales: 42,
    reorderPoint: 10,
    leadTimeDays: 3,
    updatedAt: demoTimestamp()
  },
  {
    id: 'demo-item-2',
    name: 'Black Bear Sticker',
    description: 'Outdoor-flavored sticker with strong niche appeal.',
    stockLevel: 6,
    price: 3.25,
    costPrice: 0.9,
    category: 'Stickers',
    tags: ['bear', 'outdoors'],
    ownerId: DEMO_USER.uid,
    monthlySales: 20,
    reorderPoint: 8,
    leadTimeDays: 4,
    updatedAt: demoTimestamp()
  },
  {
    id: 'demo-item-3',
    name: 'Medical Thank You Cards',
    description: 'A niche appreciation product with room for seasonal pushes.',
    stockLevel: 11,
    price: 8.5,
    costPrice: 2.2,
    category: 'Cards',
    tags: ['medical', 'gratitude'],
    ownerId: DEMO_USER.uid,
    monthlySales: 9,
    reorderPoint: 4,
    leadTimeDays: 5,
    updatedAt: demoTimestamp()
  }
];

export const DEMO_POSTS: SocialPost[] = [
  {
    id: 'demo-post-1',
    platform: 'instagram',
    content: 'A small sticker can still be the perfect little mood boost. #stickers #etsyfinds #giftideas',
    status: 'scheduled',
    scheduledAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    ownerId: DEMO_USER.uid,
    updatedAt: demoTimestamp(),
    campaignName: 'Spring Sticker Push',
    objective: 'Drive save-for-laters and low-friction clicks',
    handoffStatus: 'ready',
    handoffChannel: 'manual'
  },
  {
    id: 'demo-post-2',
    platform: 'pinterest',
    content: 'Giftable paper goods that feel personal without blowing the budget.',
    status: 'scheduled',
    scheduledAt: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000),
    ownerId: DEMO_USER.uid,
    updatedAt: demoTimestamp(),
    campaignName: 'Evergreen Gift Traffic',
    objective: 'Capture high-intent search traffic',
    handoffStatus: 'ready',
    handoffChannel: 'manual'
  },
  {
    id: 'demo-post-3',
    platform: 'facebook',
    content: 'This order is officially heading out. Handmade, packed, and ready to make someone smile.',
    status: 'posted',
    scheduledAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
    postedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
    ownerId: DEMO_USER.uid,
    updatedAt: demoTimestamp(),
    engagement: {
      likes: 28,
      shares: 3,
      comments: 5
    },
    handoffStatus: 'posted',
    handoffChannel: 'manual'
  }
];

export const DEMO_INTERACTIONS: CustomerInteraction[] = [
  {
    id: 'demo-interaction-1',
    customerName: 'Taylor',
    message: 'Can you tell me if this sticker is weatherproof for a car window?',
    response: 'Yes. These stickers are printed on durable vinyl and hold up well for normal vehicle use.',
    status: 'pending',
    priority: 'normal',
    sentiment: 'neutral',
    category: 'question',
    summary: 'Buyer is checking product durability before purchase.',
    timestamp: demoTimestamp(-4 * 60 * 60 * 1000),
    ownerId: DEMO_USER.uid
  },
  {
    id: 'demo-interaction-2',
    customerName: 'Morgan',
    message: 'My card order arrived and it looks amazing. Thank you!',
    status: 'resolved',
    priority: 'low',
    sentiment: 'positive',
    category: 'feedback',
    summary: 'Positive post-delivery feedback.',
    timestamp: demoTimestamp(-28 * 60 * 60 * 1000),
    ownerId: DEMO_USER.uid
  }
];

export const DEMO_TRENDS: TrendAnalysis[] = [
  {
    id: 'demo-trend-1',
    keyword: 'car decals',
    popularityScore: 78,
    suggestedIdeas: ['seasonal sticker bundles', 'custom initial decals'],
    analysis: 'Search intent looks steady and evergreen, with room for themed bundles.',
    competitionLevel: 'medium',
    opportunityWindow: 'Next 30-60 days',
    lastAnalyzed: demoTimestamp(),
    ownerId: DEMO_USER.uid
  },
  {
    id: 'demo-trend-2',
    keyword: 'thank you cards',
    popularityScore: 64,
    suggestedIdeas: ['bulk nurse appreciation cards', 'teacher gratitude mini sets'],
    analysis: 'Good niche demand with stronger conversion when tied to specific recipient groups.',
    competitionLevel: 'medium',
    opportunityWindow: 'Evergreen with seasonal spikes',
    lastAnalyzed: demoTimestamp(),
    ownerId: DEMO_USER.uid
  }
];

export const DEMO_ETSY_ANALYTICS: EtsyAnalyticsSnapshot = {
  mode: 'directional',
  syncedAt: demoNow.toISOString(),
  listingMetrics: [
    {
      listingId: 'demo-listing-1',
      title: 'Vehicle Sticker',
      price: 3.25,
      confidence: 'directional'
    },
    {
      listingId: 'demo-listing-2',
      title: 'Medical Thank You Cards',
      price: 8.5,
      confidence: 'directional'
    }
  ]
};
