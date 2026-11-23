import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Router, type Request, type Response } from 'express';
import {
  analyzeMediaUrl,
  downloadVerifiedMediaToDisk,
  formatByteSize,
} from './analyzer.ts';
import {
  DOWNLOADS_DIR,
  getBotConfigMap,
  insertDownload,
  insertWhatsAppMessage,
  listWhatsAppMessagesByClient,
  logRequest,
} from './db.ts';
import {
  ensureClientSession,
  issueSignedFileAccessToken,
  resolveClientSession,
} from './security.ts';

export const whatsappRouter = Router();

function isSimulatorEnabled(): boolean {
  if (process.env.ENABLE_WHATSAPP_SIMULATOR === 'true') return true;
  if (process.env.ENABLE_WHATSAPP_SIMULATOR === 'false') return false;
  return process.env.NODE_ENV !== 'production';
}

function verifyMetaWebhookSignature(req: Request): boolean {
  const appSecret = process.env.WHATSAPP_APP_SECRET?.trim();
  if (!appSecret) return true; // Skip only when WHATSAPP_APP_SECRET is not configured
  const sigHeader = String(req.headers['x-hub-signature-256'] || '');
  const rawBody = (req as Request & { rawBody?: Buffer }).rawBody;
  if (!sigHeader.startsWith('sha256=') || !rawBody) return false;

  const expected = `sha256=${crypto.createHmac('sha256', appSecret).update(rawBody).digest('hex')}`;
  const sigBuf = Buffer.from(sigHeader);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length) return false;
  return crypto.timingSafeEqual(sigBuf, expBuf);
}

function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.length <= 4) return '****';
  return `${digits.slice(0, 4)}****${digits.slice(-3)}`;
}

function isCloudApiConfigured(): boolean {
  return Boolean(
    process.env.WHATSAPP_ACCESS_TOKEN &&
      process.env.WHATSAPP_PHONE_NUMBER_ID &&
      process.env.WHATSAPP_VERIFY_TOKEN,
  );
}

async function sendMetaWhatsAppText(toPhone: string, textBody: string): Promise<boolean> {
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  if (!token || !phoneNumberId) return false;

  try {
    const res = await fetch(
      `https://graph.facebook.com/v21.0/${encodeURIComponent(phoneNumberId)}/messages`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: toPhone,
          type: 'text',
          text: { preview_url: true, body: textBody },
        }),
      },
    );
    return res.ok;
  } catch {
    return false;
  }
}

async function sendMetaWhatsAppMedia(params: {
  toPhone: string;
  mediaType: 'video' | 'image' | 'audio' | 'document';
  publicMediaUrl: string;
  caption: string;
  filename?: string;
}): Promise<boolean> {
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  if (!token || !phoneNumberId) return false;

  const mediaPayload: Record<string, string> = { link: params.publicMediaUrl };
  if (params.mediaType !== 'audio') {
    mediaPayload.caption = params.caption;
  }
  if (params.mediaType === 'document' && params.filename) {
    mediaPayload.filename = params.filename;
  }

  try {
    const res = await fetch(
      `https://graph.facebook.com/v21.0/${encodeURIComponent(phoneNumberId)}/messages`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: params.toPhone,
          type: params.mediaType,
          [params.mediaType]: mediaPayload,
        }),
      },
    );
    return res.ok;
  } catch {
    return false;
  }
}

