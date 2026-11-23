import 'package:flutter/material.dart';
import 'package:share_plus/share_plus.dart';
import 'package:url_launcher/url_launcher.dart';
import '../models/media_item.dart';
import '../services/api_service.dart';
import '../theme/app_theme.dart';

class DownloadsScreen extends StatefulWidget {
  const DownloadsScreen({super.key});

  @override
  State<DownloadsScreen> createState() => _DownloadsScreenState();
}

class _DownloadsScreenState extends State<DownloadsScreen> {
  final HamilhaApiService _api = HamilhaApiService();

  bool _loading = true;
  String? _busyItemId;
  List<DownloadRecord> _items = [];

  @override
  void initState() {
    super.initState();
    _refresh();
  }

  Future<void> _refresh() async {
    if (mounted && _items.isEmpty) {
      setState(() => _loading = true);
    }
    final list = await _api.fetchHistory();
    if (!mounted) return;
    setState(() {
      _items = list;
      _loading = false;
    });
  }

  void _showSnack(String message, {bool isError = false}) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(message),
        backgroundColor: isError ? Colors.red.shade700 : HamilhaTheme.darkBlack,
      ),
    );
  }

  Future<void> _openSourceUrl(DownloadRecord item) async {
    final uri = Uri.tryParse(item.url);
    if (uri == null || (uri.scheme != 'https' && uri.scheme != 'http')) {
      _showSnack('لا يوجد رابط خارجي مباشر لهذا العنصر.', isError: true);
      return;
    }
    if (await canLaunchUrl(uri)) {
      await launchUrl(uri, mode: LaunchMode.externalApplication);
    } else {
      _showSnack('تعذر فتح الرابط الخارجي.', isError: true);
    }
  }

  Future<void> _shareOrOpenFile(BuildContext btnCtx, DownloadRecord item) async {
    setState(() => _busyItemId = item.id);
    try {
      final file = await _api.ensureLocalFileForRecord(item);
      if (!mounted) return;
      final box = btnCtx.findRenderObject() as RenderBox?;
      await Share.shareXFiles(
        [XFile(file.path)],
        text: item.title,
        sharePositionOrigin: box != null ? box.localToGlobal(Offset.zero) & box.size : null,
      );
    } catch (e) {
      _showSnack(e.toString().replaceFirst('Exception: ', ''), isError: true);
    } finally {
      if (mounted) {
        setState(() => _busyItemId = null);
      }
    }
  }

  Future<void> _confirmAndDelete(DownloadRecord item) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('حذف التنزيل'),
        content: Text('هل تريد حذف "${item.title}" من سجل تنزيلاتك ومن الجهاز؟'),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(false),
            child: const Text('إلغاء'),
          ),
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(true),
            style: TextButton.styleFrom(foregroundColor: Colors.red),
            child: const Text('حذف'),
          ),
        ],
      ),
    );

    if (confirmed != true) return;
    setState(() => _busyItemId = item.id);
    try {
      await _api.deleteDownload(item.id);
      if (!mounted) return;
      setState(() {
        _items = _items.where((x) => x.id != item.id).toList();
      });
      _showSnack('تم حذف الملف من سجلك.');
    } catch (e) {
      _showSnack(e.toString().replaceFirst('Exception: ', ''), isError: true);
    } finally {
      if (mounted) {
        setState(() => _busyItemId = null);
      }
    }
  }

  IconData _iconForMedia(String mediaType) {
    switch (mediaType) {
      case 'image':
        return Icons.image_outlined;
      case 'audio':
        return Icons.audiotrack_outlined;
      case 'document':
        return Icons.description_outlined;
      default:
        return Icons.video_file_outlined;
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) {
      return const Center(child: CircularProgressIndicator());
    }

    return RefreshIndicator(
      onRefresh: _refresh,
      child: _items.isEmpty
          ? ListView(
              physics: const AlwaysScrollableScrollPhysics(),
              padding: const EdgeInsets.all(24),
              children: [
                const SizedBox(height: 80),
                const Icon(Icons.download_done_outlined, size: 48, color: HamilhaTheme.mutedText),
                const SizedBox(height: 12),
                const Text(
                  'لا توجد تنزيلات محفوظة لجلستك بعد.',
                  textAlign: TextAlign.center,
                  style: TextStyle(fontSize: 15, fontWeight: FontWeight.w600),
                ),
                const SizedBox(height: 6),
                const Text(
                  'اسحب للأسفل لتحديث القائمة بعد تنزيل ملف جديد.',
                  textAlign: TextAlign.center,
                  style: TextStyle(fontSize: 13, color: HamilhaTheme.mutedText),
                ),
              ],
            )
          : ListView.separated(
              physics: const AlwaysScrollableScrollPhysics(),
              padding: const EdgeInsets.all(16),
              itemCount: _items.length,
              separatorBuilder: (_, __) => const SizedBox(height: 10),
              itemBuilder: (context, i) {
                final item = _items[i];
                final isBusy = _busyItemId == item.id;
                final hasHttpUrl =
                    item.url.startsWith('https://') || item.url.startsWith('http://');

                return Card(
                  child: Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        Row(
                          children: [
                            CircleAvatar(
                              backgroundColor: HamilhaTheme.primaryGreen,
                              foregroundColor: Colors.white,
                              child: Icon(_iconForMedia(item.mediaType)),
                            ),
                            const SizedBox(width: 12),
                            Expanded(
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text(
                                    item.title,
                                    maxLines: 1,
                                    overflow: TextOverflow.ellipsis,
                                    style: const TextStyle(
                                      fontWeight: FontWeight.w700,
                                      fontSize: 14,
                                    ),
                                  ),
                                  const SizedBox(height: 3),
                                  Text(
                                    '${item.platform} · ${item.quality} · ${item.fileSize}',
                                    style: const TextStyle(
                                      fontSize: 12,
                                      color: HamilhaTheme.mutedText,
                                    ),
                                  ),
                                ],
                              ),
                            ),
                            if (isBusy)
                              const SizedBox(
                                width: 20,
                                height: 20,
                                child: CircularProgressIndicator(strokeWidth: 2),
                              ),
                          ],
                        ),
                        const SizedBox(height: 10),
                        Row(
                          mainAxisAlignment: MainAxisAlignment.end,
                          children: [
                            if (hasHttpUrl)
                              TextButton.icon(
                                onPressed: isBusy ? null : () => _openSourceUrl(item),
                                icon: const Icon(Icons.open_in_new, size: 18),
                                label: const Text('فتح المصدر'),
                              ),
                            Builder(
                              builder: (btnCtx) => TextButton.icon(
                                onPressed: isBusy ? null : () => _shareOrOpenFile(btnCtx, item),
                                icon: const Icon(Icons.share_outlined, size: 18),
                                label: const Text('فتح / مشاركة'),
                              ),
                            ),
                            TextButton.icon(
                              onPressed: isBusy ? null : () => _confirmAndDelete(item),
                              style: TextButton.styleFrom(foregroundColor: Colors.red.shade700),
                              icon: const Icon(Icons.delete_outline, size: 18),
                              label: const Text('حذف'),
                            ),
                          ],
                        ),
                      ],
                    ),
                  ),
                );
              },
            ),
    );
  }
}
