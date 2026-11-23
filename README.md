# حمّلها | HAMILHA (Web + Backend + Android + iPhone iOS)
**حمّلها.. كل ملفاتك بمكان واحد.**

مشروع يتكوّن من:
1. **واجهة ويب عربية (`RTL`)** مبنية بـ React + TypeScript + Tailwind CSS v4.
2. **خادم خلفي (`Node.js 22.5+` + Express + `node:sqlite`)** لتحليل الروابط، حفظ التنزيلات المعزولة لكل جلسة، إدارة التنظيف التلقائي، لوحة تحكم الإدارة، وربط WhatsApp Business Cloud API.
3. **تطبيق Flutter موحّد (`flutter_app/`)** لأنظمة Android و iOS يدعم حفظ الوسائط في الألبوم، المشاركة، الإشعارات المحلية، وسجل تنزيلات معزول لكل جهاز.

---

## هيكل المشروع

```text
├── server.ts                  # نقطة تشغيل Express (يدعم process.env.PORT وVite للتطوير وdist للإنتاج)
├── server/
│   ├── security.ts            # جلسات العملاء الموقّعة (HMAC-SHA256)، CORS الصارم، وتحديد معدل الطلبات
│   ├── db.ts                  # قاعدة بيانات SQLite (node:sqlite) + التنظيف التلقائي للملفات
│   ├── analyzer.ts            # تحليل الروابط وحماية الشبكة الداخلية والتحقق من روابط الوسائط
│   ├── whatsapp.ts            # Webhook واتساب الرسمي (مع تحقق توقيع Meta) + محاكي تطوير معزول
│   ├── admin.ts               # مصادقة الإدارة + لوحة الإحصائيات وإدارة الأخطاء
│   └── flutter_bundle.ts      # استعراض وتصدير ملفات Flutter
├── src/                       # واجهة React + TypeScript
├── flutter_app/               # تطبيق Flutter (Android + iOS)
├── Dockerfile                 # صورة Docker جاهزة للإنتاج على Node 22+
├── .env.example               # قالب متغيرات البيئة (بدون أسرار حقيقية)
└── package.json
```

---

## 1. القدرة الفعلية لتنزيل المنصات والقيود المهمة (بوضوح كامل)

لا يدّعي هذا المشروع وجود أدوات تجاوز أو استخراج غير رسمية؛ التنفيذ الفعلي الحالي في `server/analyzer.ts` هو كما يلي:

| المصدر / المنصة | السلوك الفعلي في الكود الحالي | القيود والملاحظات |
| :--- | :--- | :--- |
| **الروابط المباشرة** (`MP4`, `WEBM`, `MP3`, `M4A`, `JPG`, `PNG`, `WEBP`, `PDF`) | **تنزيل حقيقي وكامل** مع التحقق من نوع الملف وحجمه. | يعمل مباشرة ومناسب تماماً للنشر على المتاجر أو الويب. |
| **WhatsApp Business Cloud API** | **استقبال وحفظ حقيقي** للصور والفيديو والصوت والمستندات المرسلة للبوت. | يتطلب ربط مفاتيح Meta Cloud API ورابط `HTTPS` عام للخادم. |
| **YouTube** | **بيانات وصفية + صورة الغلاف الرسمية (`JPG`) فقط** عبر `oEmbed`. | **لا يوجد تنزيل لفيديو يوتيوب** التزاماً بسياسات يوتيوب ومتاجر التطبيقات. |
| **TikTok / Instagram / Facebook** | **محاولة قراءة عامة (`oEmbed` / HTML عام) فقط**؛ إن لم يتوفر رابط وسائط مباشر عام يُرجع التطبيق رسالة توضيح واضحة. | غالباً تحجب هذه المنصات الطلبات المباشرة من الخوادم أو تطلب تسجيل دخول، لذا لا يُضمن عملها بدون خدمة استخراج خارجية (مع مراعاة حقوق الملكية وسياسات المتاجر). |

### سياسات المتاجر (Google Play و Apple App Store)
- ترفض كل من **Google Play** و **Apple App Store** التطبيقات التي تتيح أو تُسوَّق لتنزيل الفيديوهات من YouTube أو TikTok أو Instagram أو Facebook بدون ترخيص.
- للنشر الرسمي في المتاجر يجب:
  1. تقديم التطبيق كـ **مدير تنزيل للملفات والوسائط المباشرة المرخصة + أرشفة ملفات بوت واتساب**.
  2. توفير رابط **سياسة الخصوصية (Privacy Policy)** وشروط الاستخدام داخل المتجر والتطبيق.
  3. في Android، مراجعة صلاحيات `READ_MEDIA_*` عند تقديم استمارة Google Play (حفظ الملفات عبر MediaStore لا يحتاج قراءة المعرض بالكامل).

---

## 2. عزل سجل التنزيلات والأمان

