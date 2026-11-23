import crypto from 'node:crypto';
import dns from 'node:dns/promises';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { DOWNLOADS_DIR } from './db.ts';

export type PlatformId =
  | 'tiktok'
  | 'facebook'
  | 'instagram'
  | 'youtube'
  | 'whatsapp'
  | 'direct';

export interface QualityOption {
  id: string;
  label: string;
  resolution: string;
  format: 'mp4' | 'webm' | 'm4a' | 'mp3' | 'jpg' | 'png' | 'webp' | 'pdf';
  sizeEstimate: string;
  fileBytes: number | null;
  mediaType: 'video' | 'audio' | 'image' | 'document';
  streamUrl: string;
  mimeType: string;
}

export interface AnalyzedMedia {
  analysisId: string;
  url: string;
  platform: PlatformId;
  platformNameAr: string;
  title: string;
  author: string;
  duration: string | null;
  thumbnailUrl: string | null;
  mediaType: 'video' | 'image' | 'audio' | 'document';
  downloadAllowed: boolean;
  policyNote: string;
  streamMode: 'direct' | 'unavailable';
  qualities: QualityOption[];
}

const PLATFORM_NAMES_AR: Record<PlatformId, string> = {
  tiktok: 'تيك توك (TikTok)',
  facebook: 'فيسبوك (Facebook)',
  instagram: 'إنستغرام (Instagram)',
  youtube: 'يوتيوب (YouTube)',
  whatsapp: 'واتساب (WhatsApp)',
  direct: 'رابط وسائط مباشر',
};

const PLATFORM_HOST_PATTERNS: Array<{ platform: PlatformId; hosts: string[] }> = [
  {
    platform: 'tiktok',
    hosts: ['tiktok.com', 'vm.tiktok.com', 'vt.tiktok.com', 'm.tiktok.com', 'www.tiktok.com'],
  },
  {
    platform: 'facebook',
    hosts: ['facebook.com', 'www.facebook.com', 'm.facebook.com', 'fb.watch', 'web.facebook.com'],
  },
  {
    platform: 'instagram',
    hosts: ['instagram.com', 'www.instagram.com', 'instagr.am'],
  },
  {
    platform: 'youtube',
    hosts: ['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be', 'youtube-nocookie.com'],
  },
  {
    platform: 'whatsapp',
    hosts: ['wa.me', 'api.whatsapp.com', 'web.whatsapp.com'],
  },
];

function expandIpv6ToWords(rawIp: string): number[] | null {
  const clean = rawIp.split('%')[0].toLowerCase();
  if (!clean || net.isIP(clean) !== 6) return null;

  let working = clean;
  const lastColon = working.lastIndexOf(':');
  if (lastColon !== -1 && working.slice(lastColon + 1).includes('.')) {
    const ipv4Part = working.slice(lastColon + 1);
    if (net.isIP(ipv4Part) !== 4) return null;
    const octets = ipv4Part.split('.').map(Number);
    const hi = ((octets[0] << 8) | octets[1]).toString(16);
    const lo = ((octets[2] << 8) | octets[3]).toString(16);
    working = `${working.slice(0, lastColon)}:${hi}:${lo}`;
  }

  const parts = working.split('::');
  if (parts.length > 2) return null;

  const left = parts[0] ? parts[0].split(':').filter(Boolean) : [];
  const right = parts[1] ? parts[1].split(':').filter(Boolean) : [];

  if (parts.length === 1) {
    if (left.length !== 8) return null;
    return left.map((h) => parseInt(h, 16));
  }

  const missing = 8 - (left.length + right.length);
  if (missing < 1) return null;
  const full = [...left, ...Array(missing).fill('0'), ...right];
  if (full.length !== 8) return null;
  return full.map((h) => parseInt(h, 16));
}

