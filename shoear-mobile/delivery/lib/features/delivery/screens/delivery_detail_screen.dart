import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:image_picker/image_picker.dart';
import 'package:provider/provider.dart';

import 'package:delivery/core/utils/snackbar.dart';
import 'package:delivery/features/delivery/models/delivery.dart';
import 'package:delivery/features/delivery/services/delivery_service.dart';
import 'package:delivery/features/delivery/screens/report_issue_screen.dart';
import 'package:delivery/features/delivery/widgets/status_chip.dart';

/// One delivery: pickup + drop-off info, items, and the status workflow
/// (pick up → out for delivery → confirm with the customer's OTP), plus
/// proof-of-delivery photo upload.
class DeliveryDetailScreen extends StatefulWidget {
  final String deliveryId;
  const DeliveryDetailScreen({super.key, required this.deliveryId});

  @override
  State<DeliveryDetailScreen> createState() => _DeliveryDetailScreenState();
}

class _DeliveryDetailScreenState extends State<DeliveryDetailScreen> {
  late Future<DeliveryDetail> _future;
  final _otp = TextEditingController();
  File? _proofPhoto;   // proof-of-delivery photo staged for the confirm step
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    _future = _load();
  }

  @override
  void dispose() {
    _otp.dispose();
    super.dispose();
  }

  Future<DeliveryDetail> _load() => context.read<DeliveryService>().detail(widget.deliveryId);

  void _reload() => setState(() => _future = _load());

  void _toast(String msg) => context.showSnack(msg);

  Future<void> _setStatus(String status) async {
    setState(() => _busy = true);
    try {
      await context.read<DeliveryService>().updateStatus(widget.deliveryId, status);
      _reload();
    } catch (e) {
      _toast(e.toString());
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  // Confirm delivery requires BOTH the 4-digit OTP and a proof photo. They're
  // sent together so a parcel can't be closed with only one.
  Future<void> _confirmDelivery() async {
    final code = _otp.text.trim();
    if (_proofPhoto == null) {
      _toast('Take a proof-of-delivery photo first.');
      return;
    }
    if (code.length != 4) {
      _toast('Enter the 4-digit customer OTP.');
      return;
    }
    setState(() => _busy = true);
    try {
      await context.read<DeliveryService>().verifyOtp(widget.deliveryId, code, _proofPhoto!);
      _otp.clear();
      setState(() => _proofPhoto = null);
      _toast('Delivery confirmed.');
      _reload();
    } catch (e) {
      _toast(e.toString());
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  // Pick/snap the proof photo and stage it locally — it's uploaded as part of
  // the confirm-delivery request, not on its own.
  Future<void> _pickProof() async {
    final source = await showModalBottomSheet<ImageSource>(
      context: context,
      builder: (_) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            ListTile(
              leading: const Icon(Icons.photo_camera_outlined),
              title: const Text('Take a photo'),
              onTap: () => Navigator.pop(context, ImageSource.camera),
            ),
            ListTile(
              leading: const Icon(Icons.photo_library_outlined),
              title: const Text('Choose from gallery'),
              onTap: () => Navigator.pop(context, ImageSource.gallery),
            ),
          ],
        ),
      ),
    );
    if (source == null) return;

    final picked = await ImagePicker().pickImage(source: source, maxWidth: 1600, imageQuality: 80);
    if (picked == null) return;

    setState(() => _proofPhoto = File(picked.path));
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Delivery')),
      body: FutureBuilder<DeliveryDetail>(
        future: _future,
        builder: (context, snap) {
          if (snap.connectionState == ConnectionState.waiting) {
            return const Center(child: CircularProgressIndicator());
          }
          if (snap.hasError) {
            return Center(child: Padding(padding: const EdgeInsets.all(24), child: Text(snap.error.toString(), textAlign: TextAlign.center)));
          }
          final d = snap.data!;
          return ListView(
            padding: const EdgeInsets.all(16),
            children: [
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Text('Order ${d.orderId}', style: Theme.of(context).textTheme.titleLarge),
                  StatusChip(status: d.status),
                ],
              ),
              const SizedBox(height: 16),
              _section('Pick up', Icons.store_outlined, [
                d.supplierName ?? '—',
                d.pickupAddress ?? '—',
              ]),
              const SizedBox(height: 12),
              _section('Deliver to', Icons.location_on_outlined, [
                d.customerName ?? '—',
                d.deliveryAddress ?? '—',
                if (d.customerPhone != null) 'Phone: ${d.customerPhone}',
              ]),
              const SizedBox(height: 16),
              Text('Items', style: Theme.of(context).textTheme.titleMedium),
              const SizedBox(height: 8),
              for (final it in d.items)
                Padding(
                  padding: const EdgeInsets.symmetric(vertical: 5),
                  child: Row(
                    crossAxisAlignment: CrossAxisAlignment.center,
                    children: [
                      _ItemThumb(url: it.imageUrl),
                      const SizedBox(width: 12),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text('${it.brand} ${it.productName}',
                                style: const TextStyle(fontWeight: FontWeight.w600)),
                            const SizedBox(height: 2),
                            Text('Size ${it.size}  ·  x${it.qty}',
                                style: TextStyle(fontSize: 12, color: Colors.grey.shade600)),
                          ],
                        ),
                      ),
                    ],
                  ),
                ),
              const Divider(height: 28),
              if (d.proofOfDelivery != null) ...[
                Text('Proof of delivery', style: Theme.of(context).textTheme.titleMedium),
                const SizedBox(height: 8),
                ClipRRect(
                  borderRadius: BorderRadius.circular(8),
                  child: Image.network(d.proofOfDelivery!, height: 180, fit: BoxFit.cover,
                      errorBuilder: (_, __, ___) => const SizedBox.shrink()),
                ),
                const SizedBox(height: 16),
              ],
              ..._actions(d),
            ],
          );
        },
      ),
    );
  }

  Widget _section(String title, IconData icon, List<String> lines) => Container(
        width: double.infinity,
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          border: Border.all(color: Colors.grey.shade300),
          borderRadius: BorderRadius.circular(10),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(children: [
              Icon(icon, size: 18, color: Colors.grey.shade700),
              const SizedBox(width: 6),
              Text(title, style: const TextStyle(fontWeight: FontWeight.bold)),
            ]),
            const SizedBox(height: 6),
            for (final l in lines) Padding(padding: const EdgeInsets.only(top: 2), child: Text(l)),
          ],
        ),
      );

  /// Status-driven action buttons.
  Future<void> _reportIssue(String orderId) async {
    final reported = await Navigator.of(context).push<bool>(
      MaterialPageRoute(
        builder: (_) => ReportIssueScreen(deliveryId: widget.deliveryId, orderId: orderId),
      ),
    );
    if (reported == true && mounted) {
      _toast('Issue reported. Support has been notified.');
      _reload();
    }
  }

  // a "Report an issue" button shown while the delivery is still active
  Widget _reportIssueButton(String orderId) => OutlinedButton.icon(
        onPressed: () => _reportIssue(orderId),
        icon: const Icon(Icons.report_gmailerrorred_outlined, color: Colors.red),
        label: const Text('Report an issue', style: TextStyle(color: Colors.red)),
        style: OutlinedButton.styleFrom(foregroundColor: Colors.red, side: const BorderSide(color: Colors.red)),
      );

  List<Widget> _actions(DeliveryDetail d) {
    if (_busy) {
      return const [Center(child: Padding(padding: EdgeInsets.all(16), child: CircularProgressIndicator()))];
    }
    switch (d.status) {
      case 'Assigned':
        return [
          FilledButton.icon(
            onPressed: () => _setStatus('PickedUp'),
            icon: const Icon(Icons.inventory_2_outlined),
            label: const Text('Mark as picked up'),
            style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(48)),
          ),
          const SizedBox(height: 8),
          _reportIssueButton(d.orderId),
        ];
      case 'PickedUp':
        return [
          FilledButton.icon(
            onPressed: () => _setStatus('OutForDelivery'),
            icon: const Icon(Icons.local_shipping_outlined),
            label: const Text('Start delivery (out for delivery)'),
            style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(48)),
          ),
          const SizedBox(height: 8),
          _reportIssueButton(d.orderId),
        ];
      case 'OutForDelivery':
        return [
          Text('Confirm delivery', style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(height: 4),
          Text('Both a proof-of-delivery photo and the customer’s 4-digit OTP are required.',
              style: TextStyle(fontSize: 12, color: Colors.grey.shade600)),
          const SizedBox(height: 12),

          // 1) proof photo — staged locally, uploaded on confirm
          Text('1. Proof of delivery photo', style: Theme.of(context).textTheme.labelLarge),
          const SizedBox(height: 6),
          if (_proofPhoto != null) ...[
            ClipRRect(
              borderRadius: BorderRadius.circular(8),
              child: Image.file(_proofPhoto!, height: 160, width: double.infinity, fit: BoxFit.cover),
            ),
            const SizedBox(height: 8),
          ],
          OutlinedButton.icon(
            onPressed: _pickProof,
            icon: Icon(_proofPhoto == null ? Icons.add_a_photo_outlined : Icons.refresh),
            label: Text(_proofPhoto == null ? 'Take proof photo' : 'Retake photo'),
            style: OutlinedButton.styleFrom(minimumSize: const Size.fromHeight(48)),
          ),
          const SizedBox(height: 16),

          // 2) customer OTP
          Text('2. Customer OTP', style: Theme.of(context).textTheme.labelLarge),
          const SizedBox(height: 6),
          TextField(
            controller: _otp,
            keyboardType: TextInputType.number,
            maxLength: 4,
            inputFormatters: [FilteringTextInputFormatter.digitsOnly, LengthLimitingTextInputFormatter(4)],
            decoration: const InputDecoration(
              labelText: 'Customer OTP',
              border: OutlineInputBorder(),
              counterText: '',
            ),
          ),
          const SizedBox(height: 8),

          // 3) confirm — sends photo + OTP together
          FilledButton.icon(
            onPressed: _confirmDelivery,
            icon: const Icon(Icons.check_circle_outline),
            label: const Text('Confirm delivery'),
            style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(48)),
          ),
          const SizedBox(height: 8),
          _reportIssueButton(d.orderId),
        ];
      default:
        // Delivered / Failed — terminal
        return [
          Center(
            child: Text(
              d.status == 'Delivered' ? '✓ Delivered' : 'Delivery failed',
              style: TextStyle(
                fontWeight: FontWeight.bold,
                color: d.status == 'Delivered' ? Colors.green.shade700 : Colors.red.shade700,
              ),
            ),
          ),
        ];
    }
  }
}

/// Small product thumbnail for the items list — shows the shoe image when
/// available, otherwise a neutral placeholder.
class _ItemThumb extends StatelessWidget {
  final String? url;
  const _ItemThumb({this.url});

  @override
  Widget build(BuildContext context) {
    final placeholder = Container(
      width: 48,
      height: 48,
      color: Colors.grey.shade200,
      child: Icon(Icons.image_not_supported_outlined, size: 20, color: Colors.grey.shade400),
    );
    return ClipRRect(
      borderRadius: BorderRadius.circular(8),
      child: (url == null)
          ? placeholder
          : Image.network(
              url!,
              width: 48,
              height: 48,
              fit: BoxFit.cover,
              errorBuilder: (_, __, ___) => placeholder,
              loadingBuilder: (context, child, progress) => progress == null
                  ? child
                  : SizedBox(
                      width: 48,
                      height: 48,
                      child: Center(
                        child: SizedBox(
                          width: 16, height: 16,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        ),
                      ),
                    ),
            ),
    );
  }
}
