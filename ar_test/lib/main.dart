// Throwaway spike: diagnose why our CUSTOM DeepAR shoe effect hangs at "Loading
// AR" on DeepAR's web engine while the demo effect works.
//
// We reproduce EXACTLY what the official `deepar_shoe_try_on_flutter` plugin does
// — load `https://try.deepar.ai/flutter/shoe?e=<effectUrl>` in a WebView with
// camera permission — BUT we also capture the web player's console messages and
// errors and show them LIVE ON SCREEN, so we can see the real failure without adb.
//
// Toggle between the DEMO effect (known-good) and our CUSTOM effect to compare.

import 'package:flutter/material.dart';
import 'package:webview_flutter/webview_flutter.dart';
import 'package:webview_flutter_android/webview_flutter_android.dart';
import 'package:permission_handler/permission_handler.dart';

// DeepAR's web shoe-player base (same as the plugin's kBaseUrl).
const String kBaseUrl = 'https://try.deepar.ai/flutter/shoe';

// Known-good demo effect (no query string).
const String kDemoEffectUrl =
    'https://demo.deepar.ai/flutter/shoe/nike-airforce1.deepar';

// Our custom effect — clean public GCS url (no query string to break `?e=`).
const String kCustomEffectUrl =
    'https://storage.googleapis.com/shoear-65edb.firebasestorage.app/model.deepar';

void main() => runApp(const MaterialApp(home: SpikeScreen()));

class SpikeScreen extends StatefulWidget {
  const SpikeScreen({super.key});
  @override
  State<SpikeScreen> createState() => _SpikeScreenState();
}

class _SpikeScreenState extends State<SpikeScreen> {
  WebViewController? _controller;
  final List<String> _log = [];
  bool _showingCustom = true;
  int _progress = 0;

  @override
  void initState() {
    super.initState();
    _load(kCustomEffectUrl);
  }

  void _add(String line) {
    // keep the last 60 lines
    setState(() {
      _log.add(line);
      if (_log.length > 60) _log.removeAt(0);
    });
  }

  Future<void> _load(String effectUrl) async {
    await Permission.camera.request();
    final url = '$kBaseUrl?e=$effectUrl';

    final params = AndroidWebViewControllerCreationParams();
    final controller = WebViewController.fromPlatformCreationParams(
      params,
      onPermissionRequest: (request) async {
        _add('↳ permission requested: ${request.types.map((t) => t.name).join(",")}');
        await request.grant();
      },
    );

    controller
      ..setJavaScriptMode(JavaScriptMode.unrestricted)
      ..setBackgroundColor(const Color(0xFF000000))
      ..setOnConsoleMessage((m) => _add('console[${m.level.name}]: ${m.message}'))
      ..setNavigationDelegate(NavigationDelegate(
        onProgress: (p) => setState(() => _progress = p),
        onPageStarted: (u) => _add('▶ page started'),
        onPageFinished: (u) => _add('■ page finished'),
        onWebResourceError: (e) => _add(
            '✖ RESOURCE ERROR: ${e.errorCode} ${e.description} (${e.url ?? ""})'),
        onHttpError: (e) =>
            _add('✖ HTTP ERROR: ${e.response?.statusCode} ${e.request?.uri}'),
      ));

    if (controller.platform is AndroidWebViewController) {
      (controller.platform as AndroidWebViewController)
          .setMediaPlaybackRequiresUserGesture(false);
    }

    _add('LOADING: $url');
    await controller.loadRequest(Uri.parse(url));
    setState(() => _controller = controller);
  }

  void _toggle() {
    _showingCustom = !_showingCustom;
    _log.clear();
    _load(_showingCustom ? kCustomEffectUrl : kDemoEffectUrl);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.black,
      body: SafeArea(
        child: Column(
          children: [
            // header
            Container(
              width: double.infinity,
              color: Colors.black,
              padding: const EdgeInsets.all(8),
              child: Text(
                '${_showingCustom ? "CUSTOM" : "DEMO"} effect   ·   progress $_progress%',
                style: const TextStyle(color: Colors.white, fontSize: 12),
              ),
            ),
            // webview (top half)
            Expanded(
              flex: 3,
              child: _controller == null
                  ? const Center(
                      child: Text('starting…',
                          style: TextStyle(color: Colors.white)))
                  : WebViewWidget(controller: _controller!),
            ),
            // console log (bottom half) — this is the diagnostic
            Expanded(
              flex: 2,
              child: Container(
                width: double.infinity,
                color: const Color(0xFF101418),
                padding: const EdgeInsets.all(6),
                child: ListView(
                  reverse: false,
                  children: _log
                      .map((l) => Text(l,
                          style: TextStyle(
                            color: l.contains('✖') || l.toLowerCase().contains('error')
                                ? Colors.redAccent
                                : Colors.greenAccent,
                            fontSize: 10,
                            fontFamily: 'monospace',
                          )))
                      .toList(),
                ),
              ),
            ),
            // toggle
            SizedBox(
              width: double.infinity,
              child: ElevatedButton(
                onPressed: _toggle,
                child: Text(_showingCustom
                    ? 'Switch to DEMO effect'
                    : 'Switch to CUSTOM effect'),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
