// Snapchat Camera Kit AR foot-tracking shoe try-on for the customer app.
//
// Each product's shoe is a lens in ONE Camera Kit "lens group" (all ShoeAR
// try-on lenses live in a single group). We open a product's lens by its id
// (product.arLensId, set by an admin after building the lens in Lens Studio).
//
// NATIVE SETUP (see shoear-mobile/ar-deepar/README or the ar_test spike):
//   Android – AndroidManifest.xml meta-data:
//     com.snap.camerakit.app.id   = <App ID>
//     com.snap.camerakit.api.token = <staging/production token>   (KEEP LOCAL)
//   Android – AppCompat theme, minSdk >= 21, and force a Camera Kit SDK new
//   enough for the lens in android/app/build.gradle.kts:
//     configurations.all { resolutionStrategy.eachDependency {
//       if (requested.group == "com.snap.camerakit" &&
//           requested.name != "support-media-picker-source" &&
//           requested.name != "support-media-recording") useVersion("1.50.0") } }
//   iOS – Info.plist SCCameraKitClientID / SCCameraKitAPIToken + camera usage.

import 'package:camerakit_flutter/camerakit_flutter.dart';
import 'package:camerakit_flutter/lens_model.dart';
import 'package:permission_handler/permission_handler.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:customer/features/ar/ar_lens_cache.dart';

/// The Camera Kit lens GROUP that holds all ShoeAR try-on lenses. Not a secret —
/// just an identifier. Override at build time with --dart-define=CK_GROUP_ID=...
const String kCameraKitGroupId = String.fromEnvironment(
  'CK_GROUP_ID',
  defaultValue: 'fdac5175-05fe-47e9-adf5-108b36419d71',
);

/// Opens the native Camera Kit try-on with a single product lens applied.
class ArTryOnService implements CameraKitFlutterEvents {
  late final CameraKitFlutterImpl _cameraKit =
      CameraKitFlutterImpl(cameraKitFlutterEvents: this);

  static const _seenLensKey = 'ar_seen_lens_ids';

  /// Launches Camera Kit with [lensId] applied. Requests camera/mic first.
  /// [version] is the lens's save timestamp (product.arLensUpdatedAt); passing it
  /// lets us also refresh when the admin re-publishes NEW content under the SAME id.
  Future<void> open(String lensId, {String? version}) async {
    await [Permission.camera, Permission.microphone].request();
    await _refreshCacheIfNewLens(lensId, version);
    await _cameraKit.openCameraKitWithSingleLens(
      lensId: lensId,
      groupId: kCameraKitGroupId,
      isHideCloseButton: false,
    );
  }

  /// Camera Kit caches the group's lens content, so a re-published shoe can stay
  /// stale. Rather than clearing on every launch, we clear ONLY when opening a lens
  /// we haven't cached before. We key on the lens id AND its save version, so BOTH a
  /// brand-new id AND a re-published same id (the admin re-saved -> newer version)
  /// force one fresh fetch; opening the same id+version again skips the clear, so
  /// normal try-ons stay fast. Best-effort: never blocks or fails the AR open.
  Future<void> _refreshCacheIfNewLens(String lensId, String? version) async {
    try {
      final token = '$lensId@${version ?? ''}';   // id + version identifies the cached content
      final prefs = await SharedPreferences.getInstance();
      final seen = prefs.getStringList(_seenLensKey) ?? <String>[];
      if (seen.contains(token)) return;        // already cached this exact lens+version
      await clearCameraKitLensCache();         // new id or newer version -> force a fresh fetch
      seen.add(token);
      await prefs.setStringList(_seenLensKey, seen);
    } catch (_) {/* never let cache housekeeping stop a try-on */}
  }


  // Required by the events interface; unused for a simple try-on.
  @override
  void receivedLenses(List<Lens> lensList) {}

  @override
  void onCameraKitResult(Map<dynamic, dynamic> result) {}
}
