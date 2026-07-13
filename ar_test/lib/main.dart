// Throwaway spike: diagnose why our CUSTOM DeepAR shoe effect hangs at "Loading
// AR" while the demo effect reaches "FootTracking initialized!".
//
// Reproduces what the official plugin does — load
// `https://try.deepar.ai/flutter/shoe?e=<effectUrl>` in a WebView with camera
// permission — but shows the web player's console + errors LIVE ON SCREEN.
//
// Uses a SINGLE persistent WebView and just navigates it when switching effects,
// so the camera is always released cleanly (avoids the camera-contention that a
// second WebView caused). A heartbeat prints elapsed seconds so we can tell a
// true hang from a slow load.

import 'dart:async';
import 'package:flutter/material.dart';
import 'package:webview_flutter/webview_flutter.dart';
import 'package:webview_flutter_android/webview_flutter_android.dart';
import 'package:permission_handler/permission_handler.dart';

const String kBaseUrl = 'https://try.deepar.ai/flutter/shoe';
const String kDemoEffectUrl =
    'https://demo.deepar.ai/flutter/shoe/nike-airforce1.deepar';
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
  int _elapsed = 0;
  Timer? _heartbeat;

  @override
  void initState() {
    super.initState();
    _boot();
  }

  @override
  void dispose() {
    _heartbeat?.cancel();
    super.dispose();
  }

  void _add(String line) {
    setState(() {
      _log.add('${_elapsed}s  $line');
      if (_log.length > 80) _log.removeAt(0);
    });
  }

  Future<void> _boot() async {
    await Permission.camera.request();

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
    _controller = controller;

    // heartbeat: proves the app is alive and shows how long we've been loading
    _heartbeat = Timer.periodic(const Duration(seconds: 1), (_) {
      _elapsed++;
    });

    _navigate(kCustomEffectUrl);
  }

  Future<void> _navigate(String effectUrl) async {
    final url = '$kBaseUrl?e=$effectUrl';
    setState(() {
      _log.clear();
      _elapsed = 0;
      _progress = 0;
    });
    _add('LOADING ${_showingCustom ? "CUSTOM" : "DEMO"}: $url');
    await _controller?.loadRequest(Uri.parse(url));
  }

  Future<void> _toggle() async {
    // navigate away first so the current effect's camera is released
    await _controller?.loadRequest(Uri.parse('about:blank'));
    await Future.delayed(const Duration(milliseconds: 500));
    _showingCustom = !_showingCustom;
    _navigate(_showingCustom ? kCustomEffectUrl : kDemoEffectUrl);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.black,
      body: SafeArea(
        child: Column(
          children: [
            Container(
              width: double.infinity,
              color: Colors.black,
              padding: const EdgeInsets.all(8),
              child: Text(
                '${_showingCustom ? "CUSTOM" : "DEMO"}   ·   progress $_progress%   ·   ${_elapsed}s',
                style: const TextStyle(color: Colors.white, fontSize: 12),
              ),
            ),
            Expanded(
              flex: 3,
              child: _controller == null
                  ? const Center(
                      child: Text('starting…',
                          style: TextStyle(color: Colors.white)))
                  : WebViewWidget(controller: _controller!),
            ),
            Expanded(
              flex: 2,
              child: Container(
                width: double.infinity,
                color: const Color(0xFF101418),
                padding: const EdgeInsets.all(6),
                // newest at top so the latest lines are always visible
                child: ListView(
                  children: _log.reversed
                      .map((l) => Text(l,
                          style: TextStyle(
                            color: l.contains('✖') ||
                                    l.toLowerCase().contains('error')
                                ? Colors.redAccent
                                : (l.toLowerCase().contains('warning')
                                    ? Colors.amberAccent
                                    : Colors.greenAccent),
                            fontSize: 10,
                            fontFamily: 'monospace',
                          )))
                      .toList(),
                ),
              ),
            ),
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
