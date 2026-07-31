import 'dart:io';
import 'package:flutter/foundation.dart';
import 'package:path_provider/path_provider.dart';

// Camera Kit caches its lens group on-device, so a newly-published try-on lens
// can stay hidden (AR opens with the camera on but no shoe) until that cache
// times out or the user clears it by hand. Snap's SDK exposes no clear/refresh
// API through the plugin we vendor, so we mimic Android's "Clear cache"
// ourselves — but TARGETED: delete only Camera Kit's own sub-folders inside the
// cache dir, leaving product-image and other caches intact.
//
// Trade-off: the shoe lenses re-download on the first AR open after each launch
// (a deliberate freshness-over-caching choice so a just-published shoe shows for
// customers without a manual Clear cache / reinstall). Image caches survive.
//
// The exact folder name Camera Kit uses is undocumented and can vary by SDK
// version, so we match on markers AND log every cache folder we see — check the
// log once on a device (`flutter logs` / logcat, tag "lensCache") to confirm the
// real folder and tighten _camKitMarkers if needed. Fully best-effort: it never
// throws and only touches disposable cache files.
const List<String> _camKitMarkers = [
  'camerakit', 'camera_kit', 'camera-kit', 'snap', 'lens',
];

Future<void> clearCameraKitLensCache() async {
  final roots = <Directory>[];
  try {
    roots.add(await getTemporaryDirectory());               // Android internal cacheDir
  } catch (_) {/* ignore */}
  try {
    final ext = await getExternalCacheDirectories();        // external cache dir(s), if any
    if (ext != null) roots.addAll(ext);
  } catch (_) {/* ignore */}

  for (final root in roots) {
    try {
      if (!root.existsSync()) continue;
      for (final entity in root.listSync()) {
        final base = entity.path.split(Platform.pathSeparator).last.toLowerCase();
        final isCamKit = _camKitMarkers.any((m) => base.contains(m));
        debugPrint('[lensCache] ${root.path} -> $base${isCamKit ? '  (clearing)' : ''}');
        if (isCamKit && entity is Directory) {
          try {
            entity.deleteSync(recursive: true);
          } catch (e) {
            debugPrint('[lensCache] could not delete "$base": $e');
          }
        }
      }
    } catch (e) {
      debugPrint('[lensCache] scan failed for ${root.path}: $e');
    }
  }
}
