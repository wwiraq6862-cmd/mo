import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'package:flutter/foundation.dart';
import 'package:gal/gal.dart';
import 'package:http/http.dart' as http;
import 'package:path_provider/path_provider.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../models/media_item.dart';
import 'notification_service.dart';

class SavedMediaResult {
  final File file;
  final bool savedToGallery;
  final String downloadId;

  SavedMediaResult({
    required this.file,
    required this.savedToGallery,
    required this.downloadId,
  });
}

class ServerConnectionResult {
  final bool ok;
  final String message;
  final int? latencyMs;

  ServerConnectionResult({required this.ok, required this.message, this.latencyMs});
}

class WhatsAppBotStatus {
  final bool botEnabled;
  final bool cloudApiConfigured;
  final bool simulatorEnabled;
  final String botPhoneNumber;

  WhatsAppBotStatus({
    required this.botEnabled,
    required this.cloudApiConfigured,
    required this.simulatorEnabled,
    required this.botPhoneNumber,
  });
}

class HamilhaApiService {
  // يجب تمرير عنوان HTTPS العام للخادم المنشور عند البناء:
  // flutter build apk --release --dart-define=HAMILHA_API_URL=https://api.yourdomain.com
  static const String buildTimeBaseUrl = String.fromEnvironment(
    'HAMILHA_API_URL',
    defaultValue: '',
  );

  // إخفاء أدوات التطوير (تعديل الخادم / محاكي البوت) تلقائياً في نسخ Release
  // إلا إذا تم تفعيلها صراحة عبر --dart-define=HAMILHA_DEV_TOOLS=true
  static const bool enableDevTools = bool.fromEnvironment(
    'HAMILHA_DEV_TOOLS',
    defaultValue: false,
  );

  static const String _sessionTokenKey = 'client_session_token';
  static const String _localFilesMapKey = 'local_downloaded_files_map';

  bool get showDevTools => kDebugMode || enableDevTools;

  Future<String> getBaseUrl() async {
    if (showDevTools || buildTimeBaseUrl.isEmpty) {
      final prefs = await SharedPreferences.getInstance();
      final custom = prefs.getString('custom_api_url')?.trim();
      if (custom != null && custom.startsWith('http')) {
        return custom.replaceAll(RegExp(r'/$'), '');
      }
    }
    return buildTimeBaseUrl.replaceAll(RegExp(r'/$'), '');
  }

  Future<void> setCustomBaseUrl(String url) async {
    final prefs = await SharedPreferences.getInstance();
    final cleaned = url.trim().replaceAll(RegExp(r'/$'), '');
    if (cleaned.isEmpty) {
      await prefs.remove('custom_api_url');
    } else {
      await prefs.setString('custom_api_url', cleaned);
    }
    // Reset server-signed session token when switching backend servers
    await prefs.remove(_sessionTokenKey);
  }

  Future<String> _requireBaseUrl() async {
    final url = await getBaseUrl();
    if (url.isEmpty) {
      throw Exception(
        'لم يتم ضبط عنوان الخادم العام بعد. افتح تبويب الإعدادات وأدخل رابط خادم Node.js (HTTPS).',
      );
    }
    return url;
  }

  Future<String?> _getStoredSessionToken() async {
    final prefs = await SharedPreferences.getInstance();
    final token = prefs.getString(_sessionTokenKey)?.trim();
    if (token != null && token.isNotEmpty) return token;
    return null;
  }

