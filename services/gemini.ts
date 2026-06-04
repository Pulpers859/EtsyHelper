import { GoogleGenAI, Type } from '@google/genai';

const runtimeProcess = globalThis as { process?: { env?: Record<string, string | undefined> } };
const apiKey = (import.meta.env.VITE_GEMINI_API_KEY || runtimeProcess.process?.env?.GEMINI_API_KEY || '').trim();

export const aiConfigured = apiKey.length > 0;

const ai = aiConfigured ? new GoogleGenAI({ apiKey }) : null;
const CAMPAIGN_PLATFORMS = ['instagram', 'pinterest', 'facebook', 'twitter', 'tiktok'] as const;
const SENTIMENT_VALUES = ['positive', 'neutral', 'negative'] as const;
const PRIORITY_VALUES = ['urgent', 'normal', 'low'] as const;
const INTERACTION_CATEGORIES = ['question', 'complaint', 'feedback', 'order_issue', 'custom_request', 'other'] as const;

function normalizeString(value: unknown, fallback = '') {
  return typeof value === 'string' ? value.trim() : fallback;
}

function normalizeStringList(value: unknown, maxItems = 12) {
  if (!Array.isArray(value)) return [];

  return value
    .map((entry) => normalizeString(entry))
    .filter(Boolean)
    .slice(0, maxItems);
}

function normalizeEnum<T extends readonly string[]>(value: unknown, allowed: T, fallback: T[number]) {
  const normalized = normalizeString(value).toLowerCase();
  return (allowed as readonly string[]).includes(normalized) ? (normalized as T[number]) : fallback;
}

function fallbackTrendAnalysis() {
  return {
    popularityScore: 58,
    ideas: [],
    analysis: 'Directional opportunity scan unavailable.',
    competitionLevel: 'medium',
    opportunityWindow: 'Next 2 to 4 weeks'
  };
}

function fallbackListingDescription(productName: string, category?: string, features?: string[]) {
  const featureText = features?.filter(Boolean).join(', ');
  const detailLine = featureText
    ? `Key details include ${featureText}.`
    : 'Built with a handmade-shop tone that stays warm, clear, and buyer-friendly.';
  const categoryLine = category ? `This ${category.toLowerCase()} listing is designed to feel specific and giftable.` : '';

  return [
    `${productName} is made to feel thoughtful, practical, and easy to love the moment it arrives.`,
    categoryLine,
    detailLine,
    'It works well as a personal keepsake, a meaningful gift, or a small upgrade that adds personality to everyday life.',
    'If you want a version tailored to a buyer note, occasion, or custom request, EtsyHelper can turn this into a more specific draft once AI access is configured.'
  ]
    .filter(Boolean)
    .join('\n\n');
}

export interface CampaignPack {
  campaignName: string;
  strategicAngle: string;
  audienceInsight: string;
  heroOffer: string;
  calendar: Array<{
    dayOffset: number;
    dayLabel: string;
    platform: 'instagram' | 'pinterest' | 'facebook' | 'twitter' | 'tiktok';
    hook: string;
    caption: string;
    cta: string;
    bestTime: string;
    hashtags: string[];
  }>;
}

export interface BrandBaseline {
  positioning: string;
  strengths: string[];
  opportunities: string[];
  risks: string[];
  audienceAngles: string[];
  messagingPillars: string[];
}

export interface ThirtyDayPlan {
  objective: string;
  summary: string;
  weeklyFocus: Array<{
    week: string;
    focus: string;
    actions: string[];
    expectedOutcome: string;
  }>;
  kpis: Array<{
    name: string;
    target: string;
    whyItMatters: string;
  }>;
  quickWins: string[];
}

export interface GrowthRecommendation {
  title: string;
  rationale: string;
  actions: string[];
  priority: 'high' | 'medium' | 'low';
  timeframe: string;
}

export interface ListingOptimizationPack {
  positioningAngle: string;
  titleIdeas: string[];
  descriptionHook: string;
  tagIdeas: string[];
  pricingNote: string;
  merchandisingMoves: string[];
}

export interface WeeklyMarketingPlan {
  headline: string;
  weeklyGoal: string;
  primaryFocus: string;
  contentMoves: string[];
  merchandisingMoves: string[];
  supportMoves: string[];
  checkpoints: string[];
}

export interface AudienceTargetingInsightPack {
  insights: Array<{
    headline: string;
    summary: string;
    audienceAngle: string;
    reasonToAct: string;
    priority: 'high' | 'medium' | 'low';
  }>;
}

