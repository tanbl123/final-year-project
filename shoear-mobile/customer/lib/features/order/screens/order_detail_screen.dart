import 'dart:async';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import 'package:customer/features/order/models/order.dart';
import 'package:customer/features/order/services/order_service.dart';
import 'package:customer/features/order/services/order_payment.dart';
import 'package:customer/core/widgets/product_image.dart';
import 'package:customer/core/utils/snackbar.dart';
import 'package:customer/core/utils/refresh_bus.dart';
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
  // The loaded order is kept in state (not a FutureBuilder) so background
  // refreshes (poll / push / resume) update it WITHOUT tearing the subtree down
  // to a loading spinner — which previously crashed when a dialog was open.
  CustomerOrder? _order;
  Object? _error;
  bool _paying = false;
  Timer? _poll; // scoped polling while an active delivery is on screen

  // Order is post-payment and not yet finished → worth polling while watched.
  static const _terminal = {'Delivered', 'Completed', 'Cancelled'};
  bool _isActive(CustomerOrder o) =>
      o.orderStatus != 'Placed' && !_terminal.contains(o.orderStatus);

  @override
  void initState() {
    super.initState();
    _refresh();
    appRefreshTick.addListener(_onRefreshSignal);
  }

  @override
  void dispose() {
    _poll?.cancel();
    appRefreshTick.removeListener(_onRefreshSignal);
    super.dispose();
  }

  // A push arrived or the app resumed — re-fetch this order.
  void _onRefreshSignal() {
    if (mounted && !_paying) _refresh();
  }

  /// Re-fetch the order, keeping the current one visible meanwhile (no spinner
  /// flash, no subtree teardown).
  Future<void> _refresh() async {
    try {
      final o = await context.read<OrderService>().getOrder(widget.orderId);
      if (!mounted) return;
      setState(() {
        _order = o;
        _error = null;
      });
      _managePolling(o);
    } catch (e) {
      if (!mounted) return;
      setState(() => _error = e);
    }
  }

  /// Start a 20s poll only while this order is an active (in-transit) delivery;
  /// stop it once the order is delivered/completed/cancelled or unpaid.
  void _managePolling(CustomerOrder o) {
    if (!mounted) return;
    if (_isActive(o)) {
      _poll ??= Timer.periodic(const Duration(seconds: 20), (_) {
        if (mounted && !_paying) _refresh();
      });
    } else {
      _poll?.cancel();
      _poll = null;
    }
  }

  static const _refundableStatuses = {'Paid', 'Processing', 'Shipped', 'OutForDelivery', 'Delivered', 'Completed'};
  static const _activeRefundStatuses = {'Pending', 'Approved', 'Completed'};

  bool _canRequestRefund(CustomerOrder o) =>
      _refundableStatuses.contains(o.orderStatus) &&
      !o.refunds.any((r) => _activeRefundStatuses.contains(r.refundStatus));

  Future<void> _payNow() async {
    setState(() => _paying = true);
    try {
      final result =
          await payOrderWithStripe(context.read<OrderService>(), widget.orderId);
      if (!mounted) return;
      context.showSnack(result == PayResult.paid
          ? 'Payment successful.'
          : 'Payment cancelled — your order is still awaiting payment.');
    } catch (e) {
      if (mounted) context.showSnack(e.toString());
    } finally {
      if (mounted) setState(() => _paying = false);
      await _refresh();
    }
  }

  Future<void> _requestRefund() async {
    // The dialog owns its TextEditingController and disposes it in its own
    // State, so the controller is never disposed across an async gap.
    final reason = await showDialog<String>(
      context: context,
      builder: (_) => const _RefundDialog(),
    );
    if (reason == null) return; // cancelled (dialog validated the reason inline)
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
    final order = _order;
    final awaiting = order?.orderStatus == 'Placed';
    return Scaffold(
      backgroundColor: Colors.grey.shade100,
      appBar: AppBar(
        title: Text('Order ${widget.orderId}'),
        backgroundColor: Colors.white,
        surfaceTintColor: Colors.white,
      ),
      body: order == null
          ? (_error != null
              ? Center(
                  child: Padding(
                    padding: const EdgeInsets.all(24),
                    child: Text(_error.toString(),
                        textAlign: TextAlign.center,
                        style: const TextStyle(color: Colors.grey)),
                  ),
                )
              : const Center(child: CircularProgressIndicator()))
          : RefreshIndicator(onRefresh: _refresh, child: _body(context, order)),
      bottomNavigationBar: order == null
          ? null
          : awaiting
              ? _payBar(context, order)
              : _canRequestRefund(order)
                  ? _refundBar(context)
                  : null,
    );
  }

  Widget _refundBar(BuildContext context) {
    final red = Colors.red.shade400;
    return SafeArea(
      child: Container(
        padding: const EdgeInsets.fromLTRB(16, 12, 16, 12),
        decoration: BoxDecoration(
          color: Colors.white,
          boxShadow: [
            BoxShadow(
                color: Colors.black.withValues(alpha: 0.07),
                blurRadius: 12,
                offset: const Offset(0, -3)),
          ],
        ),
        child: OutlinedButton.icon(
          onPressed: _requestRefund,
          icon: Icon(Icons.assignment_return_outlined, size: 18, color: red),
          label: Text('Request a refund',
              style: TextStyle(fontWeight: FontWeight.w600, color: red)),
          style: OutlinedButton.styleFrom(
            minimumSize: const Size.fromHeight(50),
            side: BorderSide(color: Colors.red.shade200),
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
          ),
        ),
      ),
    );
  }

  Widget _payBar(BuildContext context, CustomerOrder o) {
    return SafeArea(
      child: Container(
        padding: const EdgeInsets.fromLTRB(16, 12, 16, 12),
        decoration: BoxDecoration(
          color: Colors.white,
          boxShadow: [
            BoxShadow(
                color: Colors.black.withValues(alpha: 0.07),
                blurRadius: 12,
                offset: const Offset(0, -3)),
          ],
        ),
        child: FilledButton.icon(
          onPressed: _paying ? null : _payNow,
          icon: _paying
              ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
              : const Icon(Icons.lock_outline, size: 18),
          label: Text(_paying ? 'Processing…' : 'Pay now  ·  RM ${o.total.toStringAsFixed(2)}',
              style: const TextStyle(fontSize: 15, fontWeight: FontWeight.bold)),
          style: FilledButton.styleFrom(
            minimumSize: const Size.fromHeight(52),
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
          ),
        ),
      ),
    );
  }

  Widget _body(BuildContext context, CustomerOrder o) {
    final primary = Theme.of(context).colorScheme.primary;
    final awaiting = o.orderStatus == 'Placed';
    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 24),
      children: [
        _StatusBanner(order: o),
        const SizedBox(height: 12),

        // Delivery tracking
        _Card(
          icon: Icons.local_shipping_outlined,
          title: 'Delivery Tracking',
          child: o.deliveries.isEmpty
              ? Text('Not dispatched yet.', style: TextStyle(color: Colors.grey.shade600))
              : Column(
                  children: [
                    for (int i = 0; i < o.deliveries.length; i++) ...[
                      if (i > 0) const Divider(height: 20),
                      _ParcelBlock(parcel: o.deliveries[i]),
                    ],
                  ],
                ),
        ),
        const SizedBox(height: 12),

        // Items + total
        _Card(
          icon: Icons.shopping_bag_outlined,
          title: 'Items (${o.items.length})',
          child: Column(
            children: [
              for (int i = 0; i < o.items.length; i++) ...[
                if (i > 0) const Divider(height: 18),
                _ItemRow(item: o.items[i], primary: primary),
              ],
              const Padding(padding: EdgeInsets.symmetric(vertical: 10), child: Divider(height: 1)),
              Row(
                children: [
                  const Text('Total', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 15)),
                  const Spacer(),
                  Text('RM ${o.total.toStringAsFixed(2)}',
                      style: TextStyle(fontWeight: FontWeight.bold, fontSize: 17, color: primary)),
                ],
              ),
            ],
          ),
        ),
        const SizedBox(height: 12),

        // Payment
        _Card(
          icon: Icons.payment_outlined,
          title: 'Payment',
          child: Column(
            children: [
              _kv('Method', o.paymentMethod ?? '—'),
              _kv('Status', o.paymentStatus ?? (awaiting ? 'Unpaid' : '—')),
              if (o.paymentDate != null) _kv('Date', _fmtDate(o.paymentDate)),
            ],
          ),
        ),
        const SizedBox(height: 12),

        // Delivery address
        _Card(
          icon: Icons.location_on_outlined,
          title: 'Delivery Address',
          child: Align(
            alignment: Alignment.centerLeft,
            child: Text(o.deliveryAddress, style: const TextStyle(height: 1.4)),
          ),
        ),

        // Refunds
        if (o.refunds.isNotEmpty) ...[
          const SizedBox(height: 12),
          _Card(
            icon: Icons.assignment_return_outlined,
            title: 'Refunds',
            child: Column(
              children: [
                for (int i = 0; i < o.refunds.length; i++) ...[
                  if (i > 0) const Divider(height: 16),
                  Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Expanded(child: Text(o.refunds[i].refundReason, maxLines: 2, overflow: TextOverflow.ellipsis)),
                      const SizedBox(width: 8),
                      Text('${o.refunds[i].refundStatus} · RM ${o.refunds[i].refundAmount.toStringAsFixed(2)}',
                          style: TextStyle(color: Colors.grey.shade700, fontSize: 12)),
                    ],
                  ),
                ],
              ],
            ),
          ),
        ],

      ],
    );
  }

  Widget _kv(String k, String v) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 3),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            SizedBox(width: 80, child: Text(k, style: TextStyle(color: Colors.grey.shade600, fontSize: 13))),
            Expanded(child: Text(v, style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w500))),
          ],
        ),
      );

  String _fmtDate(String? iso) {
    if (iso == null) return '—';
    final d = DateTime.tryParse(iso);
    if (d == null) return iso;
    final l = d.toLocal();
    final h = l.hour % 12 == 0 ? 12 : l.hour % 12;
    final ampm = l.hour < 12 ? 'AM' : 'PM';
    final mm = l.minute.toString().padLeft(2, '0');
    return '${l.day}/${l.month}/${l.year} · $h:$mm $ampm';
  }
}