  Future<void> _saveSessionToken(String token) async {
    if (token.trim().isEmpty) return;
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_sessionTokenKey, token.trim());
  }

  /// Ensures this device holds a server-signed anonymous session token so download
  /// history is strictly isolated per device and cannot be forged via raw headers.
  Future<String> _ensureSessionToken(String baseUrl) async {
    final existing = await _getStoredSessionToken();
    if (existing != null) return existing;

    final res = await http
        .post(
          Uri.parse('$baseUrl/api/session'),
          headers: {'Content-Type': 'application/json'},
        )
        .timeout(const Duration(seconds: 10));

    if (res.statusCode >= 400) {
      throw Exception('تعذر إنشاء جلسة آمنة مع الخادم (HTTP ${res.statusCode}).');
    }

    final headerToken = res.headers['x-client-token']?.trim();
    final body = jsonDecode(res.body) as Map<String, dynamic>;
    final token = (body['token'] as String?)?.trim() ?? headerToken ?? '';
    if (token.isEmpty) {
      throw Exception('لم يُصدر الخادم رمز جلسة صالحاً.');
    }
    await _saveSessionToken(token);
    return token;
  }

  Future<void> _captureRefreshedToken(http.Response res) async {
    final refreshed = res.headers['x-client-token']?.trim();
    if (refreshed != null && refreshed.isNotEmpty) {
      await _saveSessionToken(refreshed);
    }
  }

  Future<Map<String, String>> _authHeaders(String baseUrl, {bool json = true}) async {
    final token = await _ensureSessionToken(baseUrl);
    return {
      if (json) 'Content-Type': 'application/json',
      'X-Client-Token': token,
    };
  }

  Future<Map<String, String>> _loadLocalFilesMap() async {
    final prefs = await SharedPreferences.getInstance();
    final raw = prefs.getString(_localFilesMapKey);
    if (raw == null || raw.isEmpty) return {};
    try {
      final decoded = jsonDecode(raw) as Map<String, dynamic>;
      return decoded.map((k, v) => MapEntry(k, v.toString()));
    } catch (_) {
      return {};
    }
  }

  Future<void> _saveLocalFilePath(String downloadId, String filePath) async {
    final prefs = await SharedPreferences.getInstance();
    final map = await _loadLocalFilesMap();
    map[downloadId] = filePath;
    await prefs.setString(_localFilesMapKey, jsonEncode(map));
  }

  Future<String?> getLocalFilePath(String downloadId) async {
    final map = await _loadLocalFilesMap();
    final p = map[downloadId];
    if (p == null || p.isEmpty) return null;
    if (await File(p).exists()) return p;
    return null;
  }

  Future<void> _removeLocalFilePath(String downloadId) async {
    final prefs = await SharedPreferences.getInstance();
    final map = await _loadLocalFilesMap();
    final existingPath = map.remove(downloadId);
    await prefs.setString(_localFilesMapKey, jsonEncode(map));
    if (existingPath != null && existingPath.isNotEmpty) {
      try {
        final f = File(existingPath);
        if (await f.exists()) {
          await f.delete();
        }
      } catch (_) {
        // Ignore local delete failure
      }
    }
  }

  Future<ServerConnectionResult> testServerConnection([String? overrideUrl]) async {
    final raw = (overrideUrl ?? await getBaseUrl()).trim().replaceAll(RegExp(r'/$'), '');
    if (raw.isEmpty) {
      return ServerConnectionResult(
        ok: false,
        message: 'لم يتم إدخال عنوان الخادم. يرجى إدخال رابط HTTPS عام للخادم.',
      );
    }
    if (!raw.startsWith('https://') && !raw.startsWith('http://')) {
      return ServerConnectionResult(
        ok: false,
        message: 'يجب أن يبدأ رابط الخادم بـ https://',
      );
    }

    final sw = Stopwatch()..start();
    try {
      final res = await http
          .get(Uri.parse('$raw/api/health'))
          .timeout(const Duration(seconds: 7));
      sw.stop();

      if (res.statusCode == 403) {
        return ServerConnectionResult(
          ok: false,
          message: 'رفض الخادم الوصول (403). تأكد من أن الرابط عام وليس رابط معاينة محمياً.',
        );
      }
      if (res.statusCode != 200) {
        return ServerConnectionResult(
          ok: false,
          message: 'استجابة غير متوقعة من الخادم (HTTP ${res.statusCode}).',
        );
      }
      final body = jsonDecode(res.body) as Map<String, dynamic>;
      if (body['ok'] == true) {
        return ServerConnectionResult(
          ok: true,
          message: 'الاتصال بالخادم يعمل بنجاح.',
          latencyMs: sw.elapsedMilliseconds,
        );
      }
      return ServerConnectionResult(ok: false, message: 'الخدمة غير جاهزة.');
    } on TimeoutException {
      return ServerConnectionResult(
        ok: false,
        message: 'انتهت مهلة الاتصال بالخادم. تحقق من الإنترنت أو عنوان الخادم.',
      );
    } catch (_) {
      return ServerConnectionResult(
        ok: false,
        message: 'تعذر الوصول إلى الخادم. تأكد من تشغيل الخادم واتصالك بالشبكة.',
      );
    }
  }

  Future<AnalyzedMedia> analyzeUrl(String url) async {
    final baseUrl = await _requireBaseUrl();
    try {
      final headers = await _authHeaders(baseUrl);
      final res = await http
          .post(
            Uri.parse('$baseUrl/api/analyze'),
            headers: headers,
            body: jsonEncode({'url': url.trim(), 'source': 'flutter'}),
          )
          .timeout(const Duration(seconds: 15));
      await _captureRefreshedToken(res);

      if (res.statusCode == 403) {
        throw Exception('الخادم يرفض الوصول (403). استخدم رابط HTTPS عاماً دائماً في الإعدادات.');
      }
      final body = jsonDecode(res.body) as Map<String, dynamic>;
      if (res.statusCode >= 400) {
        throw Exception(body['error'] ?? 'تعذر تحليل الرابط');
      }
      return AnalyzedMedia.fromJson(body);
    } on TimeoutException {
      throw Exception('انقطع الاتصال أو تأخر الخادم أثناء تحليل الرابط.');
    } on SocketException {
      throw Exception('تعذر الاتصال بالخادم. تحقق من اتصال الإنترنت وعنوان الخادم في الإعدادات.');
    }
  }

  Future<SavedMediaResult> downloadAndSaveMedia({
    required AnalyzedMedia media,
    required QualityOption quality,
  }) async {
    if (quality.streamUrl.isEmpty) {
      throw Exception('لا يتوفر رابط ملف حقيقي قابل للتنزيل لهذه الجودة.');
    }

    final baseUrl = await _requireBaseUrl();
    final prefs = await SharedPreferences.getInstance();
    final saveToGallery = prefs.getBool('save_to_gallery') ?? true;
    final notifyEnabled = prefs.getBool('enable_notifications') ?? true;
    final headers = await _authHeaders(baseUrl);

    final regRes = await http
        .post(
          Uri.parse('$baseUrl/api/downloads'),
          headers: headers,
          body: jsonEncode({
            'url': media.url,
            'streamUrl': quality.streamUrl,
            'platform': media.platform,
            'title': media.title,
            'author': media.author,
            'thumbnailUrl': media.thumbnailUrl,
            'mediaType': quality.mediaType,
            'quality': quality.id,
            'source': 'flutter',
          }),
        )
        .timeout(const Duration(seconds: 40));
    await _captureRefreshedToken(regRes);

    final regData = jsonDecode(regRes.body) as Map<String, dynamic>;
    if (regRes.statusCode >= 400) {
      throw Exception(regData['error'] ?? 'فشل تنزيل الملف الأصلي على الخادم.');
    }

    final downloadMap = regData['download'] as Map<String, dynamic>? ?? {};
    final downloadId = downloadMap['id'] as String? ?? '';
    final filePathUrl = regData['fileUrl'] as String;
    final fileHeaders = await _authHeaders(baseUrl, json: false);
    final fileBytesRes = await http
        .get(Uri.parse('$baseUrl$filePathUrl'), headers: fileHeaders)
        .timeout(const Duration(seconds: 40));

    if (fileBytesRes.statusCode != 200 || fileBytesRes.bodyBytes.isEmpty) {
      throw Exception('فشل تنزيل بيانات الملف من الخادم.');
    }

    final dir = await getApplicationDocumentsDirectory();
    final safeTs = DateTime.now().millisecondsSinceEpoch;
    final localFile = File('${dir.path}/hamilha_${media.platform}_$safeTs.${quality.format}');
    await localFile.writeAsBytes(fileBytesRes.bodyBytes);

    if (downloadId.isNotEmpty) {
      await _saveLocalFilePath(downloadId, localFile.path);
    }

    bool savedToGallery = false;
    if (saveToGallery &&
        (quality.format == 'mp4' ||
            quality.format == 'jpg' ||
            quality.format == 'png' ||
            quality.format == 'webp')) {
      try {
        final hasAccess = await Gal.hasAccess(toAlbum: true);
        if (!hasAccess) {
          await Gal.requestAccess(toAlbum: true);
        }
        if (quality.format == 'mp4') {
          await Gal.putVideo(localFile.path, album: 'HAMILHA');
        } else {
          await Gal.putImage(localFile.path, album: 'HAMILHA');
        }
        savedToGallery = true;
      } catch (_) {
        savedToGallery = false;
      }
    }

    if (notifyEnabled) {
      await NotificationService.instance.showDownloadComplete(
        title: media.title,
        quality: quality.id,
      );
    }

    return SavedMediaResult(
      file: localFile,
      savedToGallery: savedToGallery,
      downloadId: downloadId,
    );
  }

  /// Ensures a downloaded file exists locally for sharing/opening from history.
  Future<File> ensureLocalFileForRecord(DownloadRecord record) async {
    final cachedPath = await getLocalFilePath(record.id);
    if (cachedPath != null) {
      return File(cachedPath);
    }

    final baseUrl = await _requireBaseUrl();
    final headers = await _authHeaders(baseUrl, json: false);
    final res = await http
        .get(Uri.parse('$baseUrl/api/downloads/${record.id}/file'), headers: headers)
        .timeout(const Duration(seconds: 40));

    if (res.statusCode != 200 || res.bodyBytes.isEmpty) {
      throw Exception('تعذر جلب الملف من الخادم (قد يكون تم حذفه ضمن التنظيف التلقائي).');
    }

    final ext = _inferExtension(record);
    final dir = await getApplicationDocumentsDirectory();
    final safeId = record.id.replaceAll(RegExp(r'[^a-zA-Z0-9-]'), '');
    final localFile = File('${dir.path}/hamilha_${record.platform}_$safeId.$ext');
    await localFile.writeAsBytes(res.bodyBytes);
    await _saveLocalFilePath(record.id, localFile.path);
    return localFile;
  }

  String _inferExtension(DownloadRecord record) {
    switch (record.mediaType) {
      case 'image':
        return 'jpg';
      case 'audio':
        return 'mp3';
      case 'document':
        return 'pdf';
      default:
        return 'mp4';
    }
  }

  Future<List<DownloadRecord>> fetchHistory() async {
    final baseUrl = await getBaseUrl();
    if (baseUrl.isEmpty) return [];
    try {
      final token = await _getStoredSessionToken();
      if (token == null) return [];
      final res = await http
          .get(
            Uri.parse('$baseUrl/api/downloads?limit=30'),
            headers: {'X-Client-Token': token},
          )
          .timeout(const Duration(seconds: 10));
      if (res.statusCode != 200) return [];
      final data = jsonDecode(res.body) as Map<String, dynamic>;
      final rows = data['downloads'] as List<dynamic>? ?? [];
      return rows.map((e) => DownloadRecord.fromJson(e as Map<String, dynamic>)).toList();
    } catch (_) {
      return [];
    }
  }

  Future<bool> deleteDownload(String downloadId) async {
    final baseUrl = await _requireBaseUrl();
    final headers = await _authHeaders(baseUrl, json: false);
    final res = await http
        .delete(Uri.parse('$baseUrl/api/downloads/$downloadId'), headers: headers)
        .timeout(const Duration(seconds: 10));

    if (res.statusCode == 200 || res.statusCode == 404) {
      await _removeLocalFilePath(downloadId);
      return true;
    }
    final body = jsonDecode(res.body) as Map<String, dynamic>;
    throw Exception(body['error'] ?? 'تعذر حذف السجل من الخادم.');
  }

  Future<WhatsAppBotStatus> fetchWhatsAppStatus() async {
    final baseUrl = await _requireBaseUrl();
    final token = await _getStoredSessionToken();
    final res = await http
        .get(
          Uri.parse('$baseUrl/api/whatsapp/messages'),
          headers: token != null ? {'X-Client-Token': token} : const {},
        )
        .timeout(const Duration(seconds: 10));
    if (res.statusCode != 200) {
      throw Exception('تعذر جلب حالة بوت واتساب من الخادم.');
    }
    final data = jsonDecode(res.body) as Map<String, dynamic>;
    return WhatsAppBotStatus(
      botEnabled: data['botEnabled'] as bool? ?? false,
      cloudApiConfigured: data['cloudApiConfigured'] as bool? ?? false,
      simulatorEnabled: data['simulatorEnabled'] as bool? ?? false,
      botPhoneNumber: data['botPhoneNumber'] as String? ?? '',
    );
  }

  Future<Map<String, dynamic>> sendWhatsAppBotSimulation({
    required String content,
    String phone = '9647701234567',
  }) async {
    final baseUrl = await _requireBaseUrl();
    final headers = await _authHeaders(baseUrl);
    final res = await http
        .post(
          Uri.parse('$baseUrl/api/whatsapp/simulate'),
          headers: headers,
          body: jsonEncode({
            'phone': phone,
            'messageType': 'text',
            'content': content,
          }),
        )
        .timeout(const Duration(seconds: 30));
    await _captureRefreshedToken(res);
    final body = jsonDecode(res.body) as Map<String, dynamic>;
    if (res.statusCode >= 400) {
      throw Exception(body['error'] ?? 'تعذر إرسال الرسالة إلى محاكي البوت');
    }
    return body;
  }
}