function parseJson<T>(raw: string | undefined, fallback: T): T {
  try {
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch (error) {
    console.error('Failed to parse AI response:', error);
    return fallback;
  }
}

function sanitizeSentimentAnalysis(value: unknown) {
  const parsed = value && typeof value === 'object' ? value as Record<string, unknown> : {};

  return {
    sentiment: normalizeEnum(parsed.sentiment, SENTIMENT_VALUES, 'neutral'),
    category: normalizeEnum(parsed.category, INTERACTION_CATEGORIES, 'other'),
    priority: normalizeEnum(parsed.priority, PRIORITY_VALUES, 'normal'),
    summary: normalizeString(parsed.summary, 'No summary available.') || 'No summary available.'
  };
}

function sanitizeCampaignPack(value: unknown, fallback: CampaignPack): CampaignPack {
  const parsed = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const rawCalendar = Array.isArray(parsed.calendar) ? parsed.calendar : [];

  const calendar = rawCalendar
    .map((entry, index) => {
      const item = entry && typeof entry === 'object' ? entry as Record<string, unknown> : {};
      const dayOffset = typeof item.dayOffset === 'number' && Number.isFinite(item.dayOffset)
        ? Math.max(0, Math.round(item.dayOffset))
        : index;
      const caption = normalizeString(item.caption);

      if (!caption) {
        return null;
      }

      return {
        dayOffset,
        dayLabel: normalizeString(item.dayLabel, `Day ${dayOffset + 1}`) || `Day ${dayOffset + 1}`,
        platform: normalizeEnum(item.platform, CAMPAIGN_PLATFORMS, fallback.calendar[index]?.platform || 'instagram'),
        hook: normalizeString(item.hook, 'Lead with a concrete buyer benefit.') || 'Lead with a concrete buyer benefit.',
        caption,
        cta: normalizeString(item.cta, 'Invite the shopper to view the listing.') || 'Invite the shopper to view the listing.',
        bestTime: normalizeString(item.bestTime, fallback.calendar[index]?.bestTime || '11:00') || fallback.calendar[index]?.bestTime || '11:00',
        hashtags: normalizeStringList(item.hashtags, 12)
      };
    })
    .filter((item): item is CampaignPack['calendar'][number] => !!item);

  return {
    campaignName: normalizeString(parsed.campaignName, fallback.campaignName) || fallback.campaignName,
    strategicAngle: normalizeString(parsed.strategicAngle, fallback.strategicAngle) || fallback.strategicAngle,
    audienceInsight: normalizeString(parsed.audienceInsight, fallback.audienceInsight) || fallback.audienceInsight,
    heroOffer: normalizeString(parsed.heroOffer, fallback.heroOffer) || fallback.heroOffer,
    calendar: calendar.length > 0 ? calendar : fallback.calendar
  };
}

export async function suggestResponse(customerMessage: string, shopContext?: string) {
  if (!ai) {
    return "Thanks for reaching out. I'm reviewing the details and will follow up shortly.";
  }

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: `You are EtsyHelper, a calm and professional support assistant for an Etsy shop. A customer wrote: "${customerMessage}". ${shopContext ? `Shop context: ${shopContext}.` : ''} Draft a response the owner can review before sending manually.`,
      config: {
        systemInstruction: 'Be concise, warm, clear, and practical. Offer a next step. Avoid promises you cannot verify. Keep the response under 150 words.',
      }
    });
    return response.text?.trim() || "Thanks for reaching out. I'll review this and get back to you shortly.";
  } catch (error) {
    console.error('Gemini response error:', error);
    return "Thanks for your message. I'm reviewing the details and will follow up shortly.";
  }
}

export async function analyzeTrends(category: string) {
  if (!ai) {
    return fallbackTrendAnalysis();
  }

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: `Analyze directional demand opportunities for an Etsy shop category: "${category}". You do not have live marketplace browsing or Etsy API access, so be explicit that this is an AI opportunity scan based on known buyer behavior, seasonal patterns, and common marketplace dynamics.`,
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            popularityScore: { type: Type.NUMBER },
            ideas: { type: Type.ARRAY, items: { type: Type.STRING } },
            analysis: { type: Type.STRING },
            competitionLevel: { type: Type.STRING },
            opportunityWindow: { type: Type.STRING }
          },
          required: ['popularityScore', 'ideas', 'analysis', 'competitionLevel', 'opportunityWindow']
        }
      }
    });

    return parseJson(response.text, fallbackTrendAnalysis());
  } catch (error) {
    console.error('Trend analysis error:', error);
    return fallbackTrendAnalysis();
  }
}

export async function craftSocialPost(productName: string, platform: string, tone?: string) {
  if (!ai) {
    return `Fresh in the shop: ${productName}.${tone ? ` Tone: ${tone}.` : ''}`;
  }

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: `Create a ${platform} post for an Etsy seller promoting "${productName}". ${tone ? `Brand tone: ${tone}.` : ''} Write copy the owner can approve and queue manually if needed.`,
      config: {
        systemInstruction: 'Match the platform format. Keep the post specific, tasteful, and conversion-aware. Return only the caption text with line breaks where helpful.'
      }
    });
    return response.text?.trim() || `Fresh in the shop: ${productName}.`;
  } catch (error) {
    console.error('Social post error:', error);
    return `Fresh in the shop: ${productName}.`;
  }
}

