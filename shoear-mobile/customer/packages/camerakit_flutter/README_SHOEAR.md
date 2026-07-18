# Vendored `camerakit_flutter` (ShoeAR patches)

This is a local copy of [`DevCrew-io/camerakit-flutter`](https://github.com/DevCrew-io/camerakit-flutter)
v1.0.7 (MIT — see `LICENSE`), vendored into the app so we can tailor the AR
try-on screen. The upstream plugin launches Snap's full reference camera
(selfie-facing, photo/video capture, gallery import) which is wrong for a shoe
try-on. We changed four things; each is marked with a `// ShoeAR:` comment.

| # | Change | File | Why |
|---|--------|------|-----|
| 1 | Rear camera by default (`EXTRA_CAMERA_FACING_FRONT = false`, ignore lens facing preference) | `ARCameraActivity.kt` | You point the camera at your feet, not your face. Flip button still works. |
| 2 | `PLAY` mode instead of `CAPTURE` mode | `CamerakitFlutterPlugin.kt` (`OPEN_SINGLE_LENS`) | Removes the photo/video capture button — the try-on is the only focus. |
| 3 | Dropped `READ_EXTERNAL_STORAGE` | `AndroidManifest.xml` | Play mode saves no media, so no "access photos and videos" prompt. |
| 4 | Back/close button pinned top-left, notch-safe, translucent circle bg | `res/layout/camera_kit_activity_camerakit_camera.xml` + `res/drawable/close_btn_bg.xml` | An in-app way back to the product page that's visible on any background. |

The Dart API is unchanged — `openCameraKitWithSingleLens(lensId, groupId, isHideCloseButton)`
still works exactly as before, so `lib/features/ar/ar_tryon_service.dart` needs no edits.

## To revert to the pub.dev plugin
In `pubspec.yaml`, replace the `path:` dependency with `camerakit_flutter: ^1.0.7`,
then `flutter pub get`.

## Upstream
Source: https://github.com/DevCrew-io/camerakit-flutter — MIT License.
Only the four changes above differ from upstream v1.0.7.
