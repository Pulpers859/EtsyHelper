import React, { useEffect, useMemo, useRef, useState } from 'react';
import { addDays, addWeeks, format, isSameDay, startOfWeek, subWeeks } from 'date-fns';
import { addDoc, collection, deleteDoc, doc, serverTimestamp, updateDoc } from 'firebase/firestore';
import { motion } from 'framer-motion';
import {
  Bot,
  Calendar,
  ChevronLeft,
  ChevronRight,
  Copy,
  ExternalLink,
  Grid3X3,
  Hash,
  Image as ImageIcon,
  Lightbulb,
  List,
  Loader2,
  Sparkles,
  Trash2,
  Upload,
  X
} from 'lucide-react';
import type { User } from 'firebase/auth';

import { db } from '../lib/firebase';
import { cn } from '../lib/utils';
import {
  AUTO_PUBLISH_RETRY_COOLDOWN_MS,
  AppCapabilities,
  ConnectedAccounts,
  formatDate,
  isPostDue,
  isPostOverdue,
  isPublishRetryCoolingDown,
  isPublicImageUrl,
  parseBestTimeWithOffset,
  PLATFORM_COLORS,
  PLATFORM_OPTIONS,
  PLATFORM_SURFACES,
  ShopProfile,
  StudioQueueFilter,
  sortByDateField,
  sortByScheduledDate,
  splitCommaList,
  toDate,
  type Toast,
  type WorkflowFocus
} from '../app/core';
import {
  deleteLocalBucketRecord,
  isLocalWorkspaceUser,
  patchLocalBucketRecord,
  upsertLocalBucketRecord
} from '../app/localWorkspace';
import { deleteSocialAssetByPath, uploadDataUrlSocialAsset } from '../services/media';
import {
  craftSocialPost,
  generateCampaignPack,
  generateHashtags,
  generateSocialImage,
  type CampaignPack
} from '../services/gemini';
import { EmptyState, MiniActionButton, ProfileField, SectionCard, StatusPill } from '../components/shell';
import type { SocialPost, TrendAnalysis } from '../types';

type StudioViewProps = {
  user: User;
  posts: SocialPost[];
  trends: TrendAnalysis[];
  shopProfile: ShopProfile;
  connectedAccounts: ConnectedAccounts;
  appCapabilities: AppCapabilities;
  showToast: (message: string, type?: Toast['type']) => void;
  workflowFocus: Extract<WorkflowFocus, { tab: 'studio' }> | null;
  publishInstagramPost: (post: SocialPost, options?: { suppressToast?: boolean }) => Promise<{ ok: true } | { ok: false; error: string }>;
};

async function fileToDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
        return;
      }
      reject(new Error('The selected file could not be read.'));
    };
    reader.onerror = () => reject(reader.error || new Error('The selected file could not be read.'));
    reader.readAsDataURL(file);
  });
}