export async function generateSocialImage(prompt: string): Promise<string | null> {
  if (!ai) {
    return null;
  }

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.0-flash-exp',
      contents: `Create a polished social media visual for this Etsy product or promotion: ${prompt}. Keep it premium, clean, and product-focused.`,
      config: {
        responseModalities: ['IMAGE', 'TEXT']
      }
    });

    for (const part of response.candidates?.[0]?.content?.parts || []) {
      if (part.inlineData) {
        const mime = part.inlineData.mimeType || 'image/png';
        return `data:${mime};base64,${part.inlineData.data}`;
      }
    }

    return null;
  } catch (error) {
    console.error('Social image error:', error);
    return null;
  }
}

export async function generateDailyBriefing(stats: {
  inventory: number;
  lowStock: number;
  pendingMessages: number;
  scheduledPosts: number;
  recentTrends: string[];
}) {
  if (!ai) {
    return 'Review customer messages, low stock risk, and your next scheduled content piece.';
  }

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: `Generate a concise morning operating brief for an Etsy shop owner. Inventory items: ${stats.inventory}. Low stock items: ${stats.lowStock}. Pending customer messages: ${stats.pendingMessages}. Scheduled content pieces: ${stats.scheduledPosts}. Directional trend signals: ${stats.recentTrends.join(', ') || 'none yet'}.`,
      config: {
        systemInstruction: 'Write 3 to 4 short bullets. Prioritize revenue risk, customer trust, and content momentum. Be direct and practical.'
      }
    });
    return response.text?.trim() || 'Review customer messages, low stock risk, and your next scheduled content piece.';
  } catch (error) {
    console.error('Briefing error:', error);
    return 'Review customer messages, low stock risk, and your next scheduled content piece.';
  }
}

export async function analyzeCustomerSentiment(message: string) {
  if (!ai) {
    return sanitizeSentimentAnalysis(null);
  }

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: `Analyze this Etsy customer message and classify the operational risk: "${message}".`,
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            sentiment: { type: Type.STRING },
            category: { type: Type.STRING },
            priority: { type: Type.STRING },
            summary: { type: Type.STRING }
          },
          required: ['sentiment', 'category', 'priority', 'summary']
        }
      }
    });
    return sanitizeSentimentAnalysis(parseJson(response.text, {
      sentiment: 'neutral',
      category: 'other',
      priority: 'normal',
      summary: 'No summary available.'
    }));
  } catch (error) {
    console.error('Sentiment error:', error);
    return sanitizeSentimentAnalysis(null);
  }
}

export async function generateProductIdeas(existingProducts: string[], trendKeywords: string[]) {
  if (!ai) {
    return { ideas: [] };
  }

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: `Existing Etsy products: [${existingProducts.join(', ')}]. Directional trend signals: [${trendKeywords.join(', ')}]. Suggest five commercially plausible new product ideas that fit this catalog.`,
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            ideas: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  name: { type: Type.STRING },
                  description: { type: Type.STRING },
                  estimatedPrice: { type: Type.NUMBER },
                  demandLevel: { type: Type.STRING },
                  reasoning: { type: Type.STRING }
                },
                required: ['name', 'description', 'estimatedPrice', 'demandLevel', 'reasoning']
              }
            }
          },
          required: ['ideas']
        }
      }
    });
    return parseJson(response.text, { ideas: [] });
  } catch (error) {
    console.error('Product ideas error:', error);
    return { ideas: [] };
  }
}

export async function generateListingDescription(productName: string, category?: string, features?: string[]) {
  if (!ai) {
    return fallbackListingDescription(productName, category, features);
  }

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: `Write an Etsy listing description for "${productName}"${category ? ` in category "${category}"` : ''}${features?.length ? `. Features or materials: ${features.join(', ')}` : ''}.`,
      config: {
        systemInstruction: 'Use a warm handmade-commerce tone. Structure it with a hook, a few key details, and a clear close. Keep the result under 220 words.'
      }
    });
    return response.text?.trim() || fallbackListingDescription(productName, category, features);
  } catch (error) {
    console.error('Listing description error:', error);
    return fallbackListingDescription(productName, category, features);
  }
}

export async function generateHashtags(content: string, platform: string): Promise<string[]> {
  if (!ai) {
    return [];
  }

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: `Generate 12 relevant hashtags for this ${platform} post about an Etsy product: "${content}". Mix discoverability tags with niche tags.`,
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            hashtags: { type: Type.ARRAY, items: { type: Type.STRING } }
          },
          required: ['hashtags']
        }
      }
    });
    return parseJson(response.text, { hashtags: [] }).hashtags;
  } catch (error) {
    console.error('Hashtag error:', error);
    return [];
  }
}

