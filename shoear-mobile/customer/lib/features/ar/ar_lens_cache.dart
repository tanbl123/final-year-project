import 'dart:io';
import 'package:flutter/foundation.dart';
import 'package:path_provider/path_provider.dart';

// Camera Kit caches its lens group on-device, so a newly-published try-on lens can
// stay hidden until the cache is cleared. Snap's SDK exposes no clear/refresh API
// through the plugin we vendor, so we replicate the ONE thing that reliably works:
// Android Settings > "Clear cache".
//
// IMPORTANT: "Clear cache" wipes only the CACHE PARTITION — it never touches app
// DATA. We must do the same. An earlier version also deleted Camera Kit's folders in
// the app DATA dir (camera_kit_lens_sdk_data / _documents / _session / _app_vendor_id
// etc.) — but those are the SDK's internal STATE, not disposable cache, and wiping
// them left the lens unable to load (the new shoe only appeared after a plain "Clear
// cache", which leaves that state intact). So we now clear the cache partition ONLY.
//
// The cache partition is disposable by definition (the OS can clear it any time), so
// wiping it is safe — Camera Kit just re-downloads the lens content on next open.
// Best-effort: never throws. lensCacheReport is shown in a debug-only UI line.
String lensCacheReport = '';

Future<void> clearCameraKitLensCache() async {
  Future<Directory?> safe(Future<Directory?> f) async { try { return await f; } catch (_) { return null; } }
  Future<List<Directory>> safeList(Future<List<Directory>?> f) async {
    try { return (await f) ?? const []; } catch (_) { return const []; }
  }

  // The cache partition, exactly what "Clear cache" clears (deduped by path).
  final cacheRoots = <String, Directory>{};
  for (final d in [await safe(getTemporaryDirectory()), await safe(getApplicationCacheDirectory())]) {
    if (d != null) cacheRoots[d.path] = d;
  }
  for (final d in await safeList(getExternalCacheDirectories())) { cacheRoots[d.path] = d; }

  var wiped = 0;
  for (final root in cacheRoots.values) { wiped += _wipe(root); }

  lensCacheReport = 'wiped $wiped cache item(s) from ${cacheRoots.length} cache root(s) '
      '(app data left intact)';
  debugPrint('[lensCache] $lensCacheReport: ${cacheRoots.keys.join(', ')}');
}

// Delete every child of `dir` (files and folders). Returns how many were removed.
int _wipe(Directory dir) {
  var n = 0;
  try {
    if (!dir.existsSync()) return 0;
    for (final e in dir.listSync()) {
      try { e.deleteSync(recursive: true); n++; }
      catch (err) { debugPrint('[lensCache] could not delete ${e.path}: $err'); }
    }
  } catch (e) {
    debugPrint('[lensCache] wipe failed for ${dir.path}: $e');
  }
  return n;
}
