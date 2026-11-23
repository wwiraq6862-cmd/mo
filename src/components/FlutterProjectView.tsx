import { useEffect, useState } from 'react';
import { Check, Copy, Download, FileCode2, Smartphone } from 'lucide-react';
import { triggerProjectZipDownload } from '../utils/downloadZip.ts';

interface FlutterFile {
  path: string;
  exists: boolean;
  lines: number;
  content: string;
}

export function FlutterProjectView() {
  const [files, setFiles] = useState<FlutterFile[]>([]);
  const [selectedPath, setSelectedPath] = useState<string>('lib/main.dart');
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [downloadingZip, setDownloadingZip] = useState(false);
  const [zipError, setZipError] = useState<string | null>(null);

  useEffect(() => {
    async function loadFiles() {
      try {
        const res = await fetch('/api/flutter/files');
        if (!res.ok) return;
        const data = await res.json();
        const list = (data.files || []) as FlutterFile[];
        setFiles(list);
        if (list.length > 0 && !list.some((f) => f.path === selectedPath)) {
          setSelectedPath(list[0].path);
        }
      } finally {
        setLoading(false);
      }
    }
    loadFiles();
  }, []);

  const activeFile = files.find((f) => f.path === selectedPath);

  async function copyCode() {
    if (!activeFile) return;
    try {
      await navigator.clipboard.writeText(activeFile.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Ignore
    }
  }

  return (
    <div className="space-y-6">
      <div className="bg-white border border-[#E4E7EC] rounded-2xl p-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-start gap-4">
          <div className="w-12 h-12 rounded-xl bg-emerald-50 text-emerald-700 flex items-center justify-center shrink-0">
            <Smartphone className="w-6 h-6" />
          </div>
          <div>
            <h1 className="font-display text-2xl font-bold text-[#0E1111]">
              مشروع Flutter لنظامي Android و iPhone (iOS)
            </h1>
            <p className="text-sm text-[#475467] mt-1">
              تطبيق واحد بلغة Flutter يدعم Android (APK/AAB) و iOS (Xcode) بدعم RTL، حفظ الوسائط، المشاركة، والإشعارات، ومربوط مباشرة بخادم Node.js.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          <button
            type="button"
            onClick={async () => {
              setDownloadingZip(true);
              setZipError(null);
              const res = await triggerProjectZipDownload();
              if (!res.ok) setZipError(res.error || 'فشل التنزيل');
              setDownloadingZip(false);
            }}
            disabled={downloadingZip}
            className="min-h-[44px] px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white text-xs font-semibold flex items-center justify-center gap-2 transition-colors whitespace-nowrap cursor-pointer"
          >
            <Download className="w-4 h-4" />
            <span>{downloadingZip ? 'جاري تنزيل ZIP...' : 'تنزيل المشروع كاملاً (HAMILHA_ANDROID_IOS.zip)'}</span>
          </button>
          <a
            href="/api/flutter/export"
            download="hamilha-flutter-project.json"
            className="min-h-[44px] px-4 py-2.5 rounded-xl bg-[#0E1111] hover:bg-black text-white text-xs font-semibold flex items-center justify-center gap-2 transition-colors whitespace-nowrap"
          >
            <Download className="w-4 h-4" />
            <span>تصدير Flutter (JSON)</span>
          </a>
        </div>
        {zipError && (
          <p className="text-xs text-red-600 mt-2">{zipError}</p>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* File Tree (4 cols) */}
        <div className="lg:col-span-4 bg-white border border-[#E4E7EC] rounded-2xl p-4 space-y-1">
          <div className="px-2 pb-2 text-xs font-semibold text-[#475467]">
            ملفات المشروع ({files.length})
          </div>
          {loading ? (
            <div className="p-4 text-xs text-[#475467]">جاري تحميل الملفات...</div>
          ) : (
            files.map((file) => {
              const active = file.path === selectedPath;
              return (
                <button
                  key={file.path}
                  type="button"
                  onClick={() => setSelectedPath(file.path)}
                  className={`w-full min-h-[44px] px-3 py-2 rounded-xl flex items-center justify-between gap-2 text-left transition-colors cursor-pointer ${
                    active
                      ? 'bg-emerald-50 text-emerald-800 font-semibold'
                      : 'hover:bg-[#F9FAFB] text-[#0E1111]'
                  }`}
                >
                  <span dir="ltr" className="font-mono text-xs truncate">
                    {file.path}
                  </span>
                  <span className="text-[11px] text-[#475467] tabular-nums shrink-0">
                    {file.lines} سطر
                  </span>
                </button>
              );
            })
          )}
        </div>

        {/* Code Viewer (8 cols) */}
        <div className="lg:col-span-8 bg-[#0E1111] text-white rounded-2xl overflow-hidden border border-[#1E2424]">
          <div className="px-5 py-3.5 border-b border-white/10 flex items-center justify-between gap-4">
            <div className="flex items-center gap-2 min-w-0">
              <FileCode2 className="w-4 h-4 text-emerald-400 shrink-0" />
              <span dir="ltr" className="font-mono text-xs text-white/90 truncate">
                flutter_app/{activeFile?.path || ''}
              </span>
            </div>
            <button
              type="button"
              onClick={copyCode}
              className="min-h-[36px] px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/15 text-xs font-medium flex items-center gap-1.5 transition-colors shrink-0 cursor-pointer"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copied ? 'تم النسخ' : 'نسخ الكود'}</span>
            </button>
          </div>
          <pre
            dir="ltr"
            className="p-5 overflow-x-auto max-h-[540px] text-xs font-mono leading-relaxed text-emerald-50/90"
          >
            <code>{activeFile?.content || ''}</code>
          </pre>
        </div>
      </div>
    </div>
  );
}