export async function generateCampaignPack(input: {
  shopName: string;
  niche: string;
  productName: string;
  objective: string;
  audience: string;
  tone: string;
  trendKeywords: string[];
}) {
  const fallback: CampaignPack = {
    campaignName: `${input.productName || input.shopName || 'Featured product'} momentum push`,
    strategicAngle: 'Show craftsmanship, make the use case obvious, and repeat one clear buying reason.',
    audienceInsight: input.audience || 'Gift-minded Etsy shoppers looking for thoughtful handmade pieces.',
    heroOffer: 'Focus on story, proof, and urgency rather than heavy discounting.',
    calendar: [
      {
        dayOffset: 0,
        dayLabel: 'Day 1',
        platform: 'instagram',
        hook: 'Reveal the product in a styled lifestyle moment.',
        caption: `A closer look at ${input.productName || 'our latest release'} and why shoppers keep saving it for later.`,
        cta: 'Invite followers to browse the listing.',
        bestTime: '11:00',
        hashtags: ['etsyfinds', 'handmadebusiness', 'shopsmall']
      },
      {
        dayOffset: 2,
        dayLabel: 'Day 3',
        platform: 'pinterest',
        hook: 'Lead with search-friendly keywords and gift intent.',
        caption: `Pin-worthy inspiration for ${input.productName || 'a featured shop product'} with simple styling ideas.`,
        cta: 'Drive traffic back to the listing.',
        bestTime: '18:30',
        hashtags: ['giftideas', 'etsyshop', 'smallshop']
      },
      {
        dayOffset: 4,
        dayLabel: 'Day 5',
        platform: 'facebook',
        hook: 'Use a story-driven post that explains who it is for.',
        caption: `If you have been looking for a thoughtful handmade piece, ${input.productName || 'this release'} may be the one to keep on your radar this week.`,
        cta: 'Ask followers to comment or message for details.',
        bestTime: '13:00',
        hashtags: ['shopsmall', 'handmade', 'etsyseller']
      }
    ]
  };

  if (!ai) {
    return fallback;
  }

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: `Create a compact campaign pack for EtsyHelper.
Shop name: ${input.shopName || 'Etsy shop'}
Niche: ${input.niche || 'handmade goods'}
Focus product: ${input.productName || 'featured product'}
Objective: ${input.objective || 'increase clicks and save-for-laters'}
Audience: ${input.audience || 'gift-minded shoppers'}
Tone: ${input.tone || 'warm, polished, modern'}
Directional trend hints: ${input.trendKeywords.join(', ') || 'none'}
The plan should be realistic for a small Etsy seller running manual approvals before live API automation is enabled.`,
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            campaignName: { type: Type.STRING },
            strategicAngle: { type: Type.STRING },
            audienceInsight: { type: Type.STRING },
            heroOffer: { type: Type.STRING },
            calendar: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  dayOffset: { type: Type.NUMBER },
                  dayLabel: { type: Type.STRING },
                  platform: { type: Type.STRING },
                  hook: { type: Type.STRING },
                  caption: { type: Type.STRING },
                  cta: { type: Type.STRING },
                  bestTime: { type: Type.STRING },
                  hashtags: { type: Type.ARRAY, items: { type: Type.STRING } }
                },
                required: ['dayOffset', 'dayLabel', 'platform', 'hook', 'caption', 'cta', 'bestTime', 'hashtags']
              }
            }
          },
          required: ['campaignName', 'strategicAngle', 'audienceInsight', 'heroOffer', 'calendar']
        }
      }
    });

    return sanitizeCampaignPack(parseJson(response.text, fallback), fallback);
  } catch (error) {
    console.error('Campaign pack error:', error);
    return fallback;
  }
}

export async function generateBrandBaseline(input: {
  shopName: string;
  niche: string;
  listingCount: number;
  sales: number;
  rating: number;
  reviewCount: number;
  categories: string[];
  topListings: string[];
  announcement?: string;
  recentReviews: string[];
}) {
  const fallback: BrandBaseline = {
    positioning: `${input.shopName} is a niche Etsy shop with a friendly handmade voice and strong review trust.`,
    strengths: ['Positive customer sentiment', 'Clear catalog focus', 'Gift-friendly product mix'],
    opportunities: ['Stronger recurring content cadence', 'Seasonal campaign packaging', 'Listing message consistency'],
    risks: ['Over-reliance on a narrow product cluster', 'Limited cross-sell structure'],
    audienceAngles: ['Gift buyers', 'Personal identity stickers', 'Thank-you and appreciation shoppers'],
    messagingPillars: ['Handmade quality', 'Personality-driven design', 'Fast and thoughtful fulfillment']
  };

  if (!ai) {
    return fallback;
  }

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: `Build an Etsy brand baseline for this shop snapshot:
Shop name: ${input.shopName}
Niche: ${input.niche || 'unspecified'}
Listings: ${input.listingCount}
Sales: ${input.sales}
Rating: ${input.rating} (${input.reviewCount} reviews)
Categories: ${input.categories.join(', ') || 'none'}
Top listings: ${input.topListings.join(' | ') || 'none'}
Announcement: ${input.announcement || 'none'}
Recent review snippets: ${input.recentReviews.join(' | ') || 'none'}
Provide an honest marketing diagnosis focused on practical growth execution.`,
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            positioning: { type: Type.STRING },
            strengths: { type: Type.ARRAY, items: { type: Type.STRING } },
            opportunities: { type: Type.ARRAY, items: { type: Type.STRING } },
            risks: { type: Type.ARRAY, items: { type: Type.STRING } },
            audienceAngles: { type: Type.ARRAY, items: { type: Type.STRING } },
            messagingPillars: { type: Type.ARRAY, items: { type: Type.STRING } }
          },
          required: ['positioning', 'strengths', 'opportunities', 'risks', 'audienceAngles', 'messagingPillars']
        }
      }
    });
    return parseJson(response.text, fallback);
  } catch (error) {
    console.error('Brand baseline error:', error);
    return fallback;
  }
}

