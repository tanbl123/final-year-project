import 'dart:io';
import 'package:flutter/foundation.dart';
import 'package:path_provider/path_provider.dart';

// Camera Kit caches its lens group on-device, so a newly-published try-on lens
// can stay hidden (AR opens with the camera on but no shoe) until that cache
// times out or the user clears it by hand. Snap's SDK exposes no clear/refresh
// API through the plugin we vendor, so we mimic Android's "Clear cache"
// ourselves — but TARGETED: delete only Camera Kit's own cache sub-folders,
// leaving product-image and other caches intact.
//
// Trade-off: the shoe lenses re-download on the first AR open after each launch
// (a deliberate freshness-over-caching choice so a just-published shoe shows for
// customers without a manual Clear cache / reinstall). Image caches survive.
//
// Camera Kit's cache folder name and location are undocumented and vary by SDK
// version and platform, so this is best-effort and driven by markers:
//   * We scan every cache-ish root we can reach — including iOS's Library/Caches
//     via getApplicationCacheDirectory(), which is where Camera Kit caches on iOS
//     (the old code only checked tmp and so never cleared anything on iOS).
//   * We recurse into sub-folders (the cache folder is often nested, not a direct
//     child), bounded by _maxDepth so the launch scan stays quick.
//   * We log EVERY folder we see (tag "lensCache"): run `flutter logs` / logcat
//     once on a device to confirm the real folder, then tighten _camKitMarkers.
// Fully best-effort: it never throws and only touches disposable cache files.
const List<String> _camKitMarkers = [
  'camerakit', 'camera_kit', 'camera-kit', 'snap', 'lens',
];
const int _maxDepth = 5; // descend into nested cache folders, but bound the scan

Future<void> clearCameraKitLensCache() async {
  // Dedupe roots by path — on Android several of these resolve to the same cacheDir.
  final roots = <String, Directory>{};
  Future<void> addOne(Future<Directory?> f) async {
    try { final d = await f; if (d != null) roots[d.path] = d; } catch (_) {/* ignore */}
  }
  Future<void> addMany(Future<List<Directory>?> f) async {
    try { final l = await f; if (l != null) for (final d in l) roots[d.path] = d; } catch (_) {/* ignore */}
  }
  await addOne(getTemporaryDirectory());         // Android cacheDir / iOS tmp
  await addOne(getApplicationCacheDirectory());  // Android cacheDir / iOS Library/Caches (Camera Kit iOS)
  await addMany(getExternalCacheDirectories());  // Android external cache dir(s), if any
  await addOne(getApplicationSupportDirectory()); // some SDK state lives here too

  var cleared = 0;
  for (final root in roots.values) {
    cleared += _scanAndClear(root, 0);
  }
  debugPrint('[lensCache] done — cleared $cleared Camera Kit folder(s) across '
      '${roots.length} root(s): ${roots.keys.join(', ')}');
}

// Recursively walk `dir` to _maxDepth: delete any directory whose name looks like
// Camera Kit's cache, otherwise descend to find a nested one. Returns how many
// folders were deleted. Only lists directories (skips files) and never throws.
int _scanAndClear(Directory dir, int depth) {
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
    final base = entity.path.split(Platform.pathSeparator).last.toLowerCase();
    final isCamKit = _camKitMarkers.any((m) => base.contains(m));
    debugPrint('[lensCache] d$depth ${entity.path}${isCamKit ? '  (clearing)' : ''}');
    if (isCamKit) {
      try {
        entity.deleteSync(recursive: true);
        cleared++;
      } catch (e) {
        debugPrint('[lensCache] could not delete "$base": $e');
      }
    } else {
      cleared += _scanAndClear(entity, depth + 1); // look for a nested Camera Kit cache
    }
  }
  return cleared;
}
