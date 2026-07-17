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

  /// Launches Camera Kit with [lensId] applied. Requests camera/mic first.
  Future<void> open(String lensId) async {
    await [Permission.camera, Permission.microphone].request();
    await _cameraKit.openCameraKitWithSingleLens(
      lensId: lensId,
      groupId: kCameraKitGroupId,
      isHideCloseButton: false,
    );
  }

  // Required by the events interface; unused for a simple try-on.
  @override
  void receivedLenses(List<Lens> lensList) {}

  @override
  void onCameraKitResult(Map<dynamic, dynamic> result) {}
}