export async function generateThirtyDayPlan(input: {
  shopName: string;
  niche: string;
  focusProduct: string;
  objective: string;
  audience: string;
  baseline: BrandBaseline;
}) {
  const fallback: ThirtyDayPlan = {
    objective: input.objective || 'Increase qualified traffic and conversion consistency.',
    summary: `A four-week execution plan for ${input.shopName} with weekly themes and measurable checkpoints.`,
    weeklyFocus: [
      {
        week: 'Week 1',
        focus: 'Brand clarity and offer framing',
        actions: ['Refine listing hooks', 'Publish intro campaign content', 'Set baseline metrics'],
        expectedOutcome: 'Higher save-for-later and click intent'
      },
      {
        week: 'Week 2',
        focus: 'Content cadence and social proof',
        actions: ['Show buyer outcomes', 'Feature reviews', 'Ship 3-5 planned posts'],
        expectedOutcome: 'Improved engagement and trust signals'
      },
      {
        week: 'Week 3',
        focus: 'Conversion tightening',
        actions: ['Tune product descriptions', 'Introduce urgency/seasonality', 'Promote top listings'],
        expectedOutcome: 'Stronger add-to-cart behavior'
      },
      {
        week: 'Week 4',
        focus: 'Scale what worked',
        actions: ['Double down on winning themes', 'Retire weak creatives', 'Plan next month pipeline'],
        expectedOutcome: 'Compounding momentum into next cycle'
      }
    ],
    kpis: [
      { name: 'Engagement rate', target: '+15%', whyItMatters: 'Signals content-market resonance' },
      { name: 'Listing click-through', target: '+10%', whyItMatters: 'Measures hook and creative quality' },
      { name: 'Conversion efficiency', target: '+8%', whyItMatters: 'Revenue outcome from traffic' }
    ],
    quickWins: ['Use review quotes in social content', 'Standardize CTA structure', 'Refresh top listing hero image']
  };

  if (!ai) {
    return fallback;
  }

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: `Create a practical 30-day marketing plan for EtsyHelper.
Shop: ${input.shopName}
Niche: ${input.niche || 'unspecified'}
Focus product: ${input.focusProduct || 'unspecified'}
Primary objective: ${input.objective}
Audience: ${input.audience || 'gift-minded Etsy buyers'}
Baseline positioning: ${input.baseline.positioning}
Strengths: ${input.baseline.strengths.join(', ')}
Opportunities: ${input.baseline.opportunities.join(', ')}
Risks: ${input.baseline.risks.join(', ')}
Messaging pillars: ${input.baseline.messagingPillars.join(', ')}
Output a 4-week execution plan with KPI targets and quick wins.`,
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            objective: { type: Type.STRING },
            summary: { type: Type.STRING },
            weeklyFocus: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  week: { type: Type.STRING },
                  focus: { type: Type.STRING },
                  actions: { type: Type.ARRAY, items: { type: Type.STRING } },
                  expectedOutcome: { type: Type.STRING }
                },
                required: ['week', 'focus', 'actions', 'expectedOutcome']
              }
            },
            kpis: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  name: { type: Type.STRING },
                  target: { type: Type.STRING },
                  whyItMatters: { type: Type.STRING }
                },
                required: ['name', 'target', 'whyItMatters']
              }
            },
            quickWins: { type: Type.ARRAY, items: { type: Type.STRING } }
          },
          required: ['objective', 'summary', 'weeklyFocus', 'kpis', 'quickWins']
        }
      }
    });
    return parseJson(response.text, fallback);
  } catch (error) {
    console.error('30-day plan error:', error);
    return fallback;
  }
}

