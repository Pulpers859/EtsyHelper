import cookieParser from 'cookie-parser';
import crypto from 'crypto';
import dotenv from 'dotenv';
import express from 'express';
import net from 'net';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import { load } from 'cheerio';

import { isPublicImageUrl } from './app/core';

dotenv.config({ path: '.env.local' });
dotenv.config();

function toBase64Url(input: Buffer) {
  return input
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function buildPkcePair() {
  const verifier = toBase64Url(crypto.randomBytes(32));
  const challenge = toBase64Url(crypto.createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}

function buildState() {
  return toBase64Url(crypto.randomBytes(24));
}

function resolveAppUrl(req: express.Request) {
  const configured = process.env.APP_URL?.trim();
  if (configured && /^https?:\/\//i.test(configured) && configured !== 'MY_APP_URL') {
    try {
      const parsed = new URL(configured);
      const normalizedPath = parsed.pathname.replace(/\/+$/, '');
      if (normalizedPath === '/auth/callback/etsy' || normalizedPath === '/auth/callback/instagram') {
        return parsed.origin;
      }
      return `${parsed.origin}${normalizedPath}`;
    } catch {
      return configured.replace(/\/+$/, '');
    }
  }
  return `${req.protocol}://${req.get('host')}`;
}

function setOAuthCookie(res: express.Response, key: string, value: string) {
  res.cookie(key, value, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 10 * 60 * 1000
  });
}

function clearOAuthCookie(res: express.Response, key: string) {
  res.clearCookie(key, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax'
  });
}

async function findAvailablePort(preferredPort: number, host = '0.0.0.0') {
  const maxAttempts = 20;

  for (let offset = 0; offset < maxAttempts; offset += 1) {
    const candidatePort = preferredPort + offset;
    const isAvailable = await new Promise<boolean>((resolve) => {
      const tester = net.createServer();

      tester.once('error', () => resolve(false));
      tester.once('listening', () => {
        tester.close(() => resolve(true));
      });

      tester.listen(candidatePort, host);
    });

    if (isAvailable) {
      return candidatePort;
    }
  }

  throw new Error(`No open port found between ${preferredPort} and ${preferredPort + maxAttempts - 1}`);
}

const ETSY_SESSION_COOKIE = 'etsy_oauth_session';
const ETSY_SESSION_MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000;
const INSTAGRAM_SESSION_COOKIE = 'instagram_oauth_session';
const INSTAGRAM_SESSION_MAX_AGE_MS = 60 * 24 * 60 * 60 * 1000;
const INSTAGRAM_API_VERSION = process.env.INSTAGRAM_API_VERSION?.trim() || 'v25.0';
const INSTAGRAM_DEFAULT_SCOPES = process.env.INSTAGRAM_SCOPES?.trim() || 'instagram_business_basic,instagram_business_content_publish';
const INSTAGRAM_AUTH_URL = process.env.INSTAGRAM_AUTH_URL?.trim() || 'https://www.instagram.com/oauth/authorize';
const INSTAGRAM_TOKEN_URL = process.env.INSTAGRAM_TOKEN_URL?.trim() || 'https://api.instagram.com/oauth/access_token';
const SINGLE_STORE_SHOP_ID = process.env.ETSY_SHOP_ID?.trim() || '';
const SINGLE_STORE_OWNER_USER_ID = process.env.ETSY_OWNER_USER_ID?.trim() || '';
const SINGLE_STORE_NAME = process.env.ETSY_SHOP_NAME?.trim() || '';

type EtsyOAuthTokenResponse = {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token: string;
  scope?: string;
};

type EtsyOAuthSession = {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  userId: string;
  scopes: string[];
  shopId?: string;
  shopName?: string;
};

type InstagramOAuthTokenResponse = {
  access_token: string;
  user_id?: string | number;
  permissions?: string[] | string;
};

type InstagramLongLivedTokenResponse = {
  access_token: string;
  token_type?: string;
  expires_in: number;
  permissions?: string[] | string;
};

type InstagramOAuthSession = {
  accessToken: string;
  expiresAt: number;
  igUserId: string;
  username?: string;
  scopes: string[];
  tokenType?: string;
};

type InstagramProfile = {
  igUserId: string;
  username?: string;
};

type EtsyShopSummary = {
  shopId: string;
  shopName: string;
  title?: string;
  announcement?: string;
  currencyCode?: string;
  activeListingCount?: number;
};

type EtsyUserProfile = {
  userId: string;
  loginName?: string;
  primaryEmail?: string;
  firstName?: string;
  lastName?: string;
};

type EtsyInventorySyncItem = {
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

type EtsyListingMetric = {
  listingId: string;
  title: string;
  price?: number;
  views30d?: number | null;
  favorites30d?: number | null;
  orders30d?: number | null;
  revenue30d?: number | null;
  conversionRate?: number | null;
  confidence: 'live';
};

type EtsyReceiptSyncItem = {
  receiptId: string;
  customerName: string;
  customerEmail?: string;
  message: string;
  summary: string;
  status: 'pending' | 'resolved';
  priority: 'urgent' | 'normal' | 'low';
  category: 'question' | 'feedback' | 'order_issue' | 'other';
  tags: string[];
  relatedOrderId: string;
  createdAt: string;
  orderStatus: 'paid' | 'shipped' | 'canceled';
};

type EtsySyncPayload = {
  connected: true;
  syncedAt: string;
  shop: EtsyShopSummary;
  shopRevenue30d: number | null;
  shopOrders30d: number | null;
  averageConversionRate: number | null;
  listingMetrics: EtsyListingMetric[];
  inventoryItems: EtsyInventorySyncItem[];
  receiptItems: EtsyReceiptSyncItem[];
};

type EtsyListingUpdateBody = {
  title?: string;
  description?: string;
  price?: number;
  stockLevel?: number;
};

function getEtsyApiKey() {
  const clientId = process.env.ETSY_CLIENT_ID;
  if (!clientId) {
    throw new Error('ETSY_CLIENT_ID must be configured');
  }
  return clientId;
}

function getSessionSecret() {
  return process.env.ETSY_COOKIE_SECRET || process.env.APP_SESSION_SECRET || process.env.ETSY_CLIENT_SECRET || '';
}

function assertSessionSecretConfigured() {
  if (!getSessionSecret().trim()) {
    throw new Error('ETSY_COOKIE_SECRET or APP_SESSION_SECRET must be configured to store account sessions securely');
  }
}

function getCapabilityError(check: () => void) {
  try {
    check();
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : 'Configuration is incomplete';
  }
}

function getSessionKey(scope: string) {
  const secret = getSessionSecret();
  if (!secret) {
    throw new Error('ETSY_COOKIE_SECRET or APP_SESSION_SECRET must be configured to store Etsy sessions securely');
  }
  return crypto.scryptSync(secret, `etsyhelper-${scope}`, 32);
}

function encryptSession<T>(payload: T, scope: string) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getSessionKey(scope), iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [iv, tag, encrypted]
    .map((part) => toBase64Url(part))
    .join('.');
}

function decryptSession<T>(raw: string, scope: string): T | null {
  try {
    const [ivRaw, tagRaw, encryptedRaw] = raw.split('.');
    if (!ivRaw || !tagRaw || !encryptedRaw) return null;

    const decipher = crypto.createDecipheriv(
      'aes-256-gcm',
      getSessionKey(scope),
      Buffer.from(ivRaw.replace(/-/g, '+').replace(/_/g, '/'), 'base64')
    );
    decipher.setAuthTag(Buffer.from(tagRaw.replace(/-/g, '+').replace(/_/g, '/'), 'base64'));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(encryptedRaw.replace(/-/g, '+').replace(/_/g, '/'), 'base64')),
      decipher.final()
    ]);
    return JSON.parse(decrypted.toString('utf8')) as T;
  } catch {
    return null;
  }
}

function setSessionCookie(res: express.Response, session: EtsyOAuthSession) {
  res.cookie(ETSY_SESSION_COOKIE, encryptSession(session, 'etsy-session'), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: ETSY_SESSION_MAX_AGE_MS
  });
}

function clearSessionCookie(res: express.Response) {
  res.clearCookie(ETSY_SESSION_COOKIE, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax'
  });
}

function parseEtsyUserId(token: string) {
  const userId = token.split('.')[0];
  if (!/^\d+$/.test(userId)) {
    throw new Error('Unable to derive Etsy user id from OAuth token');
  }
  return userId;
}

