// AR Try-On (customer app) — DeepAR foot-tracking shoe try-on.
//
// Uses the `deepar_shoe_try_on_flutter` plugin, which renders DeepAR's web-based
// foot-tracking shoe try-on inside a camera WebView. You pass the URL of a
// `.deepar` effect (built per shoe in DeepAR Studio, hosted e.g. on Firebase).
// DeepAR does the camera, foot tracking, and shoe rendering — this screen just
// hosts its view.
//
// ACTIVATION: staged outside lib/ on purpose (the plugin needs native camera
// permissions + a device to build/run — see ../README.md). When set up, copy to:
//   shoear-mobile/customer/lib/features/ar/screens/ar_tryon_screen.dart
//
// NOTE: the plugin's public API is thin — essentially just the widget + a
// `.deepar` link. Interactions (rotate/flip/reset) come from DeepAR's own web
// try-on UI inside the view, not from Flutter. Confirm the exact import name and
// any license-key requirement against the installed plugin version.

import 'package:flutter/material.dart';
import 'package:deepar_shoe_try_on_flutter/deepar_shoe_try_on_flutter.dart';

class ArTryOnScreen extends StatelessWidget {
  final String productName;
  final String effectUrl; // URL of this product's .deepar shoe effect

  const ArTryOnScreen({
    super.key,
    required this.productName,
    required this.effectUrl,
  });

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.black,
      body: Stack(
        children: [
          // DeepAR foot-tracking camera + shoe overlay
          Positioned.fill(
            child: DeepARShoeTryOnPreview(link: Uri.parse(effectUrl)),
          ),

          // close button + product name
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
                      productName,
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
        ],
      ),
    );
  }
}
