// Throwaway spike: prove DeepAR FOOT-TRACKING shoe try-on works on a real device
// using the official webview plugin `deepar_shoe_try_on_flutter`. This is the one
// that already tracked DeepAR's demo shoe on the foot — DeepAR's web engine does
// the camera, foot tracking and shoe rendering. We just host its view and pass a
// `.deepar` effect URL. Delete this whole folder afterwards.
//
// Goal of this run: get OUR OWN custom effect (kCustomEffectUrl) to load + track,
// not just the demo. If the custom URL says "couldn't find this effect", the
// Firebase bucket still needs its CORS policy set (see README, Step CORS).
//
// No license key and no native .aar needed for this plugin — just camera
// permission and minSdk >= 19.

import 'package:flutter/material.dart';
import 'package:deepar_shoe_try_on_flutter/deepar_shoe_try_on_flutter.dart';
import 'package:permission_handler/permission_handler.dart';

// DeepAR's own demo effect — pre-licensed, known to track. Sanity check.
const String kDemoEffectUrl =
    'https://demo.deepar.ai/flutter/shoe/nike-airforce1.deepar';

// OUR custom shoe effect (verified valid DeepAR "DA01" binary).
//
// IMPORTANT: the plugin loads `https://try.deepar.ai/flutter/shoe?e=<thisUrl>`
// WITHOUT url-encoding it. A Firebase download URL carries its own
// `?alt=media&token=` query string, which collides with the `?e=` param and
// strips the token → 403 → "couldn't find this effect". So we MUST use a CLEAN
// url with no `?`/`&`. The direct GCS object url is clean; make the object public
// once (see README):
//   gsutil acl ch -u AllUsers:R gs://shoear-65edb.firebasestorage.app/model.deepar
const String kCustomEffectUrl =
    'https://storage.googleapis.com/shoear-65edb.firebasestorage.app/model.deepar';

void main() => runApp(const MaterialApp(home: SpikeScreen()));

class SpikeScreen extends StatefulWidget {
  const SpikeScreen({super.key});
  @override
  State<SpikeScreen> createState() => _SpikeScreenState();
}

class _SpikeScreenState extends State<SpikeScreen> {
  bool _granted = false;
  // Start on the CUSTOM effect (the real test). Tap the button to compare
  // against the known-good DEMO effect if the custom one doesn't load.
  String _effectUrl = kCustomEffectUrl;
  bool _showingCustom = true;

  @override
  void initState() {
    super.initState();
    _requestCamera();
  }

  Future<void> _requestCamera() async {
    await Permission.camera.request();
    if (mounted) setState(() => _granted = true);
  }

  void _toggleEffect() {
    setState(() {
      _showingCustom = !_showingCustom;
      _effectUrl = _showingCustom ? kCustomEffectUrl : kDemoEffectUrl;
    });
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.black,
      body: Stack(
        children: [
          if (_granted)
            Positioned.fill(
              // key forces the webview to rebuild when the effect URL changes
              child: DeepARShoeTryOnPreview(
                key: ValueKey(_effectUrl),
                link: Uri.parse(_effectUrl),
              ),
            )
          else
            const Center(
              child: Text('Grant camera permission to start',
                  style: TextStyle(color: Colors.white)),
            ),

          // top bar: which effect is loaded
          SafeArea(
            child: Padding(
              padding: const EdgeInsets.all(8),
              child: Container(
                padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                color: Colors.black54,
                child: Text(
                  _showingCustom ? 'CUSTOM effect (Firebase)' : 'DEMO effect',
                  style: const TextStyle(color: Colors.white),
                ),
              ),
            ),
          ),

          // bottom: switch between custom + demo to isolate any problem
          Align(
            alignment: Alignment.bottomCenter,
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: ElevatedButton(
                onPressed: _toggleEffect,
                child: Text(_showingCustom
                    ? 'Switch to DEMO effect'
                    : 'Switch to CUSTOM effect'),
              ),
            ),
          ),
        ],
      ),
    );
  }
}