- **لا يثق الخادم بمعرّفات خام قابلة للتزوير** (مثل `X-Client-Id` أو `localStorage`).
- يُصدر الخادم عبر `/api/session` **معرّف جلسة عشوائياً (`cid_...`) موقّعاً رقمياً بـ HMAC-SHA256**:
  - **على الويب:** يُحفظ داخل Cookie من نوع `HttpOnly` (مع `Secure; SameSite=None; Partitioned` عبر HTTPS) ولا يُخزَّن في `localStorage`، مع التحقق من `Origin` / `X-Requested-With` في طلبات التعديل.
  - **على Flutter:** يُحفظ الرمز الموقّع على الجهاز ويُرسل في ترويسة `X-Client-Token`.
- جميع نقاط النهاية (`GET /api/downloads`، `GET /api/downloads/:id/file`، `DELETE /api/downloads/:id`، `DELETE /api/downloads`) مقيدة بصاحب الجلسة فقط، بينما تستخدم روابط وسائط بوت واتساب المرسلة لـ Meta رمز وصول مؤقتاً موقّعاً (`?ft=...`).
- **ملاحظة معمارية:** هذا العزل يربط السجل بالجهاز/المتصفح دون طلب تسجيل حساب. إذا أردت لاحقاً مزامنة السجل بين عدة أجهزة لنفس المستخدم، ستحتاج لإضافة نظام حسابات مستخدمين (مثل Firebase Auth أو تسجيل دخول بالبريد الإلكتروني).

---

## 3. متطلبات التخزين الدائم والتنظيف التلقائي

- يخزّن الخادم قاعدة بيانات SQLite (`hamilha.db`) والملفات المؤقتة داخل المسار `DATA_DIR` (افتراضياً `./data`).
- يعمل منظّف تلقائي عند الإقلاع وبشكل دوري (`CLEANUP_INTERVAL_MINUTES=30`) لـ:
  - حذف الملفات والسجلات الأقدم من `DOWNLOAD_TTL_HOURS` (افتراضياً 24 ساعة).
  - تفريغ أقدم الملفات تلقائياً إذا تجاوز إجمالي الحجم `MAX_STORAGE_MB` (افتراضياً 500 MB).
  - إزالة أي ملفات يتيمة على القرص.
- **مهم عند الاستضافة السحابية:**
  - على المنصات مثل **Render / Railway / Fly.io** يجب ربط **قرص تخزين دائم (Persistent Disk / Volume)** وتوجيه `DATA_DIR` إليه (مثلاً `/app/data`) وتشغيل **نسخة واحدة (Single Instance)** لأن SQLite يعتمد على ملف محلي.
  - على الاستضافات عديمة الحالة مثل **Cloud Run** أو عند التوسع لعدة نسخ (Horizontal Scaling)، يُنصح بالانتقال إلى قاعدة بيانات خارجية (PostgreSQL/Firestore) وتخزين ملفات سحابي (GCS/S3).

---

## 4. التشغيل والنشر (Node.js 22.5+ أو Docker)

### متغيرات البيئة المطلوبة (على الخادم فقط — لا ترفع أسراراً للمستودع)
| المتغير | إلزامي؟ | الوصف |
| :--- | :--- | :--- |
| `PORT` | اختياري | منفذ الخادم (الافتراضي `3000`، وتمرره منصات الاستضافة تلقائياً). |
| `APP_URL` | موصى به | رابط الخادم العام `HTTPS` (مطلوب لروابط وسائط واتساب وCORS). |
| `SESSION_SECRET` | **مهم للإنتاج** | مفتاح عشوائي طويل (32+ حرفاً) لتوقيع جلسات الإدارة والعملاء؛ عند غيابه يُولَّد مفتاح مؤقت بالذاكرة وتُفقد الجلسات عند إعادة التشغيل. |
| `ADMIN_PASSCODE` | موصى به | كلمة مرور لوحة الإدارة؛ إن تُركت فارغة يظهر نموذج تعيين أولي لمرة واحدة. |
| `CORS_ALLOWED_ORIGINS` | عند فصل الواجهة | قائمة النطاقات المسموح لها مفصولة بفاصلة (مثال: `https://app.yourdomain.com`). |
| `DATA_DIR` | اختياري | مسار التخزين الدائم لقاعدة SQLite والملفات (افتراضياً `./data`). |
| `DOWNLOAD_TTL_HOURS` / `MAX_STORAGE_MB` | اختياري | مدة الاحتفاظ بالملفات (افتراضياً `24` ساعة) وسقف التخزين (`500` MB). |
| `WHATSAPP_VERIFY_TOKEN` | للبوت الحقيقي | رمز تحقق Meta Webhook. |
| `WHATSAPP_ACCESS_TOKEN` | للبوت الحقيقي | رمز وصول Meta Graph API. |
| `WHATSAPP_PHONE_NUMBER_ID` | للبوت الحقيقي | معرّف رقم الهاتف في Meta Cloud API. |
| `WHATSAPP_APP_SECRET` | موصى به للبوت | للتحقق التشفيري من ترويسة `X-Hub-Signature-256` في Webhook. |
| `WHATSAPP_BUSINESS_PHONE` | للبوت الحقيقي | رقم واتساب البوت بصيغة دولية أرقام فقط لزر المحادثة. |
| `ENABLE_WHATSAPP_SIMULATOR` | اختياري | القيمة الافتراضية `false` في الإنتاج (`NODE_ENV=production`) لتعطيل المحاكي العام. |

