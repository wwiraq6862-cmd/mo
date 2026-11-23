import { Trash2 } from 'lucide-react';
import type { AppSettings } from '../types.ts';

interface SettingsViewProps {
  settings: AppSettings;
  clientId: string;
  onUpdateSettings: (patch: Partial<AppSettings>) => void;
  onClearHistory: () => void;
}

export function SettingsView({
  settings,
  clientId,
  onUpdateSettings,
  onClearHistory,
}: SettingsViewProps) {
  return (
    <div className="max-w-3xl space-y-6">
      <div className="bg-white border border-[#E4E7EC] rounded-2xl p-6">
        <h1 className="font-display text-2xl font-bold text-[#0E1111]">
          إعدادات التطبيق
        </h1>
        <p className="text-sm text-[#475467] mt-1">
          تخصيص جودة التنزيل الافتراضية وتجربة الاستخدام على جهازك. لا يتطلب التطبيق إنشاء حساب في النسخة الأولى.
        </p>
      </div>

      <div className="bg-white border border-[#E4E7EC] rounded-2xl divide-y divide-[#E4E7EC]">
        <div className="p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="text-sm font-bold text-[#0E1111]">الجودة الافتراضية للتنزيل</div>
            <div className="text-xs text-[#475467] mt-0.5">
              يتم تحديد هذه الجودة تلقائياً عند تحليل الروابط الجديدة
            </div>
          </div>
          <div className="flex items-center gap-1 p-1 bg-[#F2F4F7] rounded-xl shrink-0">
            {(['1080p', '720p', '480p'] as const).map((q) => (
              <button
                key={q}
                type="button"
                onClick={() => onUpdateSettings({ defaultQuality: q })}
                className={`min-h-[40px] px-4 py-1.5 rounded-lg font-mono text-xs font-semibold transition-colors cursor-pointer ${
                  settings.defaultQuality === q
                    ? 'bg-white text-[#0E1111] shadow-xs'
                    : 'text-[#475467] hover:text-[#0E1111]'
                }`}
              >
                {q}
              </button>
            ))}
          </div>
        </div>

        <div className="p-6 flex items-center justify-between gap-4">
          <div>
            <div className="text-sm font-bold text-[#0E1111]">إظهار تلميحات المنصات المدعومة</div>
            <div className="text-xs text-[#475467] mt-0.5">
              عرض قائمة المنصات أسفل مربع إدخال الرابط في الواجهة الرئيسية
            </div>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={settings.showPlatformHints}
            onClick={() =>
              onUpdateSettings({ showPlatformHints: !settings.showPlatformHints })
            }
            className={`w-12 h-7 rounded-full transition-colors p-1 cursor-pointer shrink-0 ${
              settings.showPlatformHints ? 'bg-emerald-600' : 'bg-[#D0D5DD]'
            }`}
          >
            <span
              className={`block w-5 h-5 rounded-full bg-white transition-transform ${
                settings.showPlatformHints ? '-translate-x-5' : 'translate-x-0'
              }`}
            />
          </button>
        </div>

        <div className="p-6 flex items-center justify-between gap-4">
          <div>
            <div className="text-sm font-bold text-[#0E1111]">معرّف الجلسة المحلي (بدون حساب)</div>
            <div className="text-xs text-[#475467] mt-0.5">
              يُستخدم فقط لربط تنزيلاتك دون طلب بريد إلكتروني أو كلمة مرور
            </div>
          </div>
          <code className="px-3 py-1.5 rounded-lg bg-[#F6F7F8] border border-[#E4E7EC] font-mono text-xs text-[#0E1111]">
            {clientId}
          </code>
        </div>

        <div className="p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="text-sm font-bold text-[#0E1111]">إدارة سجل التنزيلات</div>
            <div className="text-xs text-[#475467] mt-0.5">
              حذف كافة السجلات المحفوظة في قاعدة بيانات التطبيق
            </div>
          </div>
          <button
            type="button"
            onClick={onClearHistory}
            className="min-h-[44px] px-4 py-2 rounded-xl border border-red-200 text-red-700 hover:bg-red-50 text-xs font-semibold flex items-center gap-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Trash2 className="w-4 h-4" />
            <span>مسح سجل التنزيلات</span>
          </button>
        </div>
      </div>
    </div>
  );
}