function getEtsySession(req: express.Request) {
  const raw = req.cookies?.[ETSY_SESSION_COOKIE];
  if (!raw || typeof raw !== 'string') return null;
  const parsed = decryptSession<EtsyOAuthSession>(raw, 'etsy-session');
  return parsed?.accessToken && parsed?.refreshToken ? parsed : null;
}

function getInstagramClientId() {
  const clientId = process.env.INSTAGRAM_CLIENT_ID?.trim();
  if (!clientId || clientId === 'YOUR_INSTAGRAM_CLIENT_ID') {
    throw new Error('INSTAGRAM_CLIENT_ID is not configured yet');
  }
  return clientId;
}

function getInstagramClientSecret() {
  const clientSecret = process.env.INSTAGRAM_CLIENT_SECRET?.trim();
  if (!clientSecret || clientSecret === 'YOUR_INSTAGRAM_CLIENT_SECRET') {
    throw new Error('INSTAGRAM_CLIENT_SECRET is not configured yet');
  }
  return clientSecret;
}

function getInstagramScopes() {
  return INSTAGRAM_DEFAULT_SCOPES.split(',')
    .map((scope) => scope.trim())
    .filter(Boolean);
}

function normalizeInstagramScopes(value: string[] | string | undefined, fallback = getInstagramScopes()) {
  if (Array.isArray(value)) {
    return value.map((scope) => scope.trim()).filter(Boolean);
  }
  if (typeof value === 'string') {
    return value.split(/[,\s]+/).map((scope) => scope.trim()).filter(Boolean);
  }
  return fallback;
}

function setInstagramSessionCookie(res: express.Response, session: InstagramOAuthSession) {
  res.cookie(INSTAGRAM_SESSION_COOKIE, encryptSession(session, 'instagram-session'), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: INSTAGRAM_SESSION_MAX_AGE_MS
  });
}

function clearInstagramSessionCookie(res: express.Response) {
  res.clearCookie(INSTAGRAM_SESSION_COOKIE, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax'
  });
}

function getInstagramSession(req: express.Request) {
  const raw = req.cookies?.[INSTAGRAM_SESSION_COOKIE];
  if (!raw || typeof raw !== 'string') return null;
  const parsed = decryptSession<InstagramOAuthSession>(raw, 'instagram-session');
  return parsed?.accessToken && parsed?.igUserId ? parsed : null;
}

async function requestEtsyOAuthToken(code: string, verifier: string, redirectUri: string) {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: process.env.ETSY_CLIENT_ID || '',
    redirect_uri: redirectUri,
    code,
    code_verifier: verifier
  });

  const response = await fetch('https://api.etsy.com/v3/public/oauth/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.access_token || !payload?.refresh_token) {
    throw new Error(payload?.error_description || payload?.error || `Etsy token exchange failed (${response.status})`);
  }

  return payload as EtsyOAuthTokenResponse;
}

async function refreshEtsySession(session: EtsyOAuthSession) {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: process.env.ETSY_CLIENT_ID || '',
    refresh_token: session.refreshToken
  });

  const response = await fetch('https://api.etsy.com/v3/public/oauth/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.access_token || !payload?.refresh_token) {
    throw new Error(payload?.error_description || payload?.error || `Etsy token refresh failed (${response.status})`);
  }

  const refreshed = payload as EtsyOAuthTokenResponse;
  return {
    ...session,
    accessToken: refreshed.access_token,
    refreshToken: refreshed.refresh_token,
    expiresAt: Date.now() + (refreshed.expires_in * 1000),
    scopes: refreshed.scope ? refreshed.scope.split(/\s+/).filter(Boolean) : session.scopes
  } satisfies EtsyOAuthSession;
}

async function ensureFreshEtsySession(req: express.Request, res: express.Response) {
  const existing = getEtsySession(req);
  if (!existing) {
    return null;
  }

  if (existing.expiresAt > Date.now() + 60_000) {
    return existing;
  }

  const refreshed = await refreshEtsySession(existing);
  setSessionCookie(res, refreshed);
  return refreshed;
}

async function requestInstagramOAuthToken(code: string, redirectUri: string) {
  const body = new URLSearchParams({
    client_id: getInstagramClientId(),
    client_secret: getInstagramClientSecret(),
    grant_type: 'authorization_code',
    redirect_uri: redirectUri,
    code
  });

  const response = await fetch(INSTAGRAM_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.access_token) {
    throw new Error(payload?.error_message || payload?.error || `Instagram token exchange failed (${response.status})`);
  }

  return payload as InstagramOAuthTokenResponse;
}

async function exchangeInstagramLongLivedToken(accessToken: string) {
  const params = new URLSearchParams({
    grant_type: 'ig_exchange_token',
    client_secret: getInstagramClientSecret(),
    access_token: accessToken
  });

  const response = await fetch(`https://graph.instagram.com/access_token?${params.toString()}`, {
    headers: {
      Accept: 'application/json'
    }
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.access_token) {
    throw new Error(payload?.error?.message || payload?.error_message || `Instagram long-lived token exchange failed (${response.status})`);
  }

  return payload as InstagramLongLivedTokenResponse;
}

async function refreshInstagramSession(session: InstagramOAuthSession) {
  const params = new URLSearchParams({
    grant_type: 'ig_refresh_token',
    access_token: session.accessToken
  });

  const response = await fetch(`https://graph.instagram.com/refresh_access_token?${params.toString()}`, {
    headers: {
      Accept: 'application/json'
    }
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.access_token) {
    throw new Error(payload?.error?.message || payload?.error_message || `Instagram token refresh failed (${response.status})`);
  }

  const refreshed = payload as InstagramLongLivedTokenResponse;
  return {
    ...session,
    accessToken: refreshed.access_token,
    expiresAt: Date.now() + ((refreshed.expires_in || 0) * 1000),
    scopes: normalizeInstagramScopes(refreshed.permissions, session.scopes),
    tokenType: refreshed.token_type || session.tokenType
  } satisfies InstagramOAuthSession;
}

async function ensureFreshInstagramSession(req: express.Request, res: express.Response) {
  const existing = getInstagramSession(req);
  if (!existing) {
    return null;
  }

  if (existing.expiresAt > Date.now() + (24 * 60 * 60 * 1000)) {
    return existing;
  }

  const refreshed = await refreshInstagramSession(existing);
  setInstagramSessionCookie(res, refreshed);
  return refreshed;
}

async function instagramApiRequest<T>(
  req: express.Request,
  res: express.Response,
  session: InstagramOAuthSession,
  path: string,
  init?: RequestInit
) {
  const requestUrl = new URL(`https://graph.instagram.com/${INSTAGRAM_API_VERSION}${path}`);
  const response = await fetch(requestUrl, {
    ...init,
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${session.accessToken}`,
      ...(init?.headers || {})
    }
  });

  if (response.status === 401) {
    const refreshed = await refreshInstagramSession(session);
    setInstagramSessionCookie(res, refreshed);
    const retry = await fetch(requestUrl, {
      ...init,
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${refreshed.accessToken}`,
        ...(init?.headers || {})
      }
    });

    const retryPayload = await retry.json().catch(() => null);
    if (!retry.ok) {
      throw new Error(retryPayload?.error?.message || retryPayload?.error_message || `Instagram request failed (${retry.status})`);
    }
    return { payload: retryPayload as T, session: refreshed };
  }

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(payload?.error?.message || payload?.error_message || `Instagram request failed (${response.status})`);
  }

  return { payload: payload as T, session };
}

async function resolveInstagramProfile(req: express.Request, res: express.Response, session: InstagramOAuthSession) {
  const { payload, session: activeSession } = await instagramApiRequest<Record<string, unknown>>(
    req,
    res,
    session,
    '/me?fields=user_id,username'
  );

  const igUserId = String(payload?.user_id ?? payload?.id ?? session.igUserId ?? '').trim();
  if (!igUserId) {
    throw new Error('Instagram did not return an account id for this login');
  }

  return {
    profile: {
      igUserId,
      username: typeof payload?.username === 'string' ? payload.username : session.username
    } satisfies InstagramProfile,
    session: {
      ...activeSession,
      igUserId,
      username: typeof payload?.username === 'string' ? payload.username : activeSession.username
    } satisfies InstagramOAuthSession
  };
}

