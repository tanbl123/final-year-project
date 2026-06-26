import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import 'package:customer/features/order/models/order.dart';
import 'package:customer/features/order/services/order_service.dart';
import 'package:customer/core/widgets/product_image.dart';
import 'package:customer/core/utils/snackbar.dart';
import 'package:customer/features/order/screens/orders_screen.dart' show kOrderStatusColors, prettyStatus;

const Map<String, Color> _deliveryColors = {
  'Pending': Colors.orange,
  'Assigned': Colors.blue,
  'PickedUp': Colors.indigo,
  'OutForDelivery': Colors.indigo,
  'Delivered': Colors.green,
  'Failed': Colors.red,
};

/// One order in full: items, payment, and per-parcel delivery tracking. Each
/// supplier's parcel ships independently, so each shows its own status and —
/// when it's out for delivery — the OTP the customer reads to the courier.
class OrderDetailScreen extends StatefulWidget {
  final String orderId;
  const OrderDetailScreen({super.key, required this.orderId});

  @override
  State<OrderDetailScreen> createState() => _OrderDetailScreenState();
}

class _OrderDetailScreenState extends State<OrderDetailScreen> {
  late Future<CustomerOrder> _future;

  @override
  void initState() {
    super.initState();
    _future = context.read<OrderService>().getOrder(widget.orderId);
  }

  Future<void> _refresh() async {
    final next = context.read<OrderService>().getOrder(widget.orderId);
    setState(() => _future = next);
    await next;
  }

  static const _refundableStatuses = {'Paid', 'Processing', 'Shipped', 'OutForDelivery', 'Delivered', 'Completed'};
  static const _activeRefundStatuses = {'Pending', 'Approved', 'Completed'};

  bool _canRequestRefund(CustomerOrder o) =>
      _refundableStatuses.contains(o.orderStatus) &&
      !o.refunds.any((r) => _activeRefundStatuses.contains(r.refundStatus));

  Future<void> _requestRefund() async {
    final reasonCtrl = TextEditingController();
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Request a refund'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Text('Tell us why you want a refund. An admin will review your request.'),
            const SizedBox(height: 12),
            TextField(
              controller: reasonCtrl,
              autofocus: true,
              minLines: 2,
              maxLines: 4,
              maxLength: 255,
              decoration: const InputDecoration(hintText: 'Reason', border: OutlineInputBorder()),
            ),
          ],
        ),
        actions: [
          TextButton(onPressed: () => Navigator.of(ctx).pop(false), child: const Text('Cancel')),
          FilledButton(onPressed: () => Navigator.of(ctx).pop(true), child: const Text('Submit')),
        ],
      ),
    );
    final reason = reasonCtrl.text.trim();
    reasonCtrl.dispose();
    if (ok != true) return;
    if (reason.isEmpty) {
      if (mounted) context.showSnack('A reason is required.');
      return;
    }
    if (reason.length < 5) {
      if (mounted) context.showSnack('Please give a bit more detail (at least 5 characters).');
      return;
    }
    try {
      await context.read<OrderService>().requestRefund(widget.orderId, reason);
      if (!mounted) return;
      context.showSnack('Refund request submitted.');
      _refresh();
    } catch (e) {
      if (mounted) context.showSnack(e.toString());
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text('Order ${widget.orderId}')),
      body: FutureBuilder<CustomerOrder>(
        future: _future,
        builder: (context, snap) {
          if (snap.connectionState == ConnectionState.waiting) {
            return const Center(child: CircularProgressIndicator());
          }
          if (snap.hasError) {
            return Center(
              child: Padding(
                padding: const EdgeInsets.all(24),
                child: Text(snap.error.toString(), textAlign: TextAlign.center, style: const TextStyle(color: Colors.grey)),
              ),
            );
          }
          return RefreshIndicator(onRefresh: _refresh, child: _body(context, snap.data!));
        },
      ),
    );
  }

  Widget _body(BuildContext context, CustomerOrder o) {
    final theme = Theme.of(context);
    final orderColor = kOrderStatusColors[o.orderStatus] ?? Colors.grey;
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        Row(
          children: [
            Expanded(child: Text(_fmtDate(o.orderDate), style: TextStyle(color: Colors.grey.shade600))),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
              decoration: BoxDecoration(color: orderColor.withValues(alpha: 0.12), borderRadius: BorderRadius.circular(12)),
              child: Text(prettyStatus(o.orderStatus), style: TextStyle(color: orderColor, fontWeight: FontWeight.w600)),
            ),
          ],
        ),

        const SizedBox(height: 20),
        _title(context, 'Delivery tracking'),
        if (o.deliveries.isEmpty)
          Text('Not dispatched yet.', style: TextStyle(color: Colors.grey.shade600))
        else
          for (final d in o.deliveries) _ParcelCard(parcel: d),

        const SizedBox(height: 20),
        _title(context, 'Items'),
        for (final it in o.items)
          Padding(
            padding: const EdgeInsets.symmetric(vertical: 6),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                ClipRRect(
                  borderRadius: BorderRadius.circular(8),
                  child: SizedBox(width: 52, height: 52, child: ProductImage(url: it.imageUrl)),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(it.productName, style: const TextStyle(fontWeight: FontWeight.w600)),
                      Text('${it.brand} · Size ${it.size} · x${it.qty}',
                          style: TextStyle(fontSize: 12, color: Colors.grey.shade600)),
                    ],
                  ),
                ),
                Text('RM ${it.subtotal.toStringAsFixed(2)}'),
              ],
            ),
          ),
        const Divider(height: 24),
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Text('Total', style: theme.textTheme.titleMedium),
            Text('RM ${o.total.toStringAsFixed(2)}',
                style: theme.textTheme.titleMedium?.copyWith(fontWeight: FontWeight.bold, color: theme.colorScheme.primary)),
          ],
        ),

        const SizedBox(height: 20),
        _title(context, 'Payment'),
        _kv('Method', o.paymentMethod ?? '—'),
        _kv('Status', o.paymentStatus ?? '—'),
        if (o.paymentDate != null) _kv('Date', _fmtDate(o.paymentDate)),

        const SizedBox(height: 20),
        _title(context, 'Delivery address'),
        Text(o.deliveryAddress),

        if (o.refunds.isNotEmpty) ...[
          const SizedBox(height: 20),
          _title(context, 'Refunds'),
          for (final r in o.refunds)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 4),
              child: Row(
                children: [
                  Expanded(child: Text(r.refundReason, maxLines: 2, overflow: TextOverflow.ellipsis)),
                  const SizedBox(width: 8),
                  Text('${r.refundStatus} · RM ${r.refundAmount.toStringAsFixed(2)}',
                      style: TextStyle(color: Colors.grey.shade700, fontSize: 12)),
                ],
              ),
            ),
        ],

        if (_canRequestRefund(o)) ...[
          const SizedBox(height: 24),
          OutlinedButton.icon(
            onPressed: _requestRefund,
            icon: const Icon(Icons.assignment_return_outlined),
            label: const Text('Request a refund'),
          ),
        ],
      ],
    );
  }

  Widget _title(BuildContext context, String t) => Padding(
        padding: const EdgeInsets.only(bottom: 8),
        child: Text(t, style: Theme.of(context).textTheme.titleMedium),
      );

  Widget _kv(String k, String v) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 2),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            SizedBox(width: 80, child: Text(k, style: const TextStyle(color: Colors.grey))),
            Expanded(child: Text(v)),
          ],
        ),
      );

  String _fmtDate(String? iso) {
    if (iso == null) return '—';
    final d = DateTime.tryParse(iso);
    if (d == null) return iso;
    final l = d.toLocal();
    return '${l.day}/${l.month}/${l.year} ${l.hour.toString().padLeft(2, '0')}:${l.minute.toString().padLeft(2, '0')}';
  }
}