export function isBlockedIpAddress(rawIp: string): boolean {
  const clean = rawIp.split('%')[0].trim().replace(/^\[|\]$/g, '').toLowerCase();
  const ipType = net.isIP(clean);
  if (!ipType) return false;

  if (ipType === 4) {
    const parts = clean.split('.').map(Number);
    const [a, b, c] = parts;
    if (a === 0) return true; // 0.0.0.0/8 ("this network")
    if (a === 10) return true; // 10.0.0.0/8 (RFC1918)
    if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 (CGNAT)
    if (a === 127) return true; // 127.0.0.0/8 (Loopback)
    if (a === 169 && b === 254) return true; // 169.254.0.0/16 (Link-local / Cloud Metadata)
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12 (RFC1918)
    if (a === 192 && b === 0 && c === 0) return true; // 192.0.0.0/24 (IETF Protocol)
    if (a === 192 && b === 0 && c === 2) return true; // 192.0.2.0/24 (TEST-NET-1)
    if (a === 192 && b === 168) return true; // 192.168.0.0/16 (RFC1918)
    if (a === 198 && (b === 18 || b === 19)) return true; // 198.18.0.0/15 (Benchmarking)
    if (a === 198 && b === 51 && c === 100) return true; // 198.51.100.0/24 (TEST-NET-2)
    if (a === 203 && b === 0 && c === 113) return true; // 203.0.113.0/24 (TEST-NET-3)
    if (a >= 224) return true; // 224.0.0.0/4 Multicast & 240.0.0.0/4 Reserved/Broadcast
    return false;
  }

  const words = expandIpv6ToWords(clean);
  if (!words) return true;

  const isAllZeroPrefix5 =
    words[0] === 0 && words[1] === 0 && words[2] === 0 && words[3] === 0 && words[4] === 0;

  // :: (unspecified) and ::1 (loopback)
  if (isAllZeroPrefix5 && words[5] === 0 && words[6] === 0 && (words[7] === 0 || words[7] === 1)) {
    return true;
  }

  // IPv4-mapped IPv6 ::ffff:0:0/96 or IPv4-compatible ::/96
  if (isAllZeroPrefix5 && (words[5] === 0xffff || words[5] === 0)) {
    const embeddedV4 = `${words[6] >> 8}.${words[6] & 0xff}.${words[7] >> 8}.${words[7] & 0xff}`;
    return isBlockedIpAddress(embeddedV4);
  }

  // NAT64 64:ff9b::/96 & 64:ff9b:1::/48
  if (words[0] === 0x0064 && words[1] === 0xff9b) {
    const embeddedV4 = `${words[6] >> 8}.${words[6] & 0xff}.${words[7] >> 8}.${words[7] & 0xff}`;
    return isBlockedIpAddress(embeddedV4);
  }

  // 6to4 2002::/16 (embeds IPv4 in words[1] and words[2])
  if (words[0] === 0x2002) {
    const embeddedV4 = `${words[1] >> 8}.${words[1] & 0xff}.${words[2] >> 8}.${words[2] & 0xff}`;
    return isBlockedIpAddress(embeddedV4);
  }

  // Teredo 2001:0000::/32
  if (words[0] === 0x2001 && words[1] === 0x0000) return true;

  // Documentation 2001:db8::/32
  if (words[0] === 0x2001 && words[1] === 0x0db8) return true;

  // Unique Local Addresses fc00::/7 (includes fd00::/8)
  if ((words[0] & 0xfe00) === 0xfc00) return true;

  // Link-local fe80::/10
  if ((words[0] & 0xffc0) === 0xfe80) return true;

  // Deprecated site-local fec0::/10
  if ((words[0] & 0xffc0) === 0xfec0) return true;

  // Multicast ff00::/8
  if ((words[0] & 0xff00) === 0xff00) return true;

  return false;
}

export function isPrivateOrBlockedIp(hostname: string): boolean {
  const lower = hostname.toLowerCase().split('%')[0].replace(/^\[|\]$/g, '').trim();
  if (
    !lower ||
    lower === 'localhost' ||
    lower.endsWith('.localhost') ||
    lower.endsWith('.local') ||
    lower.endsWith('.internal') ||
    lower.endsWith('.arpa')
  ) {
    return true;
  }

  if (net.isIP(lower)) {
    return isBlockedIpAddress(lower);
  }

  // Reject single-label hostnames or integer/hex/octal IP disguises
  if (!lower.includes('.') || /^(0x[0-9a-f]+|0[0-7]+|\d+)$/i.test(lower)) {
    return true;
  }

  return false;
}

export function assertSafeExternalUrl(rawInput: string): URL {
  const trimmed = rawInput.trim();
  if (!trimmed || trimmed.length > 2048) {
    throw new Error('الرابط غير صالح أو يتجاوز الطول المسموح.');
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(trimmed);
  } catch {
    throw new Error('صيغة الرابط غير صحيحة. تأكد من بدء الرابط بـ https://');
  }

  if (parsedUrl.protocol !== 'https:' && parsedUrl.protocol !== 'http:') {
    throw new Error('يُسمح فقط بروابط http أو https الآمنة.');
  }

  if (parsedUrl.username || parsedUrl.password) {
    throw new Error('لا يُسمح ببيانات المصادقة المضمنة داخل الرابط.');
  }

  if (isPrivateOrBlockedIp(parsedUrl.hostname)) {
    throw new Error('لا يُسمح بالوصول إلى العناوين المحلية أو الشبكات الخاصة.');
  }

  return parsedUrl;
}

