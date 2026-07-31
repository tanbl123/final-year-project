import 'dart:io';
import 'package:flutter/foundation.dart';
import 'package:path_provider/path_provider.dart';

// Camera Kit caches its lens group on-device, so a newly-published try-on lens
// can stay hidden until that cache times out or is cleared by hand. Snap's SDK
// exposes no clear/refresh API through the plugin we vendor, so we mimic a
// targeted "Clear cache": delete only Camera Kit's own cache folders, leaving
// product-image and other caches intact.
//
// The folder's name and location are undocumented and vary by SDK version and
// platform, so this is best-effort and DIAGNOSTIC: it records every shallow
// folder name it sees (lensCacheReport, shown in a debug line under the AR
// button) so the real Camera Kit folder can be identified on-device — Honor/
// Huawei block `adb logcat`, so the terminal route usually shows nothing.
//
// Deletion happens ONLY in disposable cache dirs. The app's files/documents dirs
// are LISTED for diagnosis but never deleted from (they can hold real data).
// Fully best-effort: never throws.
const List<String> _camKitMarkers = [
  'camerakit', 'camera_kit', 'camera-kit', 'snap', 'lens',
];
const int _maxDepth = 5; // descend into nested folders, but bound the scan

// Human-readable summary of the last run (folders seen + cleared), surfaced in a
// debug-only UI line so it can be verified/diagnosed on-device without logcat.
String lensCacheReport = '';

Future<void> clearCameraKitLensCache() async {
  // Disposable caches — safe to DELETE Camera Kit folders from.
  final deleteRoots = <String, Directory>{};
  // App data dirs — LIST ONLY (may hold real data), to find where the cache lives.
  final listRoots = <String, Directory>{};

  Future<void> addTo(Map<String, Directory> m, Future<Directory?> f) async {
    try { final d = await f; if (d != null) m[d.path] = d; } catch (_) {/* ignore */}
  }
  Future<void> addAllTo(Map<String, Directory> m, Future<List<Directory>?> f) async {
    try { final l = await f; if (l != null) for (final d in l) m[d.path] = d; } catch (_) {/* ignore */}
  }
  await addTo(deleteRoots, getTemporaryDirectory());          // Android cacheDir / iOS tmp
  await addTo(deleteRoots, getApplicationCacheDirectory());   // Android cacheDir / iOS Library/Caches
  await addAllTo(deleteRoots, getExternalCacheDirectories()); // Android external cache(s)
  await addTo(listRoots, getApplicationSupportDirectory());   // Android files / iOS App Support
  await addTo(listRoots, getApplicationDocumentsDirectory()); // Android files / iOS Documents

  final seen = <String>[]; // shallow folder names we saw (for diagnosis)
  var cleared = 0;
  for (final root in deleteRoots.values) {
    cleared += _scan(root, 0, seen, canDelete: true);
  }
  for (final root in listRoots.values) {
    _scan(root, 0, seen, canDelete: false);
  }

  final shown = seen.take(30).toList();
  final more = seen.length - shown.length;
  lensCacheReport = 'cleared $cleared folder(s) across ${deleteRoots.length} cache root(s). '
      'Folders seen: ${shown.isEmpty ? '(none)' : shown.join(', ')}'
      '${more > 0 ? ' …(+$more more)' : ''}';
  debugPrint('[lensCache] $lensCacheReport');
}

// Recursively walk `dir` to _maxDepth. Records shallow folder names into `seen`.
// When canDelete, deletes any folder whose name looks like Camera Kit's cache;
// otherwise (list-only dirs) it just flags a match with a leading '!'. Returns the
// number of folders deleted. Only lists directories and never throws.
int _scan(Directory dir, int depth, List<String> seen, {required bool canDelete}) {
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
    final isCamKit = _camKitMarkers.any((m) => base.toLowerCase().contains(m));
    if (depth <= 1) seen.add(isCamKit ? '!$base' : base); // '!' marks a Camera Kit match
    debugPrint('[lensCache] d$depth ${entity.path}'
        '${isCamKit ? (canDelete ? '  (clearing)' : '  (FOUND, not deleting — app data dir)') : ''}');
    if (isCamKit && canDelete) {
      try {
        entity.deleteSync(recursive: true);
        cleared++;
      } catch (e) {
        debugPrint('[lensCache] could not delete "$base": $e');
      }
    } else if (!isCamKit) {
      cleared += _scan(entity, depth + 1, seen, canDelete: canDelete); // look deeper
    }
  }
  return cleared;
}