async function waitForInstagramContainer(
  req: express.Request,
  res: express.Response,
  session: InstagramOAuthSession,
  creationId: string
) {
  let activeSession = session;

  for (let attempt = 0; attempt < 10; attempt += 1) {
    const { payload, session: refreshedSession } = await instagramApiRequest<Record<string, unknown>>(
      req,
      res,
      activeSession,
      `/${creationId}?fields=status_code`
    );
    activeSession = refreshedSession;

    const statusCode = typeof payload?.status_code === 'string' ? payload.status_code.toUpperCase() : '';
    if (!statusCode || statusCode === 'FINISHED' || statusCode === 'PUBLISHED') {
      return activeSession;
    }
    if (statusCode === 'ERROR' || statusCode === 'EXPIRED') {
      throw new Error(`Instagram media container failed with status ${statusCode.toLowerCase()}`);
    }

    await new Promise((resolve) => setTimeout(resolve, 1500));
  }

  return activeSession;
}

async function etsyJsonRequest<T>(
  req: express.Request,
  res: express.Response,
  session: EtsyOAuthSession,
  path: string,
  init?: RequestInit
) {
  const response = await fetch(`https://api.etsy.com/v3${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': getEtsyApiKey(),
      Authorization: `Bearer ${session.accessToken}`,
      ...(init?.headers || {})
    }
  });

  if (response.status === 401) {
    const refreshed = await refreshEtsySession(session);
    setSessionCookie(res, refreshed);
    const retry = await fetch(`https://api.etsy.com/v3${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': getEtsyApiKey(),
        Authorization: `Bearer ${refreshed.accessToken}`,
        ...(init?.headers || {})
      }
    });

    const retryPayload = await retry.json().catch(() => null);
    if (!retry.ok) {
      throw new Error(retryPayload?.error || retryPayload?.error_description || `Etsy request failed (${retry.status})`);
    }
    return { payload: retryPayload as T, session: refreshed };
  }

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(payload?.error || payload?.error_description || `Etsy request failed (${response.status})`);
  }

  return { payload: payload as T, session };
}

function toIsoDate(value: unknown) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return new Date().toISOString();
  }
  return new Date(numeric * 1000).toISOString();
}

function normalizeShop(raw: Record<string, any>) {
  return {
    shopId: String(raw?.shop_id ?? raw?.shopId ?? ''),
    shopName: String(raw?.shop_name ?? raw?.shopName ?? raw?.name ?? ''),
    title: typeof raw?.title === 'string' ? raw.title : undefined,
    announcement: typeof raw?.announcement === 'string' ? raw.announcement : undefined,
    currencyCode: typeof raw?.currency_code === 'string' ? raw.currency_code : undefined,
    activeListingCount: typeof raw?.active_listing_count === 'number' ? raw.active_listing_count : undefined
  } satisfies EtsyShopSummary;
}

function normalizeUserProfile(raw: Record<string, any>, fallbackUserId: string): EtsyUserProfile {
  return {
    userId: String(raw?.user_id ?? raw?.userId ?? fallbackUserId),
    loginName: typeof raw?.login_name === 'string' ? raw.login_name : typeof raw?.loginName === 'string' ? raw.loginName : undefined,
    primaryEmail: typeof raw?.primary_email === 'string' ? raw.primary_email : typeof raw?.primaryEmail === 'string' ? raw.primaryEmail : undefined,
    firstName: typeof raw?.first_name === 'string' ? raw.first_name : typeof raw?.firstName === 'string' ? raw.firstName : undefined,
    lastName: typeof raw?.last_name === 'string' ? raw.last_name : typeof raw?.lastName === 'string' ? raw.lastName : undefined
  };
}

function createNoShopError() {
  const error = new Error('No Etsy shop was returned for this authorized account') as Error & { code: string };
  error.code = 'ETSY_NO_SHOP';
  return error;
}

function isNoShopError(error: unknown): error is Error & { code: 'ETSY_NO_SHOP' } {
  return typeof error === 'object' && error !== null && 'code' in error && (error as { code?: string }).code === 'ETSY_NO_SHOP';
}

async function resolveEtsyShop(req: express.Request, res: express.Response, session: EtsyOAuthSession) {
  if (session.shopId) {
    const { payload, session: updatedSession } = await etsyJsonRequest<Record<string, any>>(req, res, session, `/application/shops/${session.shopId}`);
    return { shop: normalizeShop(payload), session: updatedSession };
  }

  const { payload, session: updatedSession } = await etsyJsonRequest<{ results?: Record<string, any>[] }>(
    req,
    res,
    session,
    `/application/users/${session.userId}/shops`
  );

  const rawShop = payload?.results?.[0];
  if (!rawShop && SINGLE_STORE_SHOP_ID && SINGLE_STORE_OWNER_USER_ID && session.userId === SINGLE_STORE_OWNER_USER_ID) {
    try {
      const { payload: fallbackPayload, session: fallbackSession } = await etsyJsonRequest<Record<string, any>>(
        req,
        res,
        session,
        `/application/shops/${SINGLE_STORE_SHOP_ID}`
      );
      const fallbackShop = normalizeShop(fallbackPayload);
      return {
        shop: {
          ...fallbackShop,
          shopId: fallbackShop.shopId || SINGLE_STORE_SHOP_ID,
          shopName: fallbackShop.shopName || SINGLE_STORE_NAME
        },
        session: {
          ...fallbackSession,
          shopId: SINGLE_STORE_SHOP_ID,
          shopName: fallbackShop.shopName || SINGLE_STORE_NAME
        } satisfies EtsyOAuthSession
      };
    } catch (fallbackError) {
      console.error('Direct shop lookup fallback failed:', fallbackError);
    }
  }

  if (!rawShop) {
    throw createNoShopError();
  }

  const shop = normalizeShop(rawShop);
  return {
    shop,
    session: {
      ...updatedSession,
      shopId: shop.shopId,
      shopName: shop.shopName
    } satisfies EtsyOAuthSession
  };
}

async function tryFetchEtsyUserProfile(req: express.Request, res: express.Response, session: EtsyOAuthSession) {
  try {
    const { payload } = await etsyJsonRequest<Record<string, any>>(
      req,
      res,
      session,
      `/application/users/${session.userId}`
    );
    return normalizeUserProfile(payload, session.userId);
  } catch (error) {
    console.error('Etsy user profile lookup failed:', error);
    return null;
  }
}

function parseAmount(raw: unknown) {
  if (typeof raw === 'number') return raw;
  if (typeof raw === 'string') return parseMoney(raw);
  if (raw && typeof raw === 'object') {
    const nested = raw as Record<string, unknown>;
    const divisor = typeof nested.divisor === 'number' && nested.divisor > 0 ? nested.divisor : 1;
    if (typeof nested.amount === 'number') return nested.amount / divisor;
    if (typeof nested.amount === 'string') return parseMoney(nested.amount) / divisor;
    if (typeof nested.value === 'number') return nested.value;
    if (typeof nested.value === 'string') return parseMoney(nested.value);
  }
  return 0;
}

function normalizeListing(raw: Record<string, any>) {
  const images = Array.isArray(raw?.images) ? raw.images : Array.isArray(raw?.Images) ? raw.Images : [];
  const offerings = Array.isArray(raw?.inventory?.products)
    ? raw.inventory.products.flatMap((product: any) => Array.isArray(product?.offerings) ? product.offerings : [])
    : [];
  const firstOffering = offerings[0];
  const price = parseAmount(firstOffering?.price ?? raw?.price);
  const stockLevel = offerings.length > 0
    ? offerings.reduce((sum: number, offering: any) => sum + (Number(offering?.quantity) || 0), 0)
    : (Number(raw?.quantity) || 0);
  const tags = Array.isArray(raw?.tags) ? raw.tags.filter((entry: unknown) => typeof entry === 'string') : [];
  const taxonomyPath = Array.isArray(raw?.taxonomy_path) ? raw.taxonomy_path.filter((entry: unknown) => typeof entry === 'string') : [];
  const imageCandidate = images[0] || {};
  const imageUrl = imageCandidate?.url_fullxfull || imageCandidate?.url_570xN || imageCandidate?.url_300x300;

  return {
    inventoryItem: {
      etsyListingId: String(raw?.listing_id ?? raw?.listingId ?? ''),
      name: String(raw?.title ?? 'Untitled Etsy listing'),
      description: typeof raw?.description === 'string' ? raw.description : '',
      price,
      stockLevel,
      category: taxonomyPath[0] || tags[0] || '',
      tags,
      imageUrl: typeof imageUrl === 'string' ? imageUrl : undefined,
      sku: typeof firstOffering?.sku === 'string' ? firstOffering.sku : undefined
    } satisfies EtsyInventorySyncItem,
    metric: {
      listingId: String(raw?.listing_id ?? raw?.listingId ?? ''),
      title: String(raw?.title ?? 'Untitled Etsy listing'),
      price,
      confidence: 'live'
    } satisfies EtsyListingMetric
  };
}