export async function assertSafeExternalUrlWithDns(rawInput: string): Promise<URL> {
  const parsedUrl = assertSafeExternalUrl(rawInput);
  const cleanHost = parsedUrl.hostname.toLowerCase().split('%')[0].replace(/^\[|\]$/g, '');

  if (net.isIP(cleanHost)) {
    if (isBlockedIpAddress(cleanHost)) {
      throw new Error('لا يُسمح بالوصول إلى العناوين المحلية أو الشبكات الخاصة.');
    }
    return parsedUrl;
  }

  let resolved: Array<{ address: string; family: number }>;
  try {
    resolved = await dns.lookup(cleanHost, { all: true, verbatim: true });
  } catch {
    throw new Error('تعذر حل اسم النطاق (DNS) أو الوصول إلى الخادم الهدف.');
  }

  if (!resolved || resolved.length === 0) {
    throw new Error('لم يُرجع فحص DNS أي عنوان IP صالح للنطاق.');
  }

  for (const entry of resolved) {
    if (isBlockedIpAddress(entry.address)) {
      throw new Error('تم حظر الطلب لأن النطاق يشير إلى عنوان شبكة داخلي أو خاص غير مسموح به.');
    }
  }

  return parsedUrl;
}

const REDIRECT_STATUS_CODES = new Set([301, 302, 303, 307, 308]);

export async function safeFetchWithManualRedirects(
  initialUrl: string,
  options: {
    method?: 'GET' | 'HEAD';
    headers?: Record<string, string>;
    signal?: AbortSignal;
    maxRedirects?: number;
  } = {},
): Promise<{ response: Response; finalUrl: string }> {
  const maxRedirects = options.maxRedirects ?? 5;
  let currentUrl = initialUrl;
  let currentMethod = options.method ?? 'GET';

  for (let hop = 0; hop <= maxRedirects; hop++) {
    const safeUrl = await assertSafeExternalUrlWithDns(currentUrl);
    const res = await fetch(safeUrl.toString(), {
      method: currentMethod,
      headers: options.headers,
      signal: options.signal,
      redirect: 'manual',
    });

    if (REDIRECT_STATUS_CODES.has(res.status)) {
      await res.body?.cancel().catch(() => {});
      const location = res.headers.get('location');
      if (!location) {
        throw new Error('أعاد الخادم تحويلاً بدون وجهة محددة.');
      }
      if (hop === maxRedirects) {
        throw new Error('تجاوز الرابط الحد الأقصى للتحويلات المسموح بها.');
      }
      const nextUrl = new URL(location, safeUrl.toString()).toString();
      await assertSafeExternalUrlWithDns(nextUrl);
      currentUrl = nextUrl;
      if (res.status === 303 && currentMethod !== 'HEAD') {
        currentMethod = 'GET';
      }
      continue;
    }

    return { response: res, finalUrl: safeUrl.toString() };
  }

  throw new Error('تجاوز الرابط الحد الأقصى للتحويلات المسموح بها.');
}

export function validateAndDetectUrl(rawInput: string): {
  parsedUrl: URL;
  platform: PlatformId;
  isDirectMedia: boolean;
} {
  const parsedUrl = assertSafeExternalUrl(rawInput);
  const hostname = parsedUrl.hostname.toLowerCase();

  for (const entry of PLATFORM_HOST_PATTERNS) {
    if (entry.hosts.some((h) => hostname === h || hostname.endsWith('.' + h))) {
      return { parsedUrl, platform: entry.platform, isDirectMedia: false };
    }
  }

  const ext = path.extname(parsedUrl.pathname).toLowerCase();
  const directExts = ['.mp4', '.mov', '.webm', '.jpg', '.jpeg', '.png', '.webp', '.mp3', '.m4a', '.pdf'];
  if (directExts.includes(ext)) {
    return { parsedUrl, platform: 'direct', isDirectMedia: true };
  }

  return { parsedUrl, platform: 'direct', isDirectMedia: true };
}

