import 'dart:io';
import 'package:flutter/foundation.dart';
import 'package:path_provider/path_provider.dart';

// Camera Kit caches its lens group on-device, so a newly-published try-on lens can
// stay hidden until the cache is cleared. Snap's SDK exposes no clear/refresh API
// through the plugin we vendor, so we clear it ourselves at launch.
//
// What finally works (matching Android Settings > "Clear cache", the only thing that
// reliably showed the new lens): WIPE THE WHOLE CACHE PARTITION, not just folders we
// recognise. Camera Kit downloads lens content through a network/HTTP cache whose
// folder isn't named `camera_kit_*`, so our earlier name-matched delete missed it.
// The cache partition is disposable by definition (the OS can clear it any time), so
// wiping it is safe — it just re-downloads on next use.
//
// Camera Kit also keeps the unpacked lens in `camera_kit_*` folders in the app's
// DATA dir (files/documents), which "Clear cache" does NOT touch — so we additionally
// delete those (they're unmistakably Camera Kit's own disposable data).
//
// Trade-off: images and the lens re-download on first use after each launch — the
// deliberate freshness cost so a just-published shoe shows without a manual clear.
// Best-effort: never throws. lensCacheReport is shown in a debug-only UI line.
const List<String> _camKitStrict = ['camera_kit', 'camerakit', 'camera-kit'];
const int _maxDepth = 5;

String lensCacheReport = '';

Future<void> clearCameraKitLensCache() async {
  Future<Directory?> safe(Future<Directory?> f) async { try { return await f; } catch (_) { return null; } }
  Future<List<Directory>> safeList(Future<List<Directory>?> f) async {
    try { return (await f) ?? const []; } catch (_) { return const []; }
  }

  // Phase 1 — wipe the entire cache partition (exactly what "Clear cache" does).
  final cacheRoots = <String, Directory>{};
  for (final d in [await safe(getTemporaryDirectory()), await safe(getApplicationCacheDirectory())]) {
    if (d != null) cacheRoots[d.path] = d;
  }
  for (final d in await safeList(getExternalCacheDirectories())) { cacheRoots[d.path] = d; }
  var wiped = 0;
  for (final root in cacheRoots.values) { wiped += _wipe(root); }

  // Phase 2 — delete Camera Kit's own folders in the app DATA dir (files/documents),
  // where the unpacked lens lives (camera_kit_lens_content / _remote_asset). "Clear
  // cache" doesn't reach here; camera_kit_* is safe to delete (it re-downloads).
  final dataRoots = <String, Directory>{};
  for (final d in [await safe(getApplicationSupportDirectory()), await safe(getApplicationDocumentsDirectory())]) {
    if (d != null) dataRoots[d.path] = d;
  }
  final seen = <String>[];
  var cleared = 0;
  for (final root in dataRoots.values) { cleared += _clearCamKit(root, 0, seen); }

  final shown = seen.take(20).toList();
  final more = seen.length - shown.length;
  lensCacheReport = 'wiped $wiped cache item(s), cleared $cleared Camera Kit folder(s) in app data.'
      ' App-data folders: ${shown.isEmpty ? '(none)' : shown.join(', ')}'
      '${more > 0 ? ' …(+$more)' : ''}';
  debugPrint('[lensCache] $lensCacheReport');
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

// Recursively delete folders named `camera_kit_*` under `dir`; record shallow folder
// names into `seen` (a Camera Kit match gets a '!' prefix). Returns folders deleted.
int _clearCamKit(Directory dir, int depth, List<String> seen) {
  if (depth > _maxDepth) return 0;
  List<FileSystemEntity> entries;
  try {
    if (!dir.existsSync()) return 0;
    entries = dir.listSync();
  } catch (e) {
    debugPrint('[lensCache] scan failed for ${dir.path}: $e');
    return 0;
  }
  var cleared = 0;
  for (final entity in entries) {
    if (entity is! Directory) continue;
    final base = entity.path.split(Platform.pathSeparator).last;
    final isCamKit = _camKitStrict.any((m) => base.toLowerCase().contains(m));
    if (depth <= 1) seen.add(isCamKit ? '!$base' : base);
    if (isCamKit) {
      try { entity.deleteSync(recursive: true); cleared++; }
      catch (e) { debugPrint('[lensCache] could not delete "$base": $e'); }
    } else {
      cleared += _clearCamKit(entity, depth + 1, seen);
    }
  }
  return cleared;
}
