import 'package:flutter/material.dart';

/// Read-only view of the courier's verified identity card (IC). Kept off the
/// main Profile screen and behind a tap so the IC number and photos aren't
/// exposed at a glance to anyone glancing at the phone. The IC is a fixed
/// identity document (verified at approval) and can't be changed here.
class IdentityCardScreen extends StatelessWidget {
  final String? icNumber;
  final String? icFrontUrl;
  final String? icBackUrl;

  const IdentityCardScreen({
    super.key,
    this.icNumber,
    this.icFrontUrl,
    this.icBackUrl,
  });

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Identity card (IC)')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          const Text(
            'Your verified identity document. It can\'t be changed here — contact '
            'support if any detail is incorrect.',
            style: TextStyle(fontSize: 12, color: Colors.grey),
          ),
          const SizedBox(height: 16),
          _row('IC number', (icNumber?.isNotEmpty ?? false) ? icNumber! : '—'),
          const SizedBox(height: 16),
          _docThumb(context, 'IC (front)', icFrontUrl),
          _docThumb(context, 'IC (back)', icBackUrl),
        ],
      ),
    );
  }

  Widget _row(String k, String v) => Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(width: 110, child: Text(k, style: const TextStyle(color: Colors.grey))),
          Expanded(child: Text(v)),
        ],
      );

  // A labelled, read-only document preview. Tap to open full-screen and zoom.
  Widget _docThumb(BuildContext context, String label, String? url) {
    if (url == null || url.isEmpty) return const SizedBox.shrink();
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(label, style: const TextStyle(fontSize: 12, color: Colors.grey)),
          const SizedBox(height: 4),
          GestureDetector(
            onTap: () => _openFullScreen(context, label, url),
            child: ClipRRect(
              borderRadius: BorderRadius.circular(8),
              child: Stack(
                children: [
                  Image.network(url, height: 150, width: double.infinity, fit: BoxFit.cover,
                      errorBuilder: (_, __, ___) => Container(
                            height: 90, width: double.infinity, color: Colors.grey.shade200,
                            child: const Center(child: Icon(Icons.description_outlined, color: Colors.grey)),
                          )),
                  Positioned(
                    right: 6,
                    bottom: 6,
                    child: Container(
                      padding: const EdgeInsets.all(4),
                      decoration: BoxDecoration(color: Colors.black54, borderRadius: BorderRadius.circular(6)),
                      child: const Icon(Icons.zoom_in, color: Colors.white, size: 18),
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

  void _openFullScreen(BuildContext context, String label, String url) {
    Navigator.of(context).push(MaterialPageRoute(
      fullscreenDialog: true,
      builder: (_) => Scaffold(
        backgroundColor: Colors.black,
        appBar: AppBar(
          backgroundColor: Colors.black,
          foregroundColor: Colors.white,
          title: Text(label, style: const TextStyle(color: Colors.white, fontSize: 16)),
        ),
        body: Center(
          child: InteractiveViewer(
            minScale: 0.8,
            maxScale: 5,
            child: Image.network(url, fit: BoxFit.contain,
                loadingBuilder: (_, child, progress) =>
                    progress == null ? child : const CircularProgressIndicator(color: Colors.white),
                errorBuilder: (_, __, ___) => const Icon(Icons.broken_image_outlined, color: Colors.white70, size: 48)),
          ),
        ),
      ),
    ));
  }
}
