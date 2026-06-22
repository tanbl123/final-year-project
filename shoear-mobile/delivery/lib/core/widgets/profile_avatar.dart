import 'package:flutter/material.dart';

/// A round avatar: shows the uploaded photo if [url] is set, otherwise falls
/// back to the first initial on a colour picked deterministically from the
/// name — matching the web portal / customer app so a person looks the same.
class ProfileAvatar extends StatelessWidget {
  final String name;
  final String? url;
  final double size;

  const ProfileAvatar({super.key, required this.name, this.url, this.size = 40});

  static const _colors = [
    Color(0xFF1ABC9C), Color(0xFF3498DB), Color(0xFF9B59B6), Color(0xFFE67E22), Color(0xFFE74C3C),
    Color(0xFF16A085), Color(0xFF2980B9), Color(0xFF8E44AD), Color(0xFFD35400), Color(0xFF27AE60),
  ];

  @override
  Widget build(BuildContext context) {
    final trimmed = name.trim();
    final letter = (trimmed.isNotEmpty ? trimmed[0] : '?').toUpperCase();

    int hash = 0;
    for (final code in trimmed.codeUnits) {
      hash = code + ((hash << 5) - hash);
    }
    final bg = _colors[hash.abs() % _colors.length];

    if (url == null || url!.isEmpty) {
      return CircleAvatar(
        radius: size / 2,
        backgroundColor: bg,
        child: Text(letter, style: TextStyle(color: Colors.white, fontSize: size * 0.45, fontWeight: FontWeight.w600)),
      );
    }
    return CircleAvatar(
      radius: size / 2,
      backgroundColor: bg,
      foregroundImage: NetworkImage(url!),
      onForegroundImageError: (_, __) {},
      child: Text(letter, style: TextStyle(color: Colors.white, fontSize: size * 0.45, fontWeight: FontWeight.w600)),
    );
  }
}
