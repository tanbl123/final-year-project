// Throwaway spike: prove DeepAR FOOT-TRACKING shoe try-on works on a real device
// using the maintained community fork `deepar_flutter_plus` (the official DeepAR
// Flutter plugin is abandoned/broken). Delete this whole folder afterwards.
//
// Pass your DeepAR Android license key at run time (do NOT hardcode it):
//   flutter run --dart-define=DEEPAR_ANDROID_KEY=xxxxxxxxxxxx
//
// The license key is created in the DeepAR developer portal for the package id
// `com.example.ar_test` (this spike's applicationId).
//
// NOTE: exact method names may differ slightly by plugin version — if something
// doesn't resolve, cross-check the deepar_flutter_plus example on pub.dev.

import 'package:flutter/material.dart';
import 'package:deepar_flutter_plus/deepar_flutter_plus.dart';
import 'package:flutter_cache_manager/flutter_cache_manager.dart';
import 'package:permission_handler/permission_handler.dart';

const String kAndroidKey = String.fromEnvironment('DEEPAR_ANDROID_KEY');

// A DeepAR foot-tracking shoe effect. If this URL 404s, replace it with a
// `.deepar` shoe effect you export from DeepAR Studio and host somewhere.
const String kEffectUrl =
    'https://demo.deepar.ai/flutter/shoe/nike-airforce1.deepar';

void main() => runApp(const MaterialApp(home: SpikeScreen()));

class SpikeScreen extends StatefulWidget {
  const SpikeScreen({super.key});
  @override
  State<SpikeScreen> createState() => _SpikeScreenState();
}

class _SpikeScreenState extends State<SpikeScreen> {
  final DeepArControllerPlus _controller = DeepArControllerPlus();
  String _status = 'Tap Start to begin';
  bool _initialized = false;

  Future<void> _start() async {
    try {
      if (kAndroidKey.isEmpty) {
        setState(() => _status =
            'No license key.\nRun:\nflutter run --dart-define=DEEPAR_ANDROID_KEY=YOUR_KEY');
        return;
      }
      setState(() => _status = 'Requesting camera permission…');
      await [Permission.camera, Permission.microphone].request();

      setState(() => _status = 'Initializing DeepAR…');
      await _controller.initialize(
        androidLicenseKey: kAndroidKey,
        iosLicenseKey: '',
        resolution: Resolution.medium,
      );
      setState(() => _initialized = true);
    } catch (e) {
      setState(() => _status = 'Init error: $e');
    }
  }

  // called once the DeepAR camera view is ready — download + apply the effect
  Future<void> _loadEffect() async {
    try {
      setState(() => _status = 'Downloading shoe effect…');
      final file = await DefaultCacheManager().getSingleFile(kEffectUrl);
      setState(() => _status = 'Applying effect…');
      await _controller.switchEffect(file.path);
      setState(() => _status = 'Point the camera at your feet 👟');
    } catch (e) {
      setState(() => _status = 'Effect error: $e');
    }
  }

  @override
  void dispose() {
    _controller.destroy();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.black,
      body: SafeArea(
        child: Stack(
          children: [
            if (_initialized)
              Positioned.fill(
                child: DeepArPreviewPlus(_controller, onViewCreated: _loadEffect),
              ),
            Align(
              alignment: Alignment.bottomCenter,
              child: Container(
                width: double.infinity,
                color: Colors.black54,
                padding: const EdgeInsets.all(12),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(
                      _status,
                      textAlign: TextAlign.center,
                      style: const TextStyle(color: Colors.white),
                    ),
                    if (!_initialized)
                      Padding(
                        padding: const EdgeInsets.only(top: 8),
                        child: ElevatedButton(
                          onPressed: _start,
                          child: const Text('Start AR Try-On'),
                        ),
                      ),
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
