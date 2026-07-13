// Throwaway spike: prove Snapchat Camera Kit FOOT-TRACKING shoe try-on works on a
// real device, using our OWN custom shoe lens built in Lens Studio. Delete this
// folder when done.
//
// Camera Kit credentials (App ID + API token) live in AndroidManifest.xml
// meta-data (see README) — NOT here. The lens GROUP ID is passed at run time:
//   flutter run --dart-define=CK_GROUP_ID=your-lens-group-id
//
// openCameraKit(groupIds) launches Snapchat's native camera activity with the
// group's lenses applied live — point at your foot to try the shoe on.

import 'package:flutter/material.dart';
import 'package:camerakit_flutter/camerakit_flutter.dart';
import 'package:permission_handler/permission_handler.dart';

// Lens group ID from the Snap developer portal (after publishing the lens).
const String kGroupId = String.fromEnvironment('CK_GROUP_ID');

void main() => runApp(const MaterialApp(home: SpikeScreen()));

class SpikeScreen extends StatefulWidget {
  const SpikeScreen({super.key});
  @override
  State<SpikeScreen> createState() => _SpikeScreenState();
}

class _SpikeScreenState extends State<SpikeScreen>
    implements CameraKitFlutterEvents {
  late final CameraKitFlutterImpl _cameraKit =
      CameraKitFlutterImpl(cameraKitFlutterEvents: this);
  String _status = 'Tap to open Camera Kit AR try-on';

  Future<void> _open() async {
    if (kGroupId.isEmpty) {
      setState(() => _status =
          'No lens group ID.\nRun:\nflutter run --dart-define=CK_GROUP_ID=YOUR_GROUP_ID');
      return;
    }
    setState(() => _status = 'Requesting camera/mic permission…');
    await [Permission.camera, Permission.microphone].request();
    try {
      setState(() => _status = 'Opening Camera Kit… point at your foot 👟');
      await _cameraKit.openCameraKit(
        groupIds: [kGroupId],
        isHideCloseButton: false,
      );
    } catch (e) {
      setState(() => _status = 'Camera Kit error: $e');
    }
  }

  // Fired when the lens group's lenses are returned (we can list/switch them).
  @override
  void receivedLenses(List<Lens> lensList) {
    setState(() => _status =
        'Loaded ${lensList.length} lens(es): ${lensList.map((l) => l.name).join(", ")}');
  }

  // Fired when the user captures a photo/video in the Camera Kit UI.
  @override
  void onCameraKitResult(Map<dynamic, dynamic> result) {
    setState(() => _status =
        'Captured ${result["type"]} → ${result["path"]}');
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.black,
      body: Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(
                _status,
                textAlign: TextAlign.center,
                style: const TextStyle(color: Colors.white),
              ),
              const SizedBox(height: 24),
              ElevatedButton.icon(
                onPressed: _open,
                icon: const Icon(Icons.camera_alt),
                label: const Text('Open AR Try-On'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
