import 'dart:convert';

import 'package:flutter/services.dart' show rootBundle;

/// One postcode's resolved location.
class PostcodeLocation {
  final String city;
  final String state;
  const PostcodeLocation({required this.city, required this.state});
}

/// Looks up a Malaysian 5-digit postcode and returns its city + state.
///
/// The data is a static, bundled JSON asset (Malaysian postcodes are fixed
/// government data — no API or network call needed). Loaded lazily on first
/// use and cached in memory for the rest of the app's lifetime.
///
/// Unknown postcodes return null so the UI can fall back to manual entry —
/// it never blocks checkout if a postcode isn't in the dataset.
class PostcodeService {
  PostcodeService._();
  static final PostcodeService instance = PostcodeService._();

  static const _assetPath = 'assets/data/my_postcodes.json';

  Map<String, PostcodeLocation>? _cache;

  /// Loads and parses the bundled dataset once, then caches it.
  Future<void> _ensureLoaded() async {
    if (_cache != null) return;
    final raw = await rootBundle.loadString(_assetPath);
    final json = jsonDecode(raw) as Map<String, dynamic>;
    final entries = (json['postcodes'] as Map<String, dynamic>);
    _cache = entries.map((code, v) {
      final m = v as Map<String, dynamic>;
      return MapEntry(
        code,
        PostcodeLocation(
          city: m['city'] as String? ?? '',
          state: m['state'] as String? ?? '',
        ),
      );
    });
  }

  /// Returns the city + state for [postcode], or null if it's not a known
  /// 5-digit Malaysian postcode.
  Future<PostcodeLocation?> lookup(String postcode) async {
    final code = postcode.trim();
    if (!RegExp(r'^\d{5}$').hasMatch(code)) return null;
    await _ensureLoaded();
    return _cache![code];
  }
}