export async function generateStoreGrowthRecommendations(input: {
  shopName: string;
  niche: string;
  listingCount: number;
  topListings: Array<{ title: string; price: number }>;
  categories: string[];
  baseline: BrandBaseline;
  plan: ThirtyDayPlan;
}) {
  const fallback: GrowthRecommendation[] = [
    {
      title: 'Build an offer ladder around your best-performing listing theme',
      rationale: 'Your catalog likely has winner clusters that can carry average order value if bundled intentionally.',
      actions: [
        'Create a 3-item and 5-item bundle anchored on top listings',
        'Feature bundle savings in social content and listing images',
        'Track conversion lift vs single-item purchases for two weeks'
      ],
      priority: 'high',
      timeframe: 'This week'
    },
    {
      title: 'Turn review trust into conversion assets',
      rationale: 'Review language is often your best positioning copy and should be converted into creative immediately.',
      actions: [
        'Pull 3 short review quotes into product images or post captions',
        'Pair each quote with one clear CTA',
        'Reuse top quote across one week of campaign posts'
      ],
      priority: 'high',
      timeframe: '7 days'
    },
    {
      title: 'Run one focused campaign theme instead of scattered posting',
      rationale: 'Concentrated messaging creates stronger memory and improves click intent.',
      actions: [
        'Pick one hero product cluster',
        'Schedule 4 to 6 connected posts around one audience pain point',
        'Review engagement and listing clicks at the end of the cycle'
      ],
      priority: 'medium',
      timeframe: '30 days'
    }
  ];

  if (!ai) {
    return fallback;
  }

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: `Create high-signal, strategic growth recommendations for an Etsy shop.
Shop: ${input.shopName}
Niche: ${input.niche || 'unspecified'}
Listing count: ${input.listingCount}
Categories: ${input.categories.join(', ') || 'none'}
Top listings: ${input.topListings.map((entry) => `${entry.title} ($${entry.price.toFixed(2)})`).join(' | ') || 'none'}
Baseline positioning: ${input.baseline.positioning}
Strengths: ${input.baseline.strengths.join(', ')}
Opportunities: ${input.baseline.opportunities.join(', ')}
Risks: ${input.baseline.risks.join(', ')}
30-day plan summary: ${input.plan.summary}
Weekly focus: ${input.plan.weeklyFocus.map((week) => `${week.week}: ${week.focus}`).join(' | ')}
Return thoughtful recommendations that are specific to this store, not generic ecommerce advice.`,
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            recommendations: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  title: { type: Type.STRING },
                  rationale: { type: Type.STRING },
                  actions: { type: Type.ARRAY, items: { type: Type.STRING } },
                  priority: { type: Type.STRING },
                  timeframe: { type: Type.STRING }
                },
                required: ['title', 'rationale', 'actions', 'priority', 'timeframe']
              }
            }
          },
          required: ['recommendations']
        }
      }
    });

    const parsed = parseJson(response.text, { recommendations: fallback });
    const valid = (parsed.recommendations || []).filter((entry: GrowthRecommendation) =>
      entry?.title && entry?.rationale && Array.isArray(entry?.actions) && entry.actions.length > 0
    );
    return valid.length > 0 ? valid.slice(0, 5) : fallback;
  } catch (error) {
    console.error('Growth recommendations error:', error);
    return fallback;
  }
}

export async function generateListingOptimization(input: {
  shopName: string;
  productName: string;
  category?: string;
  description?: string;
  materials?: string[];
  price: number;
  trendKeywords: string[];
  liveSignal?: string;
}) {
  const fallback: ListingOptimizationPack = {
    positioningAngle: `${input.productName} should be framed around one clear buyer use case and one memorable material or finish detail.`,
    titleIdeas: [
      `${input.productName} Gift for Thoughtful Shoppers`,
      `${input.productName}${input.category ? ` | ${input.category}` : ''}`,
      `${input.productName} Handmade${input.materials?.[0] ? ` with ${input.materials[0]}` : ''}`
    ],
    descriptionHook: `Lead with what makes ${input.productName} easy to choose, gift, or keep.`,
    tagIdeas: [
      ...(input.category ? input.category.toLowerCase().split(/\s+/).slice(0, 2) : []),
      ...input.trendKeywords.map((keyword) => keyword.toLowerCase().replace(/\s+/g, '-')).slice(0, 4)
    ].filter(Boolean),
    pricingNote: input.price > 0
      ? `At $${input.price.toFixed(2)}, highlight craftsmanship, gift value, and what makes the piece feel worth keeping.`
      : 'Add a working price so the optimizer can give stronger positioning guidance.',
    merchandisingMoves: [
      'Show one use-case photo or outcome-driven description line.',
      'Repeat the main buyer benefit in the first two lines of the listing.',
      'Pair this item with one adjacent product for bundling or cross-sell.'
    ]
  };

  if (!ai) {
    return fallback;
  }

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: `Build a compact Etsy listing optimization pack.
Shop: ${input.shopName || 'Etsy shop'}
Product: ${input.productName}
Category: ${input.category || 'unspecified'}
Current price: $${input.price.toFixed(2)}
Materials: ${input.materials?.join(', ') || 'none listed'}
Current description: ${input.description || 'none'}
Directional trend hints: ${input.trendKeywords.join(', ') || 'none'}
Live listing signal: ${input.liveSignal || 'no live performance signal'}
Return improvements that are practical for a seller to apply today.`,
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            positioningAngle: { type: Type.STRING },
            titleIdeas: { type: Type.ARRAY, items: { type: Type.STRING } },
            descriptionHook: { type: Type.STRING },
            tagIdeas: { type: Type.ARRAY, items: { type: Type.STRING } },
            pricingNote: { type: Type.STRING },
            merchandisingMoves: { type: Type.ARRAY, items: { type: Type.STRING } }
          },
          required: ['positioningAngle', 'titleIdeas', 'descriptionHook', 'tagIdeas', 'pricingNote', 'merchandisingMoves']
        }
      }
    });

    const parsed = parseJson(response.text, fallback) as ListingOptimizationPack;
    return {
      positioningAngle: normalizeString(parsed.positioningAngle, fallback.positioningAngle) || fallback.positioningAngle,
      titleIdeas: normalizeStringList(parsed.titleIdeas, 4).length > 0 ? normalizeStringList(parsed.titleIdeas, 4) : fallback.titleIdeas,
      descriptionHook: normalizeString(parsed.descriptionHook, fallback.descriptionHook) || fallback.descriptionHook,
      tagIdeas: normalizeStringList(parsed.tagIdeas, 8),
      pricingNote: normalizeString(parsed.pricingNote, fallback.pricingNote) || fallback.pricingNote,
      merchandisingMoves: normalizeStringList(parsed.merchandisingMoves, 5).length > 0 ? normalizeStringList(parsed.merchandisingMoves, 5) : fallback.merchandisingMoves
    };
  } catch (error) {
    console.error('Listing optimization error:', error);
    return fallback;
  }
}