export function formatByteSize(bytes: number | null | undefined): string {
  if (!bytes || bytes <= 0) return 'غير محدد من المصدر';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function mapMimeToFormat(
  mimeType: string,
  fallbackUrl: string,
): {
  format: QualityOption['format'];
  mediaType: QualityOption['mediaType'];
} | null {
  const lower = mimeType.toLowerCase().split(';')[0].trim();
  if (lower === 'video/mp4' || lower === 'video/quicktime') {
    return { format: 'mp4', mediaType: 'video' };
  }
  if (lower === 'video/webm') {
    return { format: 'webm', mediaType: 'video' };
  }
  if (lower.startsWith('video/')) {
    return { format: 'mp4', mediaType: 'video' };
  }
  if (lower === 'audio/mp4' || lower === 'audio/aac' || lower === 'audio/x-m4a') {
    return { format: 'm4a', mediaType: 'audio' };
  }
  if (lower === 'audio/mpeg' || lower === 'audio/mp3') {
    return { format: 'mp3', mediaType: 'audio' };
  }
  if (lower === 'image/jpeg' || lower === 'image/jpg') {
    return { format: 'jpg', mediaType: 'image' };
  }
  if (lower === 'image/png') {
    return { format: 'png', mediaType: 'image' };
  }
  if (lower === 'image/webp') {
    return { format: 'webp', mediaType: 'image' };
  }
  if (lower === 'application/pdf') {
    return { format: 'pdf', mediaType: 'document' };
  }
  if (lower === 'application/octet-stream') {
    const ext = path.extname(new URL(fallbackUrl).pathname).toLowerCase();
    if (ext === '.mp4') return { format: 'mp4', mediaType: 'video' };
    if (ext === '.webm') return { format: 'webm', mediaType: 'video' };
    if (ext === '.m4a') return { format: 'm4a', mediaType: 'audio' };
    if (ext === '.mp3') return { format: 'mp3', mediaType: 'audio' };
    if (ext === '.jpg' || ext === '.jpeg') return { format: 'jpg', mediaType: 'image' };
    if (ext === '.png') return { format: 'png', mediaType: 'image' };
    if (ext === '.pdf') return { format: 'pdf', mediaType: 'document' };
  }
  return null;
}

interface VerifiedStream {
  streamUrl: string;
  mimeType: string;
  fileBytes: number | null;
  format: QualityOption['format'];
  mediaType: QualityOption['mediaType'];
}

export async function verifyRemoteMediaStream(
  candidateUrl: string,
  timeoutMs = 6000,
): Promise<VerifiedStream | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const baseHeaders = {
      'User-Agent': 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/126.0.0.0 Mobile Safari/537.36',
    };

    let { response: res, finalUrl } = await safeFetchWithManualRedirects(candidateUrl, {
      method: 'HEAD',
      signal: controller.signal,
      headers: baseHeaders,
    });

    if (res.status === 405 || res.status === 403 || !res.ok) {
      await res.body?.cancel().catch(() => {});
      const rangeAttempt = await safeFetchWithManualRedirects(candidateUrl, {
        method: 'GET',
        signal: controller.signal,
        headers: {
          Range: 'bytes=0-0',
          ...baseHeaders,
        },
      });
      res = rangeAttempt.response;
      finalUrl = rangeAttempt.finalUrl;
      await res.body?.cancel().catch(() => {});
    }

    if (!res.ok) return null;

    const mimeType = (res.headers.get('content-type') || '').split(';')[0].trim();
    const mapped = mapMimeToFormat(mimeType, finalUrl);
    if (!mapped) return null;

    let fileBytes: number | null = null;
    const contentRange = res.headers.get('content-range');
    if (contentRange) {
      const totalMatch = contentRange.match(/\/(\d+)$/);
      if (totalMatch) fileBytes = Number(totalMatch[1]);
    }
    if (!fileBytes) {
      const cl = Number(res.headers.get('content-length') || '0');
      if (cl > 1) fileBytes = cl;
    }

    return {
      streamUrl: finalUrl,
      mimeType,
      fileBytes,
      format: mapped.format,
      mediaType: mapped.mediaType,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function safeFetchJson<T>(url: string, timeoutMs = 5000): Promise<T | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const { response: res } = await safeFetchWithManualRedirects(url, {
      method: 'GET',
      signal: controller.signal,
      headers: {
        'User-Agent': 'HAMILHA-MediaAnalyzer/1.0',
        Accept: 'application/json',
      },
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function safeFetchPageHtml(
  url: string,
  timeoutMs = 6000,
): Promise<{ finalUrl: string; html: string } | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const { response: res, finalUrl } = await safeFetchWithManualRedirects(url, {
      method: 'GET',
      signal: controller.signal,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36',
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Language': 'ar,en-US;q=0.9,en;q=0.8',
      },
    });
    if (!res.ok) return null;
    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('text/html')) return null;
    const html = (await res.text()).slice(0, 350_000);
    return { finalUrl, html };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function decodeHtmlEntities(str: string): string {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/\\u0026/g, '&')
    .replace(/\\\//g, '/');
}

function extractMetaTag(html: string, prop: string): string | undefined {
  const re1 = new RegExp(
    `<meta[^>]+(?:property|name)=["']${prop}["'][^>]+content=["']([^"']+)["']`,
    'i',
  );
  const re2 = new RegExp(
    `<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${prop}["']`,
    'i',
  );
  const raw = html.match(re1)?.[1] || html.match(re2)?.[1];
  return raw ? decodeHtmlEntities(raw.trim()) : undefined;
}

function extractJsonEscapedUrl(html: string, keyPattern: string): string | undefined {
  const re = new RegExp(`"${keyPattern}"\\s*:\\s*"(https?:[^"]+)"`, 'i');
  const match = html.match(re)?.[1];
  return match ? decodeHtmlEntities(match) : undefined;
}

export async function analyzeMediaUrl(rawUrl: string): Promise<AnalyzedMedia> {
  const { parsedUrl, platform } = validateAndDetectUrl(rawUrl);
  const cleanUrl = parsedUrl.toString();
  const analysisId = crypto.randomUUID();

  // 1. Direct media check first (or non-social direct links)
  if (platform === 'direct') {
    const verified = await verifyRemoteMediaStream(cleanUrl);
    if (!verified) {
      throw new Error(
        'الرابط لا يشير إلى ملف وسائط مباشر صالح أو تعذر الوصول إليه. تأكد من أنه رابط ملف مباشر (MP4 / JPG / PNG / MP3 / PDF) أو من منصة مدعومة.',
      );
    }

    const fileName = decodeURIComponent(path.basename(parsedUrl.pathname)) || 'ملف وسائط مباشر';
    return {
      analysisId,
      url: cleanUrl,
      platform: 'direct',
      platformNameAr: PLATFORM_NAMES_AR.direct,
      title: fileName,
      author: parsedUrl.hostname,
      duration: null,
      thumbnailUrl: verified.mediaType === 'image' ? verified.streamUrl : null,
      mediaType: verified.mediaType,
      downloadAllowed: true,
      policyNote: 'تم التحقق من رابط الوسائط المباشر وهو جاهز للتنزيل.',
      streamMode: 'direct',
      qualities: [
        {
          id: 'original',
          label: `الملف الأصلي (${verified.format.toUpperCase()})`,
          resolution: verified.mimeType,
          format: verified.format,
          sizeEstimate: formatByteSize(verified.fileBytes),
          fileBytes: verified.fileBytes,
          mediaType: verified.mediaType,
          streamUrl: verified.streamUrl,
          mimeType: verified.mimeType,
        },
      ],
    };
  }

  // 2. YouTube (Licensed & Official Metadata Policy)
  if (platform === 'youtube') {
    const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(cleanUrl)}&format=json`;
    const oembed = await safeFetchJson<{
      title?: string;
      author_name?: string;
      thumbnail_url?: string;
    }>(oembedUrl);

    if (!oembed?.title) {
      return {
        analysisId,
        url: cleanUrl,
        platform: 'youtube',
        platformNameAr: PLATFORM_NAMES_AR.youtube,
        title: 'رابط يوتيوب غير متاح أو خاص',
        author: 'يوتيوب',
        duration: null,
        thumbnailUrl: null,
        mediaType: 'video',
        downloadAllowed: false,
        policyNote: 'تعذر التحقق من الفيديو عبر واجهة يوتيوب الرسمية (قد يكون خاصاً أو محذوفاً).',
        streamMode: 'unavailable',
        qualities: [],
      };
    }

    // Verify if official thumbnail image is directly downloadable
    const verifiedThumb = oembed.thumbnail_url
      ? await verifyRemoteMediaStream(oembed.thumbnail_url)
      : null;

    const qualities: QualityOption[] = [];
    if (verifiedThumb) {
      qualities.push({
        id: 'thumbnail_jpg',
        label: 'صورة غلاف الفيديو الأصلية (JPG)',
        resolution: 'الصورة المصغرة الرسمية',
        format: verifiedThumb.format,
        sizeEstimate: formatByteSize(verifiedThumb.fileBytes),
        fileBytes: verifiedThumb.fileBytes,
        mediaType: 'image',
        streamUrl: verifiedThumb.streamUrl,
        mimeType: verifiedThumb.mimeType,
      });
    }

    return {
      analysisId,
      url: cleanUrl,
      platform: 'youtube',
      platformNameAr: PLATFORM_NAMES_AR.youtube,
      title: oembed.title,
      author: oembed.author_name || 'قناة يوتيوب',
      duration: null,
      thumbnailUrl: oembed.thumbnail_url || null,
      mediaType: 'video',
      downloadAllowed: qualities.length > 0,
      policyNote:
        'لا يوفر يوتيوب رابط تنزيل فيديو مباشر بدون ترخيص YouTube Studio / Premium؛ يمكنك تنزيل الغلاف الرسمي المتحقق منه أو استخدام رابط مرخص مملوك لك.',
      streamMode: qualities.length > 0 ? 'direct' : 'unavailable',
      qualities,
    };
  }

  // 3. TikTok
  if (platform === 'tiktok') {
    const oembedUrl = `https://www.tiktok.com/oembed?url=${encodeURIComponent(cleanUrl)}`;
    const oembed = await safeFetchJson<{
      title?: string;
      author_name?: string;
      thumbnail_url?: string;
    }>(oembedUrl);

    const page = await safeFetchPageHtml(cleanUrl);
    const candidates: Array<{ id: string; label: string; url: string }> = [];

    if (page) {
      const ogVid = extractMetaTag(page.html, 'og:video') || extractMetaTag(page.html, 'og:video:secure_url');
      const playAddr = extractJsonEscapedUrl(page.html, 'playAddr');
      const downloadAddr = extractJsonEscapedUrl(page.html, 'downloadAddr');
      if (downloadAddr) candidates.push({ id: 'original_mp4', label: 'الفيديو الأصلي (MP4)', url: downloadAddr });
      if (playAddr && playAddr !== downloadAddr) {
        candidates.push({ id: 'stream_mp4', label: 'نسخة العرض المباشر (MP4)', url: playAddr });
      }
      if (ogVid && ogVid !== downloadAddr && ogVid !== playAddr) {
        candidates.push({ id: 'og_mp4', label: 'رابط الوسائط العام (MP4)', url: ogVid });
      }
    }

    const qualities: QualityOption[] = [];
    for (const c of candidates) {
      const verified = await verifyRemoteMediaStream(c.url);
      if (verified && verified.mediaType === 'video') {
        qualities.push({
          id: c.id,
          label: c.label,
          resolution: 'متحقق من المصدر',
          format: verified.format,
          sizeEstimate: formatByteSize(verified.fileBytes),
          fileBytes: verified.fileBytes,
          mediaType: 'video',
          streamUrl: verified.streamUrl,
          mimeType: verified.mimeType,
        });
      }
    }

    if (qualities.length === 0 && oembed?.thumbnail_url) {
      const verifiedThumb = await verifyRemoteMediaStream(oembed.thumbnail_url);
      if (verifiedThumb) {
        qualities.push({
          id: 'cover_jpg',
          label: 'صورة غلاف المقطع (JPG)',
          resolution: 'غلاف المقطع',
          format: verifiedThumb.format,
          sizeEstimate: formatByteSize(verifiedThumb.fileBytes),
          fileBytes: verifiedThumb.fileBytes,
          mediaType: 'image',
          streamUrl: verifiedThumb.streamUrl,
          mimeType: verifiedThumb.mimeType,
        });
      }
    }

    return {
      analysisId,
      url: cleanUrl,
      platform: 'tiktok',
      platformNameAr: PLATFORM_NAMES_AR.tiktok,
      title: oembed?.title || (page ? extractMetaTag(page.html, 'og:title') : undefined) || 'منشور تيك توك',
      author: oembed?.author_name ? `@${oembed.author_name}` : 'منشئ محتوى تيك توك',
      duration: null,
      thumbnailUrl: oembed?.thumbnail_url || (page ? extractMetaTag(page.html, 'og:image') : undefined) || null,
      mediaType: 'video',
      downloadAllowed: qualities.length > 0,
      policyNote:
        qualities.some((q) => q.mediaType === 'video')
          ? 'تم التحقق من وجود رابط فيديو حقيقي متاح للتنزيل.'
          : 'لم توفر تيك توك رابط فيديو مباشر لهذا المقطع بدون جلسة دخول؛ تتوفر فقط الصورة المصغرة المتحقق منها إذا ظهرت أعلاه.',
      streamMode: qualities.length > 0 ? 'direct' : 'unavailable',
      qualities,
    };
  }

  // 4. Instagram & Facebook
  if (platform === 'instagram' || platform === 'facebook') {
    const page = await safeFetchPageHtml(cleanUrl);
    const loginBlocked =
      !page ||
      page.finalUrl.includes('/accounts/login') ||
      page.finalUrl.includes('/login.php') ||
      page.finalUrl.includes('checkpoint');

    if (loginBlocked || !page) {
      return {
        analysisId,
        url: cleanUrl,
        platform,
        platformNameAr: PLATFORM_NAMES_AR[platform],
        title: `محتوى ${PLATFORM_NAMES_AR[platform]} يتطلب صلاحية وصول`,
        author: PLATFORM_NAMES_AR[platform],
        duration: null,
        thumbnailUrl: null,
        mediaType: 'video',
        downloadAllowed: false,
        policyNote:
          'يتطلب هذا المنشور تسجيل دخول من المنصة أو أنه غير متاح للوصول العام المباشر، لذلك لا يتوفر رابط تنزيل حقيقي.',
        streamMode: 'unavailable',
        qualities: [],
      };
    }

    const title =
      extractMetaTag(page.html, 'og:title') ||
      extractMetaTag(page.html, 'twitter:title') ||
      `منشور عام من ${PLATFORM_NAMES_AR[platform]}`;
    const thumb = extractMetaTag(page.html, 'og:image') || extractMetaTag(page.html, 'twitter:image') || null;
    const author = extractMetaTag(page.html, 'og:site_name') || PLATFORM_NAMES_AR[platform];

    const streamCandidates: Array<{ id: string; label: string; url: string }> = [];
    const hdUrl =
      extractJsonEscapedUrl(page.html, 'browser_native_hd_url') ||
      extractJsonEscapedUrl(page.html, 'playable_url_quality_hd') ||
      extractJsonEscapedUrl(page.html, 'video_url');
    const sdUrl =
      extractJsonEscapedUrl(page.html, 'browser_native_sd_url') ||
      extractJsonEscapedUrl(page.html, 'playable_url') ||
      extractMetaTag(page.html, 'og:video:secure_url') ||
      extractMetaTag(page.html, 'og:video');

    if (hdUrl) streamCandidates.push({ id: 'hd_mp4', label: 'فيديو جودة عالية (HD)', url: hdUrl });
    if (sdUrl && sdUrl !== hdUrl) {
      streamCandidates.push({ id: 'sd_mp4', label: 'فيديو جودة قياسية (SD)', url: sdUrl });
    }

    const qualities: QualityOption[] = [];
    for (const c of streamCandidates) {
      const verified = await verifyRemoteMediaStream(c.url);
      if (verified && verified.mediaType === 'video') {
        qualities.push({
          id: c.id,
          label: c.label,
          resolution: 'متحقق من المصدر',
          format: verified.format,
          sizeEstimate: formatByteSize(verified.fileBytes),
          fileBytes: verified.fileBytes,
          mediaType: 'video',
          streamUrl: verified.streamUrl,
          mimeType: verified.mimeType,
        });
      }
    }

    if (qualities.length === 0 && thumb) {
      const verifiedImg = await verifyRemoteMediaStream(thumb);
      if (verifiedImg && verifiedImg.mediaType === 'image') {
        qualities.push({
          id: 'original_image',
          label: 'الصورة الأصلية المتاحة',
          resolution: verifiedImg.mimeType,
          format: verifiedImg.format,
          sizeEstimate: formatByteSize(verifiedImg.fileBytes),
          fileBytes: verifiedImg.fileBytes,
          mediaType: 'image',
          streamUrl: verifiedImg.streamUrl,
          mimeType: verifiedImg.mimeType,
        });
      }
    }

    return {
      analysisId,
      url: cleanUrl,
      platform,
      platformNameAr: PLATFORM_NAMES_AR[platform],
      title,
      author,
      duration: null,
      thumbnailUrl: thumb,
      mediaType: qualities.some((q) => q.mediaType === 'video') ? 'video' : 'image',
      downloadAllowed: qualities.length > 0,
      policyNote:
        qualities.length > 0
          ? 'تم التحقق من صلاحية رابط الوسائط وهو جاهز للتنزيل الفعلي.'
          : 'لم تكشف الصفحة العامة عن رابط وسائط مباشر قابل للتنزيل.',
      streamMode: qualities.length > 0 ? 'direct' : 'unavailable',
      qualities,
    };
  }

  // 5. WhatsApp web link
  return {
    analysisId,
    url: cleanUrl,
    platform: 'whatsapp',
    platformNameAr: PLATFORM_NAMES_AR.whatsapp,
    title: 'رابط محادثة واتساب',
    author: 'واتساب',
    duration: null,
    thumbnailUrl: null,
    mediaType: 'document',
    downloadAllowed: false,
    policyNote:
      'روابط wa.me تفتح المحادثة ولا تحتوي على ملف فيديو؛ لاستقبال الوسائط أرسل الملف مباشرة إلى بوت واتساب.',
    streamMode: 'unavailable',
    qualities: [],
  };
}

export async function downloadVerifiedMediaToDisk(params: {
  streamUrl: string;
  downloadId: string;
  maxBytes?: number;
  extraHeaders?: Record<string, string>;
}): Promise<{
  localFilePath: string;
  fileBytes: number;
  fileSizeFormatted: string;
  mimeType: string;
  extension: string;
}> {
  const maxBytes = params.maxBytes ?? 150 * 1024 * 1024;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);

  let tempPath = '';
  try {
    const { response: res, finalUrl } = await safeFetchWithManualRedirects(params.streamUrl, {
      method: 'GET',
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/126.0.0.0 Mobile Safari/537.36',
        ...(params.extraHeaders || {}),
      },
    });

    if (!res.ok || !res.body) {
      throw new Error(`تعذر تنزيل الملف من المصدر (رمز الاستجابة ${res.status}).`);
    }

    const mimeType = (res.headers.get('content-type') || '').split(';')[0].trim();
    if (mimeType.includes('text/html')) {
      throw new Error('أعاد المصدر صفحة HTML بدلاً من ملف وسائط صالح.');
    }

    const mapped = mapMimeToFormat(mimeType, finalUrl);
    const extension = mapped?.format || path.extname(new URL(finalUrl).pathname).replace('.', '') || 'bin';

    const contentLen = Number(res.headers.get('content-length') || '0');
    if (contentLen > maxBytes) {
      throw new Error('حجم الملف يتجاوز الحد الأقصى المسموح به على الخادم.');
    }

    const safeId = params.downloadId.replace(/[^a-zA-Z0-9-]/g, '');
    const safeExt = extension.replace(/[^a-zA-Z0-9]/g, '') || 'bin';
    const outPath = path.resolve(DOWNLOADS_DIR, `hamilha-${safeId}.${safeExt}`);
    if (!outPath.startsWith(DOWNLOADS_DIR + path.sep)) {
      throw new Error('مسار الحفظ غير صالح.');
    }
    tempPath = `${outPath}.part`;

    const nodeStream = Readable.fromWeb(res.body as unknown as import('node:stream/web').ReadableStream);
    let received = 0;
    nodeStream.on('data', (chunk: Buffer) => {
      received += chunk.length;
      if (received > maxBytes) {
        nodeStream.destroy(new Error('تجاوز الملف الحجم الأقصى المسموح به أثناء التنزيل.'));
      }
    });

    await pipeline(nodeStream, fs.createWriteStream(tempPath));

    const stat = fs.statSync(tempPath);
    if (stat.size <= 0) {
      throw new Error('الملف المُنزّل فارغ (0 بايت).');
    }

    fs.renameSync(tempPath, outPath);
    tempPath = '';

    return {
      localFilePath: outPath,
      fileBytes: stat.size,
      fileSizeFormatted: formatByteSize(stat.size),
      mimeType: mimeType || 'application/octet-stream',
      extension: safeExt,
    };
  } catch (err) {
    if (tempPath && fs.existsSync(tempPath)) {
      try {
        fs.unlinkSync(tempPath);
      } catch {
        // Ignore cleanup failure
      }
    }
    throw err instanceof Error ? err : new Error('فشل تنزيل الملف من المصدر.');
  } finally {
    clearTimeout(timer);
  }
}
