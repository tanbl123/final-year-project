// Throwaway spike app: prove DeepAR foot-tracking shoe try-on works on a real
// device using DeepAR's own (pre-licensed) demo effect — BEFORE we build our own
// effects or touch the real customer app. Delete this whole folder afterwards.

import 'package:flutter/material.dart';
import 'package:deepar_shoe_try_on_flutter/deepar_shoe_try_on_flutter.dart';

void main() => runApp(const MaterialApp(home: HomeScreen()));

class HomeScreen extends StatelessWidget {
  const HomeScreen({super.key});
  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('DeepAR spike')),
      body: Center(
        child: ElevatedButton(
          onPressed: () => Navigator.of(context).push(
            MaterialPageRoute(builder: (_) => const TryOnScreen()),
          ),
          child: const Text('Start AR Try-On'),
        ),
      ),
    );
  }
}

class TryOnScreen extends StatelessWidget {
  const TryOnScreen({super.key});
  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.black,
      body: SafeArea(
        child: Stack(
          children: [
            Positioned.fill(
              child: DeepARShoeTryOnPreview(
                link: Uri.parse(
                  'https://demo.deepar.ai/flutter/shoe/nike-airforce1.deepar',
                ),
              ),
            ),
            Align(
              alignment: Alignment.topLeft,
              child: IconButton(
                icon: const Icon(Icons.close, color: Colors.white, size: 30),
                onPressed: () => Navigator.of(context).pop(),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