export async function generateWeeklyMarketingPlan(input: {
  shopName: string;
  niche: string;
  focusProduct: string;
  monthlyRevenueGoal: number;
  liveRevenue30d?: number | null;
  queuedPostCount: number;
  lowStockItems: string[];
  urgentConversations: string[];
  trendKeywords: string[];
  topListings: string[];
}) {
  const fallback: WeeklyMarketingPlan = {
    headline: `Weekly plan for ${input.shopName || 'your shop'}`,
    weeklyGoal: input.monthlyRevenueGoal > 0
      ? `Support progress toward the $${input.monthlyRevenueGoal.toFixed(0)} monthly goal with one focused product story and steady buyer follow-through.`
      : 'Keep momentum by supporting one focused product story and steady buyer follow-through.',
    primaryFocus: input.focusProduct || input.topListings[0] || 'Featured product push',
    contentMoves: [
      'Publish one proof-driven post and one behind-the-scenes post.',
      'Reuse the strongest product angle across two platforms.',
      input.queuedPostCount < 3 ? 'Queue at least three approved posts for the week.' : 'Tighten the next queued posts around one clear offer.'
    ],
    merchandisingMoves: [
      input.lowStockItems.length > 0 ? `Restock or de-emphasize ${input.lowStockItems[0]} before pushing it harder.` : 'Review one listing title and first paragraph for clarity.',
      'Cross-sell a related item in the description or follow-up content.',
      'Refresh one hero listing with a stronger use-case angle.'
    ],
    supportMoves: [
      input.urgentConversations.length > 0 ? `Clear urgent buyer threads first: ${input.urgentConversations.slice(0, 2).join(', ')}.` : 'Keep inbox response times tight to protect conversion trust.',
      'Save one reusable reply draft for common buyer questions.',
      'Log notes on any request that could become a new listing angle.'
    ],
    checkpoints: [
      'Review reply backlog by midweek.',
      'Check whether the top listing angle is showing up consistently in content.',
      'End the week by choosing one winning message to repeat next week.'
    ]
  };

  if (!ai) {
    return fallback;
  }

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: `Create a one-week Etsy operating and marketing plan.
Shop: ${input.shopName || 'Etsy shop'}
Niche: ${input.niche || 'unspecified'}
Focus product: ${input.focusProduct || 'unspecified'}
Monthly revenue goal: ${input.monthlyRevenueGoal || 0}
Live revenue last 30 days: ${input.liveRevenue30d ?? 'unknown'}
Queued post count: ${input.queuedPostCount}
Low stock items: ${input.lowStockItems.join(', ') || 'none'}
Urgent conversations: ${input.urgentConversations.join(', ') || 'none'}
Trend keywords: ${input.trendKeywords.join(', ') || 'none'}
Top listings: ${input.topListings.join(', ') || 'none'}
Return a concise weekly plan with content, merchandising, support, and checkpoints.`,
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            headline: { type: Type.STRING },
            weeklyGoal: { type: Type.STRING },
            primaryFocus: { type: Type.STRING },
            contentMoves: { type: Type.ARRAY, items: { type: Type.STRING } },
            merchandisingMoves: { type: Type.ARRAY, items: { type: Type.STRING } },
            supportMoves: { type: Type.ARRAY, items: { type: Type.STRING } },
            checkpoints: { type: Type.ARRAY, items: { type: Type.STRING } }
          },
          required: ['headline', 'weeklyGoal', 'primaryFocus', 'contentMoves', 'merchandisingMoves', 'supportMoves', 'checkpoints']
        }
      }
    });

    const parsed = parseJson(response.text, fallback) as WeeklyMarketingPlan;
    return {
      headline: normalizeString(parsed.headline, fallback.headline) || fallback.headline,
      weeklyGoal: normalizeString(parsed.weeklyGoal, fallback.weeklyGoal) || fallback.weeklyGoal,
      primaryFocus: normalizeString(parsed.primaryFocus, fallback.primaryFocus) || fallback.primaryFocus,
      contentMoves: normalizeStringList(parsed.contentMoves, 5).length > 0 ? normalizeStringList(parsed.contentMoves, 5) : fallback.contentMoves,
      merchandisingMoves: normalizeStringList(parsed.merchandisingMoves, 5).length > 0 ? normalizeStringList(parsed.merchandisingMoves, 5) : fallback.merchandisingMoves,
      supportMoves: normalizeStringList(parsed.supportMoves, 5).length > 0 ? normalizeStringList(parsed.supportMoves, 5) : fallback.supportMoves,
      checkpoints: normalizeStringList(parsed.checkpoints, 5).length > 0 ? normalizeStringList(parsed.checkpoints, 5) : fallback.checkpoints
    };
  } catch (error) {
    console.error('Weekly marketing plan error:', error);
    return fallback;
  }
}

