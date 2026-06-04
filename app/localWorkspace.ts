import type { User } from 'firebase/auth';

import type { AgentTask, CustomerInteraction, InventoryItem, SocialPost, TrendAnalysis } from '../types';

export const LOCAL_WORKSPACE_USER = {
  uid: 'local-user',
  displayName: 'PipersPress Local',
  email: 'local@etsyhelper.local',
  photoURL: ''
} as User;

export const LOCAL_WORKSPACE_EVENT = 'etsyhelper:local-workspace-updated';

type LocalBucket = 'inventory' | 'posts' | 'interactions' | 'trends' | 'agentTasks';

type LocalBucketMap = {
  inventory: InventoryItem;
  posts: SocialPost;
  interactions: CustomerInteraction;
  trends: TrendAnalysis;
  agentTasks: AgentTask;
};

export function isLocalWorkspaceUser(user?: Pick<User, 'uid'> | null) {
  return user?.uid === LOCAL_WORKSPACE_USER.uid;
}

function getBucketKey(ownerId: string, bucket: LocalBucket) {
  return `etsyhelper:local-workspace:${ownerId}:${bucket}`;
}

function emitWorkspaceChange(ownerId: string, bucket: LocalBucket) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(LOCAL_WORKSPACE_EVENT, {
    detail: { ownerId, bucket }
  }));
}

function buildLocalId(bucket: LocalBucket) {
  return `${bucket}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function readLocalBucket<K extends LocalBucket>(ownerId: string, bucket: K): LocalBucketMap[K][] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(getBucketKey(ownerId, bucket));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed as LocalBucketMap[K][] : [];
  } catch (error) {
    console.error(`Failed to read local workspace ${bucket}:`, error);
    return [];
  }
}

export function writeLocalBucket<K extends LocalBucket>(ownerId: string, bucket: K, records: LocalBucketMap[K][]) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(getBucketKey(ownerId, bucket), JSON.stringify(records));
    emitWorkspaceChange(ownerId, bucket);
  } catch (error) {
    console.error(`Failed to write local workspace ${bucket}:`, error);
  }
}

export function upsertLocalBucketRecord<K extends LocalBucket>(
  ownerId: string,
  bucket: K,
  record: Omit<LocalBucketMap[K], 'id'> & Partial<Pick<LocalBucketMap[K], 'id'>>
) {
  const current = readLocalBucket(ownerId, bucket);
  const nextId = record.id || buildLocalId(bucket);
  const nextRecords = current.filter((entry) => entry.id !== nextId);
  nextRecords.push({ ...record, id: nextId } as LocalBucketMap[K]);
  writeLocalBucket(ownerId, bucket, nextRecords);
  return nextId;
}

export function patchLocalBucketRecord<K extends LocalBucket>(
  ownerId: string,
  bucket: K,
  id: string,
  patch: Partial<LocalBucketMap[K]>
) {
  const current = readLocalBucket(ownerId, bucket);
  const nextRecords = current.map((entry) => (
    entry.id === id
      ? { ...entry, ...patch }
      : entry
  ));
  writeLocalBucket(ownerId, bucket, nextRecords);
}

export function deleteLocalBucketRecord(ownerId: string, bucket: LocalBucket, id: string) {
  const current = readLocalBucket(ownerId, bucket);
  writeLocalBucket(
    ownerId,
    bucket,
    current.filter((entry) => entry.id !== id)
  );
}
