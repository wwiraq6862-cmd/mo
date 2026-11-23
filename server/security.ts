import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

const FALLBACK_EPHEMERAL_SECRET = crypto.randomBytes(32).toString('hex');
let warnedAboutEphemeralSecret = false;

export const CLIENT_SESSION_COOKIE = 'hamilha_csid';
const CLIENT_SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 days
const FILE_ACCESS_TOKEN_TTL_MS = 1000 * 60 * 60 * 2; // 2 hours

export function getSessionSigningKey(): string {
  const configured = process.env.SESSION_SECRET?.trim();
  if (configured && configured.length >= 16) {
    return configured;
  }
  if (process.env.NODE_ENV === 'production' && !warnedAboutEphemeralSecret) {
    warnedAboutEphemeralSecret = true;
    console.warn(
      '[HAMILHA] WARNING: SESSION_SECRET is not configured (or shorter than 16 chars). Using an ephemeral in-memory key; sessions will reset on restart.',
    );
  }
  return FALLBACK_EPHEMERAL_SECRET;
}

function signPayload(payloadB64: string, purpose: string): string {
  return crypto
    .createHmac('sha256', getSessionSigningKey())
    .update(`${purpose}:${payloadB64}`)
    .digest('base64url');
}

function verifySignature(payloadB64: string, sigB64: string, purpose: string): boolean {
  const expected = signPayload(payloadB64, purpose);
  const sigBuf = Buffer.from(sigB64);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length) return false;
  return crypto.timingSafeEqual(sigBuf, expBuf);
}

export interface ClientSession {
  cid: string;
  token: string;
  via: 'header' | 'cookie' | 'issued';
}

export function issueClientSessionToken(existingCid?: string): { cid: string; token: string } {
  const cid = existingCid || `cid_${crypto.randomBytes(16).toString('hex')}`;
  const payload = {
    cid,
    iat: Date.now(),
    exp: Date.now() + CLIENT_SESSION_TTL_MS,
  };
  const payloadB64 = Buffer.from(JSON.stringify(payload), 'utf-8').toString('base64url');
  const sigB64 = signPayload(payloadB64, 'client-session');
  return { cid, token: `${payloadB64}.${sigB64}` };
}

export function verifyClientSessionToken(token: string): { cid: string } | null {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [payloadB64, sigB64] = parts;
  if (!payloadB64 || !sigB64) return null;
  if (!verifySignature(payloadB64, sigB64, 'client-session')) return null;

  try {
    const parsed = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf-8')) as {
      cid?: string;
      exp?: number;
    };
    if (
      typeof parsed.cid !== 'string' ||
      !parsed.cid.startsWith('cid_') ||
      parsed.cid.length < 12 ||
      parsed.cid.length > 64 ||
      typeof parsed.exp !== 'number' ||
      parsed.exp <= Date.now()
    ) {
      return null;
    }
    return { cid: parsed.cid };
  } catch {
    return null;
  }
}

export function issueSignedFileAccessToken(downloadId: string, ttlMs = FILE_ACCESS_TOKEN_TTL_MS): string {
  const payload = {
    did: downloadId,
    exp: Date.now() + ttlMs,
  };
  const payloadB64 = Buffer.from(JSON.stringify(payload), 'utf-8').toString('base64url');
  const sigB64 = signPayload(payloadB64, 'file-access');
  return `${payloadB64}.${sigB64}`;
}

export function verifySignedFileAccessToken(token: string, expectedDownloadId: string): boolean {
  if (!token || typeof token !== 'string') return false;
  const parts = token.split('.');
  if (parts.length !== 2) return false;
  const [payloadB64, sigB64] = parts;
  if (!payloadB64 || !sigB64) return false;
  if (!verifySignature(payloadB64, sigB64, 'file-access')) return false;

  try {
    const parsed = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf-8')) as {
      did?: string;
      exp?: number;
    };
    return (
      parsed.did === expectedDownloadId &&
      typeof parsed.exp === 'number' &&
      parsed.exp > Date.now()
    );
  } catch {
    return false;
  }
}

function parseCookies(cookieHeader: string | undefined): Record<string, string> {
  const result: Record<string, string> = {};
  if (!cookieHeader) return result;
  const pairs = cookieHeader.split(';');
  for (const pair of pairs) {
    const idx = pair.indexOf('=');
    if (idx <= 0) continue;
    const key = pair.slice(0, idx).trim();
    const val = pair.slice(idx + 1).trim();
    try {
      result[key] = decodeURIComponent(val);
    } catch {
      result[key] = val;
    }
  }
  return result;
}

