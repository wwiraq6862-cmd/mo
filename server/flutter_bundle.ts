import fs from 'node:fs';
import path from 'node:path';
import { Router, type Request, type Response } from 'express';

export const flutterRouter = Router();

const FLUTTER_ROOT = path.resolve(process.cwd(), 'flutter_app');

const ALLOWED_FLUTTER_FILES = [
  'pubspec.yaml',
  'android/gradle.properties',
  'android/gradle/wrapper/gradle-wrapper.properties',
  'android/gradlew',
  'android/gradlew.bat',
  'android/key.properties.example',
  'android/settings.gradle.kts',
  'android/build.gradle.kts',
  'android/app/build.gradle.kts',
  'android/app/src/main/AndroidManifest.xml',
  'android/app/src/main/kotlin/com/hamilha/app/MainActivity.kt',
  'android/app/src/main/res/values/styles.xml',
  'android/app/src/main/res/drawable/launch_background.xml',
  'ios/Podfile',
  'ios/Flutter/Debug.xcconfig',
  'ios/Flutter/Release.xcconfig',
  'ios/Flutter/AppFrameworkInfo.plist',
  'ios/Runner/Info.plist',
  'ios/Runner/AppDelegate.swift',
  'ios/Runner/Runner-Bridging-Header.h',
  'ios/Runner/Assets.xcassets/Contents.json',
  'ios/Runner/Assets.xcassets/AppIcon.appiconset/Contents.json',
  'ios/Runner/Base.lproj/LaunchScreen.storyboard',
  'ios/Runner/Base.lproj/Main.storyboard',
  'ios/Runner.xcodeproj/project.pbxproj',
  'lib/main.dart',
  'lib/theme/app_theme.dart',
  'lib/models/media_item.dart',
  'lib/services/api_service.dart',
  'lib/services/notification_service.dart',
  'lib/screens/home_screen.dart',
  'lib/screens/downloads_screen.dart',
  'lib/screens/whatsapp_bot_screen.dart',
  'lib/screens/settings_screen.dart',
];

function readSafeFlutterFile(relPath: string): string | null {
  if (!ALLOWED_FLUTTER_FILES.includes(relPath)) return null;
  const resolved = path.resolve(FLUTTER_ROOT, relPath);
  if (!resolved.startsWith(FLUTTER_ROOT + path.sep)) return null;
  if (!fs.existsSync(resolved)) return null;
  return fs.readFileSync(resolved, 'utf-8');
}

flutterRouter.get('/files', (_req: Request, res: Response) => {
  const files = ALLOWED_FLUTTER_FILES.map((relPath) => {
    const content = readSafeFlutterFile(relPath);
    return {
      path: relPath,
      exists: content !== null,
      lines: content ? content.split('\n').length : 0,
      content: content ?? '',
    };
  });
  res.json({ projectName: 'hamilha_app', files });
});

flutterRouter.get('/export', (_req: Request, res: Response) => {
  const bundle = ALLOWED_FLUTTER_FILES.map((relPath) => ({
    path: `flutter_app/${relPath}`,
    content: readSafeFlutterFile(relPath) ?? '',
  }));

  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader(
    'Content-Disposition',
    'attachment; filename="hamilha-flutter-project.json"',
  );
  res.send(JSON.stringify({ app: 'حمّلها HAMILHA', version: '1.1.0', files: bundle }, null, 2));
});