function extractHashtags(content: string) {
  const matches = content.match(/#([A-Za-z0-9_]+)/g) || [];
  const seen = new Set<string>();
  const hashtags: string[] = [];

  for (const match of matches) {
    const normalized = match.replace(/^#/, '').trim();
    const key = normalized.toLowerCase();
    if (!normalized || seen.has(key)) continue;
    seen.add(key);
    hashtags.push(normalized);
  }

  return hashtags;
}

function getPostStatusTone(status: SocialPost['status']) {
  if (status === 'posted') return 'success' as const;
  if (status === 'failed') return 'danger' as const;
  if (status === 'draft') return 'info' as const;
  return 'warning' as const;
}

export default function StudioView({
  user,
  posts,
  trends,
  shopProfile,
  connectedAccounts,
  appCapabilities,
  showToast,
  workflowFocus,
  publishInstagramPost
}: StudioViewProps) {
  const [viewMode, setViewMode] = useState<'queue' | 'calendar'>('queue');
  const [platform, setPlatform] = useState<SocialPost['platform']>('instagram');
  const [productName, setProductName] = useState(shopProfile.focusProduct);
  const [campaignObjective, setCampaignObjective] = useState('Drive qualified clicks and save-for-laters');
  const [campaignAudience, setCampaignAudience] = useState(shopProfile.idealCustomer);
  const [content, setContent] = useState('');
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [selectedAssetName, setSelectedAssetName] = useState('');
  const [scheduledDate, setScheduledDate] = useState(format(addDays(new Date(), 1), 'yyyy-MM-dd'));
  const [scheduledTime, setScheduledTime] = useState('11:00');
  const [campaignPack, setCampaignPack] = useState<CampaignPack | null>(null);
  const [calendarWeek, setCalendarWeek] = useState(new Date());
  const [loadingDraft, setLoadingDraft] = useState(false);
  const [loadingHashtags, setLoadingHashtags] = useState(false);
  const [loadingImage, setLoadingImage] = useState(false);
  const [uploadingAsset, setUploadingAsset] = useState(false);
  const [loadingPack, setLoadingPack] = useState(false);
  const [agentRunning, setAgentRunning] = useState(false);
  const [agentCadence, setAgentCadence] = useState<3 | 5 | 7>(5);
  const [agentVoice, setAgentVoice] = useState(shopProfile.brandTone || 'warm, premium, handmade, trustworthy');
  const [clipboardKey, setClipboardKey] = useState<string | null>(null);
  const [queueFilter, setQueueFilter] = useState<StudioQueueFilter>('scheduled');
  const [editingPostId, setEditingPostId] = useState<string | null>(null);
  const [composerAssetPath, setComposerAssetPath] = useState('');
  const [savingComposer, setSavingComposer] = useState(false);
  const [publishingPostId, setPublishingPostId] = useState<string | null>(null);
  const [focusedPostId, setFocusedPostId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const instagramDirectReady = connectedAccounts.instagram && !!appCapabilities.instagram.directPublishing;
  const manualMode = !instagramDirectReady;
  const sortedPosts = sortByScheduledDate(posts);
  const queuedPosts = sortedPosts.filter((post) => post.status !== 'posted');
  const scheduledPosts = queuedPosts.filter((post) => post.status === 'scheduled');
  const publishedPosts = sortedPosts.filter((post) => post.status === 'posted');
  const failedPosts = sortedPosts.filter((post) => post.status === 'failed');
  const dueQueuedPosts = sortByScheduledDate(scheduledPosts.filter((post) => isPostDue(post)));
  const overdueQueuedPosts = sortByScheduledDate(scheduledPosts.filter((post) => isPostOverdue(post)));
  const autoReadyDuePosts = sortByScheduledDate(scheduledPosts.filter((post) =>
    post.platform === 'instagram'
    && isPublicImageUrl(post.imageUrl)
    && instagramDirectReady
    && isPostDue(post)
    && !isPublishRetryCoolingDown(post, Date.now(), AUTO_PUBLISH_RETRY_COOLDOWN_MS)
  ));
  const manualDuePosts = sortByScheduledDate(scheduledPosts.filter((post) =>
    isPostDue(post)
    && !autoReadyDuePosts.some((candidate) => candidate.id === post.id)
  ));
  const retryReadyFailedPosts = sortByDateField(
    failedPosts.filter((post) =>
      post.platform === 'instagram'
      && isPublicImageUrl(post.imageUrl)
      && instagramDirectReady
      && !isPublishRetryCoolingDown(post, Date.now(), AUTO_PUBLISH_RETRY_COOLDOWN_MS)
    ),
    'lastPublishAttemptAt'
  );
  const visiblePosts = useMemo(() => {
    const scoped = queueFilter === 'all'
      ? sortedPosts
      : queueFilter === 'posted'
        ? publishedPosts
        : queuedPosts;

    if (!focusedPostId) {
      return scoped;
    }

    return [...scoped].sort((left, right) => {
      const leftFocused = left.id === focusedPostId ? 1 : 0;
      const rightFocused = right.id === focusedPostId ? 1 : 0;
      return rightFocused - leftFocused;
    });
  }, [focusedPostId, publishedPosts, queueFilter, queuedPosts, sortedPosts]);
  const nextQueuedPost = scheduledPosts.find((post) => toDate(post.scheduledAt));
  const assetReadyCount = queuedPosts.filter((post) => !!post.imageUrl).length;
  const missingAssetCount = queuedPosts.filter((post) => !post.imageUrl).length;
  const handoffWindowPosts = scheduledPosts.filter((post) => {
    const scheduled = toDate(post.scheduledAt);
    if (!scheduled) return false;
    const time = scheduled.getTime();
    const now = Date.now();
    return time >= now - (1000 * 60 * 60 * 12) && time <= now + (1000 * 60 * 60 * 72);
  }).slice(0, 5);
  const weekStart = startOfWeek(calendarWeek, { weekStartsOn: 0 });
  const weekDays = Array.from({ length: 7 }, (_, index) => addDays(weekStart, index));
  const openCalendarView = () => setViewMode('calendar');
  const workflowBadge = workflowFocus?.mode === 'overdue'
    ? 'Overdue handoff'
    : workflowFocus?.mode === 'composer'
      ? 'Composer focus'
      : workflowFocus?.mode === 'upcoming'
        ? 'Upcoming handoff'
        : '';

  const getPostsForDay = (day: Date) =>
    scheduledPosts.filter((post) => {
      const scheduled = toDate(post.scheduledAt);
      return scheduled ? isSameDay(scheduled, day) : false;
    });

  useEffect(() => {
    if (!workflowFocus) return;

    setViewMode('queue');
    setQueueFilter(workflowFocus.queueFilter || 'scheduled');
    setFocusedPostId(workflowFocus.postId || null);
  }, [workflowFocus]);

  const resetComposer = () => {
    setEditingPostId(null);
    setComposerAssetPath('');
    setContent('');
    setImageUrl(null);
    setSelectedAssetName('');
    setScheduledDate(format(addDays(new Date(), 1), 'yyyy-MM-dd'));
    setScheduledTime('11:00');
  };

  const persistPost = async (payload: {
    platform: SocialPost['platform'];
    content: string;
    imageUrl?: string | null;
    scheduledAt: Date;
    hashtags?: string[];
    campaignName?: string;
    objective?: string;
  }, options?: { postId?: string | null; existingAssetPath?: string }) => {
    let persistedImageUrl = payload.imageUrl?.trim() || null;
    let assetPath = options?.existingAssetPath?.trim() || '';
    let uploadedAsset = false;
    let shouldDeletePreviousAsset = false;
    let uploadedAssetPathForCleanup = '';

    try {
      if (persistedImageUrl?.startsWith('data:')) {
        const uploaded = await uploadDataUrlSocialAsset({
          dataUrl: persistedImageUrl,
          ownerId: user.uid,
          platform: payload.platform,
          filenameHint: selectedAssetName || productName || shopProfile.focusProduct || payload.platform
        });
        persistedImageUrl = uploaded.imageUrl;
        assetPath = uploaded.assetPath;
        uploadedAsset = true;
        uploadedAssetPathForCleanup = uploaded.assetPath;
        shouldDeletePreviousAsset = !!options?.existingAssetPath && options.existingAssetPath !== uploaded.assetPath;
      } else if (!persistedImageUrl && options?.existingAssetPath) {
        shouldDeletePreviousAsset = true;
        assetPath = '';
      }

      const postPayload = {
        platform: payload.platform,
        content: payload.content,
        imageUrl: persistedImageUrl,
        assetPath,
        status: 'scheduled' as const,
        scheduledAt: payload.scheduledAt,
        postedAt: null,
        hashtags: payload.hashtags || [],
        campaignName: payload.campaignName || '',
        objective: payload.objective || '',
        handoffStatus: 'ready' as const,
        handoffChannel: payload.platform === 'instagram' ? 'instagram' as const : 'manual' as const,
        publishError: '',
        externalPostId: '',
        publishedPermalink: '',
        ownerId: user.uid,
        updatedAt: serverTimestamp()
      };

      if (isLocalWorkspaceUser(user)) {
        const timestamp = new Date().toISOString();
        if (options?.postId) {
          patchLocalBucketRecord(user.uid, 'posts', options.postId, {
            ...postPayload,
            updatedAt: timestamp
          });
        } else {
          upsertLocalBucketRecord(user.uid, 'posts', {
            ...postPayload,
            updatedAt: timestamp,
            createdAt: timestamp
          });
        }
      } else if (options?.postId) {
        await updateDoc(doc(db, 'posts', options.postId), postPayload);
      } else {
        await addDoc(collection(db, 'posts'), {
          ...postPayload,
          createdAt: serverTimestamp()
        });
      }

      if (shouldDeletePreviousAsset && options?.existingAssetPath) {
        try {
          await deleteSocialAssetByPath(options.existingAssetPath);
        } catch (cleanupError) {
          console.error('Previous stored asset cleanup failed:', cleanupError);
        }
      }
    } catch (error) {
      if (uploadedAssetPathForCleanup) {
        try {
          await deleteSocialAssetByPath(uploadedAssetPathForCleanup);
        } catch (cleanupError) {
          console.error('Stored asset cleanup failed:', cleanupError);
        }
      }
      throw error;
    }

    return {
      uploadedAsset,
      retainedImage: !!persistedImageUrl,
      mode: options?.postId ? 'updated' : 'created'
    };
  };

  const handleCreateDraft = async () => {
    if (!productName.trim()) return;
    setLoadingDraft(true);
    try {
      const draft = await craftSocialPost(productName.trim(), platform, shopProfile.brandTone);
      setContent(draft);
    } catch (error) {
      console.error('Social draft generation failed:', error);
      showToast('Unable to draft post copy right now', 'error');
    } finally {
      setLoadingDraft(false);
    }
  };

  const handleGenerateHashtags = async () => {
    if (!content.trim()) return;
    setLoadingHashtags(true);
    try {
      const hashtags = await generateHashtags(content, platform);
      if (hashtags.length > 0) {
        const hashtagLine = hashtags.map((tag) => tag.startsWith('#') ? tag : `#${tag}`).join(' ');
        setContent((current) => `${current}\n\n${hashtagLine}`);
        return;
      }
      showToast('No additional hashtags were generated', 'info');
    } catch (error) {
      console.error('Hashtag generation failed:', error);
      showToast('Unable to generate hashtags right now', 'error');
    } finally {
      setLoadingHashtags(false);
    }
  };

  const handleGenerateImage = async () => {
    if (!content.trim()) return;
    setLoadingImage(true);
    try {
      const generated = await generateSocialImage(content);
      if (!generated) {
        showToast('Image generation is unavailable right now', 'info');
        return;
      }
      setImageUrl(generated);
      setSelectedAssetName(`${platform}-ai-preview`);
    } catch (error) {
      console.error('Image generation failed:', error);
      showToast('Unable to generate a visual right now', 'error');
    } finally {
      setLoadingImage(false);
    }
  };

  const handleSelectAsset = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      showToast('Choose an image file for the publishing asset', 'error');
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      showToast('Choose an image under 5 MB for a smoother handoff workflow', 'error');
      return;
    }

    setUploadingAsset(true);
    try {
      const dataUrl = await fileToDataUrl(file);
      setImageUrl(dataUrl);
      setSelectedAssetName(file.name.replace(/\.[^.]+$/, ''));
      showToast('Publishing asset loaded into the composer', 'success');
    } catch (error) {
      console.error('Asset selection failed:', error);
      showToast('Unable to load that image right now', 'error');
    } finally {
      setUploadingAsset(false);
    }
  };

  const handleQueueCurrent = async () => {
    if (!content.trim()) return;
    const scheduledAt = new Date(`${scheduledDate}T${scheduledTime}`);
    if (Number.isNaN(scheduledAt.getTime())) {
      showToast('Choose a valid date and time before queueing the post', 'error');
      return;
    }

    setSavingComposer(true);
    try {
      const currentEditId = editingPostId;
      const queued = await persistPost({
        platform,
        content,
        imageUrl,
        scheduledAt,
        hashtags: extractHashtags(content),
        objective: campaignObjective
      }, {
        postId: currentEditId,
        existingAssetPath: composerAssetPath
      });
      resetComposer();
      if (queued.mode === 'updated') {
        showToast('Queued post updated and returned to the approval runway', 'success');
        return;
      }
      if (queued.uploadedAsset) {
        showToast('Content added to queue with a stored publishing asset', 'success');
        return;
      }
      if (queued.retainedImage) {
        showToast('Content added to queue with an existing asset URL', 'success');
        return;
      }
      showToast('Content added to queue', 'success');
    } catch (error) {
      console.error('Queueing content failed:', error);
      showToast('Unable to add this content to the queue right now', 'error');
    } finally {
      setSavingComposer(false);
    }
  };

  const handleGeneratePack = async () => {
    setLoadingPack(true);
    try {
      const pack = await generateCampaignPack({
        shopName: shopProfile.shopName || user.displayName || 'Etsy shop',
        niche: shopProfile.niche,
        productName: productName || shopProfile.focusProduct || 'featured product',
        objective: campaignObjective,
        audience: campaignAudience || shopProfile.idealCustomer,
        tone: shopProfile.brandTone,
        trendKeywords: trends.slice(0, 4).map((trend) => trend.keyword)
      });
      setCampaignPack(pack);
    } catch (error) {
      console.error('Campaign pack generation failed:', error);
      showToast('Unable to generate a campaign pack right now', 'error');
    } finally {
      setLoadingPack(false);
    }
  };

  const runMarketingAgentCycle = async () => {
    setAgentRunning(true);
    try {
      const pack = await generateCampaignPack({
        shopName: shopProfile.shopName || user.displayName || 'Etsy shop',
        niche: shopProfile.niche,
        productName: productName || shopProfile.focusProduct || 'featured product',
        objective: `${campaignObjective}. Build a ${agentCadence}-step growth plan with a strategic progression.`,
        audience: campaignAudience || shopProfile.idealCustomer,
        tone: agentVoice,
        trendKeywords: trends.slice(0, 5).map((trend) => trend.keyword)
      });

      const entries = pack.calendar.slice(0, agentCadence);
      for (const item of entries) {
        const scheduledAt = parseBestTimeWithOffset(item.bestTime, item.dayOffset);
        await persistPost({
          platform: item.platform,
          content: `${item.caption}\n\n${item.hashtags.map((tag) => tag.startsWith('#') ? tag : `#${tag}`).join(' ')}`,
          scheduledAt,
          hashtags: item.hashtags,
          campaignName: pack.campaignName,
          objective: campaignObjective
        });
      }

      setCampaignPack(pack);
      showToast(`Agent queued ${entries.length} posts for approval`, 'success');
    } catch (error) {
      console.error('Marketing agent cycle failed:', error);
      showToast('Unable to queue the marketing cycle right now', 'error');
    } finally {
      setAgentRunning(false);
    }
  };

  const loadPackItem = (item: CampaignPack['calendar'][number]) => {
    setPlatform(item.platform);
    setContent(`${item.caption}\n\n${item.hashtags.map((tag) => tag.startsWith('#') ? tag : `#${tag}`).join(' ')}`);
    setScheduledDate(format(addDays(new Date(), item.dayOffset), 'yyyy-MM-dd'));
    setScheduledTime(item.bestTime);
    showToast('Loaded campaign step into the composer', 'info');
  };

  const queuePackItem = async (item: CampaignPack['calendar'][number]) => {
    try {
      const scheduledAt = parseBestTimeWithOffset(item.bestTime, item.dayOffset);
      await persistPost({
        platform: item.platform,
        content: `${item.caption}\n\n${item.hashtags.map((tag) => tag.startsWith('#') ? tag : `#${tag}`).join(' ')}`,
        scheduledAt,
        hashtags: item.hashtags,
        campaignName: campaignPack?.campaignName || '',
        objective: campaignObjective
      });
      showToast('Campaign step queued', 'success');
    } catch (error) {
      console.error('Campaign step queue failed:', error);
      showToast('Unable to queue this campaign step right now', 'error');
    }
  };

  const loadPostIntoComposer = (post: SocialPost) => {
    setEditingPostId(post.id || null);
    setComposerAssetPath(post.assetPath || '');
    setPlatform(post.platform);
    setContent(post.content);
    setImageUrl(post.imageUrl || null);
    setSelectedAssetName(post.campaignName || post.platform);
    setCampaignObjective(post.objective || campaignObjective);

    const scheduled = toDate(post.scheduledAt);
    if (scheduled) {
      setScheduledDate(format(scheduled, 'yyyy-MM-dd'));
      setScheduledTime(format(scheduled, 'HH:mm'));
    }

    showToast('Queued post loaded into the composer for revision', 'info');
  };

  const deletePost = async (post: SocialPost) => {
    if (!post.id) return;
    try {
      if (isLocalWorkspaceUser(user)) {
        deleteLocalBucketRecord(user.uid, 'posts', post.id);
      } else {
        await deleteDoc(doc(db, 'posts', post.id));
      }
      if (post.assetPath) {
        try {
          await deleteSocialAssetByPath(post.assetPath);
        } catch (cleanupError) {
          console.error('Queued post asset cleanup failed:', cleanupError);
        }
      }
      if (editingPostId === post.id) {
        resetComposer();
      }
      showToast('Queued post removed', 'info');
    } catch (error) {
      console.error('Queued post delete failed:', error);
      showToast('Unable to remove this queued post right now', 'error');
    }
  };

  const platformPostUrls: Record<SocialPost['platform'], string> = {
    instagram: 'https://www.instagram.com/',
    pinterest: 'https://www.pinterest.com/pin-creation-tool/',
    facebook: 'https://www.facebook.com/',
    twitter: 'https://x.com/compose/post',
    tiktok: 'https://www.tiktok.com/upload'
  };

  const copyPostCaption = async (post: SocialPost) => {
    try {
      await navigator.clipboard.writeText(post.content);
      setClipboardKey(post.id || post.content);
      window.setTimeout(() => setClipboardKey(null), 1800);
      showToast('Caption copied for publishing handoff', 'success');
    } catch (error) {
      console.error('Caption copy failed:', error);
      showToast('Unable to copy the caption in this browser tab', 'error');
    }
  };

  const copyAndOpenPlatform = async (post: SocialPost) => {
    try {
      await navigator.clipboard.writeText(post.content);
      setClipboardKey(post.id || post.content);
      window.setTimeout(() => setClipboardKey(null), 1800);
      window.open(platformPostUrls[post.platform], '_blank', 'noopener,noreferrer');
      showToast(`Caption copied — paste it into ${post.platform}`, 'success');
    } catch (error) {
      console.error('Copy & open failed:', error);
      showToast('Unable to copy the caption in this browser tab', 'error');
    }
  };

  const handlePublishInstagramPost = async (post: SocialPost) => {
    if (!post.id) return;
    setPublishingPostId(post.id);
    try {
      await publishInstagramPost(post);
    } finally {
      setPublishingPostId(null);
    }
  };

  const markPostStatus = async (post: SocialPost, status: SocialPost['status']) => {
    if (!post.id) return;
    try {
      if (isLocalWorkspaceUser(user)) {
        const timestamp = new Date().toISOString();
        patchLocalBucketRecord(user.uid, 'posts', post.id, {
          status,
          handoffStatus: status === 'posted' ? 'posted' : 'ready',
          handoffChannel: status === 'posted' && post.platform === 'instagram' ? 'instagram' : post.handoffChannel || 'manual',
          postedAt: status === 'posted' ? timestamp : null,
          publishError: '',
          updatedAt: timestamp
        });
      } else {
        await updateDoc(doc(db, 'posts', post.id), {
          status,
          handoffStatus: status === 'posted' ? 'posted' : 'ready',
          handoffChannel: status === 'posted' && post.platform === 'instagram' ? 'instagram' : post.handoffChannel || 'manual',
          postedAt: status === 'posted' ? serverTimestamp() : null,
          publishError: '',
          updatedAt: serverTimestamp()
        });
      }
      showToast(status === 'posted' ? 'Post marked published' : 'Post returned to the approval queue', 'success');
    } catch (error) {
      console.error('Post status update failed:', error);
      showToast('Unable to update the publishing status right now', 'error');
    }
  };

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="space-y-6">
      <SectionCard className="p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-[11px] font-black tracking-[0.08em] text-amber-500">Studio</p>
            <h2 className="mt-2 text-3xl font-extrabold tracking-tight text-slate-950">Plan and queue content</h2>
          </div>
          <StatusPill tone={manualMode ? 'warning' : 'success'}>
            {manualMode ? 'Approval queue' : 'Instagram direct'}
          </StatusPill>
        </div>

        <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-[1.5rem] border border-slate-200 bg-white p-4">
            <p className="text-[11px] font-black uppercase tracking-[0.22em] text-slate-500">Approval runway</p>
            <p className="mt-2 text-2xl font-black text-slate-950">{queuedPosts.length}</p>
            <p className="mt-2 text-sm text-slate-600">Posts still in the handoff pipeline.</p>
          </div>
          <div className="rounded-[1.5rem] border border-slate-200 bg-white p-4">
            <p className="text-[11px] font-black uppercase tracking-[0.22em] text-slate-500">Automation ready now</p>
            <p className="mt-2 text-2xl font-black text-slate-950">{autoReadyDuePosts.length}</p>
            <p className="mt-2 text-sm text-slate-600">
              {autoReadyDuePosts.length > 0
                ? 'Due Instagram posts with assets can publish automatically.'
                : `${assetReadyCount} queue item${assetReadyCount === 1 ? '' : 's'} already have assets.`}
            </p>
          </div>
          <div className="rounded-[1.5rem] border border-slate-200 bg-white p-4">
            <p className="text-[11px] font-black uppercase tracking-[0.22em] text-slate-500">Manual due now</p>
            <p className="mt-2 text-2xl font-black text-slate-950">{manualDuePosts.length}</p>
            <p className="mt-2 text-sm text-slate-600">
              {overdueQueuedPosts.length > 0
                ? `${overdueQueuedPosts.length} overdue queue item${overdueQueuedPosts.length === 1 ? '' : 's'} need immediate attention.`
                : `${missingAssetCount} queue item${missingAssetCount === 1 ? '' : 's'} still need an asset or manual handoff.`}
            </p>
          </div>
          <div className="rounded-[1.5rem] border border-slate-200 bg-white p-4">
            <p className="text-[11px] font-black uppercase tracking-[0.22em] text-slate-500">Publish issues</p>
            <p className="mt-2 text-2xl font-black text-slate-950">{failedPosts.length}</p>
            <p className="mt-2 text-sm text-slate-600">
              {retryReadyFailedPosts.length > 0
                ? `${retryReadyFailedPosts.length} failed post${retryReadyFailedPosts.length === 1 ? '' : 's'} are ready to retry now.`
                : nextQueuedPost
                  ? `Next publish block: ${formatDate(nextQueuedPost.scheduledAt, 'MMM d, h:mm a')}.`
                  : 'Nothing scheduled yet.'}
            </p>
          </div>
        </div>
      </SectionCard>

      <SectionCard className="p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-[11px] font-black tracking-[0.08em] text-amber-500">Marketing Agent</p>
            <h3 className="mt-2 text-2xl font-extrabold tracking-tight text-slate-950">Campaign agent</h3>
          </div>
          <StatusPill tone="info">Batch planner</StatusPill>
        </div>

          <p className="mt-4 text-sm leading-7 text-slate-700">
            Generate several posts at once and send them straight into the queue.
          </p>

        <div className="mt-5 grid gap-4 xl:grid-cols-[minmax(0,0.7fr)_minmax(0,1fr)_auto]">
          <div>
            <p className="mb-2 text-[11px] font-black tracking-[0.08em] text-slate-500">Cadence</p>
            <div className="flex rounded-full border border-slate-200 bg-white p-1">
              {[3, 5, 7].map((days) => (
                <button
                  key={days}
                  onClick={() => setAgentCadence(days as 3 | 5 | 7)}
                  className={cn(
                    'flex-1 rounded-full px-3 py-2 text-xs font-bold transition',
                    agentCadence === days ? 'bg-slate-950 text-white' : 'text-slate-600'
                  )}
                >
                  {days} posts
                </button>
              ))}
            </div>
          </div>

          <ProfileField
            label="Agent voice"
            value={agentVoice}
            onChange={setAgentVoice}
            placeholder="Warm, confident, premium handmade expert"
          />

          <div className="flex items-end xl:min-w-[234px]">
            <button
              onClick={runMarketingAgentCycle}
              disabled={agentRunning}
              className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-slate-950 px-5 py-3 text-sm font-bold text-white transition hover:bg-slate-800 disabled:opacity-60"
            >
              {agentRunning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Bot className="h-4 w-4" />}
              Run agent cycle
            </button>
          </div>
        </div>

      </SectionCard>

      <SectionCard className="p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-[11px] font-black uppercase tracking-[0.28em] text-amber-500">Handoff board</p>
            <h3 className="mt-2 text-2xl font-extrabold tracking-tight text-slate-950">What needs to publish soon</h3>
          </div>
          <StatusPill tone={handoffWindowPosts.length > 0 ? 'warning' : 'success'}>
            {handoffWindowPosts.length > 0 ? `${handoffWindowPosts.length} posts in the next 72 hours` : 'No near-term publish pressure'}
          </StatusPill>
        </div>

        {handoffWindowPosts.length > 0 ? (
          <div className="mt-5 grid gap-4 xl:grid-cols-2">
            {handoffWindowPosts.map((post) => (
              <div key={post.id} className="rounded-[1.7rem] border border-slate-200 bg-slate-50 p-5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className={cn('h-2.5 w-2.5 rounded-full', PLATFORM_COLORS[post.platform])} />
                      <p className="text-[11px] font-black uppercase tracking-[0.22em] text-slate-500">{post.platform}</p>
                    </div>
                    <p className="mt-3 text-base font-black text-slate-950">{formatDate(post.scheduledAt, 'EEE, MMM d h:mm a')}</p>
                  </div>
                  <StatusPill tone={post.imageUrl ? 'success' : 'warning'}>
                    {post.imageUrl ? 'Asset ready' : 'Needs asset'}
                  </StatusPill>
                </div>
                <p className="mt-4 line-clamp-4 text-sm leading-6 text-slate-700">{post.content}</p>
                <div className="mt-4 flex flex-wrap gap-2">
                  {post.platform === 'instagram' && instagramDirectReady && post.imageUrl && post.status !== 'posted' && (
                    <MiniActionButton
                      onClick={() => { void handlePublishInstagramPost(post); }}
                      disabled={publishingPostId === post.id}
                      label={publishingPostId === post.id ? 'Publishing...' : 'Publish now'}
                      icon={publishingPostId === post.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                    />
                  )}
                  <MiniActionButton
                    onClick={() => { void copyPostCaption(post); }}
                    label={clipboardKey === (post.id || post.content) ? 'Copied' : 'Copy caption'}
                    icon={<Copy className="h-3.5 w-3.5" />}
                  />
                  <MiniActionButton
                    onClick={() => { void copyAndOpenPlatform(post); }}
                    label="Open platform"
                    icon={<ExternalLink className="h-3.5 w-3.5" />}
                  />
                  <MiniActionButton
                    onClick={() => { void markPostStatus(post, 'posted'); }}
                    label="Mark posted"
                    icon={<Calendar className="h-3.5 w-3.5" />}
                  />
                  <MiniActionButton
                    onClick={() => loadPostIntoComposer(post)}
                    label="Edit"
                    icon={<Copy className="h-3.5 w-3.5" />}
                  />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="mt-5">
                <EmptyState
                  icon={<Calendar className="h-6 w-6" />}
                  title="Nothing urgent to hand off"
                  subtitle="Once posts are scheduled, this board will surface the ones that need your attention soonest."
                  actions={(
                    <>
                      <button
                        onClick={openCalendarView}
                        className="rounded-full border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 transition hover:border-slate-300 hover:text-slate-950"
                      >
                        Open calendar
                      </button>
                      <button
                        onClick={handleGeneratePack}
                        disabled={loadingPack}
                        className="rounded-full bg-slate-950 px-4 py-2 text-xs font-semibold text-white transition hover:bg-slate-800 disabled:opacity-60"
                      >
                        {loadingPack ? 'Building plan...' : 'Generate plan'}
                      </button>
                    </>
                  )}
                />
              </div>
            )}
      </SectionCard>

      <div className="grid gap-6 xl:grid-cols-[1.02fr_0.98fr]">
        <SectionCard className="p-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-[11px] font-black uppercase tracking-[0.28em] text-amber-500">Composer</p>
              <h3 className="mt-2 text-2xl font-extrabold tracking-tight text-slate-950">Build a post</h3>
            </div>
            <div className="flex rounded-full border border-slate-200 bg-white p-1">
              <button
                aria-label="Queue view"
                onClick={() => setViewMode('queue')}
                className={cn('rounded-full px-4 py-2 text-[11px] font-black transition', viewMode === 'queue' ? 'bg-slate-950 text-white' : 'text-slate-600')}
              >
                <List className="h-4 w-4" />
              </button>
              <button
                aria-label="Calendar view"
                onClick={() => setViewMode('calendar')}
                className={cn('rounded-full px-4 py-2 text-[11px] font-black transition', viewMode === 'calendar' ? 'bg-slate-950 text-white' : 'text-slate-600')}
              >
                <Grid3X3 className="h-4 w-4" />
              </button>
            </div>
          </div>

          <div className="mt-6 grid gap-4 md:grid-cols-2">
            <ProfileField label="Focus product or collection" value={productName} onChange={setProductName} placeholder="Pressed-flower keepsake frame" />
            <ProfileField label="Campaign objective" value={campaignObjective} onChange={setCampaignObjective} placeholder="Drive clicks and save-for-laters" />
            <ProfileField label="Target audience" value={campaignAudience} onChange={setCampaignAudience} placeholder="Gift-minded buyers shopping for weddings" />
            <div>
              <p className="mb-2 text-[11px] font-black tracking-[0.08em] text-slate-500">Platform</p>
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
                {PLATFORM_OPTIONS.map((entry) => (
                  <button
                    key={entry}
                    onClick={() => setPlatform(entry)}
                    className={cn(
                      'rounded-2xl border px-3 py-3 text-xs font-semibold transition',
                      platform === entry ? 'border-slate-950 bg-slate-950 text-white' : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300'
                    )}
                  >
                    {entry}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {editingPostId && (
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-[1.5rem] border border-amber-200 bg-amber-50 px-4 py-4">
              <div>
                <p className="text-[11px] font-black uppercase tracking-[0.22em] text-amber-700">Editing queued post</p>
                <p className="mt-1 text-sm text-slate-700">Saving updates the existing queue item.</p>
              </div>
              <button
                onClick={resetComposer}
                className="rounded-full border border-amber-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 transition hover:border-amber-300 hover:text-slate-950"
              >
                Cancel edit
              </button>
            </div>
          )}

          <div className="mt-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <p className="text-[11px] font-black tracking-[0.08em] text-slate-500">Caption</p>
              <div className="flex flex-wrap gap-3">
                <MiniActionButton onClick={handleCreateDraft} disabled={loadingDraft || !productName.trim()} label="Draft AI" icon={loadingDraft ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />} />
                <MiniActionButton onClick={handleGenerateHashtags} disabled={loadingHashtags || !content.trim()} label="Tags AI" icon={loadingHashtags ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Hash className="h-3.5 w-3.5" />} />
                <MiniActionButton onClick={handleGenerateImage} disabled={loadingImage || !content.trim()} label="Visual AI" icon={loadingImage ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ImageIcon className="h-3.5 w-3.5" />} />
                <MiniActionButton onClick={() => fileInputRef.current?.click()} disabled={uploadingAsset} label="Upload Asset" icon={uploadingAsset ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />} />
              </div>
            </div>

            <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleSelectAsset} />

            <textarea
              value={content}
              onChange={(event) => setContent(event.target.value)}
              className="h-44 w-full rounded-[1.7rem] border border-slate-200 bg-slate-50 p-5 text-sm font-medium leading-7 text-slate-700"
              placeholder="Write the post yourself or let EtsyHelper build the first draft."
            />
          </div>

          {imageUrl && (
            <div className="relative mt-4 overflow-hidden rounded-[1.8rem] border border-slate-200">
              <img src={imageUrl} alt="Generated social visual" className="h-52 w-full object-cover" />
              <button
                onClick={() => {
                  setImageUrl(null);
                  setSelectedAssetName('');
                }}
                className="absolute right-3 top-3 rounded-full bg-white/90 p-2 text-slate-700 shadow-md"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          )}
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <ProfileField label="Schedule date" value={scheduledDate} onChange={setScheduledDate} type="date" />
            <ProfileField label="Schedule time" value={scheduledTime} onChange={setScheduledTime} type="time" />
          </div>

          <div className="mt-6 rounded-[1.8rem] border border-slate-200 bg-slate-50 p-5">
            <p className="text-[11px] font-black uppercase tracking-[0.24em] text-slate-500">Live preview</p>
            <div className="mt-4 rounded-[1.7rem] border border-white bg-white p-5 shadow-sm">
              <div className="flex items-center gap-3">
                <div className={cn('flex h-10 w-10 items-center justify-center rounded-2xl text-white', PLATFORM_COLORS[platform])}>
                  <Sparkles className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-sm font-black text-slate-900">{shopProfile.shopName || 'Your Etsy shop'}</p>
                  <p className="text-[11px] font-semibold text-slate-500">{platform}</p>
                </div>
              </div>
              {imageUrl && <img src={imageUrl} alt="Preview" className="mt-4 h-44 w-full rounded-[1.4rem] object-cover" />}
              <p className="mt-4 whitespace-pre-line text-sm leading-7 text-slate-700">{content || 'Your post preview will appear here.'}</p>
            </div>
          </div>

          <div className="mt-5 flex flex-wrap justify-end gap-3">
            <button
              onClick={resetComposer}
              disabled={savingComposer && !editingPostId}
              className="inline-flex items-center gap-2 rounded-full border border-slate-200 px-5 py-3 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:text-slate-950"
            >
              Clear composer
            </button>
            <button
              onClick={handleQueueCurrent}
              disabled={!content.trim() || savingComposer}
              className="inline-flex items-center gap-2 rounded-full bg-slate-950 px-6 py-3 text-sm font-bold text-white transition hover:bg-slate-800 disabled:opacity-60"
            >
              {savingComposer ? <Loader2 className="h-4 w-4 animate-spin" /> : <Calendar className="h-4 w-4" />}
              {editingPostId ? 'Save queued post' : 'Add to queue'}
            </button>
          </div>
        </SectionCard>

        <SectionCard className="p-6">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-[11px] font-black uppercase tracking-[0.28em] text-amber-500">Campaign pack</p>
              <h3 className="mt-2 text-2xl font-extrabold tracking-tight text-slate-950">Build a week of content, not one lonely post</h3>
            </div>
            <button
              onClick={handleGeneratePack}
              disabled={loadingPack}
              className="inline-flex items-center gap-2 rounded-full border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-700 transition hover:border-slate-300 hover:text-slate-950 disabled:opacity-60"
            >
              {loadingPack ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Lightbulb className="h-3.5 w-3.5" />}
              Generate plan
            </button>
          </div>

          {campaignPack ? (
            <div className="mt-5 space-y-4">
              <div className="rounded-[1.7rem] border border-amber-100 bg-amber-50 p-5">
                <p className="text-[11px] font-black tracking-[0.08em] text-amber-700">Campaign concept</p>
                <h4 className="mt-2 text-xl font-black text-slate-950">{campaignPack.campaignName}</h4>
                <p className="mt-3 text-sm leading-7 text-slate-700">{campaignPack.strategicAngle}</p>
                <div className="mt-4 grid gap-3 md:grid-cols-2">
                  <div className="rounded-2xl border border-white/70 bg-white/70 p-4">
                    <p className="text-[11px] font-black tracking-[0.08em] text-slate-500">Audience insight</p>
                    <p className="mt-2 text-sm leading-6 text-slate-700">{campaignPack.audienceInsight}</p>
                  </div>
                  <div className="rounded-2xl border border-white/70 bg-white/70 p-4">
                    <p className="text-[11px] font-black tracking-[0.08em] text-slate-500">Hero offer</p>
                    <p className="mt-2 text-sm leading-6 text-slate-700">{campaignPack.heroOffer}</p>
                  </div>
                </div>
              </div>

              <div className="space-y-3">
                {campaignPack.calendar.map((item, index) => (
                  <div key={`${item.dayLabel}-${index}`} className={cn('rounded-[1.7rem] border p-5', PLATFORM_SURFACES[item.platform])}>
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="text-[11px] font-black tracking-[0.08em] text-slate-500">{item.dayLabel} · {item.platform}</p>
                        <p className="mt-2 text-lg font-black text-slate-950">{item.hook}</p>
                        <p className="mt-3 text-sm leading-7 text-slate-700">{item.caption}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-[11px] font-black tracking-[0.08em] text-slate-500">Best time</p>
                        <p className="mt-2 text-lg font-black text-slate-950">{item.bestTime}</p>
                      </div>
                    </div>

                    <div className="mt-4 flex flex-wrap gap-2">
                      {item.hashtags.map((tag) => (
                        <span key={tag} className="rounded-full border border-white/80 bg-white/80 px-3 py-1 text-[11px] font-bold text-slate-600">
                          #{tag.replace(/^#/, '')}
                        </span>
                      ))}
                    </div>

                    <div className="mt-5 flex flex-wrap gap-3">
                      <button
                        onClick={() => loadPackItem(item)}
                        className="rounded-full border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 transition hover:border-slate-300 hover:text-slate-950"
                      >
                        Load into composer
                      </button>
                      <button
                        onClick={() => queuePackItem(item)}
                        className="rounded-full bg-slate-950 px-4 py-2 text-xs font-semibold text-white transition hover:bg-slate-800"
                      >
                        Queue this step
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="mt-5">
              <EmptyState
                icon={<Lightbulb className="h-6 w-6" />}
                title="No campaign pack yet"
                subtitle="Generate a week-long campaign to build a stronger publishing runway."
                actions={(
                  <button
                    onClick={handleGeneratePack}
                    disabled={loadingPack}
                    className="rounded-full bg-slate-950 px-4 py-2 text-xs font-semibold text-white transition hover:bg-slate-800 disabled:opacity-60"
                  >
                    {loadingPack ? 'Building plan...' : 'Generate plan'}
                  </button>
                )}
              />
            </div>
          )}
        </SectionCard>
      </div>

      {viewMode === 'queue' ? (
        <SectionCard className="p-6">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-[11px] font-black uppercase tracking-[0.28em] text-amber-500">Queue</p>
              <h3 className="mt-2 text-2xl font-extrabold tracking-tight text-slate-950">Publishing queue and history</h3>
              {workflowBadge && (
                <p className="mt-2 text-sm font-semibold text-slate-500">
                  Workflow spotlight: {workflowBadge.toLowerCase()}
                </p>
              )}
            </div>
            <div className="flex rounded-full border border-slate-200 bg-white p-1">
              {([
                { key: 'scheduled', label: `Runway (${queuedPosts.length})` },
                { key: 'posted', label: `Published (${publishedPosts.length})` },
                { key: 'all', label: `All (${sortedPosts.length})` }
              ] as const).map((option) => (
                <button
                  key={option.key}
                  onClick={() => setQueueFilter(option.key)}
                  className={cn(
                    'rounded-full px-4 py-2 text-[11px] font-black transition',
                    queueFilter === option.key ? 'bg-slate-950 text-white' : 'text-slate-600'
                  )}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {visiblePosts.length === 0 ? (
              <div className="md:col-span-2 xl:col-span-3">
                <EmptyState
                  icon={<Calendar className="h-6 w-6" />}
                  title={queueFilter === 'posted' ? 'No published history yet' : 'Nothing in this workflow view'}
                  subtitle={queueFilter === 'posted'
                    ? 'Mark completed handoffs as published so you can track what has already gone out.'
                    : 'Use the composer or a campaign pack to build your publishing runway.'}
                  actions={queueFilter === 'posted' ? undefined : (
                    <>
                      <button
                        onClick={handleGeneratePack}
                        disabled={loadingPack}
                        className="rounded-full bg-slate-950 px-4 py-2 text-xs font-semibold text-white transition hover:bg-slate-800 disabled:opacity-60"
                      >
                        {loadingPack ? 'Building plan...' : 'Generate plan'}
                      </button>
                      <button
                        onClick={openCalendarView}
                        className="rounded-full border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 transition hover:border-slate-300 hover:text-slate-950"
                      >
                        Open calendar
                      </button>
                    </>
                  )}
                />
              </div>
            ) : (
              visiblePosts.map((post) => (
                <div
                  key={post.id}
                  className={cn(
                    'rounded-[1.8rem] border bg-white p-5 shadow-sm',
                    focusedPostId && post.id === focusedPostId
                      ? 'border-amber-300 ring-2 ring-amber-100'
                      : 'border-slate-200'
                  )}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <span className={cn('h-2.5 w-2.5 rounded-full', PLATFORM_COLORS[post.platform])} />
                      <span className="text-[11px] font-semibold text-slate-500">{post.platform}</span>
                    </div>
                    {post.id && (
                      <button onClick={() => deletePost(post)} className="rounded-full p-2 text-slate-400 transition hover:bg-rose-50 hover:text-rose-500">
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </div>

                  {post.campaignName && <p className="mt-3 text-xs font-black uppercase tracking-[0.18em] text-amber-600">{post.campaignName}</p>}
                  {post.objective && <p className="mt-2 text-xs font-semibold text-slate-500">{post.objective}</p>}
                  {post.imageUrl && <img src={post.imageUrl} alt="Queued post" className="mt-4 h-44 w-full rounded-[1.4rem] object-cover" />}
                  <p className="mt-4 line-clamp-5 text-sm leading-7 text-slate-700">{post.content}</p>

                  <div className="mt-4 flex flex-wrap gap-2">
                    {focusedPostId && post.id === focusedPostId && workflowBadge && (
                      <StatusPill tone="warning">{workflowBadge}</StatusPill>
                    )}
                    <StatusPill tone={getPostStatusTone(post.status)}>
                      {post.status === 'posted' ? 'Published' : post.status === 'failed' ? 'Needs revision' : post.status === 'draft' ? 'Draft' : 'Ready to publish'}
                    </StatusPill>
                    <StatusPill tone={post.imageUrl ? 'success' : 'info'}>
                      {post.imageUrl ? 'Asset stored' : 'Text-only handoff'}
                    </StatusPill>
                    {post.platform === 'instagram' && instagramDirectReady && isPublicImageUrl(post.imageUrl) && (
                      <StatusPill tone="success">
                        Direct publish eligible
                      </StatusPill>
                    )}
                    {post.platform === 'instagram' && instagramDirectReady && post.imageUrl && !isPublicImageUrl(post.imageUrl) && (
                      <StatusPill tone="warning">
                        Needs public image URL
                      </StatusPill>
                    )}
                  </div>

                  {post.publishError && (
                    <p className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm leading-6 text-rose-700">
                      {post.publishError}
                    </p>
                  )}

                  <div className="mt-5 flex flex-wrap gap-3 border-t border-slate-100 pt-4">
                    <button
                      onClick={() => loadPostIntoComposer(post)}
                      className="inline-flex items-center gap-2 rounded-full border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-700 transition hover:border-slate-300 hover:text-slate-950"
                    >
                      Revise
                    </button>
                    <button
                      onClick={() => copyPostCaption(post)}
                      className="inline-flex items-center gap-2 rounded-full border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-700 transition hover:border-slate-300 hover:text-slate-950"
                    >
                      <Copy className="h-3.5 w-3.5" />
                      {clipboardKey === (post.id || post.content) ? 'Copied' : 'Copy caption'}
                    </button>
                    {post.status !== 'posted' && (
                      post.platform === 'instagram' && instagramDirectReady && isPublicImageUrl(post.imageUrl) ? (
                        <button
                          onClick={() => { void handlePublishInstagramPost(post); }}
                          disabled={publishingPostId === post.id}
                          className="inline-flex items-center gap-2 rounded-full bg-slate-950 px-4 py-2 text-xs font-semibold text-white transition hover:bg-slate-800 disabled:opacity-60"
                        >
                          {publishingPostId === post.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                          {publishingPostId === post.id ? 'Publishing...' : post.status === 'failed' ? 'Retry Instagram' : 'Publish to Instagram'}
                        </button>
                      ) : (
                      <button
                        onClick={() => copyAndOpenPlatform(post)}
                        className="inline-flex items-center gap-2 rounded-full bg-amber-50 border border-amber-200 px-4 py-2 text-xs font-semibold text-amber-700 transition hover:bg-amber-100"
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                        Copy & Open {post.platform}
                      </button>
                      )
                    )}
                    {post.imageUrl && (
                      <button
                        onClick={() => window.open(post.imageUrl, '_blank', 'noopener,noreferrer')}
                        className="inline-flex items-center gap-2 rounded-full border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-700 transition hover:border-slate-300 hover:text-slate-950"
                      >
                        <ImageIcon className="h-3.5 w-3.5" />
                        Open asset
                      </button>
                    )}
                    {post.status !== 'posted' ? (
                      <button
                        onClick={() => markPostStatus(post, 'posted')}
                        className="inline-flex items-center gap-2 rounded-full bg-slate-950 px-4 py-2 text-xs font-semibold text-white transition hover:bg-slate-800"
                      >
                        Mark published
                      </button>
                    ) : (
                      <>
                        {post.publishedPermalink && (
                          <button
                            onClick={() => window.open(post.publishedPermalink, '_blank', 'noopener,noreferrer')}
                            className="inline-flex items-center gap-2 rounded-full border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-700 transition hover:border-slate-300 hover:text-slate-950"
                          >
                            <ExternalLink className="h-3.5 w-3.5" />
                            Open post
                          </button>
                        )}
                        <button
                          onClick={() => loadPostIntoComposer(post)}
                          className="inline-flex items-center gap-2 rounded-full border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-700 transition hover:border-slate-300 hover:text-slate-950"
                        >
                          Build follow-up
                        </button>
                      </>
                    )}
                  </div>

                  <div className="mt-5 flex items-center justify-between border-t border-slate-100 pt-4">
                    <div>
                      <p className="text-[11px] font-black tracking-[0.08em] text-slate-500">Scheduled</p>
                      <p className="mt-1 text-sm font-bold text-slate-900">{formatDate(post.scheduledAt, 'MMM d, h:mm a')}</p>
                    </div>
                    {post.postedAt ? <StatusPill tone="success">{formatDate(post.postedAt, 'MMM d, h:mm a')}</StatusPill> : <StatusPill tone="warning">Approval queue</StatusPill>}
                  </div>
                </div>
              ))
            )}
          </div>
        </SectionCard>
      ) : (
        <SectionCard className="p-6">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-[11px] font-black uppercase tracking-[0.28em] text-amber-500">Calendar</p>
              <h3 className="mt-2 text-2xl font-extrabold tracking-tight text-slate-950">Seven-day content map</h3>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={() => setCalendarWeek(subWeeks(calendarWeek, 1))} className="rounded-full border border-slate-200 bg-white p-2 text-slate-500 transition hover:border-slate-300 hover:text-slate-900">
                <ChevronLeft className="h-4 w-4" />
              </button>
              <span className="text-[11px] font-semibold text-slate-500">
                {format(weekStart, 'MMM d')} - {format(addDays(weekStart, 6), 'MMM d')}
              </span>
              <button onClick={() => setCalendarWeek(addWeeks(calendarWeek, 1))} className="rounded-full border border-slate-200 bg-white p-2 text-slate-500 transition hover:border-slate-300 hover:text-slate-900">
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>

          <div className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-7">
            {weekDays.map((day) => {
              const dayPosts = getPostsForDay(day);
              const today = isSameDay(day, new Date());
              return (
                <div key={day.toISOString()} className={cn('min-h-[180px] rounded-[1.5rem] border p-4', today ? 'border-amber-200 bg-amber-50' : 'border-slate-200 bg-white')}>
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-semibold text-slate-500">{format(day, 'EEE')}</span>
                    <span className="text-sm font-black text-slate-900">{format(day, 'd')}</span>
                  </div>
                  <div className="mt-4 space-y-2">
                    {dayPosts.length === 0 ? (
                      <p className="text-xs leading-5 text-slate-400">No queued posts</p>
                    ) : (
                      dayPosts.map((post) => (
                        <div key={post.id} className={cn('rounded-xl border px-3 py-2 text-xs font-semibold text-white', PLATFORM_COLORS[post.platform])}>
                          {post.platform.slice(0, 3)} · {formatDate(post.scheduledAt, 'h:mm a')}
                        </div>
                      ))
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </SectionCard>
      )}
    </motion.div>
  );
}
