import 'package:flutter/material.dart';

class HamilhaTheme {
  static const Color primaryGreen = Color(0xFF059669);
  static const Color darkBlack = Color(0xFF0E1111);
  static const Color surfaceWhite = Color(0xFFFFFFFF);
  static const Color canvasGray = Color(0xFFF6F7F8);
  static const Color borderGray = Color(0xFFE4E7EC);
  static const Color mutedText = Color(0xFF475467);

  static ThemeData lightTheme() {
    return ThemeData(
      useMaterial3: true,
      brightness: Brightness.light,
      scaffoldBackgroundColor: canvasGray,
      colorScheme: const ColorScheme.light(
        primary: primaryGreen,
        secondary: darkBlack,
        surface: surfaceWhite,
        onPrimary: Colors.white,
        onSecondary: Colors.white,
        onSurface: darkBlack,
      ),
      appBarTheme: const AppBarTheme(
        backgroundColor: surfaceWhite,
        foregroundColor: darkBlack,
        elevation: 0,
        centerTitle: false,
        surfaceTintColor: Colors.transparent,
      ),
      // يتطلب CardThemeData إصدار Flutter 3.29+ (Dart 3.7+).
      // في حال البناء على إصدار أقدم (Flutter 3.24–3.27) استبدل CardThemeData بـ CardTheme.
      cardTheme: CardThemeData(
        color: surfaceWhite,
        elevation: 0,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(16),
          side: const BorderSide(color: borderGray, width: 1),
        ),
      ),
      elevatedButtonTheme: ElevatedButtonThemeData(
        style: ElevatedButton.styleFrom(
          backgroundColor: primaryGreen,
          foregroundColor: Colors.white,
          minimumSize: const Size(48, 48),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(12),
          ),
          textStyle: const TextStyle(
            fontWeight: FontWeight.w700,
            fontSize: 15,
          ),
        ),
      ),
    );
  }
}
