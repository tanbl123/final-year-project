import 'dart:io';
import 'package:flutter/foundation.dart';
import 'package:path_provider/path_provider.dart';

// Camera Kit caches its lens group on-device, so a newly-published try-on lens
// can stay hidden until that cache is cleared. Snap's SDK exposes no clear/refresh
// API through the plugin we vendor, so we clear it ourselves at launch.
//
// On-device diagnosis (Honor/Huawei block adb logcat, so we log to the UI via
// lensCacheReport) showed Camera Kit keeps its data in folders named `camera_kit_*`
// — NOT in the OS cache dir but in the app's files/documents dir:
//   camera_kit_lens_content, camera_kit_lens_remote_asset  <- the downloaded lens
//   camera_kit_lens_sdk_cache, camera_kit_response_cache, camera_kit_cof_cache, ...
// A `camera_kit_*` folder is unmistakably Camera Kit's own disposable data (it all
// re-downloads/recreates), so we delete those wherever they live — including the
// app data dirs. The looser 'snap'/'lens' markers stay restricted to the throwaway
// OS cache dirs, to avoid ever touching an unrelated app folder by those names.
//
// Trade-off (deliberate): the lens re-downloads on the first AR open after each
// launch, so a just-published shoe shows without a manual Clear cache. Best-effort,
// never throws, only removes Camera Kit's own folders. lensCacheReport is shown in a
// debug-only line under the AR button for on-device verification.
const List<String> _camKitStrict = ['camera_kit', 'camerakit', 'camera-kit'];
const List<String> _camKitLoose = ['snap', 'lens']; // only in throwaway OS cache dirs
const int _maxDepth = 5; // descend into nested folders, but bound the scan

String lensCacheReport = '';

Future<void> clearCameraKitLensCache() async {
  // Roots paired with the markers we'll DELETE on there:
  //  * OS caches (throwaway)  -> strict + loose markers
  //  * app files/documents    -> strict `camera_kit_*` only (never the loose ones)
  final targets = <String, ({Directory dir, List<String> del})>{};
  Future<void> addOne(Future<Directory?> f, List<String> del) async {
    try { final d = await f; if (d != null) targets[d.path] = (dir: d, del: del); } catch (_) {}
  }
  Future<void> addMany(Future<List<Directory>?> f, List<String> del) async {
    try { final l = await f; if (l != null) for (final d in l) targets[d.path] = (dir: d, del: del); } catch (_) {}
  }
  final looseAndStrict = [..._camKitStrict, ..._camKitLoose];
  await addOne(getTemporaryDirectory(), looseAndStrict);          // Android cacheDir / iOS tmp
  await addOne(getApplicationCacheDirectory(), looseAndStrict);   // Android cacheDir / iOS Library/Caches
  await addMany(getExternalCacheDirectories(), looseAndStrict);   // Android external cache(s)
  await addOne(getApplicationSupportDirectory(), _camKitStrict);  // Android files / iOS App Support
  await addOne(getApplicationDocumentsDirectory(), _camKitStrict); // Android files / iOS Documents

  final seen = <String>[];
  var cleared = 0;
  for (final t in targets.values) {
    cleared += _scan(t.dir, 0, seen, t.del);
  }

  final shown = seen.take(30).toList();
  final more = seen.length - shown.length;
  lensCacheReport = 'cleared $cleared Camera Kit folder(s) across ${targets.length} location(s). '
      'Folders seen: ${shown.isEmpty ? '(none)' : shown.join(', ')}'
      '${more > 0 ? ' …(+$more more)' : ''}';
  debugPrint('[lensCache] $lensCacheReport');
}

// Recursively walk `dir` to _maxDepth. Deletes any folder whose name contains one of
// `deleteMarkers`; records shallow folder names into `seen` (Camera Kit matches get a
// '!' prefix). Returns folders deleted. Only lists directories and never throws.
int _scan(Directory dir, int depth, List<String> seen, List<String> deleteMarkers) {
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
    final low = base.toLowerCase();
    final shouldDelete = deleteMarkers.any((m) => low.contains(m));
    final looksCamKit = _camKitStrict.any((m) => low.contains(m)) ||
        _camKitLoose.any((m) => low.contains(m));
    if (depth <= 1) seen.add(looksCamKit ? '!$base' : base);
    debugPrint('[lensCache] d$depth ${entity.path}${shouldDelete ? '  (clearing)' : ''}');
    if (shouldDelete) {
      try {
        entity.deleteSync(recursive: true);
        cleared++;
      } catch (e) {
        debugPrint('[lensCache] could not delete "$base": $e');
      }
    } else if (!looksCamKit) {
      cleared += _scan(entity, depth + 1, seen, deleteMarkers); // look for a nested one
    }
  }
  return cleared;
}