class _ParcelCard extends StatelessWidget {
  final ParcelDelivery parcel;
  const _ParcelCard({required this.parcel});

  @override
  Widget build(BuildContext context) {
    final color = _deliveryColors[parcel.deliveryStatus] ?? Colors.grey;
    final showOtp = parcel.deliveryStatus == 'OutForDelivery' && (parcel.otpCode?.isNotEmpty ?? false);
    return Card(
      margin: const EdgeInsets.only(bottom: 10),
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(child: Text(parcel.supplierName, style: const TextStyle(fontWeight: FontWeight.w600))),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                  decoration: BoxDecoration(color: color.withValues(alpha: 0.12), borderRadius: BorderRadius.circular(12)),
                  child: Text(prettyStatus(parcel.deliveryStatus), style: TextStyle(color: color, fontWeight: FontWeight.w600, fontSize: 12)),
                ),
              ],
            ),
            if (parcel.estimatedDeliveryTime != null) ...[
              const SizedBox(height: 4),
              Text('Est. delivery: ${_fmt(parcel.estimatedDeliveryTime!)}', style: TextStyle(fontSize: 12, color: Colors.grey.shade600)),
            ],
            if (showOtp) ...[
              const SizedBox(height: 10),
              Container(
                width: double.infinity,
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: Colors.amber.shade50,
                  border: Border.all(color: Colors.amber.shade300),
                  borderRadius: BorderRadius.circular(8),
                ),
                child: Column(
                  children: [
                    Text('Show this code to the courier', style: TextStyle(fontSize: 12, color: Colors.amber.shade900)),
                    const SizedBox(height: 4),
                    Text(parcel.otpCode!, style: const TextStyle(fontSize: 26, fontWeight: FontWeight.bold, letterSpacing: 6)),
                  ],
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }

  String _fmt(String iso) {
    final d = DateTime.tryParse(iso);
    if (d == null) return iso;
    final l = d.toLocal();
    return '${l.day}/${l.month}/${l.year} ${l.hour.toString().padLeft(2, '0')}:${l.minute.toString().padLeft(2, '0')}';
  }
}
