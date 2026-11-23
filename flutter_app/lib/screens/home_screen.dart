import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:share_plus/share_plus.dart';
import '../models/media_item.dart';
import '../services/api_service.dart';
import '../theme/app_theme.dart';

class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  final TextEditingController _urlController = TextEditingController();
  final HamilhaApiService _api = HamilhaApiService();

  bool _analyzing = false;
  bool _downloading = false;
  bool _serverConfigured = true;
  String? _error;
  String? _savedPath;
  bool _savedToGallery = false;
  AnalyzedMedia? _analyzed;
  QualityOption? _selectedQuality;

  @override
  void initState() {
    super.initState();
    _checkServerConfig();
  }

  @override
  void dispose() {
    _urlController.dispose();
    super.dispose();
  }

  Future<void> _checkServerConfig() async {
    final url = await _api.getBaseUrl();
    if (mounted) {
      setState(() => _serverConfigured = url.isNotEmpty);
    }
  }

  Future<void> _pasteFromClipboard() async {
    final data = await Clipboard.getData(Clipboard.kTextPlain);
    if (!mounted) return;
    if (data?.text != null && data!.text!.trim().isNotEmpty) {
      setState(() {
        _urlController.text = data.text!.trim();
        _error = null;
      });
    }
  }

  Future<void> _analyze() async {
    if (_urlController.text.trim().isEmpty) {
      setState(() => _error = 'يرجى إدخال رابط الفيديو أو الوسائط أولاً');
      return;
    }
    setState(() {
      _analyzing = true;
      _error = null;
      _savedPath = null;
      _savedToGallery = false;
    });
    try {
      final result = await _api.analyzeUrl(_urlController.text);
      if (!mounted) return;
      setState(() {
        _analyzed = result;
        _selectedQuality = result.qualities.isNotEmpty ? result.qualities.first : null;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() => _error = e.toString().replaceFirst('Exception: ', ''));
    } finally {
      if (mounted) {
        setState(() => _analyzing = false);
      }
    }
  }

  Future<void> _download() async {
    if (_analyzed == null || _selectedQuality == null || !_analyzed!.downloadAllowed) return;
    setState(() {
      _downloading = true;
      _error = null;
    });
    try {
      final res = await _api.downloadAndSaveMedia(
        media: _analyzed!,
        quality: _selectedQuality!,
      );
      if (!mounted) return;
      setState(() {
        _savedPath = res.file.path;
        _savedToGallery = res.savedToGallery;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() => _error = e.toString().replaceFirst('Exception: ', ''));
    } finally {
      if (mounted) {
        setState(() => _downloading = false);
      }
    }
  }

  Future<void> _shareFile(BuildContext context) async {
    if (_savedPath == null) return;
    final box = context.findRenderObject() as RenderBox?;
    await Share.shareXFiles(
      [XFile(_savedPath!)],
      text: _analyzed?.title ?? 'ملف من تطبيق حمّلها',
      sharePositionOrigin: box != null ? box.localToGlobal(Offset.zero) & box.size : null,
    );
  }

  @override
  Widget build(BuildContext context) {
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        const Text(
          'أهلاً بك في حمّلها',
          style: TextStyle(fontSize: 24, fontWeight: FontWeight.w700),
        ),
        const SizedBox(height: 4),
        const Text(
          'حمّلها.. كل ملفاتك بمكان واحد.',
          style: TextStyle(fontSize: 14, color: HamilhaTheme.mutedText),
        ),
        if (!_serverConfigured) ...[
          const SizedBox(height: 12),
          Card(
            color: const Color(0xFFFFFBEB),
            child: const Padding(
              padding: EdgeInsets.all(14),
              child: Text(
                'لم يتم ضبط عنوان الخادم العام (HTTPS) بعد. انتقل إلى تبويب الإعدادات لإدخال رابط الخادم المنشور واختبار الاتصال.',
                style: TextStyle(fontSize: 13, color: Color(0xFF92400E)),
              ),
            ),
          ),
        ],
        const SizedBox(height: 16),
        Card(
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                TextField(
                  controller: _urlController,
                  textDirection: TextDirection.ltr,
                  keyboardType: TextInputType.url,
                  decoration: InputDecoration(
                    hintText: 'https://...',
                    labelText: 'رابط الفيديو أو الوسائط المباشر',
                    border: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(12),
                    ),
                  ),
                ),
                const SizedBox(height: 12),
                Row(
                  children: [
                    Expanded(
                      child: OutlinedButton.icon(
                        onPressed: _pasteFromClipboard,
                        icon: const Icon(Icons.content_paste),
                        label: const Text('لصق الرابط'),
                        style: OutlinedButton.styleFrom(minimumSize: const Size(48, 48)),
                      ),
                    ),
                    const SizedBox(width: 10),
                    Expanded(
                      flex: 2,
                      child: ElevatedButton.icon(
                        onPressed: _analyzing ? null : _analyze,
                        icon: const Icon(Icons.search),
                        label: Text(_analyzing ? 'جاري التحليل...' : 'تحليل الرابط'),
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),
        ),
        if (_error != null) ...[
          const SizedBox(height: 12),
          Text(_error!, style: const TextStyle(color: Colors.red)),
        ],
        if (_analyzed != null) ...[
          const SizedBox(height: 16),
          Card(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Text(
                    _analyzed!.platformNameAr,
                    style: const TextStyle(
                      color: HamilhaTheme.primaryGreen,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                  const SizedBox(height: 6),
                  Text(
                    _analyzed!.title,
                    style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    _analyzed!.duration != null
                        ? '${_analyzed!.author} · ${_analyzed!.duration}'
                        : _analyzed!.author,
                    style: const TextStyle(color: HamilhaTheme.mutedText, fontSize: 13),
                  ),
                  const SizedBox(height: 10),
                  Text(
                    _analyzed!.policyNote,
                    style: const TextStyle(color: HamilhaTheme.mutedText, fontSize: 12),
                  ),
                  if (_analyzed!.downloadAllowed && _analyzed!.qualities.isNotEmpty) ...[
                    const SizedBox(height: 14),
                    const Text('الخيارات الحقيقية المتاحة:',
                        style: TextStyle(fontWeight: FontWeight.w600)),
                    const SizedBox(height: 8),
                    Wrap(
                      spacing: 8,
                      runSpacing: 8,
                      children: _analyzed!.qualities.map((q) {
                        final active = _selectedQuality?.id == q.id;
                        return ChoiceChip(
                          label: Text('${q.label} (${q.sizeEstimate})'),
                          selected: active,
                          onSelected: (_) => setState(() => _selectedQuality = q),
                        );
                      }).toList(),
                    ),
                    const SizedBox(height: 16),
                    ElevatedButton.icon(
                      style: ElevatedButton.styleFrom(backgroundColor: HamilhaTheme.darkBlack),
                      onPressed: _downloading ? null : _download,
                      icon: const Icon(Icons.download),
                      label: Text(
                        _downloading ? 'جاري تنزيل الملف الأصلي...' : 'تنزيل وحفظ في الهاتف',
                      ),
                    ),
                  ],
                  if (_savedPath != null) ...[
                    const SizedBox(height: 10),
                    Text(
                      _savedToGallery
                          ? 'تم حفظ الملف الحقيقي في ألبوم الصور ومجلد التطبيق.'
                          : 'تم حفظ الملف الحقيقي في مجلد التطبيق.',
                      style: const TextStyle(
                        color: HamilhaTheme.primaryGreen,
                        fontWeight: FontWeight.w600,
                        fontSize: 13,
                      ),
                    ),
                    const SizedBox(height: 8),
                    Builder(
                      builder: (btnCtx) => OutlinedButton.icon(
                        onPressed: () => _shareFile(btnCtx),
                        icon: const Icon(Icons.share),
                        label: const Text('مشاركة الملف مع الأصدقاء'),
                      ),
                    ),
                  ],
                ],
              ),
            ),
          ),
        ],
      ],
    );
  }
}
