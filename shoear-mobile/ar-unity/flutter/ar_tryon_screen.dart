// AR Try-On screen (customer app) — hosts the embedded Unity AR Foundation view
// and the on-screen controls the customer uses to fit the shoe.
//
// ACTIVATION: this file is staged outside lib/ on purpose. When you have the
// Unity library exported and `flutter_unity_widget` added (see ../README.md),
// copy it to:  lib/features/ar/screens/ar_tryon_screen.dart
//
// The heavy lifting (camera, SLAM tracking, plane detection, rendering) is done
// by Unity AR Foundation. THIS screen only sends control messages (set model,
// scale, rotate, flip, reset, capture) to Unity and reacts to its events — the
// tunable parameters (base scale, rotation step) live in the Unity controller.

import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter_unity_widget/flutter_unity_widget.dart';

class ArTryOnScreen extends StatefulWidget {
  final String productName;
  final String modelUrl; // .glb/.gltf URL (Firebase) passed to Unity to load

  const ArTryOnScreen({
    super.key,
    required this.productName,
    required this.modelUrl,
  });

  @override
  State<ArTryOnScreen> createState() => _ArTryOnScreenState();
}

class _ArTryOnScreenState extends State<ArTryOnScreen> {
  UnityWidgetController? _unity;

  // The GameObject in the Unity scene that carries ArTryOnController.cs. Flutter
  // addresses Unity messages to (gameObject, method, payload).
  static const _controllerObject = 'ARController';

  bool _ready = false; // Unity has loaded the shoe model and is ready
  bool _placed = false; // the shoe has been placed on a detected surface
  double _scale = 1.0; // user scale factor (1.0 = the tuned base size)

  // ── send a command to the Unity controller ───────────────────────────────
  void _send(String method, String payload) {
    _unity?.postMessage(_controllerObject, method, payload);
  }

  void _onUnityCreated(UnityWidgetController controller) {
    _unity = controller;
    // hand Unity the model to load; it replies with a "ready" event
    _send('SetModel', widget.modelUrl);
  }

  // ── events coming back from Unity ─────────────────────────────────────────
  void _onUnityMessage(dynamic message) {
    Map<String, dynamic> evt;
    try {
      evt = jsonDecode(message.toString()) as Map<String, dynamic>;
    } catch (_) {
      return;
    }
    switch (evt['type']) {
      case 'ready':
        setState(() => _ready = true);
        break;
      case 'placed':
        setState(() => _placed = true);
        break;
      case 'captured':
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Saved: ${evt['data']}')),
        );
        break;
      case 'error':
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Could not load the 3D model.')),
        );
        break;
    }
  }

  @override
  void dispose() {
    _unity?.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.black,
      body: Stack(
        children: [
          // the live AR camera + rendered shoe (Unity)
          Positioned.fill(
            child: UnityWidget(
              onUnityCreated: _onUnityCreated,
              onUnityMessage: _onUnityMessage,
              fullscreen: false,
            ),
          ),

          // top bar: back + product name
          SafeArea(
            child: Padding(
              padding: const EdgeInsets.all(8),
              child: Row(
                children: [
                  CircleAvatar(
                    backgroundColor: Colors.black54,
                    child: IconButton(
                      icon: const Icon(Icons.close, color: Colors.white),
                      onPressed: () => Navigator.of(context).pop(),
                    ),
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      widget.productName,
                      style: const TextStyle(
                        color: Colors.white,
                        fontWeight: FontWeight.w600,
                        shadows: [Shadow(blurRadius: 4, color: Colors.black)],
                      ),
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
                ],
              ),
            ),
          ),

          // guidance banner (until the shoe is placed)
          if (!_placed)
            Positioned(
              left: 16,
              right: 16,
              top: MediaQuery.of(context).padding.top + 56,
              child: Container(
                padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                decoration: BoxDecoration(
                  color: Colors.black.withValues(alpha: 0.55),
                  borderRadius: BorderRadius.circular(10),
                ),
                child: Text(
                  _ready
                      ? 'Point at the floor in good lighting, then tap to place the shoe.'
                      : 'Loading 3D model…',
                  textAlign: TextAlign.center,
                  style: const TextStyle(color: Colors.white),
                ),
              ),
            ),

          // bottom control panel
          Align(
            alignment: Alignment.bottomCenter,
            child: SafeArea(
              child: Container(
                margin: const EdgeInsets.all(12),
                padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                decoration: BoxDecoration(
                  color: Colors.black.withValues(alpha: 0.55),
                  borderRadius: BorderRadius.circular(16),
                ),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    // size (scale) slider — maps to ScaleFactor in Unity
                    Row(
                      children: [
                        const Icon(Icons.straighten, color: Colors.white70, size: 20),
                        Expanded(
                          child: Slider(
                            value: _scale,
                            min: 0.7,
                            max: 1.3,
                            divisions: 12,
                            label: '${(_scale * 100).round()}%',
                            onChanged: _ready
                                ? (v) {
                                    setState(() => _scale = v);
                                    _send('SetScale', v.toStringAsFixed(3));
                                  }
                                : null,
                          ),
                        ),
                      ],
                    ),
                    // action buttons
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceEvenly,
                      children: [
                        _ctl(Icons.rotate_left, 'Rotate', () => _send('Rotate', '-15')),
                        _ctl(Icons.rotate_right, 'Rotate', () => _send('Rotate', '15')),
                        _ctl(Icons.flip, 'Flip', () => _send('Flip', '')),
                        _ctl(Icons.restart_alt, 'Reset', () {
                          setState(() => _scale = 1.0);
                          _send('Reset', '');
                        }),
                        _ctl(Icons.camera_alt, 'Capture', () => _send('Capture', '')),
                      ],
                    ),
                  ],
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _ctl(IconData icon, String label, VoidCallback onTap) {
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        IconButton(
          icon: Icon(icon, color: _ready ? Colors.white : Colors.white38),
          onPressed: _ready ? onTap : null,
        ),
        Text(label, style: const TextStyle(color: Colors.white70, fontSize: 11)),
      ],
    );
  }
}