// ── Status banner ───────────────────────────────────────────────────────────
class _StatusBanner extends StatelessWidget {
  final CustomerOrder order;
  const _StatusBanner({required this.order});

  (IconData, String) _meta(String s) {
    switch (s) {
      case 'Placed': return (Icons.payments_outlined, 'Awaiting payment');
      case 'Paid': return (Icons.inventory_2_outlined, 'Paid · preparing your order');
      case 'Processing': return (Icons.inventory_2_outlined, 'Preparing your order');
      case 'Shipped': return (Icons.local_shipping_outlined, 'Shipped');
      case 'OutForDelivery': return (Icons.local_shipping_outlined, 'Out for delivery');
      case 'Delivered': return (Icons.check_circle_outline, 'Delivered');
      case 'Completed': return (Icons.check_circle_outline, 'Completed');
      case 'Cancelled': return (Icons.cancel_outlined, 'Cancelled');
      default: return (Icons.receipt_long_outlined, prettyStatus(s));
    }
  }

  String _fmtDate(String? iso) {
    if (iso == null) return '';
    final d = DateTime.tryParse(iso);
    if (d == null) return iso;
    final l = d.toLocal();
    return 'Ordered ${l.day}/${l.month}/${l.year}';
  }

  @override
  Widget build(BuildContext context) {
    final color = order.orderStatus == 'Placed'
        ? Colors.orange.shade700
        : (kOrderStatusColors[order.orderStatus] ?? Colors.grey);
    final (icon, title) = _meta(order.orderStatus);
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.10),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: color.withValues(alpha: 0.25)),
      ),
      child: Row(
        children: [
          Container(
            width: 44,
            height: 44,
            decoration: BoxDecoration(color: color.withValues(alpha: 0.15), shape: BoxShape.circle),
            child: Icon(icon, color: color, size: 24),
          ),
          const SizedBox(width: 14),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(title, style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16, color: color)),
                const SizedBox(height: 2),
                Text(_fmtDate(order.orderDate), style: TextStyle(fontSize: 12, color: Colors.grey.shade700)),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

// ── White section card ─────────────────────────────────────────────────────
class _Card extends StatelessWidget {
  final IconData icon;
  final String title;
  final Widget child;
  const _Card({required this.icon, required this.title, required this.child});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Container(
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(14),
        boxShadow: [
          BoxShadow(color: Colors.black.withValues(alpha: 0.04), blurRadius: 8, offset: const Offset(0, 2)),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 14, 16, 10),
            child: Row(
              children: [
                Icon(icon, size: 18, color: theme.colorScheme.primary),
                const SizedBox(width: 8),
                Text(title, style: theme.textTheme.titleSmall?.copyWith(fontWeight: FontWeight.bold)),
              ],
            ),
          ),
          const Divider(height: 1),
          Padding(padding: const EdgeInsets.all(16), child: child),
        ],
      ),
    );
  }
}

