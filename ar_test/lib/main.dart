// Throwaway spike: prove DeepAR FOOT-TRACKING shoe try-on works on a real device
// using the maintained community fork `deepar_flutter_plus`. Delete this folder
// afterwards.
//
// Run with your DeepAR Android license key (created in the DeepAR portal for the
// package id `com.example.ar_test`). DO NOT hardcode it:
//   flutter run --dart-define=DEEPAR_ANDROID_KEY=xxxxxxxxxxxx
//
// This build surfaces DIAGNOSTICS on-screen and via debugPrint so we can see what
// the native plugin actually does when it loads the effect. Watch logcat too:
//   adb logcat | findstr /i "deepar SpikeAR"      (Windows)
//   adb logcat | grep -iE "deepar|SpikeAR"        (mac/linux)

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:deepar_flutter_plus/deepar_flutter_plus.dart';
import 'package:flutter_cache_manager/flutter_cache_manager.dart';
import 'package:permission_handler/permission_handler.dart';

const String kAndroidKey = String.fromEnvironment('DEEPAR_ANDROID_KEY');

// Our OWN custom shoe effect (verified valid DeepAR "DA01" binary, ~1.99 MB).
// Using the known-good custom file removes the demo-URL as a variable.
const String kEffectUrl =
    'https://firebasestorage.googleapis.com/v0/b/shoear-65edb.firebasestorage.app/o/model.deepar?alt=media&token=8708d0cd-b3e3-4b38-ab54-bc84a7e4de3d';

void _log(String m) => debugPrint('SpikeAR: $m');

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
  bool _effectLoaded = false; // guard: onViewCreated can re-fire on rebuilds

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
      _log('initialize() start');
      await _controller.initialize(
        androidLicenseKey: kAndroidKey,
        iosLicenseKey: '',
        resolution: Resolution.medium,
      );
      _log('initialize() done');
      setState(() => _initialized = true);
    } catch (e) {
      _log('init error: $e');
      setState(() => _status = 'Init error: $e');
    }
  }

  // called once the DeepAR camera view is ready — download + apply the effect
  Future<void> _loadEffect() async {
    if (_effectLoaded) return;
    _effectLoaded = true;
    try {
      setState(() => _status = 'Downloading shoe effect…');
      _log('downloading effect from $kEffectUrl');
      final file = await DefaultCacheManager().getSingleFile(kEffectUrl);
      _log('downloaded to ${file.path} (${await file.length()} bytes)');

      setState(() => _status = 'Applying effect…');
      final result = await _controller.switchEffect(file.path);
      // deepar_flutter_plus returns a status/message here — surface it verbatim.
      _log('switchEffect returned: $result');
      setState(() => _status =
          'switchEffect => $result\nFlip to REAR camera, point at your foot 👟');
    } catch (e) {
      _log('effect error: $e');
      setState(() => _status = 'Effect error: $e');
    }
  }

  Future<void> _flip() async {
    try {
      _log('flipCamera()');
      await _controller.flipCamera();
    } catch (e) {
      _log('flip error: $e');
      setState(() => _status = 'Flip error: $e');
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
                    const SizedBox(height: 8),
                    if (!_initialized)
                      ElevatedButton(
                        onPressed: _start,
                        child: const Text('Start AR Try-On'),
                      )
                    else
                      ElevatedButton.icon(
                        onPressed: _flip,
                        icon: const Icon(Icons.cameraswitch),
                        label: const Text('Flip camera (use REAR)'),
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
