import 'dotenv/config';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import express, { type Request, type Response } from 'express';
import { adminRouter } from './server/admin.ts';
import {
  analyzeMediaUrl,
  downloadVerifiedMediaToDisk,
  validateAndDetectUrl,
} from './server/analyzer.ts';
import {
  cleanupExpiredDownloads,
  clearDownloadsForClient,
  deleteDownloadByIdForClient,
  DOWNLOADS_DIR,
  getDownloadById,
  insertDownload,
  listDownloadsByClient,
  logRequest,
} from './server/db.ts';
import { flutterRouter } from './server/flutter_bundle.ts';
import {
  createCorsMiddleware,
  createRateLimiter,
  ensureClientSession,
  getSessionSigningKey,
  resolveClientSession,
  verifyMutationOrigin,
  verifySignedFileAccessToken,
} from './server/security.ts';
import { whatsappRouter } from './server/whatsapp.ts';

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

async function startServer() {
  const app = express();
  const PORT = parsePositiveInt(process.env.PORT, 3000);
  const DOWNLOAD_TTL_HOURS = parsePositiveInt(process.env.DOWNLOAD_TTL_HOURS, 24);
  const MAX_STORAGE_MB = parsePositiveInt(process.env.MAX_STORAGE_MB, 500);
  const CLEANUP_INTERVAL_MIN = parsePositiveInt(process.env.CLEANUP_INTERVAL_MINUTES, 30);

  // Validate signing key readiness on startup (warns in production if unset)
  getSessionSigningKey();

  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  // Basic security headers (keeps iframe compatibility in preview environments)
  app.use((_req: Request, res: Response, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    next();
  });

  // Strict allowlist CORS (no wildcard on credentialed/authenticated endpoints)
  app.use('/api', createCorsMiddleware());

  // Capture rawBody for Meta WhatsApp Webhook HMAC verification
  app.use(
    express.json({
      limit: '25mb',
      verify: (req, _res, buf) => {
        (req as Request & { rawBody?: Buffer }).rawBody = buf;
      },
    }),
  );

  // Tiered rate limiting
  const generalApiLimiter = createRateLimiter({
    windowMs: 60 * 1000,
    maxRequests: parsePositiveInt(process.env.RATE_LIMIT_MAX_PER_MIN, 120),
    keyPrefix: 'api-general',
  });
  const heavyMediaLimiter = createRateLimiter({
    windowMs: 60 * 1000,
    maxRequests: parsePositiveInt(process.env.MEDIA_RATE_LIMIT_MAX_PER_MIN, 20),
    keyPrefix: 'api-media',
    message: 'تم تجاوز عدد طلبات التحليل/التنزيل المسموح بها في الدقيقة. انتظر قليلاً ثم أعد المحاولة.',
  });

  app.use('/api', generalApiLimiter);

  // Protect cookie-authenticated mutations against cross-site request forgery
  // (Exempt Meta webhook POST which uses Meta X-Hub-Signature-256 instead of browser cookies)
  app.use('/api', (req, res, next) => {
    if (req.path === '/whatsapp/webhook') {
      next();
      return;
    }
    verifyMutationOrigin(req, res, next);
  });

  // Health endpoint
  app.get('/api/health', (_req: Request, res: Response) => {
    res.json({ ok: true, service: 'hamilha-api', timestamp: new Date().toISOString() });
  });

  // Server-signed anonymous client session (prevents spoofing X-Client-Id across users)
  app.get('/api/session', (req: Request, res: Response) => {
    const session = ensureClientSession(req, res);
    res.json({
      clientId: session.cid,
      token: session.via === 'issued' ? session.token : undefined,
      isolated: true,
    });
  });

  app.post('/api/session', (req: Request, res: Response) => {
    const session = ensureClientSession(req, res);
    res.json({
      clientId: session.cid,
      token: session.token,
      isolated: true,
    });
  });

  // Analyze social or direct media URL and verify real stream availability
  app.post('/api/analyze', heavyMediaLimiter, async (req: Request, res: Response) => {
    const start = Date.now();
    const rawUrl = String(req.body?.url || '').trim();
    const session = ensureClientSession(req, res);
    const source = String(req.body?.source || 'app').slice(0, 24);

    if (!rawUrl) {
      res.status(400).json({ error: 'يرجى إدخال رابط الفيديو أو المنشور أولاً.' });
      return;
    }

    try {
      const analyzed = await analyzeMediaUrl(rawUrl);
      logRequest({
        endpoint: '/api/analyze',
        platform: analyzed.platform,
        url: analyzed.url,
        clientId: session.cid,
        source,
        status: 'success',
        latencyMs: Date.now() - start,
      });
      res.json(analyzed);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'تعذر تحليل الرابط.';
      let detectedPlatform = 'unknown';
      try {
        detectedPlatform = validateAndDetectUrl(rawUrl).platform;
      } catch {
        // Keep unknown
      }
      logRequest({
        endpoint: '/api/analyze',
        platform: detectedPlatform,
        url: rawUrl.slice(0, 300),
        clientId: session.cid,
        source,
        status: 'error',
        latencyMs: Date.now() - start,
        errorMessage: message,
      });
      res.status(400).json({ error: message });
    }
  });

  // Download genuine verified media stream first, then record in SQLite under verified session cid
  app.post('/api/downloads', heavyMediaLimiter, async (req: Request, res: Response) => {
    const start = Date.now();
    const session = ensureClientSession(req, res);
    const source = String(req.body?.source || 'app').slice(0, 24);

    const url = String(req.body?.url || '').trim();
    const streamUrl = String(req.body?.streamUrl || '').trim();
    const platform = String(req.body?.platform || 'direct').slice(0, 32);
    const title = String(req.body?.title || 'ملف وسائط').slice(0, 200);
    const author = String(req.body?.author || 'غير محدد').slice(0, 120);
    const thumbnailUrl = req.body?.thumbnailUrl ? String(req.body.thumbnailUrl).slice(0, 500) : null;
    const mediaType = String(req.body?.mediaType || 'video').slice(0, 24);
    const quality = String(req.body?.quality || 'original').slice(0, 32);

    if (!url || !streamUrl) {
      res.status(400).json({
        error: 'لا يتوفر رابط وسائط مباشر صالح للتنزيل لهذا المحتوى.',
      });
      return;
    }

    const downloadId = crypto.randomUUID();
    try {
      const savedFile = await downloadVerifiedMediaToDisk({
        streamUrl,
        downloadId,
      });

      const record = insertDownload({
        id: downloadId,
        url,
        platform,
        title,
        author,
        thumbnail_url: thumbnailUrl,
        media_type: mediaType,
        quality,
        file_size: savedFile.fileSizeFormatted,
        source,
        client_id: session.cid,
        status: 'completed',
        stream_mode: 'direct',
        local_file_path: savedFile.localFilePath,
        mime_type: savedFile.mimeType,
        file_bytes: savedFile.fileBytes,
      });

      logRequest({
        endpoint: '/api/downloads',
        platform: record.platform,
        url: record.url,
        clientId: session.cid,
        source,
        status: 'success',
        latencyMs: Date.now() - start,
      });

      res.status(201).json({
        download: record,
        fileUrl: `/api/downloads/${record.id}/file`,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'فشل تنزيل الملف الأصلي من المصدر.';
      logRequest({
        endpoint: '/api/downloads',
        platform,
        url: streamUrl.slice(0, 300),
        clientId: session.cid,
        source,
        status: 'error',
        latencyMs: Date.now() - start,
        errorMessage: message,
      });
      res.status(422).json({ error: message });
    }
  });

  // List ONLY the authenticated client's own downloads
  app.get('/api/downloads', (req: Request, res: Response) => {
    const session = resolveClientSession(req);
    if (!session) {
      res.json({ downloads: [] });
      return;
    }
    const limit = Math.min(100, Math.max(1, Number(req.query.limit || 30)));
    const platform = req.query.platform ? String(req.query.platform) : undefined;
    res.json({ downloads: listDownloadsByClient(session.cid, limit, platform) });
  });

  // Serve real downloaded file ONLY to its owner session or with a valid signed file token
  app.get('/api/downloads/:id/file', (req: Request, res: Response) => {
    const id = String(req.params.id || '');
    const record = getDownloadById(id);
    if (!record || !record.local_file_path) {
      res.status(404).json({ error: 'الملف الفعلي غير متوفر على الخادم.' });
      return;
    }

    const session = resolveClientSession(req);
    const fileToken = String(req.query.ft || '').trim();
    const isOwner = Boolean(session && record.client_id === session.cid);
    const hasSignedFileToken = fileToken ? verifySignedFileAccessToken(fileToken, record.id) : false;

    if (!isOwner && !hasSignedFileToken) {
      res.status(403).json({ error: 'غير مصرح لك بالوصول إلى هذا الملف.' });
      return;
    }

    const resolved = path.resolve(record.local_file_path);
    if (!resolved.startsWith(DOWNLOADS_DIR + path.sep) || !fs.existsSync(resolved)) {
      res.status(404).json({ error: 'تعذر العثور على الملف المحفوظ (قد يكون تم تنظيفه تلقائياً).' });
      return;
    }

    const ext = path.extname(resolved).replace('.', '') || 'bin';
    const stat = fs.statSync(resolved);
    const downloadName = `hamilha-${record.platform}-${record.id.slice(0, 8)}.${ext}`;
    res.setHeader('Content-Type', record.mime_type || 'application/octet-stream');
    res.setHeader('Content-Length', String(stat.size));
    res.setHeader('Content-Disposition', `attachment; filename="${downloadName}"`);
    res.setHeader('Cache-Control', 'private, no-store');
    fs.createReadStream(resolved).pipe(res);
  });

  // Delete single download (strictly scoped to owner)
  app.delete('/api/downloads/:id', (req: Request, res: Response) => {
    const session = resolveClientSession(req);
    if (!session) {
      res.status(401).json({ error: 'لا توجد جلسة صالحة لحذف هذا السجل.' });
      return;
    }
    const ok = deleteDownloadByIdForClient(String(req.params.id || ''), session.cid);
    if (!ok) {
      res.status(404).json({ error: 'السجل غير موجود أو غير تابع لجلستك.' });
      return;
    }
    res.json({ deleted: true });
  });

  // Clear ONLY the authenticated client's own download history
  app.delete('/api/downloads', (req: Request, res: Response) => {
    const session = resolveClientSession(req);
    if (!session) {
      res.json({ cleared: true, count: 0 });
      return;
    }
    const count = clearDownloadsForClient(session.cid);
    res.json({ cleared: true, count });
  });

  // Mount WhatsApp Bot, Admin Console, and Flutter Project Bundle routes
  app.use('/api/whatsapp', whatsappRouter);
  app.use('/api/admin', adminRouter);
  app.use('/api/flutter', flutterRouter);

  // Serve full Android + iOS project ZIP archive if pre-generated on disk
  const sendFullProjectZip = (_req: Request, res: Response) => {
    const zipPath = path.resolve(process.cwd(), 'HAMILHA_ANDROID_IOS.zip');
    if (!fs.existsSync(zipPath)) {
      res.status(404).json({ error: 'ملف المشروع المضغوط غير متوفر حالياً.' });
      return;
    }
    const stat = fs.statSync(zipPath);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Length', String(stat.size));
    res.setHeader('Content-Disposition', 'attachment; filename="HAMILHA_ANDROID_IOS.zip"');
    fs.createReadStream(zipPath).pipe(res);
  };
  app.get('/HAMILHA_ANDROID_IOS.zip', sendFullProjectZip);
  app.get('/HAMILHA_FULL_PROJECT.zip', sendFullProjectZip);
  app.get('/api/project/download-zip', sendFullProjectZip);

  // Automatic retention & quota cleanup for downloaded files
  const runCleanup = () => {
    const summary = cleanupExpiredDownloads({
      ttlHours: DOWNLOAD_TTL_HOURS,
      maxStorageMb: MAX_STORAGE_MB,
    });
    if (summary.removedExpired || summary.removedForQuota || summary.removedOrphans) {
      console.log('[HAMILHA] Storage cleanup completed:', summary);
    }
  };
  runCleanup();
  const cleanupTimer = setInterval(runCleanup, CLEANUP_INTERVAL_MIN * 60 * 1000);
  cleanupTimer.unref();

  // Vite dev middleware or static dist serving (lazy-import vite only in non-production)
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`HAMILHA server running at http://0.0.0.0:${PORT}`);
  });
}

startServer();