export async function generateAudienceTargetingInsights(input: {
  shopName: string;
  niche: string;
  idealCustomer: string;
  focusProduct: string;
  trendKeywords: string[];
  topListings: string[];
  lowStockItems: string[];
  liveSignal?: string;
}) {
  const fallback: AudienceTargetingInsightPack = {
    insights: [
      {
        headline: 'Lean into gift-intent shoppers',
        summary: 'Gift-oriented messaging is still the cleanest path when the catalog has emotionally resonant or occasion-friendly items.',
        audienceAngle: 'Position the hero product as an easy, meaningful gift choice.',
        reasonToAct: 'Gift framing usually shortens decision time and improves click intent.',
        priority: 'high'
      },
      {
        headline: 'Tie product language to one current trend theme',
        summary: 'Trend scans work best when you repeat one phrase cluster across listing copy and content.',
        audienceAngle: input.trendKeywords[0] || 'Use one clear theme shoppers are already browsing for.',
        reasonToAct: 'Consistency makes the shop easier to remember and improves search resonance.',
        priority: 'medium'
      },
      {
        headline: 'Promote what you can actually fulfill',
        summary: 'Keep demand generation pointed at items that are in stock and easy to ship cleanly.',
        audienceAngle: input.lowStockItems.length > 0 ? `De-emphasize ${input.lowStockItems[0]} and shift attention to a steadier listing.` : 'Feature the most stable listing first.',
        reasonToAct: 'Protects buyer trust while keeping momentum on the right items.',
        priority: 'medium'
      }
    ]
  };

  if (!ai) {
    return fallback;
  }

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: `Generate predictive audience and targeting insights for an Etsy seller.
Shop: ${input.shopName || 'Etsy shop'}
Niche: ${input.niche || 'unspecified'}
Ideal customer: ${input.idealCustomer || 'unspecified'}
Focus product: ${input.focusProduct || 'unspecified'}
Trend signals: ${input.trendKeywords.join(', ') || 'none'}
Top listings: ${input.topListings.join(', ') || 'none'}
Low stock items: ${input.lowStockItems.join(', ') || 'none'}
Live signal: ${input.liveSignal || 'no live performance signal'}
Return the most useful audience angles, trend themes, and targeting moves the seller should think about next.`,
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            insights: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  headline: { type: Type.STRING },
                  summary: { type: Type.STRING },
                  audienceAngle: { type: Type.STRING },
                  reasonToAct: { type: Type.STRING },
                  priority: { type: Type.STRING }
                },
                required: ['headline', 'summary', 'audienceAngle', 'reasonToAct', 'priority']
              }
            }
          },
          required: ['insights']
        }
      }
    });

    const parsed = parseJson(response.text, fallback) as AudienceTargetingInsightPack;
    const insights = (parsed.insights || [])
      .map((insight) => ({
        headline: normalizeString(insight.headline),
        summary: normalizeString(insight.summary),
        audienceAngle: normalizeString(insight.audienceAngle),
        reasonToAct: normalizeString(insight.reasonToAct),
        priority: normalizeEnum(insight.priority, ['high', 'medium', 'low'] as const, 'medium')
      }))
      .filter((insight) => insight.headline && insight.summary && insight.audienceAngle && insight.reasonToAct)
      .slice(0, 4);

    return { insights: insights.length > 0 ? insights : fallback.insights };
  } catch (error) {
    console.error('Audience targeting insights error:', error);
    return fallback;
  }
}

export async function agentChat(message: string, context: string) {
  if (!ai) {
    return 'AI drafting is not configured yet. Use the Launchpad to confirm your API setup, then ask again for priority, content, or catalog guidance.';
  }

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: `${message}\n\nCurrent shop context:\n${context}`,
      config: {
        systemInstruction: 'You are EtsyHelper, an operator-minded assistant for an Etsy seller. Help with priorities, content planning, customer communication, inventory risk, and growth ideas. Be direct, actionable, and honest about missing live integrations.'
      }
    });
    return response.text?.trim() || 'Try asking about your next marketing move, customer queue, or inventory risk.';
  } catch (error) {
    console.error('Agent chat error:', error);
    return 'I hit a temporary issue. Try asking again in a moment.';
  }
}