// ── One item row ────────────────────────────────────────────────────────────
class _ItemRow extends StatelessWidget {
  final OrderItem item;
  final Color primary;
  const _ItemRow({required this.item, required this.primary});

  @override
  Widget build(BuildContext context) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.center,
      children: [
        ClipRRect(
          borderRadius: BorderRadius.circular(10),
          child: SizedBox(width: 52, height: 52, child: ProductImage(url: item.imageUrl)),
        ),
        const SizedBox(width: 12),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(item.brand.toUpperCase(),
                  style: TextStyle(fontSize: 10, color: primary, fontWeight: FontWeight.w600, letterSpacing: 0.8)),
              Text(item.productName, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 13)),
              Text('Size ${item.size} · Qty ${item.qty}', style: TextStyle(fontSize: 11, color: Colors.grey.shade600)),
            ],
          ),
        ),
        const SizedBox(width: 8),
        Text('RM ${item.subtotal.toStringAsFixed(2)}', style: const TextStyle(fontWeight: FontWeight.bold)),
      ],
    );
  }
}

// ── One parcel block (inside the Delivery Tracking card) ────────────────────
class _ParcelBlock extends StatelessWidget {
  final ParcelDelivery parcel;
  const _ParcelBlock({required this.parcel});

  @override
  Widget build(BuildContext context) {
    final color = _deliveryColors[parcel.deliveryStatus] ?? Colors.grey;
    final showOtp = parcel.deliveryStatus == 'OutForDelivery' && (parcel.otpCode?.isNotEmpty ?? false);
    return Column(
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
    );
  }

