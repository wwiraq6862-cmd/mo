import { useMemo, useState } from 'react';
import {
  Check,
  ClipboardPaste,
  Download,
  ExternalLink,
  Loader2,
  Search,
  Settings2,
  Share2,
  Trash2,
} from 'lucide-react';
import type { AnalyzedMedia, AppSettings, AppTab, DownloadRecord, QualityOption } from '../types.ts';
import { triggerProjectZipDownload } from '../utils/downloadZip.ts';
import { detectClientPlatform, getPlatformLabelAr, PlatformIcon } from './PlatformIcon.tsx';

interface HomeWorkspaceProps {
  downloads: DownloadRecord[];
  settings: AppSettings;
  clientId: string;
  onDownloadCreated: (record: DownloadRecord) => void;
  onDeleteDownload: (id: string) => void;
  onNavigateTab: (tab: AppTab) => void;
}

const SAMPLE_LINKS = [
  {
    label: 'فيديو MP4 مباشر',
    platform: 'Direct',
    url: 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4',
  },
  {
    label: 'مقطع يوتيوب (معاينة)',
    platform: 'YouTube',
    url: 'https://www.youtube.com/watch?v=aqz-KE-bpKQ',
  },
  {
    label: 'فيديو تيك توك',
    platform: 'TikTok',
    url: 'https://www.tiktok.com/@scout2015/video/6718335390845095173',
  },
];

