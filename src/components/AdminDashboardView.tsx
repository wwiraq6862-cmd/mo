import { useCallback, useEffect, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Cpu,
  Download,
  Lock,
  RefreshCw,
  Server,
  ShieldCheck,
  Users,
} from 'lucide-react';
import { getPlatformLabelAr } from './PlatformIcon.tsx';

interface AdminOverview {
  metrics: {
    totalUsers: number;
    totalDownloads: number;
    dailyRequests: number;
    unresolvedErrors: number;
    avgLatencyMs: number;
  };
  serverHealth: {
    uptimeSeconds: number;
    memoryUsedMb: number;
    memoryTotalMb: number;
    cpuLoad1m: number;
    nodeVersion: string;
    platform: string;
  };
  platformBreakdown: Array<{ platform: string; count: number }>;
  dailySeries: Array<{ date: string; requests: number; downloads: number }>;
  botConfig: Record<string, string>;
  cloudApiConfigured: boolean;
  recentLogs: Array<{
    id: string;
    endpoint: string;
    platform: string;
    status: string;
    latency_ms: number;
    created_at: string;
  }>;
  failedLogs: Array<{
    id: string;
    endpoint: string;
    platform: string;
    url: string | null;
    status: string;
    error_message: string | null;
    resolved: number;
    created_at: string;
  }>;
}

