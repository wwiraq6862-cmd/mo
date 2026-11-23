import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';
import '../services/api_service.dart';
import '../theme/app_theme.dart';

class WhatsAppBotScreen extends StatefulWidget {
  const WhatsAppBotScreen({super.key});

  @override
  State<WhatsAppBotScreen> createState() => _WhatsAppBotScreenState();
}

class _WhatsAppBotScreenState extends State<WhatsAppBotScreen> {
  final TextEditingController _msgController = TextEditingController();
  final HamilhaApiService _api = HamilhaApiService();

  bool _loadingStatus = true;
  bool _sending = false;
  String? _statusError;
  WhatsAppBotStatus? _status;
  String? _botReply;

  @override
  void initState() {
    super.initState();
    _loadStatus();
  }

  @override
  void dispose() {
    _msgController.dispose();
    super.dispose();
  }

  Future<void> _loadStatus() async {
    setState(() {
      _loadingStatus = true;
      _statusError = null;
    });
    try {
      final st = await _api.fetchWhatsAppStatus();
      if (!mounted) return;
      setState(() => _status = st);
    } catch (e) {
      if (!mounted) return;
      setState(() => _statusError = e.toString().replaceFirst('Exception: ', ''));
    } finally {
      if (mounted) {
        setState(() => _loadingStatus = false);
      }
    }
  }

  Future<void> _openRealWhatsAppBot() async {
    final phone = _status?.botPhoneNumber ?? '';
    if (phone.isEmpty || _status?.cloudApiConfigured != true) return;
    final uri = Uri.parse(
      'https://wa.me/$phone?text=${Uri.encodeComponent("مرحباً بوت حمّلها")}',
    );
    if (await canLaunchUrl(uri)) {
      await launchUrl(uri, mode: LaunchMode.externalApplication);
    }
  }

  Future<void> _sendToSandboxSimulator() async {
    final text = _msgController.text.trim();
    if (text.isEmpty) return;
    setState(() {
      _sending = true;
      _botReply = null;
    });
    try {
      final res = await _api.sendWhatsAppBotSimulation(content: text);
      final outbound = res['outbound'] as Map<String, dynamic>?;
      if (!mounted) return;
      setState(() {
        _botReply = outbound?['content'] as String? ?? 'تمت معالجة الطلب في المحاكي.';
        _msgController.clear();
      });
    } catch (e) {
      if (!mounted) return;
      setState(() => _botReply = e.toString().replaceFirst('Exception: ', ''));
    } finally {
      if (mounted) {
        setState(() => _sending = false);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final liveConnected =
        _status?.cloudApiConfigured == true && (_status?.botPhoneNumber.isNotEmpty ?? false);
    final showSandboxSimulator =
        _api.showDevTools && (_status?.simulatorEnabled ?? true);

    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        Card(
          child: Padding(
            padding: const EdgeInsets.all(18),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    const Text(
                      'بوت واتساب الرسمي',
                      style: TextStyle(fontSize: 17, fontWeight: FontWeight.w700),
                    ),
                    IconButton(
                      onPressed: _loadingStatus ? null : _loadStatus,
                      icon: const Icon(Icons.refresh),
                    ),
                  ],
                ),
                const SizedBox(height: 8),
                if (_loadingStatus)
                  const Text('جاري فحص حالة الربط مع الخادم...')
                else if (_statusError != null)
                  Text(_statusError!, style: const TextStyle(color: Colors.red, fontSize: 13))
                else if (liveConnected) ...[
                  const Text(
                    'البوت الحقيقي متصل ومفعّل عبر WhatsApp Business Cloud API.',
                    style: TextStyle(
                      color: HamilhaTheme.primaryGreen,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                  const SizedBox(height: 12),
                  ElevatedButton.icon(
                    onPressed: _openRealWhatsAppBot,
                    icon: const Icon(Icons.chat),
                    label: Text('مراسلة بوت واتساب الرسمي (${_status!.botPhoneNumber})'),
                  ),
                ] else ...[
                  const Text(
                    'خدمة بوت واتساب غير مفعّلة على الخادم حالياً.',
                    style: TextStyle(color: Color(0xFF92400E), fontSize: 13),
                  ),
                ],
              ],
            ),
          ),
        ),
        if (showSandboxSimulator) ...[
          const SizedBox(height: 16),
          Card(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  const Text(
                    'محاكي اختبار البوت (بيئة تطوير فقط)',
                    style: TextStyle(fontSize: 15, fontWeight: FontWeight.w700),
                  ),
                  const SizedBox(height: 4),
                  const Text(
                    'يظهر هذا القسم في وضع التطوير فقط ولا يظهر في نسخ الإصدار النهائية.',
                    style: TextStyle(fontSize: 12, color: HamilhaTheme.mutedText),
                  ),
                  const SizedBox(height: 12),
                  TextField(
                    controller: _msgController,
                    decoration: InputDecoration(
                      labelText: 'رابط وسائط لاختبار المحاكي',
                      hintText: 'https://...',
                      border: OutlineInputBorder(borderRadius: BorderRadius.circular(12)),
                    ),
                  ),
                  const SizedBox(height: 12),
                  ElevatedButton.icon(
                    onPressed: _sending ? null : _sendToSandboxSimulator,
                    icon: const Icon(Icons.send),
                    label: Text(_sending ? 'جاري المعالجة...' : 'إرسال إلى محاكي الاختبار'),
                  ),
                  if (_botReply != null) ...[
                    const SizedBox(height: 12),
                    Container(
                      padding: const EdgeInsets.all(12),
                      decoration: BoxDecoration(
                        color: HamilhaTheme.canvasGray,
                        borderRadius: BorderRadius.circular(12),
                      ),
                      child: Text(_botReply!),
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