function summarizeReceipts(results: Array<Record<string, any>>) {
  const cutoff = Date.now() - (30 * 24 * 60 * 60 * 1000);
  let shopOrders30d = 0;
  let shopRevenue30d = 0;

  for (const receipt of results) {
    const createdAt = Number(receipt?.create_timestamp ?? receipt?.created_timestamp ?? 0) * 1000;
    if (!createdAt || createdAt < cutoff) continue;
    shopOrders30d += 1;
    shopRevenue30d += parseAmount(receipt?.grandtotal ?? receipt?.total_price ?? receipt?.total_cost);
  }

  return {
    shopOrders30d,
    shopRevenue30d
  };
}

function normalizeReceipt(raw: Record<string, any>) {
  const receiptId = String(raw?.receipt_id ?? raw?.receiptId ?? '');
  const buyerName = typeof raw?.name === 'string' && raw.name.trim()
    ? raw.name.trim()
    : typeof raw?.buyer_name === 'string' && raw.buyer_name.trim()
      ? raw.buyer_name.trim()
      : `Etsy buyer ${raw?.buyer_user_id ?? ''}`.trim();
  const buyerMessage = typeof raw?.message_from_buyer === 'string' && raw.message_from_buyer.trim()
    ? raw.message_from_buyer.trim()
    : typeof raw?.seller_note === 'string' && raw.seller_note.trim()
      ? raw.seller_note.trim()
      : '';
  const transactions = Array.isArray(raw?.transactions) ? raw.transactions : [];
  const itemTitles = transactions
    .map((transaction: Record<string, any>) => {
      if (typeof transaction?.title === 'string' && transaction.title.trim()) {
        return transaction.title.trim();
      }
      if (typeof transaction?.listing_title === 'string' && transaction.listing_title.trim()) {
        return transaction.listing_title.trim();
      }
      return '';
    })
    .filter(Boolean)
    .slice(0, 3);
  const createdAt = toIsoDate(raw?.create_timestamp ?? raw?.created_timestamp);
  const wasCanceled = raw?.is_canceled === true || raw?.was_canceled === true || raw?.status === 'canceled';
  const wasShipped = raw?.was_shipped === true || raw?.is_shipped === true || raw?.status === 'shipped';
  const orderStatus: EtsyReceiptSyncItem['orderStatus'] = wasCanceled ? 'canceled' : wasShipped ? 'shipped' : 'paid';
  const fallbackSummary = itemTitles.length > 0
    ? `${orderStatus === 'shipped' ? 'Shipped' : orderStatus === 'canceled' ? 'Canceled' : 'Paid'} Etsy order for ${itemTitles.join(', ')}`
    : `Etsy order ${orderStatus}`;
  const status: EtsyReceiptSyncItem['status'] = wasShipped || wasCanceled ? 'resolved' : 'pending';
  const category: EtsyReceiptSyncItem['category'] = buyerMessage ? 'question' : orderStatus === 'canceled' ? 'other' : 'order_issue';
  const message = buyerMessage || (
    orderStatus === 'shipped'
      ? `Etsy order shipped${itemTitles.length > 0 ? ` for ${itemTitles.join(', ')}` : ''}.`
      : orderStatus === 'canceled'
        ? `Etsy order was canceled${itemTitles.length > 0 ? ` for ${itemTitles.join(', ')}` : ''}.`
        : `Paid Etsy order received${itemTitles.length > 0 ? ` for ${itemTitles.join(', ')}` : ''}. Awaiting fulfillment.`
  );

  return {
    receiptId,
    customerName: buyerName || `Etsy buyer ${receiptId}`,
    customerEmail: typeof raw?.buyer_email === 'string' ? raw.buyer_email : undefined,
    message,
    summary: buyerMessage ? `Buyer note on ${fallbackSummary.toLowerCase()}` : fallbackSummary,
    status,
    priority: buyerMessage && status === 'pending' ? 'urgent' : 'normal',
    category,
    tags: ['etsy', 'receipt', orderStatus, ...(buyerMessage ? ['buyer-note'] : [])],
    relatedOrderId: receiptId,
    createdAt,
    orderStatus
  } satisfies EtsyReceiptSyncItem;
}

function normalizeInventoryUpdateProduct(product: Record<string, any>, body: EtsyListingUpdateBody) {
  const offerings = Array.isArray(product?.offerings) ? product.offerings : [];
  const offering = offerings[0] || {};
  const fallbackQuantity = Number(offering?.quantity);
  const resolvedQuantity = body.stockLevel !== undefined
    ? body.stockLevel
    : (Number.isFinite(fallbackQuantity) ? fallbackQuantity : 0);
  const nextOffering: Record<string, any> = {
    quantity: Math.max(0, Math.round(resolvedQuantity)),
    is_enabled: offering?.is_enabled !== false,
    price: body.price ?? parseAmount(offering?.price)
  };

  if (typeof offering?.readiness_state_id === 'number') {
    nextOffering.readiness_state_id = offering.readiness_state_id;
  }

  return {
    sku: typeof product?.sku === 'string' ? product.sku : '',
    property_values: [],
    offerings: [nextOffering]
  };
}

function escapeHtml(text: string) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function normalizeWhitespace(value: string) {
  return value.replace(/\s+/g, ' ').trim();
}