export function HomeWorkspace({
  downloads,
  settings,
  clientId,
  onDownloadCreated,
  onDeleteDownload,
  onNavigateTab,
}: HomeWorkspaceProps) {
  const [urlInput, setUrlInput] = useState('');
  const [analyzing, setAnalyzing] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusNotice, setStatusNotice] = useState<string | null>(null);
  const [analyzed, setAnalyzed] = useState<AnalyzedMedia | null>(null);
  const [selectedQuality, setSelectedQuality] = useState<QualityOption | null>(null);
  const [imgFailed, setImgFailed] = useState(false);
  const [shareFeedback, setShareFeedback] = useState<string | null>(null);

  const liveDetectedPlatform = useMemo(() => detectClientPlatform(urlInput), [urlInput]);

  async function handlePaste() {
    setError(null);
    setStatusNotice(null);
    try {
      if (navigator.clipboard?.readText) {
        const text = await navigator.clipboard.readText();
        if (text.trim()) {
          setUrlInput(text.trim());
          setStatusNotice('تم لصق الرابط من الحافظة.');
          return;
        }
      }
      setStatusNotice('الحافظة فارغة — يمكنك الضغط مطولاً ولصق الرابط يدوياً في المربع.');
    } catch {
      setStatusNotice('يرجى لصق الرابط يدوياً داخل مربع الإدخال (Ctrl+V).');
    }
  }

  async function handleAnalyze(targetUrl?: string) {
    const clean = (targetUrl ?? urlInput).trim();
    if (!clean) {
      setError('يرجى إدخال رابط الفيديو أو المنشور أولاً.');
      return;
    }

    setAnalyzing(true);
    setError(null);
    setStatusNotice(null);
    setImgFailed(false);

    try {
      const res = await fetch('/api/analyze', {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'hamilha-web',
        },
        body: JSON.stringify({ url: clean, source: 'app' }),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'تعذر تحليل الرابط.');
        setAnalyzed(null);
        return;
      }

      const result = data as AnalyzedMedia;
      setAnalyzed(result);
      const preferred =
        result.qualities.find((q) => q.id === settings.defaultQuality) ||
        result.qualities[0] ||
        null;
      setSelectedQuality(preferred);
    } catch {
      setError('حدث خطأ في الاتصال بالخادم أثناء تحليل الرابط.');
    } finally {
      setAnalyzing(false);
    }
  }

  async function handleDownload() {
    if (!analyzed || !selectedQuality || !selectedQuality.streamUrl) return;
    setDownloading(true);
    setError(null);
    setStatusNotice(null);

    try {
      const res = await fetch('/api/downloads', {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'hamilha-web',
        },
        body: JSON.stringify({
          url: analyzed.url,
          streamUrl: selectedQuality.streamUrl,
          platform: analyzed.platform,
          title: analyzed.title,
          author: analyzed.author,
          thumbnailUrl: analyzed.thumbnailUrl,
          mediaType: selectedQuality.mediaType,
          quality: selectedQuality.id,
          source: 'app',
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'تعذر تنزيل الملف الأصلي من المصدر.');
        return;
      }

      const fileRes = await fetch(data.fileUrl, { credentials: 'same-origin' });
      if (!fileRes.ok) {
        setError('تعذر استلام الملف المُنزّل من الخادم.');
        return;
      }
      const blob = await fileRes.blob();
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = objectUrl;
      anchor.download = `hamilha-${analyzed.platform}-${selectedQuality.id}.${selectedQuality.format}`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(objectUrl), 4000);

      onDownloadCreated(data.download as DownloadRecord);
      setStatusNotice(`اكتمل تنزيل الملف الحقيقي (${data.download.file_size}) وحفظه بنجاح.`);
    } catch {
      setError('تعذر إكمال التنزيل الحقيقي. يرجى التحقق من الاتصال والمحاولة مرة أخرى.');
    } finally {
      setDownloading(false);
    }
  }

  async function handleShare(title: string, url: string) {
    try {
      if (navigator.share) {
        await navigator.share({
          title: `حمّلها — ${title}`,
          text: title,
          url,
        });
        setShareFeedback('تمت المشاركة بنجاح');
      } else if (navigator.clipboard) {
        await navigator.clipboard.writeText(url);
        setShareFeedback('تم نسخ رابط المشاركة');
      }
      setTimeout(() => setShareFeedback(null), 2500);
    } catch {
      // User cancelled native share sheet
    }
  }

  const recentSlice = downloads.slice(0, 5);

  return (
    <div className="space-y-10">
      {/* Hero & Analyzer Split */}
      <section className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-stretch">
        {/* Right Column (Input & Actions) */}
        <div className="lg:col-span-7 bg-white border border-[#E4E7EC] rounded-2xl p-6 sm:p-8 flex flex-col justify-between">
          <div>
            <p className="text-sm font-semibold text-emerald-700 mb-2">
              أهلاً بك في حمّلها
            </p>
            <h1 className="font-display text-3xl sm:text-4xl font-bold text-[#0E1111] tracking-tight leading-tight text-balance">
              حمّلها.. كل ملفاتك بمكان واحد.
            </h1>
            <p className="mt-3 text-[15px] text-[#475467] leading-relaxed max-w-2xl">
              الصق رابط ملف وسائط مباشر (MP4 / JPG / PNG / MP3 / PDF) لتنزيله فوراً، أو رابط منشور عام لمعاينة بياناته وتنزيل ما تسمح به المنصة رسمياً (ملاحظة: يوتيوب يعرض البيانات والغلاف الرسمي فقط، وتخضع منصات التواصل لقيود الوصول العام).
            </p>

            {/* URL Input Box */}
            <div className="mt-6 space-y-3">
              <div className="flex items-center justify-between text-xs text-[#475467]">
                <label htmlFor="media-url-input" className="font-semibold text-[#0E1111]">
                  رابط الفيديو أو المنشور
                </label>
                {liveDetectedPlatform && (
                  <span className="text-emerald-700 font-semibold">
                    تم التعرف تلقائياً: {getPlatformLabelAr(liveDetectedPlatform)}
                  </span>
                )}
              </div>

              <div className="relative">
                <input
                  id="media-url-input"
                  type="url"
                  dir="ltr"
                  value={urlInput}
                  onChange={(e) => {
                    setUrlInput(e.target.value);
                    if (error) setError(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleAnalyze();
                  }}
                  placeholder="https://www.tiktok.com/@creator/video/..."
                  className="w-full h-13 px-4 rounded-xl border border-[#D0D5DD] bg-[#F9FAFB] text-[#0E1111] font-mono text-sm placeholder:text-[#98A2B3] focus:outline-none focus:ring-2 focus:ring-emerald-600 focus:border-emerald-600 focus:bg-white transition-colors"
                />
              </div>

              <div className="flex flex-col sm:flex-row gap-3 pt-1">
                <button
                  type="button"
                  onClick={handlePaste}
                  className="min-h-[48px] px-5 py-2.5 rounded-xl border border-[#D0D5DD] bg-white hover:bg-[#F9FAFB] text-[#0E1111] font-semibold text-sm flex items-center justify-center gap-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <ClipboardPaste className="w-4 h-4 text-[#475467]" />
                  <span>لصق الرابط</span>
                </button>

                <button
                  type="button"
                  onClick={() => handleAnalyze()}
                  disabled={analyzing}
                  className="flex-1 min-h-[48px] px-6 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white font-semibold text-sm flex items-center justify-center gap-2 transition-colors whitespace-nowrap cursor-pointer"
                >
                  {analyzing ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>جاري تحليل الرابط...</span>
                    </>
                  ) : (
                    <>
                      <Search className="w-4 h-4" />
                      <span>تحليل الرابط</span>
                    </>
                  )}
                </button>
              </div>
            </div>

            {error && (
              <div
                role="alert"
                className="mt-4 p-3.5 rounded-xl bg-red-50 border border-red-200 text-red-800 text-sm"
              >
                {error}
              </div>
            )}

            {statusNotice && !error && (
              <div className="mt-4 p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm flex items-center gap-2">
                <Check className="w-4 h-4 shrink-0" />
                <span>{statusNotice}</span>
              </div>
            )}
          </div>

          {/* Supported Platforms & Quick Test Links */}
          <div className="mt-8 pt-5 border-t border-[#E4E7EC] space-y-3">
            {settings.showPlatformHints && (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[#475467]">
                <span className="font-semibold text-[#0E1111]">المنصات المدعومة:</span>
                <span>TikTok</span>
                <span aria-hidden="true">·</span>
                <span>Facebook</span>
                <span aria-hidden="true">·</span>
                <span>Instagram</span>
                <span aria-hidden="true">·</span>
                <span>YouTube</span>
                <span aria-hidden="true">·</span>
                <span>WhatsApp Bot</span>
              </div>
            )}

            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-[#475467]">تجربة سريعة:</span>
                {SAMPLE_LINKS.map((sample) => (
                  <button
                    key={sample.platform}
                    type="button"
                    onClick={() => {
                      setUrlInput(sample.url);
                      handleAnalyze(sample.url);
                    }}
                    className="min-h-[36px] px-3 py-1.5 rounded-lg bg-[#F2F4F7] hover:bg-[#E4E7EC] text-xs font-medium text-[#0E1111] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    {sample.label}
                  </button>
                ))}
              </div>

              <button
                type="button"
                onClick={() => triggerProjectZipDownload()}
                className="min-h-[36px] px-3.5 py-1.5 rounded-lg bg-[#0E1111] hover:bg-black text-white text-xs font-semibold flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" />
                <span>تنزيل كود المشروع (ZIP)</span>
              </button>
            </div>
          </div>
        </div>

        {/* Left Column (Preview / Analyzed Result Card) */}
        <div className="lg:col-span-5 bg-white border border-[#E4E7EC] rounded-2xl overflow-hidden flex flex-col">
          {!analyzed ? (
            <div className="relative flex-1 min-h-[320px] flex flex-col justify-end">
              <img
                src="/src/assets/images/hamilha_hero_studio_1795258515957.jpg"
                alt="تطبيق حمّلها على شاشات أندرويد"
                referrerPolicy="no-referrer"
                className="absolute inset-0 w-full h-full object-cover"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-[#0E1111]/90 via-[#0E1111]/45 to-transparent" />
              <div className="relative p-6 sm:p-8 text-white space-y-3">
                <div className="text-xs font-medium text-emerald-300">
                  معالجة فورية · متوافق مع Android وبوت واتساب
                </div>
                <h2 className="font-display text-2xl font-bold leading-snug">
                  جاهز لاستقبال روابطك
                </h2>
                <p className="text-sm text-white/85 leading-relaxed">
                  بمجرد تحليل أي رابط مسموح به، ستظهر هنا معاينة المحتوى، اسم المنصة، وخيارات الجودة المتاحة للتنزيل أو المشاركة.
                </p>
              </div>
            </div>
          ) : (
            <div className="p-6 sm:p-7 flex-1 flex flex-col justify-between space-y-5">
              <div className="space-y-4">
                {/* Platform Header */}
                <div className="flex items-center justify-between gap-3 pb-3 border-b border-[#E4E7EC]">
                  <div className="flex items-center gap-2.5 text-sm font-bold text-emerald-700">
                    <PlatformIcon platform={analyzed.platform} className="w-5 h-5" />
                    <span>{analyzed.platformNameAr}</span>
                  </div>
                  {analyzed.duration && (
                    <span className="text-xs text-[#475467] tabular-nums">
                      {analyzed.duration}
                    </span>
                  )}
                </div>

                {/* Thumbnail */}
                <div className="relative aspect-[16/9] rounded-xl overflow-hidden bg-[#F2F4F7] border border-[#E4E7EC]">
                  {!imgFailed && analyzed.thumbnailUrl ? (
                    <img
                      src={analyzed.thumbnailUrl}
                      alt={analyzed.title}
                      referrerPolicy="no-referrer"
                      onError={() => setImgFailed(true)}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full flex flex-col items-center justify-center gap-2 bg-gradient-to-br from-[#F2F4F7] to-[#E4E7EC] text-[#475467]">
                      <PlatformIcon platform={analyzed.platform} className="w-8 h-8 text-emerald-600" />
                      <span className="text-xs font-medium">{analyzed.platformNameAr}</span>
                    </div>
                  )}
                </div>

                {/* Title & Creator */}
                <div>
                  <h3 className="font-display text-lg font-bold text-[#0E1111] leading-snug line-clamp-2">
                    {analyzed.title}
                  </h3>
                  <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-[#475467]">
                    <span>{analyzed.author}</span>
                    <span aria-hidden="true">·</span>
                    <span>{analyzed.policyNote}</span>
                  </div>
                </div>

                {/* Quality Selector or Unavailable Notice */}
                {analyzed.downloadAllowed && analyzed.qualities.length > 0 ? (
                  <div className="space-y-2">
                    <div className="text-xs font-semibold text-[#0E1111]">
                      الخيارات الحقيقية المتاحة للتنزيل
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {analyzed.qualities.map((q) => {
                        const active = selectedQuality?.id === q.id;
                        return (
                          <button
                            key={q.id}
                            type="button"
                            onClick={() => setSelectedQuality(q)}
                            className={`min-h-[44px] px-3 py-2 rounded-xl border text-right transition-colors cursor-pointer ${
                              active
                                ? 'border-emerald-600 bg-emerald-50 text-[#0E1111]'
                                : 'border-[#E4E7EC] bg-white hover:bg-[#F9FAFB] text-[#475467]'
                            }`}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-xs font-bold text-[#0E1111] truncate">
                                {q.label}
                              </span>
                              <span className="text-xs font-mono tabular-nums text-emerald-700 shrink-0">
                                {q.sizeEstimate}
                              </span>
                            </div>
                            <div className="text-[11px] text-[#475467] truncate mt-0.5">
                              {q.resolution}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ) : (
                  <div className="p-3.5 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-xs leading-relaxed">
                    {analyzed.policyNote}
                  </div>
                )}
              </div>

              {/* Download & Share CTA */}
              <div className="pt-2 space-y-2.5">
                {analyzed.downloadAllowed && selectedQuality && (
                  <button
                    type="button"
                    onClick={handleDownload}
                    disabled={downloading}
                    className="w-full min-h-[48px] px-5 py-3 rounded-xl bg-[#0E1111] hover:bg-black disabled:opacity-60 text-white font-semibold text-sm flex items-center justify-center gap-2 transition-colors cursor-pointer"
                  >
                    {downloading ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        <span>جاري تنزيل الملف الحقيقي...</span>
                      </>
                    ) : (
                      <>
                        <Download className="w-4 h-4" />
                        <span>تنزيل وحفظ الملف ({selectedQuality.sizeEstimate})</span>
                      </>
                    )}
                  </button>
                )}

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handleShare(analyzed.title, analyzed.url)}
                    className="flex-1 min-h-[44px] px-4 py-2 rounded-xl border border-[#E4E7EC] hover:bg-[#F9FAFB] text-xs font-semibold text-[#0E1111] flex items-center justify-center gap-2 transition-colors cursor-pointer"
                  >
                    <Share2 className="w-4 h-4 text-[#475467]" />
                    <span>{shareFeedback || 'مشاركة مع الأصدقاء'}</span>
                  </button>
                  <a
                    href={analyzed.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="min-h-[44px] px-4 py-2 rounded-xl border border-[#E4E7EC] hover:bg-[#F9FAFB] text-xs font-semibold text-[#475467] flex items-center justify-center gap-1.5 transition-colors whitespace-nowrap shrink-0"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    <span>المصدر</span>
                  </a>
                </div>
              </div>
            </div>
          )}
        </div>
      </section>

      {/* Recent Downloads + Settings Summary Row */}
      <section className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* Recent Downloads (8 cols) */}
        <div className="lg:col-span-8 bg-white border border-[#E4E7EC] rounded-2xl p-6">
          <div className="flex items-center justify-between gap-4 pb-4 border-b border-[#E4E7EC]">
            <div>
              <h2 className="font-display text-xl font-bold text-[#0E1111]">
                آخر التنزيلات
              </h2>
              <p className="text-xs text-[#475467] mt-0.5">
                الملفات المحفوظة عبر التطبيق وبوت واتساب
              </p>
            </div>
            <button
              type="button"
              onClick={() => onNavigateTab('downloads')}
              className="min-h-[40px] px-3.5 py-2 rounded-lg text-xs font-semibold text-emerald-700 hover:bg-emerald-50 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              عرض السجل الكامل
            </button>
          </div>

          {recentSlice.length === 0 ? (
            <div className="py-10 text-center space-y-2">
              <p className="text-sm font-medium text-[#0E1111]">
                سجل التنزيلات فارغ حالياً
              </p>
              <p className="text-xs text-[#475467]">
                قم بتحليل وتنزيل أول رابط في الأعلى أو جرّب إرسال رابط عبر بوت واتساب ليظهر هنا فوراً.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-[#E4E7EC]">
              {recentSlice.map((item) => (
                <div
                  key={item.id}
                  className="py-3.5 flex items-center justify-between gap-4"
                >
                  <div className="flex items-center gap-3.5 min-w-0">
                    <div className="w-10 h-10 rounded-xl bg-[#F2F4F7] text-[#0E1111] flex items-center justify-center shrink-0">
                      <PlatformIcon platform={item.platform} className="w-5 h-5" />
                    </div>
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-[#0E1111] truncate">
                        {item.title}
                      </div>
                      <div className="flex items-center gap-2 text-xs text-[#475467] mt-0.5 tabular-nums">
                        <span>{getPlatformLabelAr(item.platform)}</span>
                        <span aria-hidden="true">·</span>
                        <span>{item.quality}</span>
                        <span aria-hidden="true">·</span>
                        <span>{item.file_size}</span>
                        <span aria-hidden="true">·</span>
                        <span>{item.source === 'whatsapp' ? 'واتساب' : 'التطبيق'}</span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    <a
                      href={`/api/downloads/${item.id}/file`}
                      download
                      title="تنزيل الملف"
                      className="min-h-[40px] min-w-[40px] rounded-lg border border-[#E4E7EC] hover:bg-[#F9FAFB] flex items-center justify-center text-[#0E1111] transition-colors"
                    >
                      <Download className="w-4 h-4" />
                    </a>
                    <button
                      type="button"
                      onClick={() => handleShare(item.title, item.url)}
                      title="مشاركة"
                      className="min-h-[40px] min-w-[40px] rounded-lg border border-[#E4E7EC] hover:bg-[#F9FAFB] flex items-center justify-center text-[#475467] transition-colors cursor-pointer"
                    >
                      <Share2 className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => onDeleteDownload(item.id)}
                      title="حذف من السجل"
                      className="min-h-[40px] min-w-[40px] rounded-lg border border-[#E4E7EC] hover:bg-red-50 hover:text-red-600 flex items-center justify-center text-[#475467] transition-colors cursor-pointer"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Quick Settings & Bot Entry Card (4 cols) */}
        <div className="lg:col-span-4 bg-white border border-[#E4E7EC] rounded-2xl p-6 space-y-5">
          <div className="flex items-center justify-between pb-3 border-b border-[#E4E7EC]">
            <h2 className="font-display text-lg font-bold text-[#0E1111]">
              الإعدادات السريعة
            </h2>
            <Settings2 className="w-4 h-4 text-[#475467]" />
          </div>

          <div className="space-y-3 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-[#475467]">الجودة الافتراضية</span>
              <span className="font-mono font-semibold text-[#0E1111] tabular-nums">
                {settings.defaultQuality}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[#475467]">تسجيل الحساب</span>
              <span className="font-semibold text-emerald-700">غير مطلوب</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[#475467]">ربط بوت واتساب</span>
              <span className="font-semibold text-[#0E1111]">جاهز للتشغيل</span>
            </div>
          </div>

          <div className="pt-2 space-y-2.5">
            <button
              type="button"
              onClick={() => onNavigateTab('settings')}
              className="w-full min-h-[44px] px-4 py-2.5 rounded-xl border border-[#D0D5DD] hover:bg-[#F9FAFB] text-xs font-semibold text-[#0E1111] transition-colors cursor-pointer"
            >
              فتح قسم الإعدادات
            </button>
            <button
              type="button"
              onClick={() => onNavigateTab('whatsapp')}
              className="w-full min-h-[44px] px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-xs font-semibold text-white transition-colors cursor-pointer"
            >
              تجربة بوت واتساب الآن
            </button>
            <button
              type="button"
              onClick={() => triggerProjectZipDownload()}
              className="w-full min-h-[44px] px-4 py-2.5 rounded-xl bg-[#0E1111] hover:bg-black text-xs font-semibold text-white flex items-center justify-center gap-2 transition-colors cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              <span>تنزيل حزمة المشروع (ZIP)</span>
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
