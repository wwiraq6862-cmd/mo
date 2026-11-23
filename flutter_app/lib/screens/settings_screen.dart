import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../services/api_service.dart';
import '../theme/app_theme.dart';

class SettingsScreen extends StatefulWidget {
  const SettingsScreen({super.key});

  @override
  State<SettingsScreen> createState() => _SettingsScreenState();
}

class _SettingsScreenState extends State<SettingsScreen> {
  final HamilhaApiService _api = HamilhaApiService();
  final TextEditingController _serverController = TextEditingController();

  String _defaultQuality = '720p';
  bool _autoPaste = true;
  bool _saveToGallery = true;
  bool _enableNotifications = true;
  bool _testingServer = false;
  ServerConnectionResult? _connectionResult;

  bool get _showServerOverrideCard =>
      _api.showDevTools || HamilhaApiService.buildTimeBaseUrl.isEmpty;

  @override
  void initState() {
    super.initState();
    _loadPrefs();
  }

  @override
  void dispose() {
    _serverController.dispose();
    super.dispose();
  }

  Future<void> _loadPrefs() async {
    final prefs = await SharedPreferences.getInstance();
    final baseUrl = await _api.getBaseUrl();
    if (!mounted) return;
    setState(() {
      _serverController.text = baseUrl;
      _defaultQuality = prefs.getString('default_quality') ?? '720p';
      _autoPaste = prefs.getBool('auto_paste') ?? true;
      _saveToGallery = prefs.getBool('save_to_gallery') ?? true;
      _enableNotifications = prefs.getBool('enable_notifications') ?? true;
    });
  }

  Future<void> _saveAndTestServer() async {
    setState(() {
      _testingServer = true;
      _connectionResult = null;
    });
    await _api.setCustomBaseUrl(_serverController.text);
    final res = await _api.testServerConnection(_serverController.text);
    if (!mounted) return;
    setState(() {
      _testingServer = false;
      _connectionResult = res;
    });
  }

  Future<void> _saveQuality(String q) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString('default_quality', q);
    if (!mounted) return;
    setState(() => _defaultQuality = q);
  }

  Future<void> _setBool(String key, bool val, void Function(bool) setter) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setBool(key, val);
    if (!mounted) return;
    setState(() => setter(val));
  }

  @override
  Widget build(BuildContext context) {
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        if (_showServerOverrideCard) ...[
          Card(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  const Text(
                    'ربط التطبيق بالخادم (إعداد التطوير)',
                    style: TextStyle(fontSize: 16, fontWeight: FontWeight.w700),
                  ),
                  const SizedBox(height: 6),
                  const Text(
                    'أدخل عنوان HTTPS العام والدائم للخادم بعد نشره. يتم إخفاء هذا القسم تلقائياً في نسخ الإصدار المربوطة بـ HAMILHA_API_URL.',
                    style: TextStyle(fontSize: 12, color: HamilhaTheme.mutedText),
                  ),
                  const SizedBox(height: 12),
                  TextField(
                    controller: _serverController,
                    textDirection: TextDirection.ltr,
                    keyboardType: TextInputType.url,
                    decoration: InputDecoration(
                      labelText: 'عنوان الخادم',
                      hintText: 'https://api.yourdomain.com',
                      border: OutlineInputBorder(borderRadius: BorderRadius.circular(12)),
                    ),
                  ),
                  const SizedBox(height: 10),
                  ElevatedButton.icon(
                    onPressed: _testingServer ? null : _saveAndTestServer,
                    icon: const Icon(Icons.wifi_tethering),
                    label: Text(_testingServer ? 'جاري اختبار الاتصال...' : 'حفظ واختبار الاتصال'),
                  ),
                  if (_connectionResult != null) ...[
                    const SizedBox(height: 10),
                    Text(
                      _connectionResult!.ok
                          ? '${_connectionResult!.message} (${_connectionResult!.latencyMs} ms)'
                          : _connectionResult!.message,
                      style: TextStyle(
                        fontSize: 13,
                        fontWeight: FontWeight.w600,
                        color: _connectionResult!.ok ? HamilhaTheme.primaryGreen : Colors.red,
                      ),
                    ),
                  ],
                ],
              ),
            ),
          ),
          const SizedBox(height: 16),
        ],
        Card(
          child: Column(
            children: [
              ListTile(
                title: const Text('الجودة الافتراضية للتنزيل'),
                trailing: DropdownButton<String>(
                  value: _defaultQuality,
                  items: const [
                    DropdownMenuItem(value: '1080p', child: Text('1080p Full HD')),
                    DropdownMenuItem(value: '720p', child: Text('720p HD')),
                    DropdownMenuItem(value: '480p', child: Text('480p SD')),
                  ],
                  onChanged: (v) {
                    if (v != null) _saveQuality(v);
                  },
                ),
              ),
              const Divider(height: 1),
              SwitchListTile(
                title: const Text('حفظ الفيديو والصور في ألبوم الهاتف'),
                subtitle: const Text('Android MediaStore و iPhone Photos'),
                value: _saveToGallery,
                onChanged: (v) => _setBool('save_to_gallery', v, (x) => _saveToGallery = x),
              ),
              const Divider(height: 1),
              SwitchListTile(
                title: const Text('إشعارات اكتمال التنزيل'),
                value: _enableNotifications,
                onChanged: (v) =>
                    _setBool('enable_notifications', v, (x) => _enableNotifications = x),
              ),
              const Divider(height: 1),
              SwitchListTile(
                title: const Text('لصق الرابط تلقائياً عند فتح التطبيق'),
                value: _autoPaste,
                onChanged: (v) => _setBool('auto_paste', v, (x) => _autoPaste = x),
              ),
            ],
          ),
        ),
      ],
    );
  }
}