function decodeXmlEntities(value: string) {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function parseMoney(raw: string) {
  const cleaned = raw.replace(/[^0-9.]/g, '');
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseCount(raw: string) {
  const cleaned = raw.replace(/[^0-9]/g, '');
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : 0;
}

type ParsedShopSnapshot = {
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

function parseEtsyShopTextFallback(rawText: string, sourceUrl: string): ParsedShopSnapshot {
  const text = normalizeWhitespace(rawText);
  const lines = rawText.split('\n').map((line) => normalizeWhitespace(line)).filter(Boolean);

  const shopNameMatch = text.match(/#\s*([A-Za-z0-9][A-Za-z0-9\s'&-]{1,60})\s+Latest activity/i);
  const shopName = shopNameMatch?.[1] || lines.find((line) => line.startsWith('# '))?.replace('# ', '') || '';

  const locationMatch = text.match(/#\s*[A-Za-z0-9][A-Za-z0-9\s'&-]{1,60}\s+([A-Za-z\s]+,\s*[A-Za-z\s]+)/i);
  const location = locationMatch?.[1] || '';

  const salesMatch = text.match(/([0-9,]+)\s+Sales/i) || text.match(/([0-9,]+)\s+sales/i);
  const admirersMatch = text.match(/([0-9,]+)\s+Admirers/i);
  const ratingMatch = text.match(/([0-9]+(?:\.[0-9])?)\s*\((\d+)\)/);

  const categories: string[] = [];
  const topListings: Array<{ title: string; price: number }> = [];

  for (const line of lines) {
    const categoryMatch = line.match(/^([A-Za-z][A-Za-z\s&-]{1,40})\s+([0-9]{1,4})$/);
    if (categoryMatch) {
      const name = normalizeWhitespace(categoryMatch[1]);
      if (!['All', 'Items', 'Reviews', 'About', 'Shop Policies'].includes(name) && !categories.includes(name)) {
        categories.push(name);
      }
    }

    const listingMatch = line.match(/^\d+\.\s+(.+?)\s+\$\s*([0-9]+(?:\.[0-9]{1,2})?)/);
    if (listingMatch) {
      const title = normalizeWhitespace(listingMatch[1]);
      const price = parseMoney(listingMatch[2]);
      if (title.length > 2 && !topListings.some((entry) => entry.title === title)) {
        topListings.push({ title, price });
      }
    }
  }

  const announcementMatch = text.match(/Announcement\s+Last updated on [^.]+\.?\s+(.+?)\s+Read more/i);
  const announcement = announcementMatch ? normalizeWhitespace(announcementMatch[1]) : '';

  const reviewQuotes: string[] = [];
  for (const line of lines) {
    if (
      line.length > 20 &&
      !line.startsWith('http') &&
      !line.includes(' out of 5 stars') &&
      !line.includes(' on ') &&
      /[A-Za-z]/.test(line) &&
      !reviewQuotes.includes(line)
    ) {
      if (line.includes('sticker') || line.includes('card') || line.includes('love') || line.includes('quality')) {
        reviewQuotes.push(line);
      }
    }
    if (reviewQuotes.length >= 5) break;
  }

  return {
    sourceUrl,
    shopName,
    location,
    sales: salesMatch ? parseCount(salesMatch[1]) : 0,
    admirers: admirersMatch ? parseCount(admirersMatch[1]) : 0,
    rating: ratingMatch ? Number(ratingMatch[1]) : 0,
    reviewCount: ratingMatch ? parseCount(ratingMatch[2]) : 0,
    listingCount: topListings.length,
    categories: categories.slice(0, 8),
    topListings: topListings.slice(0, 12),
    announcement,
    recentReviews: reviewQuotes.slice(0, 5)
  };
}

function parseEtsyRss(xml: string, sourceUrl: string): ParsedShopSnapshot {
  const titleMatch = xml.match(/<title>\s*Etsy Shop for\s*([^<]+)<\/title>/i);
  const shopName = normalizeWhitespace(decodeXmlEntities(titleMatch?.[1] || ''));

  const items: Array<{ title: string; price: number }> = [];
  const categorySet = new Set<string>();
  const itemRegex = /<item>([\s\S]*?)<\/item>/gi;
  let itemMatch: RegExpExecArray | null = itemRegex.exec(xml);

  while (itemMatch) {
    const itemBlock = itemMatch[1];
    const rawTitle = itemBlock.match(/<title>([\s\S]*?)<\/title>/i)?.[1] || '';
    const titleDecoded = normalizeWhitespace(decodeXmlEntities(rawTitle));
    const title = normalizeWhitespace(titleDecoded.replace(/\s+by\s+.+$/i, ''));

    const descRaw = itemBlock.match(/<description>([\s\S]*?)<\/description>/i)?.[1] || '';
    const description = decodeXmlEntities(descRaw);
    const priceMatch = description.match(/price\"&gt;([0-9]+(?:\.[0-9]{1,2})?)\s*USD/i)
      || description.match(/<p class=\"price\">([0-9]+(?:\.[0-9]{1,2})?)\s*USD/i);
    const price = priceMatch ? Number(priceMatch[1]) : 0;

    if (title && !items.some((entry) => entry.title === title)) {
      items.push({ title, price });
    }

    if (/sticker/i.test(title)) categorySet.add('Stickers');
    if (/card/i.test(title)) categorySet.add('Cards');
    if (/thank/i.test(title) && /card/i.test(title)) categorySet.add('Thank You Cards');

    itemMatch = itemRegex.exec(xml);
  }

  return {
    sourceUrl,
    shopName,
    location: '',
    sales: 0,
    admirers: 0,
    rating: 0,
    reviewCount: 0,
    listingCount: items.length,
    categories: Array.from(categorySet),
    topListings: items.slice(0, 20),
    announcement: '',
    recentReviews: []
  };
}

function parseEtsyShopHtml(html: string, sourceUrl: string): ParsedShopSnapshot {
  const $ = load(html);
  const lines = html.split('\n').map((line) => normalizeWhitespace(line)).filter(Boolean);
  const fullText = normalizeWhitespace($('body').text() || '');

  const h1Text = normalizeWhitespace($('h1').first().text() || '');
  const shopName = h1Text || normalizeWhitespace(lines.find((line) => /^#\s+/.test(line))?.replace(/^#\s+/, '') || '');

  const locationMatch = lines.find((line) => /,\s*[A-Za-z\s]+$/.test(line) && line.length < 90 && !line.includes('http'));
  const location = locationMatch || '';

  const salesMatch = fullText.match(/([0-9,]+)\s+Sales/i) || fullText.match(/([0-9,]+)\s+sales/i);
  const reviewMatch = fullText.match(/([0-9]+(?:\.[0-9])?)\s*\((\d+)\)/);
  const admirerMatch = fullText.match(/([0-9,]+)\s+Admirers/i);

  const categories = new Set<string>();
  const listings: Array<{ title: string; price: number }> = [];
  const seenListingTitles = new Set<string>();

  // Etsy pages often contain repeated listing blocks in navigation and mobile layouts.
  $('a').each((_, anchor) => {
    const text = normalizeWhitespace($(anchor).text());
    if (!text) return;

    const categoryMatch = text.match(/^([A-Za-z][A-Za-z\s&-]{1,40})\s+([0-9]{1,4})$/);
    if (categoryMatch) {
      const name = normalizeWhitespace(categoryMatch[1]);
      if (!['All', 'Items', 'Reviews', 'About', 'Shop Policies'].includes(name)) {
        categories.add(name);
      }
    }

    const priceMatch = text.match(/\$\s*([0-9]+(?:\.[0-9]{1,2})?)/);
    if (priceMatch) {
      const title = normalizeWhitespace(text.replace(/\$\s*[0-9]+(?:\.[0-9]{1,2})?.*$/, ''));
      if (title.length >= 3 && !seenListingTitles.has(title)) {
        seenListingTitles.add(title);
        listings.push({ title, price: parseMoney(priceMatch[0]) });
      }
    }
  });

  const announcementMatch = fullText.match(/Announcement\s+Last updated on [^.]+\.?\s+(.+?)\s+Read more/i);
  const announcement = announcementMatch ? normalizeWhitespace(announcementMatch[1]) : '';

  const reviewRegex = /on\s+[A-Za-z]{3}\s+\d{1,2},\s+\d{4}\s+5 out of 5 stars\s+(.+?)(?=\s+[A-Za-z0-9]+\s+on\s+[A-Za-z]{3}\s+\d{1,2},\s+\d{4}\s+5 out of 5 stars|$)/gi;
  const recentReviews: string[] = [];
  let reviewResult: RegExpExecArray | null = reviewRegex.exec(fullText);
  while (reviewResult && recentReviews.length < 5) {
    const reviewText = normalizeWhitespace(reviewResult[1]);
    if (reviewText.length > 3 && !recentReviews.includes(reviewText)) {
      recentReviews.push(reviewText);
    }
    reviewResult = reviewRegex.exec(fullText);
  }

  return {
    sourceUrl,
    shopName,
    location,
    sales: salesMatch ? parseCount(salesMatch[1]) : 0,
    admirers: admirerMatch ? parseCount(admirerMatch[1]) : 0,
    rating: reviewMatch ? Number(reviewMatch[1]) : 0,
    reviewCount: reviewMatch ? parseCount(reviewMatch[2]) : 0,
    listingCount: listings.length,
    categories: Array.from(categories).slice(0, 8),
    topListings: listings.slice(0, 12),
    announcement,
    recentReviews
  };
}

async function startServer() {
  const app = express();
  const requestedPort = Number(process.env.PORT || 3000);
  const port = await findAvailablePort(requestedPort);

  app.use(express.json());
  app.use(cookieParser());

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  app.get('/api/capabilities', (req, res) => {
    const etsyError = getCapabilityError(() => {
      getEtsyApiKey();
      assertSessionSecretConfigured();
    });
    const instagramError = getCapabilityError(() => {
      getInstagramClientId();
      getInstagramClientSecret();
      assertSessionSecretConfigured();
    });

    res.json({
      etsy: {
        canConnect: !etsyError,
        reason: etsyError,
        callbackUrl: `${resolveAppUrl(req)}/auth/callback/etsy`
      },
      instagram: {
        canConnect: !instagramError,
        directPublishing: !instagramError,
        reason: instagramError,
        callbackUrl: `${resolveAppUrl(req)}/auth/callback/instagram`
      }
    });
  });

  app.get('/api/etsy/shop-snapshot', async (req, res) => {
    const rawUrl = typeof req.query.url === 'string' ? req.query.url : '';
    if (!rawUrl) {
      res.status(400).json({ error: 'Missing url query parameter' });
      return;
    }

    let targetUrl: URL;
    try {
      targetUrl = new URL(rawUrl);
    } catch {
      res.status(400).json({ error: 'Invalid URL' });
      return;
    }

    if (!/(\.|^)etsy\.com$/i.test(targetUrl.hostname) || !targetUrl.pathname.includes('/shop/')) {
      res.status(400).json({ error: 'Only Etsy shop URLs are supported' });
      return;
    }

    try {
      const response = await fetch(targetUrl.toString(), {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'
        }
      });
      let snapshot: ParsedShopSnapshot | null = null;

      if (response.ok) {
        const html = await response.text();
        snapshot = parseEtsyShopHtml(html, targetUrl.toString());
      } else if (response.status === 403) {
        const slugMatch = targetUrl.pathname.match(/\/shop\/([^/?]+)/i);
        const shopSlug = slugMatch?.[1];

        if (shopSlug) {
          const rssUrl = `https://www.etsy.com/shop/${shopSlug}/rss`;
          const rssResponse = await fetch(rssUrl, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'
            }
          });
          if (rssResponse.ok) {
            const xml = await rssResponse.text();
            snapshot = parseEtsyRss(xml, targetUrl.toString());
          }
        }

        if (!snapshot) {
          const proxyUrl = `https://r.jina.ai/${targetUrl.toString()}`;
          const fallbackResponse = await fetch(proxyUrl, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'
            }
          });
          if (!fallbackResponse.ok) {
            res.status(502).json({ error: `Etsy blocked direct fetch (403) and fallback failed (${fallbackResponse.status})` });
            return;
          }
          const text = await fallbackResponse.text();
          snapshot = parseEtsyShopTextFallback(text, targetUrl.toString());
        }
      } else {
        res.status(502).json({ error: `Failed to fetch Etsy shop page (${response.status})` });
        return;
      }

      if (!snapshot || !snapshot.shopName) {
        res.status(422).json({ error: 'Unable to parse shop details from this page' });
        return;
      }

      res.json({ snapshot });
    } catch (error) {
      console.error('Etsy snapshot fetch failed:', error);
      res.status(500).json({ error: 'Failed to fetch Etsy shop snapshot' });
    }
  });

  app.get('/api/auth/url/:provider', (req, res) => {
    const provider = req.params.provider as 'etsy' | 'instagram';
    const appUrl = resolveAppUrl(req);
    const redirectUri = `${appUrl}/auth/callback/${provider}`;

    if (provider !== 'etsy' && provider !== 'instagram') {
      res.status(400).json({ error: 'Unsupported provider' });
      return;
    }

    if (provider === 'etsy') {
      if (!process.env.ETSY_CLIENT_ID) {
        res.status(400).json({ error: 'ETSY_CLIENT_ID is not configured yet' });
        return;
      }

      const state = buildState();
      const { verifier, challenge } = buildPkcePair();

      setOAuthCookie(res, 'etsy_oauth_state', state);
      setOAuthCookie(res, 'etsy_oauth_verifier', verifier);

      const params = new URLSearchParams({
        response_type: 'code',
        client_id: process.env.ETSY_CLIENT_ID,
        redirect_uri: redirectUri,
        scope: 'listings_r listings_w transactions_r shops_r profile_r',
        state,
        code_challenge: challenge,
        code_challenge_method: 'S256'
      });

      res.json({ url: `https://www.etsy.com/oauth/connect?${params.toString()}` });
      return;
    }

    try {
      const clientId = getInstagramClientId();
      const state = buildState();
      setOAuthCookie(res, 'instagram_oauth_state', state);

      const params = new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        scope: getInstagramScopes().join(','),
        response_type: 'code',
        state
      });

      res.json({ url: `${INSTAGRAM_AUTH_URL}?${params.toString()}` });
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : 'Instagram OAuth is not configured yet' });
    }
  });

  app.get('/api/instagram/status', async (req, res) => {
    try {
      const session = await ensureFreshInstagramSession(req, res);
      if (!session) {
        res.json({ connected: false });
        return;
      }

      const { profile, session: resolvedSession } = await resolveInstagramProfile(req, res, session);
      if (
        resolvedSession.accessToken !== session.accessToken
        || resolvedSession.expiresAt !== session.expiresAt
        || resolvedSession.username !== session.username
        || resolvedSession.igUserId !== session.igUserId
      ) {
        setInstagramSessionCookie(res, resolvedSession);
      }

      res.json({
        connected: true,
        profile,
        scopes: resolvedSession.scopes
      });
    } catch (error) {
      console.error('Instagram status check failed:', error);
      clearInstagramSessionCookie(res);
      res.status(401).json({ connected: false, error: 'Instagram session is no longer valid. Reconnect the account.' });
    }
  });

  app.post('/api/instagram/publish', async (req, res) => {
    const caption = typeof req.body?.caption === 'string' ? req.body.caption.trim() : '';
    const imageUrl = typeof req.body?.imageUrl === 'string' ? req.body.imageUrl.trim() : '';
    const postId = typeof req.body?.postId === 'string' ? req.body.postId.trim() : '';

    if (!caption) {
      res.status(400).json({ error: 'Caption is required before publishing to Instagram' });
      return;
    }

    if (!isPublicImageUrl(imageUrl)) {
      res.status(400).json({ error: 'Instagram direct publishing currently requires a public image URL' });
      return;
    }

    try {
      let session = await ensureFreshInstagramSession(req, res);
      if (!session) {
        res.status(401).json({ error: 'Instagram is not connected yet' });
        return;
      }

      const createBody = JSON.stringify({
        image_url: imageUrl,
        caption
      });
      const { payload: creationPayload, session: createSession } = await instagramApiRequest<{ id?: string }>(
        req,
        res,
        session,
        `/${session.igUserId}/media`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: createBody
        }
      );

      const creationId = typeof creationPayload?.id === 'string' ? creationPayload.id : '';
      if (!creationId) {
        throw new Error('Instagram did not return a media container id');
      }

      session = await waitForInstagramContainer(req, res, createSession, creationId);

      const { payload: publishPayload, session: publishSession } = await instagramApiRequest<{ id?: string }>(
        req,
        res,
        session,
        `/${session.igUserId}/media_publish`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ creation_id: creationId })
        }
      );

      const publishedMediaId = typeof publishPayload?.id === 'string' ? publishPayload.id : '';
      if (!publishedMediaId) {
        throw new Error('Instagram did not confirm the published media id');
      }

      const { payload: mediaPayload, session: finalSession } = await instagramApiRequest<Record<string, unknown>>(
        req,
        res,
        publishSession,
        `/${publishedMediaId}?fields=permalink`
      );
      setInstagramSessionCookie(res, finalSession);

      res.json({
        ok: true,
        postId,
        publishedMediaId,
        permalink: typeof mediaPayload?.permalink === 'string' ? mediaPayload.permalink : null
      });
    } catch (error) {
      console.error('Instagram publish failed:', error);
      const message = error instanceof Error ? error.message : 'Unable to publish this Instagram post right now';
      res.status(500).json({ error: message });
    }
  });

  app.get('/api/etsy/status', async (req, res) => {
    let session: EtsyOAuthSession | null = null;
    try {
      session = await ensureFreshEtsySession(req, res);
      if (!session) {
        res.json({ connected: false });
        return;
      }

      const { shop, session: resolvedSession } = await resolveEtsyShop(req, res, session);
      if (resolvedSession.shopId !== session.shopId || resolvedSession.shopName !== session.shopName) {
        setSessionCookie(res, resolvedSession);
      }

      res.json({
        connected: true,
        shop,
        scopes: resolvedSession.scopes
      });
    } catch (error) {
      console.error('Etsy status check failed:', error);
      if (isNoShopError(error)) {
        clearSessionCookie(res);
        res.status(409).json({
          connected: false,
          code: 'no_shop',
          error: 'The connected Etsy account does not have an accessible seller shop. Reconnect using the seller account that owns this shop.',
          userId: session?.userId || null,
          scopes: session?.scopes || []
        });
        return;
      }
      clearSessionCookie(res);
      res.status(401).json({ connected: false, error: 'Etsy session is no longer valid. Reconnect the shop.' });
    }
  });

  app.get('/api/etsy/sync', async (req, res) => {
    let session: EtsyOAuthSession | null = null;
    try {
      session = await ensureFreshEtsySession(req, res);
      if (!session) {
        res.status(401).json({ error: 'Connect Etsy before syncing live data' });
        return;
      }

      const { shop, session: resolvedSession } = await resolveEtsyShop(req, res, session);
      let activeSession = resolvedSession;

      const listingsResponse = await etsyJsonRequest<{ results?: Record<string, any>[] }>(
        req,
        res,
        activeSession,
        `/application/shops/${shop.shopId}/listings/active?limit=100&includes=Images,Inventory`
      );
      activeSession = listingsResponse.session;

      const receiptsResponse = await etsyJsonRequest<{ results?: Record<string, any>[] }>(
        req,
        res,
        activeSession,
        `/application/shops/${shop.shopId}/receipts?limit=100&was_paid=true&includes=Transactions`
      );
      activeSession = receiptsResponse.session;

      setSessionCookie(res, activeSession);

      const listings = (listingsResponse.payload?.results || [])
        .map((entry) => normalizeListing(entry))
        .filter((entry) => entry.inventoryItem.etsyListingId);
      const receiptItems = (receiptsResponse.payload?.results || [])
        .map((entry) => normalizeReceipt(entry))
        .filter((entry) => entry.receiptId);
      const receiptSummary = summarizeReceipts(receiptsResponse.payload?.results || []);

      const payload: EtsySyncPayload = {
        connected: true,
        syncedAt: new Date().toISOString(),
        shop,
        shopRevenue30d: receiptSummary.shopRevenue30d || null,
        shopOrders30d: receiptSummary.shopOrders30d || null,
        averageConversionRate: null,
        listingMetrics: listings.map((entry) => entry.metric),
        inventoryItems: listings.map((entry) => entry.inventoryItem),
        receiptItems
      };

      res.json(payload);
    } catch (error) {
      console.error('Etsy live sync failed:', error);
      if (isNoShopError(error)) {
        clearSessionCookie(res);
        res.status(409).json({
          code: 'no_shop',
          error: 'Etsy authorized the account, but no seller shop was returned. Reconnect using the seller account that owns this shop.',
          userId: session?.userId || null,
          scopes: session?.scopes || []
        });
        return;
      }
      res.status(500).json({ error: error instanceof Error ? error.message : 'Unable to sync Etsy data right now' });
    }
  });

  app.post('/api/etsy/listings/:listingId/push', async (req, res) => {
    const listingId = String(req.params.listingId || '').trim();
    const body = (req.body || {}) as EtsyListingUpdateBody;
    const requestedTitle = typeof body.title === 'string' ? body.title.trim() : undefined;
    const requestedDescription = typeof body.description === 'string' ? body.description.trim() : undefined;
    const requestedPrice = typeof body.price === 'number' && Number.isFinite(body.price) ? body.price : undefined;
    const requestedStockLevel = typeof body.stockLevel === 'number' && Number.isFinite(body.stockLevel)
      ? Math.max(0, Math.round(body.stockLevel))
      : undefined;

    if (!listingId) {
      res.status(400).json({ error: 'A listing id is required' });
      return;
    }

    if (
      requestedTitle === undefined &&
      requestedDescription === undefined &&
      requestedPrice === undefined &&
      requestedStockLevel === undefined
    ) {
      res.status(400).json({ error: 'Nothing to sync to Etsy yet' });
      return;
    }

    let session: EtsyOAuthSession | null = null;

    try {
      session = await ensureFreshEtsySession(req, res);
      if (!session) {
        res.status(401).json({ error: 'Connect Etsy before pushing listing updates' });
        return;
      }

      const { shop, session: resolvedSession } = await resolveEtsyShop(req, res, session);
      let activeSession = resolvedSession;

      if (requestedTitle !== undefined || requestedDescription !== undefined) {
        const listingPatch: Record<string, string> = {};
        if (requestedTitle !== undefined) {
          listingPatch.title = requestedTitle;
        }
        if (requestedDescription !== undefined) {
          listingPatch.description = requestedDescription;
        }

        const listingResponse = await etsyJsonRequest<Record<string, any>>(
          req,
          res,
          activeSession,
          `/application/shops/${shop.shopId}/listings/${listingId}`,
          {
            method: 'PATCH',
            body: JSON.stringify(listingPatch)
          }
        );
        activeSession = listingResponse.session;
      }

      if (requestedPrice !== undefined || requestedStockLevel !== undefined) {
        const inventoryResponse = await etsyJsonRequest<Record<string, any>>(
          req,
          res,
          activeSession,
          `/application/listings/${listingId}/inventory`
        );
        activeSession = inventoryResponse.session;

        const inventory = inventoryResponse.payload || {};
        const products = Array.isArray(inventory?.products) ? inventory.products : [];

        if (products.length !== 1) {
          res.status(409).json({
            error: 'This Etsy listing has multiple inventory products or variations. Update it inside Etsy for now to avoid overwriting variant data.'
          });
          return;
        }

        const [product] = products;
        const propertyValues = Array.isArray(product?.property_values) ? product.property_values : [];
        const offerings = Array.isArray(product?.offerings) ? product.offerings : [];
        if (propertyValues.length > 0 || offerings.length !== 1) {
          res.status(409).json({
            error: 'This Etsy listing has variation-aware inventory. EtsyHelper only pushes stock and price automatically for single-product listings right now.'
          });
          return;
        }

        const updateBody = {
          products: [normalizeInventoryUpdateProduct(product, {
            price: requestedPrice,
            stockLevel: requestedStockLevel
          })],
          price_on_property: Array.isArray(inventory?.price_on_property) ? inventory.price_on_property : [],
          quantity_on_property: Array.isArray(inventory?.quantity_on_property) ? inventory.quantity_on_property : [],
          sku_on_property: Array.isArray(inventory?.sku_on_property) ? inventory.sku_on_property : [],
          readiness_state_on_property: Array.isArray(inventory?.readiness_state_on_property) ? inventory.readiness_state_on_property : []
        };

        const updatedInventoryResponse = await etsyJsonRequest<Record<string, any>>(
          req,
          res,
          activeSession,
          `/application/listings/${listingId}/inventory`,
          {
            method: 'PUT',
            body: JSON.stringify(updateBody)
          }
        );
        activeSession = updatedInventoryResponse.session;
      }

      setSessionCookie(res, activeSession);
      res.json({
        ok: true,
        listingId,
        pushed: {
          title: requestedTitle !== undefined,
          description: requestedDescription !== undefined,
          price: requestedPrice !== undefined,
          stockLevel: requestedStockLevel !== undefined
        }
      });
    } catch (error) {
      console.error('Etsy listing push failed:', error);
      if (isNoShopError(error)) {
        clearSessionCookie(res);
        res.status(409).json({
          code: 'no_shop',
          error: 'Etsy authorized the account, but no seller shop was returned. Reconnect using the seller account that owns this shop.',
          userId: session?.userId || null,
          scopes: session?.scopes || []
        });
        return;
      }
      res.status(500).json({ error: error instanceof Error ? error.message : 'Unable to push Etsy listing updates right now' });
    }
  });

  app.get('/auth/callback/:provider', async (req, res) => {
    const provider = req.params.provider as 'etsy' | 'instagram';
    const code = typeof req.query.code === 'string' ? req.query.code : '';
    const state = typeof req.query.state === 'string' ? req.query.state : '';
    const appUrl = resolveAppUrl(req);

    if (provider !== 'etsy' && provider !== 'instagram') {
      res.status(400).send('Unsupported provider');
      return;
    }

    const stateCookie = provider === 'etsy' ? 'etsy_oauth_state' : 'instagram_oauth_state';
    const expectedState = req.cookies?.[stateCookie];
    const verifier = provider === 'etsy' ? req.cookies?.etsy_oauth_verifier : '';

    clearOAuthCookie(res, stateCookie);
    if (provider === 'etsy') {
      clearOAuthCookie(res, 'etsy_oauth_verifier');
    }

    if (!code || !state || !expectedState || state !== expectedState) {
      res.status(400).send(`
        <html>
          <body style="font-family: sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; background: #fff7ed;">
            <div style="max-width: 540px; text-align: center; border: 1px solid #fed7aa; padding: 2rem; border-radius: 1.5rem; background: white;">
              <h1 style="color: #9a3412;">Authorization could not be verified</h1>
              <p style="color: #57534e; line-height: 1.7;">The OAuth callback was missing a valid state or code. Start the authorization flow again from EtsyHelper.</p>
            </div>
          </body>
        </html>
      `);
      return;
    }

    if (provider === 'etsy') {
      if (!verifier || typeof verifier !== 'string') {
        res.status(400).send(`
          <html>
            <body style="font-family: sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; background: #fff7ed;">
              <div style="max-width: 540px; text-align: center; border: 1px solid #fed7aa; padding: 2rem; border-radius: 1.5rem; background: white;">
                <h1 style="color: #9a3412;">Missing PKCE verifier</h1>
                <p style="color: #57534e; line-height: 1.7;">The Etsy authorization flow expired before the server could finish the token exchange. Start the connection again from EtsyHelper.</p>
              </div>
            </body>
          </html>
        `);
        return;
      }

      let token: EtsyOAuthTokenResponse | null = null;

      try {
        const redirectUri = `${appUrl}/auth/callback/etsy`;
        token = await requestEtsyOAuthToken(code, verifier, redirectUri);
        const session: EtsyOAuthSession = {
          accessToken: token.access_token,
          refreshToken: token.refresh_token,
          expiresAt: Date.now() + (token.expires_in * 1000),
          userId: parseEtsyUserId(token.access_token),
          scopes: token.scope ? token.scope.split(/\s+/).filter(Boolean) : ['listings_r', 'listings_w', 'transactions_r', 'shops_r']
        };

        const { shop, session: resolvedSession } = await resolveEtsyShop(req, res, session);
        setSessionCookie(res, resolvedSession);

        res.send(`
          <html>
            <body style="font-family: sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; background: #f8fafc;">
              <div style="max-width: 620px; text-align: center; border: 1px solid #e2e8f0; padding: 2rem; border-radius: 1.75rem; background: white; box-shadow: 0 25px 50px -12px rgba(15, 23, 42, 0.15);">
                <h1 style="color: #0f172a; margin-bottom: 1rem;">Etsy connected</h1>
                <p style="color: #475569; line-height: 1.7; margin-bottom: 1rem;">
                  EtsyHelper finished the OAuth exchange and verified access to <strong>${escapeHtml(shop.shopName || 'your Etsy shop')}</strong>.
                </p>
                <p style="color: #64748b; line-height: 1.7;">
                  Head back to the app to sync live listings, inventory, and order signals.
                </p>
                <script>
                  if (window.opener) {
                    window.opener.postMessage({ type: 'OAUTH_AUTH_SUCCESS', provider: 'etsy' }, ${JSON.stringify(appUrl)});
                    setTimeout(() => window.close(), 900);
                  } else {
                    window.location.href = '/';
                  }
                </script>
              </div>
            </body>
          </html>
        `);
      } catch (error) {
        console.error('Etsy OAuth callback failed:', error);
        clearSessionCookie(res);
        if (isNoShopError(error)) {
          if (!token) {
            res.status(409).send('Seller shop not found.');
            return;
          }
          const diagnosticsSession: EtsyOAuthSession = {
            accessToken: token.access_token,
            refreshToken: token.refresh_token,
            expiresAt: Date.now() + (token.expires_in * 1000),
            userId: parseEtsyUserId(token.access_token),
            scopes: token.scope ? token.scope.split(/\s+/).filter(Boolean) : ['listings_r', 'listings_w', 'transactions_r', 'shops_r', 'profile_r']
          };
          const profile = await tryFetchEtsyUserProfile(req, res, diagnosticsSession);
          const identityLine = profile?.loginName || profile?.primaryEmail || profile?.firstName
            ? `${profile?.firstName ? `${profile.firstName}${profile.lastName ? ` ${profile.lastName}` : ''}` : profile?.loginName || profile?.primaryEmail} (${profile?.loginName || profile?.primaryEmail || diagnosticsSession.userId})`
            : diagnosticsSession.userId;

          res.status(409).send(`
            <html>
              <body style="font-family: sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; background: #fff7ed;">
                <div style="max-width: 620px; text-align: center; border: 1px solid #fed7aa; padding: 2rem; border-radius: 1.75rem; background: white;">
                  <h1 style="color: #9a3412; margin-bottom: 1rem;">Seller shop not found</h1>
                  <p style="color: #57534e; line-height: 1.7; margin-bottom: 1rem;">
                    Etsy authorized the account, but did not return a seller shop for it.
                  </p>
                  <p style="color: #57534e; line-height: 1.7; margin-bottom: 1rem;">
                    Authorized Etsy identity: <strong>${escapeHtml(identityLine)}</strong>
                  </p>
                  <p style="color: #57534e; line-height: 1.7; margin-bottom: 1rem;">
                    Granted scopes: <code>${diagnosticsSession.scopes.join(', ')}</code>
                  </p>
                  <p style="color: #57534e; line-height: 1.7;">
                    Reconnect using the Etsy seller account that actually owns PipersPress.
                  </p>
                </div>
              </body>
            </html>
          `);
          return;
        }
        res.status(500).send(`
          <html>
            <body style="font-family: sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; background: #fff7ed;">
              <div style="max-width: 620px; text-align: center; border: 1px solid #fed7aa; padding: 2rem; border-radius: 1.75rem; background: white;">
                <h1 style="color: #9a3412; margin-bottom: 1rem;">Etsy connection failed</h1>
                <p style="color: #57534e; line-height: 1.7;">
                  ${escapeHtml(error instanceof Error ? error.message : 'The Etsy token exchange did not complete.')}
                </p>
              </div>
            </body>
          </html>
        `);
      }
      return;
    }

    try {
      const redirectUri = `${appUrl}/auth/callback/instagram`;
      const shortLivedToken = await requestInstagramOAuthToken(code, redirectUri);
      const longLivedToken = await exchangeInstagramLongLivedToken(shortLivedToken.access_token);
      const bootstrapSession: InstagramOAuthSession = {
        accessToken: longLivedToken.access_token,
        expiresAt: Date.now() + ((longLivedToken.expires_in || 0) * 1000),
        igUserId: String(shortLivedToken.user_id || '').trim(),
        username: undefined,
        scopes: normalizeInstagramScopes(longLivedToken.permissions, normalizeInstagramScopes(shortLivedToken.permissions)),
        tokenType: longLivedToken.token_type || 'bearer'
      };

      const { profile, session } = await resolveInstagramProfile(req, res, bootstrapSession);
      setInstagramSessionCookie(res, session);

      res.send(`
        <html>
          <body style="font-family: sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; background: #f8fafc;">
            <div style="max-width: 620px; text-align: center; border: 1px solid #e2e8f0; padding: 2rem; border-radius: 1.75rem; background: white; box-shadow: 0 25px 50px -12px rgba(15, 23, 42, 0.15);">
              <h1 style="color: #0f172a; margin-bottom: 1rem;">Instagram connected</h1>
              <p style="color: #475569; line-height: 1.7; margin-bottom: 1rem;">
                EtsyHelper finished the Instagram token exchange${profile.username ? ` for <strong>@${escapeHtml(profile.username)}</strong>` : ''}.
              </p>
              <p style="color: #64748b; line-height: 1.7;">
                Image posts with public assets can now publish directly from the Studio queue.
              </p>
              <script>
                if (window.opener) {
                  window.opener.postMessage({ type: 'OAUTH_AUTH_SUCCESS', provider: 'instagram' }, ${JSON.stringify(appUrl)});
                  setTimeout(() => window.close(), 900);
                } else {
                  window.location.href = '/';
                }
              </script>
            </div>
          </body>
        </html>
      `);
    } catch (error) {
      console.error('Instagram OAuth callback failed:', error);
      clearInstagramSessionCookie(res);
      res.status(500).send(`
        <html>
          <body style="font-family: sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; background: #fff7ed;">
            <div style="max-width: 620px; text-align: center; border: 1px solid #fed7aa; padding: 2rem; border-radius: 1.75rem; background: white;">
              <h1 style="color: #9a3412; margin-bottom: 1rem;">Instagram connection failed</h1>
              <p style="color: #57534e; line-height: 1.7;">
                ${escapeHtml(error instanceof Error ? error.message : 'The Instagram token exchange did not complete.')}
              </p>
            </div>
          </body>
        </html>
      `);
    }
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa'
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(port, '0.0.0.0', () => {
    if (port !== requestedPort) {
      console.log(`Port ${requestedPort} was busy, so EtsyHelper moved to http://localhost:${port}`);
    }
    console.log(`Server running on http://localhost:${port}`);
  });
}

startServer();
