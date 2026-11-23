import { useMemo, useState } from 'react';
import { Download, Search, Share2, Trash2 } from 'lucide-react';
import type { DownloadRecord } from '../types.ts';
import { getPlatformLabelAr, PlatformIcon } from './PlatformIcon.tsx';

interface DownloadsViewProps {
  downloads: DownloadRecord[];
  onDeleteDownload: (id: string) => void;
  onClearAll: () => void;
}

const PLATFORM_FILTERS = [
  { id: 'all', label: 'الكل' },
  { id: 'tiktok', label: 'تيك توك' },
  { id: 'instagram', label: 'إنستغرام' },
  { id: 'facebook', label: 'فيسبوك' },
  { id: 'youtube', label: 'يوتيوب' },
  { id: 'whatsapp', label: 'واتساب' },
];

export function DownloadsView({
  downloads,
  onDeleteDownload,
  onClearAll,
}: DownloadsViewProps) {
  const [filter, setFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');

  const filtered = useMemo(() => {
    return downloads.filter((item) => {
      const matchesPlatform = filter === 'all' || item.platform === filter;
      const q = searchQuery.trim().toLowerCase();
      const matchesSearch =
        !q ||
        item.title.toLowerCase().includes(q) ||
        item.author.toLowerCase().includes(q) ||
        item.url.toLowerCase().includes(q);
      return matchesPlatform && matchesSearch;
    });
  }, [downloads, filter, searchQuery]);

  async function handleShare(item: DownloadRecord) {
    try {
      if (navigator.share) {
        await navigator.share({ title: item.title, url: item.url });
      } else if (navigator.clipboard) {
        await navigator.clipboard.writeText(item.url);
      }
    } catch {
      // Ignore cancel
    }
  }

  return (
    <div className="space-y-6">
      <div className="bg-white border border-[#E4E7EC] rounded-2xl p-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-[#0E1111]">
            سجل التنزيلات المحفوظة
          </h1>
          <p className="text-sm text-[#475467] mt-1">
            إجمالي الملفات: <span className="font-semibold text-[#0E1111] tabular-nums">{downloads.length}</span> ملف
          </p>
        </div>

        {downloads.length > 0 && (
          <button
            type="button"
            onClick={onClearAll}
            className="min-h-[44px] px-4 py-2 rounded-xl border border-red-200 text-red-700 hover:bg-red-50 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            مسح السجل بالكامل
          </button>
        )}
      </div>

      {/* Filters & Search */}
      <div className="bg-white border border-[#E4E7EC] rounded-2xl p-4 sm:p-5 flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-4">
        <div className="flex items-center gap-1 p-1 bg-[#F2F4F7] rounded-xl overflow-x-auto">
          {PLATFORM_FILTERS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setFilter(tab.id)}
              className={`min-h-[40px] px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                filter === tab.id
                  ? 'bg-white text-[#0E1111] shadow-xs'
                  : 'text-[#475467] hover:text-[#0E1111]'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="relative lg:w-72">
          <Search className="w-4 h-4 text-[#475467] absolute right-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="بحث بالعنوان أو المنصة..."
            className="w-full h-11 pr-10 pl-3 rounded-xl border border-[#D0D5DD] bg-[#F9FAFB] text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600 focus:bg-white"
          />
        </div>
      </div>

      {/* Table / List */}
      <div className="bg-white border border-[#E4E7EC] rounded-2xl overflow-hidden">
        {filtered.length === 0 ? (
          <div className="p-12 text-center space-y-2">
            <p className="text-base font-semibold text-[#0E1111]">لا توجد نتائج مطابقة</p>
            <p className="text-sm text-[#475467]">
              جرّب تغيير فلتر المنصة أو تحليل رابط جديد من الصفحة الرئيسية.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-[#E4E7EC]">
            {filtered.map((item) => (
              <div
                key={item.id}
                className="p-4 sm:px-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4 hover:bg-[#F9FAFB] transition-colors"
              >
                <div className="flex items-center gap-4 min-w-0">
                  <div className="w-11 h-11 rounded-xl bg-emerald-50 text-emerald-700 flex items-center justify-center shrink-0">
                    <PlatformIcon platform={item.platform} className="w-5 h-5" />
                  </div>
                  <div className="min-w-0">
                    <div className="text-sm font-bold text-[#0E1111] truncate">
                      {item.title}
                    </div>
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-[#475467] mt-1 tabular-nums">
                      <span>{getPlatformLabelAr(item.platform)}</span>
                      <span aria-hidden="true">·</span>
                      <span>{item.author}</span>
                      <span aria-hidden="true">·</span>
                      <span>{item.quality}</span>
                      <span aria-hidden="true">·</span>
                      <span>{item.file_size}</span>
                      <span aria-hidden="true">·</span>
                      <span>{new Date(item.created_at).toLocaleString('ar-EG')}</span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
                  <a
                    href={`/api/downloads/${item.id}/file`}
                    download
                    className="min-h-[44px] px-4 py-2 rounded-xl bg-[#0E1111] hover:bg-black text-white text-xs font-semibold flex items-center gap-2 transition-colors whitespace-nowrap"
                  >
                    <Download className="w-4 h-4" />
                    <span>تنزيل</span>
                  </a>
                  <button
                    type="button"
                    onClick={() => handleShare(item)}
                    className="min-h-[44px] px-3.5 py-2 rounded-xl border border-[#D0D5DD] hover:bg-white text-xs font-semibold text-[#0E1111] flex items-center gap-1.5 transition-colors cursor-pointer"
                  >
                    <Share2 className="w-4 h-4" />
                    <span>مشاركة</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onDeleteDownload(item.id)}
                    aria-label="حذف"
                    className="min-h-[44px] min-w-[44px] rounded-xl border border-[#E4E7EC] hover:bg-red-50 hover:text-red-600 flex items-center justify-center text-[#475467] transition-colors cursor-pointer"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
