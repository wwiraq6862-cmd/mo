import crypto from 'node:crypto';
import os from 'node:os';
import { Router, type NextFunction, type Request, type Response } from 'express';
import { db, getBotConfigMap, setBotConfigValue } from './db.ts';
import { createRateLimiter, getSessionSigningKey } from './security.ts';

export const adminRouter = Router();

const adminAuthLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  maxRequests: 10,
  keyPrefix: 'admin-auth',
  message: 'تم تجاوز محاولات تسجيل الدخول المسموح بها. يرجى الانتظار 15 دقيقة.',
});

function hashPasscode(passcode: string, saltHex: string): Buffer {
  return crypto.scryptSync(passcode, Buffer.from(saltHex, 'hex'), 64);
}

function getClaimedAdmin(): { passcode_hash: string; salt: string; claimed_at: string } | undefined {
  return db.prepare('SELECT passcode_hash, salt, claimed_at FROM admin_auth WHERE id = 1').get() as
    | { passcode_hash: string; salt: string; claimed_at: string }
    | undefined;
}

function hasEnvPasscode(): boolean {
  return Boolean(process.env.ADMIN_PASSCODE && process.env.ADMIN_PASSCODE.trim().length > 0);
}

function verifyPasscode(candidate: string): boolean {
  const envPass = process.env.ADMIN_PASSCODE?.trim();
  if (envPass) {
    const a = crypto.createHash('sha256').update(candidate).digest();
    const b = crypto.createHash('sha256').update(envPass).digest();
    return crypto.timingSafeEqual(a, b);
  }

  const claimed = getClaimedAdmin();
  if (!claimed) return false;
  const derived = hashPasscode(candidate, claimed.salt);
  const stored = Buffer.from(claimed.passcode_hash, 'hex');
  if (derived.length !== stored.length) return false;
  return crypto.timingSafeEqual(derived, stored);
}

function issueBearerToken(): string {
  const payload = Buffer.from(
    JSON.stringify({
      role: 'admin',
      exp: Date.now() + 1000 * 60 * 60 * 12,
      jti: crypto.randomUUID(),
    }),
    'utf-8',
  ).toString('base64url');
  const sig = crypto
    .createHmac('sha256', getSessionSigningKey())
    .update(payload)
    .digest('base64url');
  return `${payload}.${sig}`;
}

function verifyBearerToken(token: string): boolean {
  const parts = token.split('.');
  if (parts.length !== 2) return false;
  const [payloadB64, sigB64] = parts;
  const expectedSig = crypto
    .createHmac('sha256', getSessionSigningKey())
    .update(payloadB64)
    .digest('base64url');
  const sigBuf = Buffer.from(sigB64);
  const expBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return false;
  }
  try {
    const parsed = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf-8')) as {
      role?: string;
      exp?: number;
    };
    return parsed.role === 'admin' && typeof parsed.exp === 'number' && parsed.exp > Date.now();
  } catch {
    return false;
  }
}

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization || '';
  if (!header.startsWith('Bearer ')) {
    res.status(401).json({ error: 'مطلوب تسجيل دخول الإدارة.' });
    return;
  }
  const token = header.slice('Bearer '.length).trim();
  if (!verifyBearerToken(token)) {
    res.status(401).json({ error: 'انتهت صلاحية جلسة الإدارة أو الرمز غير صالح.' });
    return;
  }
  next();
}

adminRouter.get('/auth/status', (_req: Request, res: Response) => {
  const envConfigured = hasEnvPasscode();
  const claimed = Boolean(getClaimedAdmin());
  res.json({
    needsInitialSetup: !envConfigured && !claimed,
    envConfigured,
  });
});

adminRouter.post('/auth/claim', adminAuthLimiter, (req: Request, res: Response) => {
  if (hasEnvPasscode() || getClaimedAdmin()) {
    res.status(409).json({ error: 'تم إعداد كلمة مرور الإدارة مسبقاً.' });
    return;
  }
  const passcode = String(req.body?.passcode || '').trim();
  if (passcode.length < 6 || passcode.length > 64) {
    res.status(400).json({ error: 'يجب أن تتكون كلمة مرور الإدارة من 6 إلى 64 حرفاً.' });
    return;
  }

  const salt = crypto.randomBytes(16).toString('hex');
  const hashHex = hashPasscode(passcode, salt).toString('hex');

  try {
    db.prepare('INSERT INTO admin_auth (id, passcode_hash, salt, claimed_at) VALUES (1, ?, ?, ?)').run(
      hashHex,
      salt,
      new Date().toISOString(),
    );
  } catch {
    res.status(409).json({ error: 'تم إعداد كلمة مرور الإدارة مسبقاً.' });
    return;
  }

  const token = issueBearerToken();
  res.json({ token, claimed: true });
});