  String _fmt(String iso) {
    final d = DateTime.tryParse(iso);
    if (d == null) return iso;
    final l = d.toLocal();
    final h = l.hour % 12 == 0 ? 12 : l.hour % 12;
    final ampm = l.hour < 12 ? 'AM' : 'PM';
    return '${l.day}/${l.month}/${l.year} · $h:${l.minute.toString().padLeft(2, '0')} $ampm';
  }
}

// ── Self-contained refund dialog (owns + disposes its own controller) ───────
class _RefundDialog extends StatefulWidget {
  const _RefundDialog();

  @override
  State<_RefundDialog> createState() => _RefundDialogState();
}

class _RefundDialogState extends State<_RefundDialog> {
  final _ctrl = TextEditingController();
  String? _error;

  @override
  void dispose() {
    _ctrl.dispose();
    super.dispose();
  }

  void _submit() {
    final reason = _ctrl.text.trim();
    if (reason.isEmpty) {
      setState(() => _error = 'A reason is required.');
      return;
    }
    if (reason.length < 5) {
      setState(() => _error = 'Please give a bit more detail (at least 5 characters).');
      return;
    }
    Navigator.of(context).pop(reason);
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('Request a refund'),
      content: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          const Text('Tell us why you want a refund. An admin will review your request.'),
          const SizedBox(height: 12),
          TextField(
            controller: _ctrl,
            autofocus: true,
            minLines: 2,
            maxLines: 4,
            maxLength: 255,
            decoration: InputDecoration(
              hintText: 'Reason',
              border: const OutlineInputBorder(),
              errorText: _error, // inline error, not a snackbar
            ),
            onChanged: (_) {
              if (_error != null) setState(() => _error = null);
            },
          ),
        ],
      ),
      actions: [
        TextButton(onPressed: () => Navigator.of(context).pop(), child: const Text('Cancel')),
        FilledButton(onPressed: _submit, child: const Text('Submit')),
      ],
    );
  }
}
