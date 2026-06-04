import { deleteObject, getDownloadURL, ref, uploadBytes } from 'firebase/storage';

import { storage } from '../lib/firebase';
import type { SocialPost } from '../types';

function sanitizeFilenamePart(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'asset';
}

function decodeDataUrl(dataUrl: string) {
  const match = dataUrl.match(/^data:(.+?);base64,(.+)$/);
  if (!match) {
    throw new Error('The generated image preview could not be decoded for upload.');
  }

  const mimeType = match[1];
  const base64 = match[2];
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return { mimeType, bytes };
}

async function uploadAssetBytes(params: {
  bytes: Uint8Array;
  mimeType: string;
  ownerId: string;
  platform: SocialPost['platform'];
  filenameHint?: string;
}) {
  const extension = params.mimeType.includes('png')
    ? 'png'
    : params.mimeType.includes('webp')
      ? 'webp'
      : params.mimeType.includes('jpeg') || params.mimeType.includes('jpg')
        ? 'jpg'
        : 'bin';

  const filename = sanitizeFilenamePart(params.filenameHint || params.platform);
  const storagePath = `social-assets/${params.ownerId}/${params.platform}/${Date.now()}-${filename}.${extension}`;
  const storageRef = ref(storage, storagePath);

  await uploadBytes(storageRef, params.bytes, {
    contentType: params.mimeType,
    cacheControl: 'public,max-age=31536000,immutable'
  });

  const downloadURL = await getDownloadURL(storageRef);

  return {
    imageUrl: downloadURL,
    assetPath: storagePath
  };
}

export async function uploadDataUrlSocialAsset(params: {
  dataUrl: string;
  ownerId: string;
  platform: SocialPost['platform'];
  filenameHint?: string;
}) {
  const decoded = decodeDataUrl(params.dataUrl);
  return uploadAssetBytes({
    bytes: decoded.bytes,
    mimeType: decoded.mimeType,
    ownerId: params.ownerId,
    platform: params.platform,
    filenameHint: params.filenameHint
  });
}

export async function deleteSocialAssetByPath(storagePath: string) {
  if (!storagePath.trim()) return;
  await deleteObject(ref(storage, storagePath));
}