adminRouter.post('/auth/login', adminAuthLimiter, (req: Request, res: Response) => {
  const passcode = String(req.body?.passcode || '');
  if (!hasEnvPasscode() && !getClaimedAdmin()) {
    res.status(409).json({ error: 'يرجى تعيين كلمة مرور الإدارة أولاً.' });
    return;
  }
  if (!verifyPasscode(passcode)) {
    res.status(401).json({ error: 'كلمة مرور الإدارة غير صحيحة.' });
    return;
  }
  const token = issueBearerToken();
  res.json({ token });
});

adminRouter.get('/overview', requireAdmin, (_req: Request, res: Response) => {
  const totalDownloadsRow = db.prepare('SELECT COUNT(*) as count FROM downloads').get() as {
    count: number;
  };
  const uniqueClientsRow = db
    .prepare(
      `SELECT COUNT(DISTINCT client_id) as count FROM (
        SELECT client_id FROM downloads
        UNION
        SELECT client_id FROM request_logs
      )`,
    )
    .get() as { count: number };

  const todayPrefix = new Date().toISOString().slice(0, 10);
  const dailyRequestsRow = db
    .prepare('SELECT COUNT(*) as count FROM request_logs WHERE created_at LIKE ?')
    .get(`${todayPrefix}%`) as { count: number };

  const errorCountRow = db
    .prepare("SELECT COUNT(*) as count FROM request_logs WHERE status != 'success' AND resolved = 0")
    .get() as { count: number };

  const avgLatencyRow = db
    .prepare('SELECT COALESCE(AVG(latency_ms), 0) as avg_ms FROM request_logs')
    .get() as { avg_ms: number };

  const platformBreakdown = db
    .prepare(
      `SELECT platform, COUNT(*) as count
       FROM downloads
       GROUP BY platform
       ORDER BY count DESC`,
    )
    .all() as Array<{ platform: string; count: number }>;

  // Last 7 days daily series
  const dailySeries: Array<{ date: string; requests: number; downloads: number }> = [];
  for (let i = 6; i >= 0; i -= 1) {
    const d = new Date(Date.now() - i * 86400_000);
    const isoDay = d.toISOString().slice(0, 10);
    const reqCount = (
      db
        .prepare('SELECT COUNT(*) as count FROM request_logs WHERE created_at LIKE ?')
        .get(`${isoDay}%`) as { count: number }
    ).count;
    const dlCount = (
      db
        .prepare('SELECT COUNT(*) as count FROM downloads WHERE created_at LIKE ?')
        .get(`${isoDay}%`) as { count: number }
    ).count;
    dailySeries.push({ date: isoDay, requests: reqCount, downloads: dlCount });
  }

  const mem = process.memoryUsage();
  const totalMemMb = Math.round(os.totalmem() / (1024 * 1024));
  const usedRssMb = Math.round(mem.rss / (1024 * 1024));
  const load = os.loadavg();

  const recentLogs = db
    .prepare('SELECT * FROM request_logs ORDER BY created_at DESC LIMIT 25')
    .all();

  const failedLogs = db
    .prepare("SELECT * FROM request_logs WHERE status != 'success' ORDER BY created_at DESC LIMIT 25")
    .all();

  res.json({
    metrics: {
      totalUsers: uniqueClientsRow.count,
      totalDownloads: totalDownloadsRow.count,
      dailyRequests: dailyRequestsRow.count,
      unresolvedErrors: errorCountRow.count,
      avgLatencyMs: Math.round(avgLatencyRow.avg_ms),
    },
    serverHealth: {
      uptimeSeconds: Math.round(process.uptime()),
      memoryUsedMb: usedRssMb,
      memoryTotalMb: totalMemMb,
      cpuLoad1m: Number(load[0]?.toFixed(2) || 0),
      nodeVersion: process.version,
      platform: os.platform(),
    },
    platformBreakdown,
    dailySeries,
    botConfig: getBotConfigMap(),
    cloudApiConfigured: Boolean(
      process.env.WHATSAPP_ACCESS_TOKEN &&
        process.env.WHATSAPP_PHONE_NUMBER_ID &&
        process.env.WHATSAPP_VERIFY_TOKEN,
    ),
    recentLogs,
    failedLogs,
  });
});

adminRouter.patch('/bot-config', requireAdmin, (req: Request, res: Response) => {
  const allowedKeys = [
    'bot_enabled',
    'auto_reply',
    'accept_user_media',
    'default_quality',
    'welcome_message',
    'max_file_mb',
  ];
  const body = req.body as Record<string, unknown>;
  for (const key of allowedKeys) {
    if (body[key] !== undefined) {
      const val = String(body[key]).slice(0, 500);
      setBotConfigValue(key, val);
    }
  }
  res.json({ botConfig: getBotConfigMap() });
});

adminRouter.post('/errors/:id/resolve', requireAdmin, (req: Request, res: Response) => {
  const id = String(req.params.id || '');
  const result = db.prepare('UPDATE request_logs SET resolved = 1 WHERE id = ?').run(id);
  if (result.changes === 0) {
    res.status(404).json({ error: 'السجل غير موجود.' });
    return;
  }
  res.json({ resolved: true, id });
});
