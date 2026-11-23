import { useEffect, useRef, useState } from 'react';
import {
  Check,
  Copy,
  Download,
  FileText,
  Image as ImageIcon,
  Loader2,
  MessageCircle,
  Send,
  Video,
} from 'lucide-react';
import type { DownloadRecord, WhatsAppMessage } from '../types.ts';

interface WhatsAppBotViewProps {
  onDownloadCreated: (record: DownloadRecord) => void;
}

export function WhatsAppBotView({ onDownloadCreated }: WhatsAppBotViewProps) {
  const [messages, setMessages] = useState<WhatsAppMessage[]>([]);
  const [botEnabled, setBotEnabled] = useState(true);
  const [cloudApiConfigured, setCloudApiConfigured] = useState(false);
  const [simulatorEnabled, setSimulatorEnabled] = useState(true);
  const [defaultQuality, setDefaultQuality] = useState('720p');
  const [inputText, setInputText] = useState('');
  const [phoneInput, setPhoneInput] = useState('9647701234567');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedWebhook, setCopiedWebhook] = useState(false);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  async function loadMessages() {
    try {
      const res = await fetch('/api/whatsapp/messages', { credentials: 'same-origin' });
      if (!res.ok) return;
      const data = await res.json();
      setMessages(data.messages || []);
      setBotEnabled(Boolean(data.botEnabled));
      setCloudApiConfigured(Boolean(data.cloudApiConfigured));
      setSimulatorEnabled(data.simulatorEnabled !== false);
      setDefaultQuality(data.defaultQuality || '720p');
    } catch {
      // Ignore transient poll error
    }
  }

  useEffect(() => {
    loadMessages();
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  async function sendSimulation(payload: {
    messageType: 'text' | 'image' | 'video' | 'document';
    content: string;
    fileName?: string;
    fileBase64?: string;
    fileMime?: string;
  }) {
    setSending(true);
    setError(null);
    try {
      const res = await fetch('/api/whatsapp/simulate', {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'hamilha-web',
        },
        body: JSON.stringify({
          phone: phoneInput,
          messageType: payload.messageType,
          content: payload.content,
          fileName: payload.fileName,
          fileBase64: payload.fileBase64,
          fileMime: payload.fileMime,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'تعذر إرسال الرسالة إلى البوت.');
        return;
      }
      if (data.download) {
        onDownloadCreated(data.download as DownloadRecord);
      }
      await loadMessages();
      if (payload.messageType === 'text') setInputText('');
    } catch {
      setError('حدث خطأ في الاتصال بخادم البوت.');
    } finally {
      setSending(false);
    }
  }

  async function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > 15 * 1024 * 1024) {
      setError('الحد الأقصى للمحاكاة المباشرة هو 15 ميجابايت.');
      return;
    }

    const type = file.type.startsWith('image/')
      ? 'image'
      : file.type.startsWith('video/')
        ? 'video'
        : 'document';

    const buf = await file.arrayBuffer();
    const bytes = new Uint8Array(buf);
    let binary = '';
    for (let i = 0; i < bytes.length; i += 8192) {
      binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
    }
    const base64 = btoa(binary);

    await sendSimulation({
      messageType: type,
      content: file.name,
      fileName: file.name,
      fileBase64: base64,
      fileMime: file.type || 'application/octet-stream',
    });
  }

  const webhookUrl =
    typeof window !== 'undefined'
      ? `${window.location.origin}/api/whatsapp/webhook`
      : '/api/whatsapp/webhook';

  async function copyWebhookUrl() {
    try {
      await navigator.clipboard.writeText(webhookUrl);
      setCopiedWebhook(true);
      setTimeout(() => setCopiedWebhook(false), 2000);
    } catch {
      // Ignore
    }
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
      {/* Interactive WhatsApp Bot Chat Simulator (7 cols) */}
      <div className="lg:col-span-7 bg-white border border-[#E4E7EC] rounded-2xl overflow-hidden flex flex-col">
        <div className="px-6 py-4 bg-[#0E1111] text-white flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-600 flex items-center justify-center shrink-0">
              <MessageCircle className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="font-display text-base font-bold">
                {cloudApiConfigured ? 'بوت واتساب حمّلها' : 'محاكي اختبار بوت واتساب (بيئة تجريبية)'}
              </h1>
              <div className="text-xs text-white/75 flex items-center gap-2">
                <span>
                  {cloudApiConfigured
                    ? botEnabled
                      ? 'متصل بـ Meta Cloud API'
                      : 'البوت متوقف مؤقتاً'
                    : 'مفاتيح Meta غير مفعلة — وضع المحاكاة المحلي'}
                </span>
                <span aria-hidden="true">·</span>
                <span>الجودة الافتراضية: {defaultQuality}</span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <label htmlFor="wa-phone" className="text-xs text-white/75 hidden sm:inline">
              رقم التجربة:
            </label>
            <input
              id="wa-phone"
              type="text"
              dir="ltr"
              value={phoneInput}
              onChange={(e) => setPhoneInput(e.target.value)}
              className="w-32 h-9 px-2.5 rounded-lg bg-white/10 border border-white/20 text-xs font-mono text-white focus:outline-none focus:border-emerald-400"
            />
          </div>
        </div>

        {/* Messages Feed */}
        <div className="h-[420px] overflow-y-auto p-5 bg-[#F6F7F8] space-y-3">
          {messages.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center max-w-md mx-auto space-y-2">
              <MessageCircle className="w-8 h-8 text-emerald-600" />
              <p className="text-sm font-bold text-[#0E1111]">
                ابدأ محادثة مع بوت واتساب
              </p>
              <p className="text-xs text-[#475467] leading-relaxed">
                أرسل رابط فيديو من تيك توك أو يوتيوب أو إنستغرام أو فيسبوك، أو ارفع صورة/فيديو/مستند للبوت ليقوم بمعالجته وإرسال رابط التنزيل.
              </p>
            </div>
          ) : (
            messages.map((msg) => {
              const isOutbound = msg.direction === 'outbound';
              return (
                <div
                  key={msg.id}
                  className={`flex ${isOutbound ? 'justify-end' : 'justify-start'}`}
                >
                  <div
                    className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm space-y-2 ${
                      isOutbound
                        ? 'bg-emerald-600 text-white'
                        : 'bg-white border border-[#E4E7EC] text-[#0E1111]'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-4 text-[11px] opacity-75">
                      <span>{isOutbound ? 'بوت حمّلها' : `أنت (${msg.sender_phone_masked})`}</span>
                      <span className="tabular-nums">
                        {new Date(msg.created_at).toLocaleTimeString('ar-EG', {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>
                    </div>
                    <p className="whitespace-pre-wrap leading-relaxed break-words">
                      {msg.content}
                    </p>
                    {isOutbound && msg.media_url && (
                      <a
                        href={msg.media_url}
                        download
                        className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-[#0E1111] text-white text-xs font-semibold hover:bg-black transition-colors"
                      >
                        <Download className="w-3.5 h-3.5" />
                        <span>تنزيل الملف المُجهّز</span>
                      </a>
                    )}
                  </div>
                </div>
              );
            })
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Quick Send Chips & Input Bar */}
        <div className="p-4 bg-white border-t border-[#E4E7EC] space-y-3">
          {!simulatorEnabled && (
            <div className="p-2.5 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-900">
              محاكي الاختبار معطّل في بيئة الإنتاج. للتشغيل الفعلي استخدم رقم بوت WhatsApp Business Cloud API المرتبط بالخادم.
            </div>
          )}
          {error && (
            <div className="p-2.5 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700">
              {error}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() =>
                sendSimulation({
                  messageType: 'text',
                  content: 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4',
                })
              }
              disabled={sending}
              className="min-h-[36px] px-3 py-1.5 rounded-lg bg-[#F2F4F7] hover:bg-[#E4E7EC] text-xs font-medium text-[#0E1111] transition-colors cursor-pointer"
            >
              إرسال رابط MP4 مباشر
            </button>
            <button
              type="button"
              onClick={() =>
                sendSimulation({
                  messageType: 'text',
                  content: 'https://www.tiktok.com/@scout2015/video/6718335390845095173',
                })
              }
              disabled={sending}
              className="min-h-[36px] px-3 py-1.5 rounded-lg bg-[#F2F4F7] hover:bg-[#E4E7EC] text-xs font-medium text-[#0E1111] transition-colors cursor-pointer"
            >
              إرسال رابط تيك توك
            </button>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={sending}
              className="min-h-[36px] px-3 py-1.5 rounded-lg border border-[#D0D5DD] hover:bg-[#F9FAFB] text-xs font-semibold text-[#0E1111] flex items-center gap-1.5 transition-colors cursor-pointer"
            >
              <ImageIcon className="w-3.5 h-3.5 text-emerald-700" />
              <span>إرسال صورة / فيديو / مستند للبوت</span>
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*,video/*,.pdf"
              onChange={handleFileSelected}
              className="hidden"
            />
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (inputText.trim()) {
                sendSimulation({ messageType: 'text', content: inputText.trim() });
              }
            }}
            className="flex items-center gap-2.5"
          >
            <input
              type="text"
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              placeholder="اكتب رسالة أو الصق رابط فيديو لإرساله للبوت..."
              className="flex-1 h-12 px-4 rounded-xl border border-[#D0D5DD] bg-[#F9FAFB] text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600 focus:bg-white"
            />
            <button
              type="submit"
              disabled={sending || !inputText.trim()}
              className="min-h-[48px] px-5 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-semibold text-sm flex items-center gap-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              <span>إرسال</span>
            </button>
          </form>
        </div>
      </div>

      {/* WhatsApp Business Cloud API Integration Info (5 cols) */}
      <div className="lg:col-span-5 space-y-6">
        <div className="bg-white border border-[#E4E7EC] rounded-2xl p-6 space-y-4">
          <h2 className="font-display text-lg font-bold text-[#0E1111]">
            ربط WhatsApp Business Cloud API
          </h2>
          <p className="text-sm text-[#475467] leading-relaxed">
            يعمل الخادم بنقطة Webhook حقيقية متوافقة مع منصة Meta للمطورين لاستقبال الروابط والصور والفيديوهات والمستندات والرد تلقائياً.
          </p>

          <div className="space-y-2 pt-2">
            <div className="text-xs font-semibold text-[#0E1111]">رابط Webhook الخادم</div>
            <div className="flex items-center gap-2">
              <code
                dir="ltr"
                className="flex-1 px-3 py-2.5 rounded-xl bg-[#F6F7F8] border border-[#E4E7EC] font-mono text-xs text-[#0E1111] truncate"
              >
                {webhookUrl}
              </code>
              <button
                type="button"
                onClick={copyWebhookUrl}
                className="min-h-[40px] px-3 rounded-xl border border-[#D0D5DD] hover:bg-[#F9FAFB] text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
              >
                {copiedWebhook ? <Check className="w-4 h-4 text-emerald-700" /> : <Copy className="w-4 h-4" />}
                <span>{copiedWebhook ? 'تم النسخ' : 'نسخ'}</span>
              </button>
            </div>
          </div>

          <div className="pt-2 space-y-2 text-xs text-[#475467] border-t border-[#E4E7EC]">
            <div className="flex items-center justify-between pt-2">
              <span>حالة مفاتيح Meta Cloud API</span>
              <span className={`font-semibold ${cloudApiConfigured ? 'text-emerald-700' : 'text-[#0E1111]'}`}>
                {cloudApiConfigured ? 'مفعّلة عبر الخادم' : 'وضع المحاكاة المحلي نشط'}
              </span>
            </div>
            <p className="leading-relaxed">
              لتفعيل الإرسال الفعلي إلى أرقام واتساب حقيقية، أضف المتغيرات{' '}
              <span className="font-mono text-[#0E1111]">WHATSAPP_VERIFY_TOKEN</span> و{' '}
              <span className="font-mono text-[#0E1111]">WHATSAPP_ACCESS_TOKEN</span> و{' '}
              <span className="font-mono text-[#0E1111]">WHATSAPP_PHONE_NUMBER_ID</span> في إعدادات الأسرار بالخادم.
            </p>
          </div>
        </div>

        <div className="bg-white border border-[#E4E7EC] rounded-2xl p-6 space-y-3">
          <h3 className="font-display text-base font-bold text-[#0E1111]">
            ما يستقبله البوت من المستخدم
          </h3>
          <ul className="space-y-2.5 text-sm text-[#475467]">
            <li className="flex items-center gap-2.5">
              <Video className="w-4 h-4 text-emerald-700 shrink-0" />
              <span>روابط الوسائط المباشرة (MP4/JPG/MP3/PDF) ومعاينة الروابط العامة المسموح بها</span>
            </li>
            <li className="flex items-center gap-2.5">
              <ImageIcon className="w-4 h-4 text-emerald-700 shrink-0" />
              <span>الصور ومقاطع الفيديو المرسلة مباشرة من هاتف المستخدم</span>
            </li>
            <li className="flex items-center gap-2.5">
              <FileText className="w-4 h-4 text-emerald-700 shrink-0" />
              <span>المستندات والملفات (PDF وغيرها) لحفظها في سجل حمّلها</span>
            </li>
          </ul>
        </div>
      </div>
    </div>
  );
}