export function AdminDashboardView() {
  // Store admin Bearer token strictly in React memory (never localStorage)
  const [token, setToken] = useState<string | null>(null);
  const [needsInitialSetup, setNeedsInitialSetup] = useState<boolean | null>(null);
  const [passcodeInput, setPasscodeInput] = useState('');
  const [authError, setAuthError] = useState<string | null>(null);
  const [authLoading, setAuthLoading] = useState(false);

  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [loadingData, setLoadingData] = useState(false);
  const [savingBot, setSavingBot] = useState(false);

  useEffect(() => {
    async function checkStatus() {
      try {
        const res = await fetch('/api/admin/auth/status');
        if (!res.ok) return;
        const data = await res.json();
        setNeedsInitialSetup(Boolean(data.needsInitialSetup));
      } catch {
        setNeedsInitialSetup(false);
      }
    }
    checkStatus();
  }, []);

  const fetchOverview = useCallback(async (authToken: string) => {
    setLoadingData(true);
    try {
      const res = await fetch('/api/admin/overview', {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      if (res.status === 401) {
        setToken(null);
        setOverview(null);
        return;
      }
      if (!res.ok) return;
      const data = (await res.json()) as AdminOverview;
      setOverview(data);
    } finally {
      setLoadingData(false);
    }
  }, []);

  useEffect(() => {
    if (token) {
      fetchOverview(token);
    }
  }, [token, fetchOverview]);

  async function handleAuthSubmit(e: React.FormEvent) {
    e.preventDefault();
    setAuthError(null);
    setAuthLoading(true);
    try {
      const endpoint = needsInitialSetup ? '/api/admin/auth/claim' : '/api/admin/auth/login';
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ passcode: passcodeInput }),
      });
      const data = await res.json();
      if (!res.ok) {
        setAuthError(data.error || 'تعذر التحقق من كلمة المرور.');
        return;
      }
      setNeedsInitialSetup(false);
      setToken(data.token);
      setPasscodeInput('');
    } catch {
      setAuthError('حدث خطأ أثناء الاتصال بالخادم.');
    } finally {
      setAuthLoading(false);
    }
  }

  async function updateBotConfig(patch: Record<string, string>) {
    if (!token) return;
    setSavingBot(true);
    try {
      const res = await fetch('/api/admin/bot-config', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(patch),
      });
      if (res.ok) {
        await fetchOverview(token);
      }
    } finally {
      setSavingBot(false);
    }
  }

  async function resolveError(id: string) {
    if (!token) return;
    const res = await fetch(`/api/admin/errors/${id}/resolve`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) {
      await fetchOverview(token);
    }
  }

  if (!token) {
    return (
      <div className="max-w-md mx-auto bg-white border border-[#E4E7EC] rounded-2xl p-6 sm:p-8 space-y-5">
        <div className="w-12 h-12 rounded-xl bg-emerald-50 text-emerald-700 flex items-center justify-center">
          <Lock className="w-6 h-6" />
        </div>
        <div>
          <h1 className="font-display text-2xl font-bold text-[#0E1111]">
            {needsInitialSetup ? 'تعيين كلمة مرور الإدارة' : 'دخول لوحة تحكم الإدارة'}
          </h1>
          <p className="text-sm text-[#475467] mt-1 leading-relaxed">
            {needsInitialSetup
              ? 'قم بتعيين كلمة مرور خاصة بصاحب التطبيق لمرة واحدة لحماية إحصائيات الخادم وإدارة البوت.'
              : 'أدخل كلمة مرور الإدارة لعرض الإحصائيات وإدارة البوت ومراقبة أداء الخادم.'}
          </p>
        </div>

        <form onSubmit={handleAuthSubmit} className="space-y-4">
          <div>
            <label htmlFor="admin-passcode" className="block text-xs font-semibold text-[#0E1111] mb-1.5">
              كلمة مرور الإدارة
            </label>
            <input
              id="admin-passcode"
              type="password"
              value={passcodeInput}
              onChange={(e) => setPasscodeInput(e.target.value)}
              placeholder="6 أحرف على الأقل..."
              className="w-full h-12 px-4 rounded-xl border border-[#D0D5DD] bg-[#F9FAFB] text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600 focus:bg-white"
            />
          </div>

          {authError && (
            <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-xs text-red-700">
              {authError}
            </div>
          )}

          <button
            type="submit"
            disabled={authLoading || passcodeInput.length < 4}
            className="w-full min-h-[48px] rounded-xl bg-[#0E1111] hover:bg-black disabled:opacity-50 text-white text-sm font-semibold transition-colors cursor-pointer"
          >
            {authLoading
              ? 'جاري التحقق...'
              : needsInitialSetup
                ? 'حفظ كلمة المرور والدخول'
                : 'تسجيل الدخول'}
          </button>
        </form>
      </div>
    );
  }

  const maxChartVal = Math.max(
    1,
    ...(overview?.dailySeries.map((d) => Math.max(d.requests, d.downloads)) || [1]),
  );

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="bg-white border border-[#E4E7EC] rounded-2xl p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-[#0E1111]">
            لوحة تحكم الإدارة والمراقبة
          </h1>
          <p className="text-sm text-[#475467] mt-1">
            متابعة حية للمستخدمين والتنزيلات وأداء الخادم وبوت واتساب وسجل الأخطاء
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={() => fetchOverview(token)}
            disabled={loadingData}
            className="min-h-[44px] px-4 py-2 rounded-xl border border-[#D0D5DD] hover:bg-[#F9FAFB] text-xs font-semibold text-[#0E1111] flex items-center gap-2 transition-colors cursor-pointer"
          >
            <RefreshCw className={`w-4 h-4 ${loadingData ? 'animate-spin' : ''}`} />
            <span>تحديث البيانات</span>
          </button>
          <button
            type="button"
            onClick={() => setToken(null)}
            className="min-h-[44px] px-4 py-2 rounded-xl bg-[#0E1111] text-white text-xs font-semibold hover:bg-black transition-colors cursor-pointer"
          >
            قفل الجلسة
          </button>
        </div>
      </div>

      {/* 4 KPI Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white border border-[#E4E7EC] rounded-2xl p-5 space-y-2">
          <div className="flex items-center justify-between text-xs text-[#475467]">
            <span>عدد المستخدمين</span>
            <Users className="w-4 h-4 text-emerald-700" />
          </div>
          <div className="font-display text-3xl font-bold text-[#0E1111] tabular-nums">
            {overview?.metrics.totalUsers ?? 0}
          </div>
        </div>

        <div className="bg-white border border-[#E4E7EC] rounded-2xl p-5 space-y-2">
          <div className="flex items-center justify-between text-xs text-[#475467]">
            <span>إجمالي التنزيلات</span>
            <Download className="w-4 h-4 text-emerald-700" />
          </div>
          <div className="font-display text-3xl font-bold text-[#0E1111] tabular-nums">
            {overview?.metrics.totalDownloads ?? 0}
          </div>
        </div>

        <div className="bg-white border border-[#E4E7EC] rounded-2xl p-5 space-y-2">
          <div className="flex items-center justify-between text-xs text-[#475467]">
            <span>الطلبات اليومية</span>
            <Activity className="w-4 h-4 text-emerald-700" />
          </div>
          <div className="font-display text-3xl font-bold text-[#0E1111] tabular-nums">
            {overview?.metrics.dailyRequests ?? 0}
          </div>
        </div>

        <div className="bg-white border border-[#E4E7EC] rounded-2xl p-5 space-y-2">
          <div className="flex items-center justify-between text-xs text-[#475467]">
            <span>أخطاء غير محلولة</span>
            <AlertTriangle className="w-4 h-4 text-amber-600" />
          </div>
          <div className="font-display text-3xl font-bold text-[#0E1111] tabular-nums">
            {overview?.metrics.unresolvedErrors ?? 0}
          </div>
        </div>
      </div>

      {/* Daily Chart + Server Performance */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
        {/* 7-day Requests & Downloads Chart (7 cols) */}
        <div className="lg:col-span-7 bg-white border border-[#E4E7EC] rounded-2xl p-6 space-y-5">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="font-display text-lg font-bold text-[#0E1111]">
                الطلبات والتنزيلات خلال 7 أيام
              </h2>
              <p className="text-xs text-[#475467] mt-0.5">
                مقارنة يومية بين إجمالي الطلبات والملفات المحمّلة
              </p>
            </div>
            <div className="flex items-center gap-4 text-xs text-[#475467]">
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-xs bg-[#0E1111]" /> الطلبات
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-xs bg-emerald-600" /> التنزيلات
              </span>
            </div>
          </div>

          <div className="grid grid-cols-7 gap-3 pt-4 h-48 items-end">
            {(overview?.dailySeries || []).map((day) => {
              const reqH = Math.max(4, Math.round((day.requests / maxChartVal) * 140));
              const dlH = Math.max(4, Math.round((day.downloads / maxChartVal) * 140));
              return (
                <div key={day.date} className="flex flex-col items-center gap-2">
                  <div className="flex items-end gap-1.5 h-36">
                    <div
                      title={`طلبات: ${day.requests}`}
                      style={{ height: `${reqH}px` }}
                      className="w-3 sm:w-4 rounded-t-sm bg-[#0E1111]"
                    />
                    <div
                      title={`تنزيلات: ${day.downloads}`}
                      style={{ height: `${dlH}px` }}
                      className="w-3 sm:w-4 rounded-t-sm bg-emerald-600"
                    />
                  </div>
                  <span className="font-mono text-[10px] text-[#475467] tabular-nums">
                    {day.date.slice(5)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Server Performance Telemetry (5 cols) */}
        <div className="lg:col-span-5 bg-white border border-[#E4E7EC] rounded-2xl p-6 space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-[#E4E7EC]">
            <h2 className="font-display text-lg font-bold text-[#0E1111]">
              مراقبة أداء الخادم
            </h2>
            <Server className="w-5 h-5 text-emerald-700" />
          </div>

          <div className="space-y-3 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-[#475467]">مدة التشغيل (Uptime)</span>
              <span className="font-mono font-semibold text-[#0E1111] tabular-nums">
                {overview?.serverHealth.uptimeSeconds ?? 0} ثانية
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[#475467]">استهلاك الذاكرة (RSS)</span>
              <span className="font-mono font-semibold text-[#0E1111] tabular-nums">
                {overview?.serverHealth.memoryUsedMb ?? 0} / {overview?.serverHealth.memoryTotalMb ?? 0} MB
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[#475467]">متوسط حمل المعالج (1m)</span>
              <span className="font-mono font-semibold text-[#0E1111] tabular-nums flex items-center gap-1.5">
                <Cpu className="w-3.5 h-3.5 text-[#475467]" />
                {overview?.serverHealth.cpuLoad1m ?? 0}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[#475467]">متوسط زمن الاستجابة</span>
              <span className="font-mono font-semibold text-emerald-700 tabular-nums">
                {overview?.metrics.avgLatencyMs ?? 0} ms
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[#475467]">بيئة التشغيل</span>
              <span className="font-mono text-xs text-[#0E1111]">
                Node {overview?.serverHealth.nodeVersion} · {overview?.serverHealth.platform}
              </span>
            </div>
          </div>

          {/* Platform Breakdown */}
          <div className="pt-3 border-t border-[#E4E7EC] space-y-2">
            <div className="text-xs font-semibold text-[#0E1111]">توزيع التنزيلات حسب المنصة</div>
            {overview?.platformBreakdown.length === 0 ? (
              <p className="text-xs text-[#475467]">لا توجد بيانات منصات بعد.</p>
            ) : (
              <div className="space-y-1.5">
                {overview?.platformBreakdown.map((row) => (
                  <div key={row.platform} className="flex items-center justify-between text-xs">
                    <span className="text-[#475467]">{getPlatformLabelAr(row.platform)}</span>
                    <span className="font-mono font-semibold text-[#0E1111] tabular-nums">
                      {row.count}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Bot Management + Error Logs */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Bot Controls (5 cols) */}
        <div className="lg:col-span-5 bg-white border border-[#E4E7EC] rounded-2xl p-6 space-y-5">
          <div className="flex items-center justify-between pb-3 border-b border-[#E4E7EC]">
            <h2 className="font-display text-lg font-bold text-[#0E1111]">
              إدارة بوت واتساب
            </h2>
            <ShieldCheck className="w-5 h-5 text-emerald-700" />
          </div>

          <div className="space-y-4">
            <div className="flex items-center justify-between gap-4">
              <div>
                <div className="text-sm font-semibold text-[#0E1111]">تشغيل البوت</div>
                <div className="text-xs text-[#475467]">استقبال ومعالجة رسائل واتساب تلقائياً</div>
              </div>
              <button
                type="button"
                disabled={savingBot}
                onClick={() =>
                  updateBotConfig({
                    bot_enabled: overview?.botConfig.bot_enabled === 'true' ? 'false' : 'true',
                  })
                }
                className={`w-12 h-7 rounded-full p-1 transition-colors cursor-pointer shrink-0 ${
                  overview?.botConfig.bot_enabled === 'true' ? 'bg-emerald-600' : 'bg-[#D0D5DD]'
                }`}
              >
                <span
                  className={`block w-5 h-5 rounded-full bg-white transition-transform ${
                    overview?.botConfig.bot_enabled === 'true' ? '-translate-x-5' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>

            <div className="flex items-center justify-between gap-4">
              <div>
                <div className="text-sm font-semibold text-[#0E1111]">استقبال وسائط المستخدمين</div>
                <div className="text-xs text-[#475467]">حفظ الصور والفيديوهات والمستندات المرسلة للبوت</div>
              </div>
              <button
                type="button"
                disabled={savingBot}
                onClick={() =>
                  updateBotConfig({
                    accept_user_media:
                      overview?.botConfig.accept_user_media === 'true' ? 'false' : 'true',
                  })
                }
                className={`w-12 h-7 rounded-full p-1 transition-colors cursor-pointer shrink-0 ${
                  overview?.botConfig.accept_user_media === 'true'
                    ? 'bg-emerald-600'
                    : 'bg-[#D0D5DD]'
                }`}
              >
                <span
                  className={`block w-5 h-5 rounded-full bg-white transition-transform ${
                    overview?.botConfig.accept_user_media === 'true'
                      ? '-translate-x-5'
                      : 'translate-x-0'
                  }`}
                />
              </button>
            </div>

            <div className="flex items-center justify-between gap-4">
              <div className="text-sm font-semibold text-[#0E1111]">جودة البوت الافتراضية</div>
              <select
                value={overview?.botConfig.default_quality || '720p'}
                onChange={(e) => updateBotConfig({ default_quality: e.target.value })}
                className="h-10 px-3 rounded-xl border border-[#D0D5DD] bg-[#F9FAFB] text-xs font-mono"
              >
                <option value="1080p">1080p</option>
                <option value="720p">720p</option>
                <option value="480p">480p</option>
              </select>
            </div>
          </div>
        </div>

        {/* Failed Requests & Errors Management (7 cols) */}
        <div className="lg:col-span-7 bg-white border border-[#E4E7EC] rounded-2xl p-6 space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-[#E4E7EC]">
            <h2 className="font-display text-lg font-bold text-[#0E1111]">
              إدارة الأخطاء والطلبات الفاشلة
            </h2>
            <span className="text-xs text-[#475467] tabular-nums">
              {overview?.failedLogs.length ?? 0} سجل
            </span>
          </div>

          {!overview?.failedLogs.length ? (
            <div className="py-10 text-center space-y-2">
              <CheckCircle2 className="w-7 h-7 text-emerald-600 mx-auto" />
              <p className="text-sm font-semibold text-[#0E1111]">لا توجد أخطاء مسجلة</p>
              <p className="text-xs text-[#475467]">
                جميع الطلبات الأخيرة تمت معالجتها بنجاح.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-[#E4E7EC] max-h-80 overflow-y-auto">
              {overview.failedLogs.map((errLog) => (
                <div
                  key={errLog.id}
                  className="py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                >
                  <div className="min-w-0">
                    <div className="text-xs font-bold text-red-700">
                      {errLog.error_message || 'طلب غير مكتمل'}
                    </div>
                    <div className="text-[11px] text-[#475467] mt-0.5 flex items-center gap-2 tabular-nums">
                      <span className="font-mono">{errLog.endpoint}</span>
                      <span aria-hidden="true">·</span>
                      <span>{new Date(errLog.created_at).toLocaleString('ar-EG')}</span>
                    </div>
                  </div>
                  {errLog.resolved === 1 ? (
                    <span className="text-xs font-semibold text-emerald-700 shrink-0">
                      تمت المعالجة
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => resolveError(errLog.id)}
                      className="min-h-[36px] px-3 py-1.5 rounded-lg border border-[#D0D5DD] hover:bg-[#F9FAFB] text-xs font-semibold text-[#0E1111] shrink-0 cursor-pointer"
                    >
                      تحديد كمحلول
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