async function fetchMetaMediaDownloadUrl(mediaId: string): Promise<{
  url: string;
  mimeType: string;
} | null> {
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  if (!token) return null;

  const res = await fetch(`https://graph.facebook.com/v21.0/${encodeURIComponent(mediaId)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { url?: string; mime_type?: string };
  if (!data.url) return null;
  return { url: data.url, mimeType: data.mime_type || 'application/octet-stream' };
}

function extractFirstUrl(text: string): string | null {
  const match = text.match(/https?:\/\/[^\s]+/i);
  return match ? match[0] : null;
}

// Meta WhatsApp Cloud API Webhook Verification
whatsappRouter.get('/webhook', (req: Request, res: Response) => {
  const mode = String(req.query['hub.mode'] || '');
  const token = String(req.query['hub.verify_token'] || '');
  const challenge = String(req.query['hub.challenge'] || '');
  const expectedToken = process.env.WHATSAPP_VERIFY_TOKEN;

  if (!expectedToken) {
    res.status(503).send('WHATSAPP_VERIFY_TOKEN غير مضبوط على الخادم.');
    return;
  }

  if (
    mode === 'subscribe' &&
    token.length === expectedToken.length &&
    crypto.timingSafeEqual(Buffer.from(token), Buffer.from(expectedToken))
  ) {
    res.status(200).send(challenge);
    return;
  }

  res.sendStatus(403);
});

// Meta WhatsApp Cloud API Inbound Webhook
whatsappRouter.post('/webhook', async (req: Request, res: Response) => {
  const start = Date.now();
  if (!verifyMetaWebhookSignature(req)) {
    res.status(401).json({ error: 'توقيع Meta Webhook غير صالح.' });
    return;
  }

  const config = getBotConfigMap();
  if (config.bot_enabled !== 'true') {
    res.status(200).json({ status: 'paused' });
    return;
  }

  try {
    const entry = req.body?.entry?.[0];
    const change = entry?.changes?.[0]?.value;
    const message = change?.messages?.[0];

    if (!message) {
      res.status(200).json({ status: 'ignored' });
      return;
    }

    const fromPhone = String(message.from || '');
    if (!fromPhone) {
      res.status(400).json({ status: 'missing_sender' });
      return;
    }

    const maskedPhone = maskPhone(fromPhone);
    const msgType = String(message.type || 'text');
    const waMessageId = String(message.id || '');

    if (msgType === 'text') {
      const bodyText = String(message.text?.body || '').trim();
      const detectedUrl = extractFirstUrl(bodyText);

      insertWhatsAppMessage({
        wa_message_id: waMessageId,
        sender_phone_masked: maskedPhone,
        direction: 'inbound',
        message_type: 'text',
        content: bodyText,
        media_url: detectedUrl,
        platform: null,
        download_id: null,
        status: 'received',
      });

      if (!detectedUrl) {
        const reply = config.welcome_message;
        insertWhatsAppMessage({
          wa_message_id: null,
          sender_phone_masked: maskedPhone,
          direction: 'outbound',
          message_type: 'text',
          content: reply,
          media_url: null,
          platform: null,
          download_id: null,
          status: 'sent',
        });
        await sendMetaWhatsAppText(fromPhone, reply);
        res.status(200).json({ status: 'replied_welcome' });
        return;
      }

      const analyzed = await analyzeMediaUrl(detectedUrl);
      if (!analyzed.downloadAllowed || analyzed.qualities.length === 0) {
        const errReply = `تعذر تنزيل الرابط من ${analyzed.platformNameAr}: ${analyzed.policyNote}`;
        insertWhatsAppMessage({
          wa_message_id: null,
          sender_phone_masked: maskedPhone,
          direction: 'outbound',
          message_type: 'text',
          content: errReply,
          media_url: null,
          platform: analyzed.platform,
          download_id: null,
          status: 'unavailable',
        });
        await sendMetaWhatsAppText(fromPhone, errReply);
        res.status(200).json({ status: 'unavailable' });
        return;
      }

      const preferredQuality =
        analyzed.qualities.find((q) => q.id === config.default_quality) || analyzed.qualities[0];
      const downloadId = crypto.randomUUID();

      // Download actual media bytes BEFORE saving to SQLite or replying
      const savedFile = await downloadVerifiedMediaToDisk({
        streamUrl: preferredQuality.streamUrl,
        downloadId,
        maxBytes: Number(config.max_file_mb || '150') * 1024 * 1024,
      });

      const dl = insertDownload({
        id: downloadId,
        url: analyzed.url,
        platform: analyzed.platform,
        title: analyzed.title,
        author: analyzed.author,
        thumbnail_url: analyzed.thumbnailUrl,
        media_type: preferredQuality.mediaType,
        quality: preferredQuality.id,
        file_size: savedFile.fileSizeFormatted,
        source: 'whatsapp',
        client_id: maskedPhone,
        status: 'completed',
        stream_mode: 'direct',
        local_file_path: savedFile.localFilePath,
        mime_type: savedFile.mimeType,
        file_bytes: savedFile.fileBytes,
      });

      const appBaseUrl = (process.env.APP_URL || '').replace(/\/$/, '');
      const signedFileToken = issueSignedFileAccessToken(dl.id);
      const relativeFileUrl = `/api/downloads/${dl.id}/file?ft=${encodeURIComponent(signedFileToken)}`;
      const publicFileUrl = appBaseUrl ? `${appBaseUrl}${relativeFileUrl}` : '';

      let sentRealMedia = false;
      if (publicFileUrl.startsWith('https://')) {
        sentRealMedia = await sendMetaWhatsAppMedia({
          toPhone: fromPhone,
          mediaType: preferredQuality.mediaType,
          publicMediaUrl: publicFileUrl,
          caption: `${analyzed.title} (${savedFile.fileSizeFormatted})`,
          filename: `hamilha-${dl.id.slice(0, 8)}.${savedFile.extension}`,
        });
      }

      const replyText = [
        `تم تنزيل وحفظ الملف من ${analyzed.platformNameAr}`,
        `العنوان: ${analyzed.title}`,
        `الحجم الحقيقي: ${savedFile.fileSizeFormatted}`,
        publicFileUrl ? `رابط الملف: ${publicFileUrl}` : `معرف الملف: ${dl.id}`,
      ].join('\n');

      if (!sentRealMedia) {
        await sendMetaWhatsAppText(fromPhone, replyText);
      }

      insertWhatsAppMessage({
        wa_message_id: null,
        sender_phone_masked: maskedPhone,
        direction: 'outbound',
        message_type: 'text',
        content: replyText,
        media_url: relativeFileUrl,
        platform: analyzed.platform,
        download_id: dl.id,
        status: 'sent',
      });

      logRequest({
        endpoint: '/api/whatsapp/webhook',
        platform: analyzed.platform,
        url: analyzed.url,
        clientId: maskedPhone,
        source: 'whatsapp',
        status: 'success',
        latencyMs: Date.now() - start,
      });

      res.status(200).json({ status: 'processed', downloadId: dl.id });
      return;
    }

    // User sends image, video, document, or audio directly to WhatsApp bot
    if (['image', 'video', 'document', 'audio'].includes(msgType)) {
      if (config.accept_user_media !== 'true') {
        res.status(200).json({ status: 'media_disabled' });
        return;
      }

      const mediaObj = message[msgType] || {};
      const mediaId = String(mediaObj.id || '');
      const mediaTitle =
        mediaObj.caption ||
        mediaObj.filename ||
        `ملف ${msgType === 'image' ? 'صورة' : msgType === 'video' ? 'فيديو' : msgType === 'document' ? 'مستند' : 'صوت'} من واتساب`;

      const token = process.env.WHATSAPP_ACCESS_TOKEN;
      if (!token || !mediaId) {
        const errMsg = 'تعذر تنزيل الوسائط من واتساب لعدم توفر صلاحيات WHATSAPP_ACCESS_TOKEN على الخادم.';
        logRequest({
          endpoint: '/api/whatsapp/webhook',
          platform: 'whatsapp',
          clientId: maskedPhone,
          source: 'whatsapp',
          status: 'error',
          latencyMs: Date.now() - start,
          errorMessage: errMsg,
        });
        res.status(200).json({ status: 'error', message: errMsg });
        return;
      }

      const metaMedia = await fetchMetaMediaDownloadUrl(mediaId);
      if (!metaMedia) {
        throw new Error('فشل جلب رابط الوسائط من WhatsApp Graph API.');
      }

      const downloadId = crypto.randomUUID();
      const savedFile = await downloadVerifiedMediaToDisk({
        streamUrl: metaMedia.url,
        downloadId,
        maxBytes: Number(config.max_file_mb || '150') * 1024 * 1024,
        extraHeaders: { Authorization: `Bearer ${token}` },
      });

      const dl = insertDownload({
        id: downloadId,
        url: `whatsapp://media/${mediaId}`,
        platform: 'whatsapp',
        title: String(mediaTitle).slice(0, 140),
        author: `مرسل عبر واتساب (${maskedPhone})`,
        thumbnail_url: null,
        media_type: msgType,
        quality: 'الأصلية',
        file_size: savedFile.fileSizeFormatted,
        source: 'whatsapp',
        client_id: maskedPhone,
        status: 'completed',
        stream_mode: 'direct',
        local_file_path: savedFile.localFilePath,
        mime_type: savedFile.mimeType,
        file_bytes: savedFile.fileBytes,
      });

      insertWhatsAppMessage({
        wa_message_id: waMessageId,
        sender_phone_masked: maskedPhone,
        direction: 'inbound',
        message_type: msgType,
        content: String(mediaTitle),
        media_url: `/api/downloads/${dl.id}/file`,
        platform: 'whatsapp',
        download_id: dl.id,
        status: 'received',
      });

      const replyText = `تم تنزيل وحفظ الملف الفعلي "${mediaTitle}" (${savedFile.fileSizeFormatted}) في مكتبة حمّلها.`;
      await sendMetaWhatsAppText(fromPhone, replyText);

      insertWhatsAppMessage({
        wa_message_id: null,
        sender_phone_masked: maskedPhone,
        direction: 'outbound',
        message_type: 'text',
        content: replyText,
        media_url: `/api/downloads/${dl.id}/file`,
        platform: 'whatsapp',
        download_id: dl.id,
        status: 'sent',
      });

      logRequest({
        endpoint: '/api/whatsapp/webhook',
        platform: 'whatsapp',
        clientId: maskedPhone,
        source: 'whatsapp',
        status: 'success',
        latencyMs: Date.now() - start,
      });

      res.status(200).json({ status: 'media_saved', downloadId: dl.id });
      return;
    }

    res.status(200).json({ status: 'unsupported_type' });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'فشل معالجة رسالة واتساب.';
    logRequest({
      endpoint: '/api/whatsapp/webhook',
      platform: 'whatsapp',
      source: 'whatsapp',
      status: 'error',
      latencyMs: Date.now() - start,
      errorMessage: message,
    });
    res.status(200).json({ status: 'error', message });
  }
});