export function setClientSessionCookie(req: Request, res: Response, token: string): void {
  const maxAgeSec = Math.floor(CLIENT_SESSION_TTL_MS / 1000);
  const protoHeader = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
  const isSecure = req.secure || protoHeader === 'https' || process.env.NODE_ENV === 'production';

  const parts = [
    `${CLIENT_SESSION_COOKIE}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    `Max-Age=${maxAgeSec}`,
  ];
  if (isSecure) {
    parts.push('Secure', 'SameSite=None', 'Partitioned');
  } else {
    parts.push('SameSite=Lax');
  }
  res.append('Set-Cookie', parts.join('; '));
}

export function resolveClientSession(req: Request): ClientSession | null {
  const headerToken = String(req.headers['x-client-token'] || '').trim();
  if (headerToken) {
    const verified = verifyClientSessionToken(headerToken);
    if (verified) {
      return { cid: verified.cid, token: headerToken, via: 'header' };
    }
  }

  const cookies = parseCookies(req.headers.cookie);
  const cookieToken = cookies[CLIENT_SESSION_COOKIE];
  if (cookieToken) {
    const verified = verifyClientSessionToken(cookieToken);
    if (verified) {
      return { cid: verified.cid, token: cookieToken, via: 'cookie' };
    }
  }

  return null;
}

export function ensureClientSession(req: Request, res: Response): ClientSession {
  const existing = resolveClientSession(req);
  if (existing) {
    return existing;
  }
  const issued = issueClientSessionToken();
  setClientSessionCookie(req, res, issued.token);
  res.setHeader('X-Client-Token', issued.token);
  return { cid: issued.cid, token: issued.token, via: 'issued' };
}

/**
 * Protects cookie-authenticated state-changing requests against cross-site request forgery.
 * Header-token clients (Flutter) are inherently immune to ambient cookie CSRF.
 */
export function verifyMutationOrigin(req: Request, res: Response, next: NextFunction): void {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
    next();
    return;
  }

  // Native clients using explicit X-Client-Token or Bearer auth are not using ambient cookies
  if (req.headers['x-client-token'] || req.headers.authorization) {
    next();
    return;
  }

  const customRequestedWith = String(req.headers['x-requested-with'] || '').trim();
  if (customRequestedWith === 'hamilha-web' || customRequestedWith === 'XMLHttpRequest') {
    next();
    return;
  }

  const origin = req.headers.origin;
  if (!origin) {
    next();
    return;
  }

  const expectedHost = String(req.headers['x-forwarded-host'] || req.headers.host || '')
    .split(',')[0]
    .trim()
    .toLowerCase();

  try {
    const originHost = new URL(origin).host.toLowerCase();
    if (originHost === expectedHost || getAllowedCorsOrigins().has(origin.toLowerCase())) {
      next();
      return;
    }
  } catch {
    // Malformed origin rejected below
  }

  res.status(403).json({ error: 'تم رفض الطلب بسبب عدم تطابق مصدر الطلب (Origin).' });
}

export function getAllowedCorsOrigins(): Set<string> {
  const allowed = new Set<string>();
  const rawList = process.env.CORS_ALLOWED_ORIGINS || '';
  for (const item of rawList.split(',')) {
    const trimmed = item.trim().replace(/\/$/, '').toLowerCase();
    if (trimmed && (trimmed.startsWith('https://') || trimmed.startsWith('http://'))) {
      allowed.add(trimmed);
    }
  }

  const appUrl = (process.env.APP_URL || '').trim().replace(/\/$/, '');
  if (appUrl && (appUrl.startsWith('https://') || appUrl.startsWith('http://'))) {
    try {
      allowed.add(new URL(appUrl).origin.toLowerCase());
    } catch {
      // Ignore invalid APP_URL
    }
  }
  return allowed;
}

export function createCorsMiddleware() {
  return (req: Request, res: Response, next: NextFunction): void => {
    const origin = req.headers.origin;
    if (!origin) {
      if (req.method === 'OPTIONS') {
        res.sendStatus(204);
        return;
      }
      next();
      return;
    }

    const normalizedOrigin = origin.replace(/\/$/, '').toLowerCase();
    const expectedHost = String(req.headers['x-forwarded-host'] || req.headers.host || '')
      .split(',')[0]
      .trim()
      .toLowerCase();

    let isSameHost = false;
    try {
      isSameHost = new URL(origin).host.toLowerCase() === expectedHost;
    } catch {
      isSameHost = false;
    }

    const allowedOrigins = getAllowedCorsOrigins();
    const isAllowed = isSameHost || allowedOrigins.has(normalizedOrigin);

    if (isAllowed) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
      res.setHeader(
        'Access-Control-Allow-Headers',
        'Content-Type, Authorization, X-Client-Token, X-Requested-With',
      );
      res.setHeader('Access-Control-Expose-Headers', 'X-Client-Token');
    }

    if (req.method === 'OPTIONS') {
      res.sendStatus(isAllowed ? 204 : 403);
      return;
    }

    next();
  };
}

interface RateBucket {
  count: number;
  resetAt: number;
}

export function createRateLimiter(options: {
  windowMs: number;
  maxRequests: number;
  message?: string;
  keyPrefix?: string;
}) {
  const buckets = new Map<string, RateBucket>();
  const prefix = options.keyPrefix || 'rl';

  const pruneTimer = setInterval(() => {
    const now = Date.now();
    for (const [key, bucket] of buckets.entries()) {
      if (bucket.resetAt <= now) {
        buckets.delete(key);
      }
    }
  }, Math.max(options.windowMs, 60_000));
  pruneTimer.unref();

  return (req: Request, res: Response, next: NextFunction): void => {
    const ip = String(req.ip || req.socket.remoteAddress || 'unknown');
    const key = `${prefix}:${ip}`;
    const now = Date.now();

    let bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 1, resetAt: now + options.windowMs };
      buckets.set(key, bucket);
    } else {
      bucket.count += 1;
    }

    const remaining = Math.max(0, options.maxRequests - bucket.count);
    res.setHeader('X-RateLimit-Limit', String(options.maxRequests));
    res.setHeader('X-RateLimit-Remaining', String(remaining));
    res.setHeader('X-RateLimit-Reset', String(Math.ceil(bucket.resetAt / 1000)));

    if (bucket.count > options.maxRequests) {
      const retryAfterSec = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
      res.setHeader('Retry-After', String(retryAfterSec));
      res.status(429).json({
        error:
          options.message ||
          'تم تجاوز الحد المسموح من الطلبات مؤقتاً. يرجى الانتظار قليلاً والمحاولة مرة أخرى.',
      });
      return;
    }

    next();
  };
}
