import { useCallback, useEffect, useState } from 'react';
import {
  Download,
  Home,
  MessageCircle,
  Settings,
  Shield,
  Smartphone,
} from 'lucide-react';
import { AdminDashboardView } from './components/AdminDashboardView.tsx';
import { DownloadsView } from './components/DownloadsView.tsx';
import { FlutterProjectView } from './components/FlutterProjectView.tsx';
import { HomeWorkspace } from './components/HomeWorkspace.tsx';
import { SettingsView } from './components/SettingsView.tsx';
import { WhatsAppBotView } from './components/WhatsAppBotView.tsx';
import type { AppSettings, AppTab, DownloadRecord } from './types.ts';
import { triggerProjectZipDownload } from './utils/downloadZip.ts';

function loadInitialSettings(): AppSettings {
  try {
    const raw = window.localStorage.getItem('hamilha_settings');
    if (raw) {
      return JSON.parse(raw) as AppSettings;
    }
  } catch {
    // Fallback to defaults
  }
  return {
    defaultQuality: '720p',
    autoPasteOnFocus: false,
    confirmBeforeClear: true,
    showPlatformHints: true,
  };
}

export default function App() {
  const [activeTab, setActiveTab] = useState<AppTab>('home');
  const [downloads, setDownloads] = useState<DownloadRecord[]>([]);
  const [clientId, setClientId] = useState<string>('جاري إنشاء جلسة محمية...');
  const [settings, setSettings] = useState<AppSettings>(() => loadInitialSettings());

  const fetchDownloads = useCallback(async () => {
    try {
      const res = await fetch('/api/downloads?limit=40', {
        credentials: 'same-origin',
      });
      if (!res.ok) return;
      const data = await res.json();
      setDownloads(data.downloads || []);
    } catch {
      // Ignore transient network errors
    }
  }, []);

  useEffect(() => {
    let active = true;
    async function initSessionAndHistory() {
      try {
        const res = await fetch('/api/session', {
          method: 'GET',
          credentials: 'same-origin',
        });
        if (res.ok && active) {
          const data = await res.json();
          if (typeof data.clientId === 'string') {
            setClientId(data.clientId);
          }
        }
      } catch {
        if (active) setClientId('جلسة مؤقتة');
      } finally {
        if (active) {
          fetchDownloads();
        }
      }
    }
    initSessionAndHistory();
    return () => {
      active = false;
    };
  }, [fetchDownloads]);

  function handleDownloadCreated(record: DownloadRecord) {
    setDownloads((prev) => [record, ...prev.filter((d) => d.id !== record.id)]);
  }

  async function handleDeleteDownload(id: string) {
    setDownloads((prev) => prev.filter((item) => item.id !== id));
    try {
      await fetch(`/api/downloads/${id}`, {
        method: 'DELETE',
        credentials: 'same-origin',
        headers: { 'X-Requested-With': 'hamilha-web' },
      });
    } catch {
      fetchDownloads();
    }
  }

  async function handleClearAll() {
    setDownloads([]);
    try {
      await fetch('/api/downloads', {
        method: 'DELETE',
        credentials: 'same-origin',
        headers: { 'X-Requested-With': 'hamilha-web' },
      });
    } catch {
      fetchDownloads();
    }
  }

  function handleUpdateSettings(patch: Partial<AppSettings>) {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      try {
        window.localStorage.setItem('hamilha_settings', JSON.stringify(next));
      } catch {
        // Ignore storage error
      }
      return next;
    });
  }

  const navItems: Array<{ id: AppTab; label: string }> = [
    { id: 'home', label: 'الرئيسية' },
    { id: 'downloads', label: 'آخر التنزيلات' },
    { id: 'whatsapp', label: 'بوت واتساب' },
    { id: 'flutter', label: 'Android & iOS' },
    { id: 'settings', label: 'الإعدادات' },
  ];

  return (
    <div className="min-h-screen flex flex-col bg-[#F6F7F8] text-[#0E1111]">
      {/* Top Bar Contract: 3 zones, single row, gap-8 */}
      <header className="sticky top-0 z-30 bg-white/95 backdrop-blur-md border-b border-[#E4E7EC]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-8">
          {/* Zone 1: Single-element Brand Wordmark */}
          <button
            type="button"
            onClick={() => setActiveTab('home')}
            className="flex items-center gap-2.5 text-[#0E1111] whitespace-nowrap shrink-0 cursor-pointer"
          >
            <svg
              width="28"
              height="28"
              viewBox="0 0 32 32"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
              aria-hidden="true"
            >
              <rect width="32" height="32" rx="9" fill="#059669" />
              <path
                d="M16 8V19M16 19L11.5 14.5M16 19L20.5 14.5M10 23H22"
                stroke="white"
                strokeWidth="2.4"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <span className="font-display text-xl font-bold tracking-tight">
              حمّلها
            </span>
          </button>

          {/* Zone 2: 5 concise single-line nav links */}
          <nav className="hidden md:flex items-center gap-6">
            {navItems.map((item) => {
              const active = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setActiveTab(item.id)}
                  className={`py-1.5 text-sm font-semibold border-b-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    active
                      ? 'border-emerald-600 text-emerald-700'
                      : 'border-transparent text-[#475467] hover:text-[#0E1111]'
                  }`}
                >
                  {item.label}
                </button>
              );
            })}
          </nav>

          {/* Zone 3: 1 Primary Action Button */}
          <div className="shrink-0">
            <button
              type="button"
              onClick={() => setActiveTab('admin')}
              className={`min-h-[40px] px-4 py-2 rounded-xl text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                activeTab === 'admin'
                  ? 'bg-emerald-600 text-white'
                  : 'bg-[#0E1111] hover:bg-black text-white'
              }`}
            >
              لوحة الإدارة
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 py-6 sm:py-10 pb-24 md:pb-12">
        {activeTab === 'home' && (
          <HomeWorkspace
            downloads={downloads}
            settings={settings}
            clientId={clientId}
            onDownloadCreated={handleDownloadCreated}
            onDeleteDownload={handleDeleteDownload}
            onNavigateTab={setActiveTab}
          />
        )}

        {activeTab === 'downloads' && (
          <DownloadsView
            downloads={downloads}
            onDeleteDownload={handleDeleteDownload}
            onClearAll={handleClearAll}
          />
        )}

        {activeTab === 'whatsapp' && (
          <WhatsAppBotView onDownloadCreated={handleDownloadCreated} />
        )}

        {activeTab === 'flutter' && <FlutterProjectView />}

        {activeTab === 'settings' && (
          <SettingsView
            settings={settings}
            clientId={clientId}
            onUpdateSettings={handleUpdateSettings}
            onClearHistory={handleClearAll}
          />
        )}

        {activeTab === 'admin' && <AdminDashboardView />}
      </main>

      {/* Clean Footer */}
      <footer className="hidden md:block bg-white border-t border-[#E4E7EC]">
        <div className="max-w-7xl mx-auto px-6 py-5 flex items-center justify-between text-xs text-[#475467]">
          <span>حمّلها HAMILHA — حمّلها.. كل ملفاتك بمكان واحد.</span>
          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={() => triggerProjectZipDownload()}
              className="font-semibold text-emerald-700 hover:underline cursor-pointer"
            >
              تنزيل المشروع كاملاً (HAMILHA_ANDROID_IOS.zip)
            </button>
            <span aria-hidden="true">·</span>
            <span>متوافق مع المنصات المسموح بها وواتساب وأندرويد وآيفون</span>
          </div>
        </div>
      </footer>

      {/* Mobile Bottom Thumb-Zone Navigation (< md) */}
      <nav
        aria-label="التنقل السريع"
        className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-white/95 backdrop-blur-md border-t border-[#E4E7EC]"
      >
        <div className="grid grid-cols-5 h-16 items-center">
          <button
            type="button"
            onClick={() => setActiveTab('home')}
            className={`min-h-[44px] flex flex-col items-center justify-center gap-0.5 text-[10px] font-semibold ${
              activeTab === 'home' ? 'text-emerald-700' : 'text-[#475467]'
            }`}
          >
            <Home className="w-5 h-5" />
            <span>الرئيسية</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('downloads')}
            className={`min-h-[44px] flex flex-col items-center justify-center gap-0.5 text-[10px] font-semibold ${
              activeTab === 'downloads' ? 'text-emerald-700' : 'text-[#475467]'
            }`}
          >
            <Download className="w-5 h-5" />
            <span>التنزيلات</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('whatsapp')}
            className={`min-h-[44px] flex flex-col items-center justify-center gap-0.5 text-[10px] font-semibold ${
              activeTab === 'whatsapp' ? 'text-emerald-700' : 'text-[#475467]'
            }`}
          >
            <MessageCircle className="w-5 h-5" />
            <span>واتساب</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('flutter')}
            className={`min-h-[44px] flex flex-col items-center justify-center gap-0.5 text-[10px] font-semibold ${
              activeTab === 'flutter' ? 'text-emerald-700' : 'text-[#475467]'
            }`}
          >
            <Smartphone className="w-5 h-5" />
            <span>Flutter</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('settings')}
            className={`min-h-[44px] flex flex-col items-center justify-center gap-0.5 text-[10px] font-semibold ${
              activeTab === 'settings' || activeTab === 'admin'
                ? 'text-emerald-700'
                : 'text-[#475467]'
            }`}
          >
            {activeTab === 'admin' ? (
              <Shield className="w-5 h-5" />
            ) : (
              <Settings className="w-5 h-5" />
            )}
            <span>الإعدادات</span>
          </button>
        </div>
      </nav>
    </div>
  );
}
