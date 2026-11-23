import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'screens/downloads_screen.dart';
import 'screens/home_screen.dart';
import 'screens/settings_screen.dart';
import 'screens/whatsapp_bot_screen.dart';
import 'services/notification_service.dart';
import 'theme/app_theme.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await NotificationService.instance.init();
  runApp(const HamilhaApp());
}

class HamilhaApp extends StatelessWidget {
  const HamilhaApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'حمّلها HAMILHA',
      debugShowCheckedModeBanner: false,
      locale: const Locale('ar'),
      supportedLocales: const [Locale('ar')],
      localizationsDelegates: const [
        GlobalMaterialLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,
        GlobalCupertinoLocalizations.delegate,
      ],
      theme: HamilhaTheme.lightTheme(),
      home: const HamilhaShell(),
    );
  }
}

class HamilhaShell extends StatefulWidget {
  const HamilhaShell({super.key});

  @override
  State<HamilhaShell> createState() => _HamilhaShellState();
}

class _HamilhaShellState extends State<HamilhaShell> {
  int _selectedIndex = 0;

  final List<Widget> _screens = const [
    HomeScreen(),
    DownloadsScreen(),
    WhatsAppBotScreen(),
    SettingsScreen(),
  ];

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text(
          'حمّلها HAMILHA',
          style: TextStyle(fontWeight: FontWeight.w700, fontSize: 19),
        ),
        bottom: PreferredSize(
          preferredSize: const Size.fromHeight(1),
          child: Container(height: 1, color: HamilhaTheme.borderGray),
        ),
      ),
      body: SafeArea(child: _screens[_selectedIndex]),
      bottomNavigationBar: NavigationBar(
        selectedIndex: _selectedIndex,
        backgroundColor: HamilhaTheme.surfaceWhite,
        indicatorColor: HamilhaTheme.primaryGreen.withValues(alpha: 0.14),
        onDestinationSelected: (idx) => setState(() => _selectedIndex = idx),
        destinations: const [
          NavigationDestination(
            icon: Icon(Icons.home_outlined),
            selectedIcon: Icon(Icons.home, color: HamilhaTheme.primaryGreen),
            label: 'الرئيسية',
          ),
          NavigationDestination(
            icon: Icon(Icons.download_done_outlined),
            selectedIcon: Icon(Icons.download_done, color: HamilhaTheme.primaryGreen),
            label: 'التنزيلات',
          ),
          NavigationDestination(
            icon: Icon(Icons.chat_outlined),
            selectedIcon: Icon(Icons.chat, color: HamilhaTheme.primaryGreen),
            label: 'بوت واتساب',
          ),
          NavigationDestination(
            icon: Icon(Icons.settings_outlined),
            selectedIcon: Icon(Icons.settings, color: HamilhaTheme.primaryGreen),
            label: 'الإعدادات',
          ),
        ],
      ),
    );
  }
}