### التشغيل المحلي (يتطلب Node.js `>=22.5.0`)
```bash
npm install
cp .env.example .env
npm run dev        # التطوير
npm run lint       # فحص TypeScript
npm run build      # بناء الإنتاج
npm start          # تشغيل الإنتاج (NODE_ENV=production node server.ts)
```

### التشغيل عبر Docker
```bash
docker build -t hamilha-server .
docker run -p 3000:3000 -v hamilha_data:/app/data --env-file .env hamilha-server
```

---

## 5. بناء تطبيق الموبايل (Flutter — Android & iOS)

**المتطلبات:** **Flutter SDK `3.29+`** (Dart `3.7+` بسبب استخدام `CardThemeData` في `app_theme.dart`)، Java 17، وAndroid Studio (ولنظام iOS: macOS + Xcode 15+ + CocoaPods).

> في نسخ الإصدار (`--release`) يتم تلقائياً **إخفاء أدوات التطوير** (تعديل رابط الخادم ومحاكي واتساب) عند تمرير `HAMILHA_API_URL`.

### Android (APK و AAB)
1. استبدل معرّف التطبيق الافتراضي `com.hamilha.app` بمعرّفك الفريد (بتمرير `-PHAMILHA_APP_ID=com.yourcompany.hamilha` أو تعديل `build.gradle.kts` و`MainActivity.kt`).
2. أنشئ مفتاح التوقيع محلياً (خارج المستودع) وانسخ `flutter_app/android/key.properties.example` إلى `flutter_app/android/key.properties`.
   - بناء `appbundle` (Google Play) سيرفض التوقيع بمفتاح `debug` تلقائياً إذا لم يكن `key.properties` مضبوطاً (لحماية النشر).
3. أوامر البناء:
```bash
cd flutter_app
flutter pub get

# للتجربة المحلية:
flutter run --dart-define=HAMILHA_API_URL=https://api.yourdomain.com

# APK للتثبيت المباشر:
flutter build apk --release --dart-define=HAMILHA_API_URL=https://api.yourdomain.com

# AAB للنشر على Google Play (يتطلب android/key.properties):
flutter build appbundle --release --dart-define=HAMILHA_API_URL=https://api.yourdomain.com
```

### بناء Android APK تلقائياً عبر GitHub Actions (بدون تثبيت Flutter على جهازك)
يحتوي المشروع على ملف `.github/workflows/build-android-apk.yml`:
1. بعد رفع المشروع إلى GitHub، افتح تبويب **Actions** ثم اختر **Build Android APK (HAMILHA)**.
2. اضغط **Run workflow** وأدخل رابط خادمك العام في حقل `api_url` (أو احفظه مرة واحدة في `Settings -> Secrets and variables -> Actions -> Variables` باسم `HAMILHA_API_URL`).
3. بعد انتهاء البناء، نزّل ملف **`hamilha-android-apk`** من قسم **Artifacts** وثبّت `app-release.apk` على هاتفك.
4. *(اختياري للنشر على Google Play)*: عند إضافة أسرار التوقيع (`ANDROID_KEYSTORE_BASE64`, `ANDROID_STORE_PASSWORD`, `ANDROID_KEY_PASSWORD`, `ANDROID_KEY_ALIAS`) في **GitHub Secrets**، يبني الـ Workflow تلقائياً ملف **`app-release.aab`** الموقّع رسمياً أيضاً.

### iOS (Xcode و IPA)
1. ثبّت الحزم وCocoaPods:
```bash
cd flutter_app
flutter pub get
cd ios && pod install && cd ..
```
2. افتح `flutter_app/ios/Runner.xcworkspace` في Xcode، اختر `Signing & Capabilities`، حدد حساب Apple Developer وعدّل `Bundle Identifier` من `com.hamilha.app` إلى معرّفك الفريد.
3. شاشة البداية (`LaunchScreen.storyboard`) جاهزة بتصميم «حمّلها»، وتمت إزالة `UIBackgroundModes` غير المستخدمة من `Info.plist`.
4. بناء IPA:
```bash
flutter build ipa --release --dart-define=HAMILHA_API_URL=https://api.yourdomain.com
```