// Status & Session-Scoped Sandbox Messages Endpoint
whatsappRouter.get('/messages', (req: Request, res: Response) => {
  const session = resolveClientSession(req);
  const messages = session ? listWhatsAppMessagesByClient(session.cid, 60) : [];
  const config = getBotConfigMap();
  res.json({
    messages,
    botEnabled: config.bot_enabled === 'true',
    cloudApiConfigured: isCloudApiConfigured(),
    simulatorEnabled: isSimulatorEnabled(),
    botPhoneNumber: (process.env.WHATSAPP_BUSINESS_PHONE || '').replace(/\D/g, ''),
    defaultQuality: config.default_quality,
  });
});

// Sandbox Bot Simulator (clearly separated from live Meta Cloud API)
whatsappRouter.post('/simulate', async (req: Request, res: Response) => {
  if (!isSimulatorEnabled()) {
    res.status(403).json({
      error: 'محاكي اختبار بوت واتساب معطّل في بيئة الإنتاج.',
    });
    return;
  }

  const start = Date.now();
  const session = ensureClientSession(req, res);
  const config = getBotConfigMap();

  if (config.bot_enabled !== 'true') {
    res.status(409).json({
      error: 'البوت متوقف مؤقتاً من لوحة تحكم الإدارة.',
    });
    return;
  }

  const phone = String(req.body?.phone || '9647701234567');
  const maskedPhone = maskPhone(phone);
  const messageType = String(req.body?.messageType || 'text');
  const content = String(req.body?.content || '').trim();
  const fileName = String(req.body?.fileName || '').trim();
  const fileBase64 = typeof req.body?.fileBase64 === 'string' ? req.body.fileBase64 : '';
  const fileMime = String(req.body?.fileMime || 'application/octet-stream');

  if (!content && !fileName) {
    res.status(400).json({ error: 'يرجى كتابة رسالة أو إرفاق رابط أو ملف.' });
    return;
  }

  // Handle real uploaded file bytes in sandbox simulator
  if (['image', 'video', 'document', 'audio'].includes(messageType)) {
    if (!fileBase64) {
      res.status(400).json({
        error: 'لم يتم إرسال محتوى الملف الفعلي. اختر ملفاً فعلياً من جهازك لإرساله للبوت.',
      });
      return;
    }

    const buffer = Buffer.from(fileBase64, 'base64');
    if (buffer.length === 0 || buffer.length > 20 * 1024 * 1024) {
      res.status(400).json({ error: 'حجم الملف غير صالح (الحد الأقصى للمحاكي 20 MB).' });
      return;
    }

    const downloadId = crypto.randomUUID();
    const ext = path.extname(fileName).replace('.', '').toLowerCase() || 'bin';
    const safeExt = ext.replace(/[^a-z0-9]/g, '') || 'bin';
    const outPath = path.resolve(DOWNLOADS_DIR, `hamilha-${downloadId}.${safeExt}`);
    if (!outPath.startsWith(DOWNLOADS_DIR + path.sep)) {
      res.status(400).json({ error: 'اسم الملف غير صالح.' });
      return;
    }

    fs.writeFileSync(outPath, buffer);
    const sizeFormatted = formatByteSize(buffer.length);

    const inbound = insertWhatsAppMessage({
      wa_message_id: `sim_${crypto.randomUUID().slice(0, 8)}`,
      sender_phone_masked: maskedPhone,
      direction: 'inbound',
      message_type: messageType,
      content: fileName || content,
      media_url: null,
      platform: 'whatsapp',
      download_id: null,
      status: 'received',
      client_id: session.cid,
    });

    const dl = insertDownload({
      id: downloadId,
      url: `whatsapp://sandbox/${inbound.id}`,
      platform: 'whatsapp',
      title: fileName || 'ملف مرفوع في المحاكي',
      author: `مستخدم المحاكي (${maskedPhone})`,
      thumbnail_url: null,
      media_type: messageType,
      quality: 'الأصلية',
      file_size: sizeFormatted,
      source: 'whatsapp',
      client_id: session.cid,
      status: 'completed',
      stream_mode: 'direct',
      local_file_path: outPath,
      mime_type: fileMime,
      file_bytes: buffer.length,
    });

    const fileUrl = `/api/downloads/${dl.id}/file`;
    const outbound = insertWhatsAppMessage({
      wa_message_id: null,
      sender_phone_masked: maskedPhone,
      direction: 'outbound',
      message_type: 'text',
      content: `تم استلام وحفظ الملف الفعلي "${dl.title}" (${sizeFormatted}) في المحاكي المحلي.`,
      media_url: fileUrl,
      platform: 'whatsapp',
      download_id: dl.id,
      status: 'sent',
      client_id: session.cid,
    });

    logRequest({
      endpoint: '/api/whatsapp/simulate',
      platform: 'whatsapp',
      clientId: session.cid,
      source: 'whatsapp',
      status: 'success',
      latencyMs: Date.now() - start,
    });

    res.json({ inbound, outbound, download: dl, simulatorMode: true });
    return;
  }

  const inbound = insertWhatsAppMessage({
    wa_message_id: `sim_${crypto.randomUUID().slice(0, 8)}`,
    sender_phone_masked: maskedPhone,
    direction: 'inbound',
    message_type: 'text',
    content,
    media_url: extractFirstUrl(content),
    platform: null,
    download_id: null,
    status: 'received',
    client_id: session.cid,
  });

  const url = extractFirstUrl(content);
  if (!url) {
    const outbound = insertWhatsAppMessage({
      wa_message_id: null,
      sender_phone_masked: maskedPhone,
      direction: 'outbound',
      message_type: 'text',
      content: config.welcome_message,
      media_url: null,
      platform: null,
      download_id: null,
      status: 'sent',
      client_id: session.cid,
    });
    res.json({ inbound, outbound, simulatorMode: true });
    return;
  }

  try {
    const analyzed = await analyzeMediaUrl(url);
    if (!analyzed.downloadAllowed || analyzed.qualities.length === 0) {
      const outbound = insertWhatsAppMessage({
        wa_message_id: null,
        sender_phone_masked: maskedPhone,
        direction: 'outbound',
        message_type: 'text',
        content: `تعذر تنزيل الوسائط من ${analyzed.platformNameAr}: ${analyzed.policyNote}`,
        media_url: null,
        platform: analyzed.platform,
        download_id: null,
        status: 'unavailable',
        client_id: session.cid,
      });
      res.json({ inbound, outbound, analyzed, simulatorMode: true });
      return;
    }

    const chosen =
      analyzed.qualities.find((q) => q.id === config.default_quality) || analyzed.qualities[0];
    const downloadId = crypto.randomUUID();
    const saved = await downloadVerifiedMediaToDisk({
      streamUrl: chosen.streamUrl,
      downloadId,
      maxBytes: Number(config.max_file_mb || '150') * 1024 * 1024,
    });

    const dl = insertDownload({
      id: downloadId,
      url: analyzed.url,
      platform: analyzed.platform,
      title: analyzed.title,
      author: analyzed.author,
      thumbnail_url: analyzed.thumbnailUrl,
      media_type: chosen.mediaType,
      quality: chosen.id,
      file_size: saved.fileSizeFormatted,
      source: 'whatsapp',
      client_id: session.cid,
      status: 'completed',
      stream_mode: 'direct',
      local_file_path: saved.localFilePath,
      mime_type: saved.mimeType,
      file_bytes: saved.fileBytes,
    });

    const fileUrl = `/api/downloads/${dl.id}/file`;
    const reply = `تم تنزيل الملف الحقيقي من ${analyzed.platformNameAr}: "${analyzed.title}" (${saved.fileSizeFormatted}).`;

    const outbound = insertWhatsAppMessage({
      wa_message_id: null,
      sender_phone_masked: maskedPhone,
      direction: 'outbound',
      message_type: 'text',
      content: reply,
      media_url: fileUrl,
      platform: analyzed.platform,
      download_id: dl.id,
      status: 'sent',
      client_id: session.cid,
    });

    logRequest({
      endpoint: '/api/whatsapp/simulate',
      platform: analyzed.platform,
      url: analyzed.url,
      clientId: session.cid,
      source: 'whatsapp',
      status: 'success',
      latencyMs: Date.now() - start,
    });

    res.json({ inbound, outbound, download: dl, analyzed, simulatorMode: true });
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : 'تعذر تحليل أو تنزيل الرابط.';
    const outbound = insertWhatsAppMessage({
      wa_message_id: null,
      sender_phone_masked: maskedPhone,
      direction: 'outbound',
      message_type: 'text',
      content: `فشل التنزيل: ${errorMsg}`,
      media_url: null,
      platform: null,
      download_id: null,
      status: 'error',
      client_id: session.cid,
    });

    logRequest({
      endpoint: '/api/whatsapp/simulate',
      platform: 'unknown',
      url,
      clientId: session.cid,
      source: 'whatsapp',
      status: 'error',
      latencyMs: Date.now() - start,
      errorMessage: errorMsg,
    });

    res.status(200).json({ inbound, outbound, simulatorMode: true });
  }
});
