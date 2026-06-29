import 'dart:async';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';
import 'package:image_picker/image_picker.dart';

import 'package:customer/features/order/models/order.dart';
import 'package:customer/features/order/services/order_service.dart';
import 'package:customer/features/order/services/order_payment.dart';
import 'package:customer/core/widgets/product_image.dart';
import 'package:customer/core/utils/snackbar.dart';
import 'package:customer/core/utils/refresh_bus.dart';
import 'package:customer/features/order/screens/refund_detail_screen.dart';
import 'package:customer/features/order/screens/orders_screen.dart' show kOrderStatusColors, prettyStatus;
import 'package:customer/features/review/services/review_service.dart';
import 'package:customer/features/review/widgets/review_sheet.dart';
import 'package:customer/features/checkout/screens/receipt_screen.dart';

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
  bool _cancelling = false;
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

  Future<void> _cancelOrder() async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Cancel this order?'),
        content: const Text(
            "The order hasn't shipped yet, so you'll be refunded in full. This can't be undone."),
        actions: [
          TextButton(onPressed: () => Navigator.of(ctx).pop(false), child: const Text('Keep order')),
          FilledButton(
            onPressed: () => Navigator.of(ctx).pop(true),
            style: FilledButton.styleFrom(backgroundColor: Colors.red.shade400),
            child: const Text('Cancel order'),
          ),
        ],
      ),
    );
    if (ok != true) return;
    setState(() => _cancelling = true);
    try {
      await context.read<OrderService>().cancelOrder(widget.orderId);
      if (!mounted) return;
      context.showSnack('Order cancelled — you will be refunded in full.');
      bumpRefresh();
    } catch (e) {
      if (mounted) context.showSnack(e.toString());
    } finally {
      if (mounted) setState(() => _cancelling = false);
      await _refresh();
    }
  }

  Future<void> _payNow() async {
    final orders = context.read<OrderService>();
    setState(() => _paying = true);
    try {
      final result = await payOrderWithStripe(orders, widget.orderId);
      if (!mounted) return;
      if (result == PayResult.paid) {
        // Same success/receipt screen as paying at checkout.
        try {
          final receipt = await orders.getReceipt(widget.orderId);
          if (!mounted) return;
          await Navigator.of(context).push(
            MaterialPageRoute(builder: (_) => ReceiptScreen(receipt: receipt)),
          );
        } catch (_) {
          if (mounted) context.showSnack('Payment successful.');
        }
      } else {
        context.showSnack('Payment cancelled — your order is still awaiting payment.');
      }
    } catch (e) {
      if (mounted) context.showSnack(e.toString());
    } finally {
      // The receipt's "Continue shopping" may have popped this screen, so guard.
      if (mounted) {
        setState(() => _paying = false);
        await _refresh();
      }
    }
  }

  Future<void> _viewReceipt() async {
    try {
      final receipt = await context.read<OrderService>().getReceipt(widget.orderId);
      if (!mounted) return;
      Navigator.of(context).push(
        MaterialPageRoute(builder: (_) => ReceiptScreen(receipt: receipt, confirmation: false)),
      );
    } catch (e) {
      if (mounted) context.showSnack(e.toString());
    }
  }

  Future<void> _rateItem(OrderItem item) async {
    final result = await showModalBottomSheet<ReviewResult>(
      context: context,
      isScrollControlled: true,
      builder: (_) => ReviewSheet(productName: item.productName),
    );
    if (result == null) return; // dismissed
    try {
      await context.read<ReviewService>().create(item.productId, result.rating, result.comment);
      if (!mounted) return;
      context.showSnack('Thanks for your review!');
      bumpRefresh();    // product rating changed elsewhere (catalog/product page)
      await _refresh(); // reflect the "Rated" state on this order
    } catch (e) {
      if (mounted) context.showSnack(e.toString());
    }
  }

  Future<void> _requestRefund() async {
    // The dialog owns its controller/image and validates inline; it returns the
    // reason + an optional proof photo only once valid.
    final result = await showModalBottomSheet<(String, List<File>)>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(
          borderRadius: BorderRadius.vertical(top: Radius.circular(20))),
      builder: (_) => const _RefundSheet(),
    );
    if (result == null) return; // cancelled
    final (reason, proofs) = result;
    final orders = context.read<OrderService>();
    try {
      final urls = <String>[];
      for (final p in proofs) {
        urls.add(await orders.uploadRefundProof(p));
      }
      await orders.requestRefund(widget.orderId, reason, refundProofs: urls);
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
              : order.canCancel
                  ? _cancelBar(context)
                  : order.canRefund
                      ? _refundBar(context)
                      : null,
    );
  }

  Widget _cancelBar(BuildContext context) {
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
          onPressed: _cancelling ? null : _cancelOrder,
          icon: _cancelling
              ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2))
              : Icon(Icons.cancel_outlined, size: 18, color: Colors.red.shade400),
          label: Text('Cancel order',
              style: TextStyle(fontWeight: FontWeight.w600, color: Colors.red.shade400)),
          style: OutlinedButton.styleFrom(
            minimumSize: const Size.fromHeight(50),
            side: BorderSide(color: Colors.red.shade200),
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
          ),
        ),
      ),
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
                      _ParcelBlock(parcel: o.deliveries[i], orderId: o.orderId),
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
                _ItemRow(
                  item: o.items[i],
                  primary: primary,
                  canReview: o.canReview,
                  onRate: () => _rateItem(o.items[i]),
                ),
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
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              _kv('Method', o.paymentMethod ?? '—'),
              _kv('Status', o.paymentStatus ?? (awaiting ? 'Unpaid' : '—')),
              if (o.paymentDate != null) _kv('Date', _fmtDate(o.paymentDate)),
              if (o.paymentStatus == 'Successful') ...[
                const SizedBox(height: 6),
                const Divider(height: 1),
                const SizedBox(height: 6),
                Align(
                  alignment: Alignment.centerLeft,
                  child: TextButton.icon(
                    onPressed: _viewReceipt,
                    icon: const Icon(Icons.receipt_long_outlined, size: 18),
                    label: const Text('View receipt'),
                    style: TextButton.styleFrom(
                        foregroundColor: primary, padding: EdgeInsets.zero, visualDensity: VisualDensity.compact),
                  ),
                ),
              ],
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
                  InkWell(
                    onTap: () => Navigator.of(context).push(MaterialPageRoute(
                        builder: (_) => RefundDetailScreen(refund: o.refunds[i]))),
                    child: Padding(
                      padding: const EdgeInsets.symmetric(vertical: 4),
                      child: Row(
                        children: [
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(o.refunds[i].refundReason,
                                    maxLines: 1, overflow: TextOverflow.ellipsis),
                                const SizedBox(height: 2),
                                Text(
                                    '${o.refunds[i].refundStatus} · RM ${o.refunds[i].refundAmount.toStringAsFixed(2)}',
                                    style: TextStyle(color: Colors.grey.shade600, fontSize: 12)),
                              ],
                            ),
                          ),
                          const Icon(Icons.chevron_right, size: 20, color: Colors.grey),
                        ],
                      ),
                    ),
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
  final bool canReview;       // order is purchased → items can be rated
  final VoidCallback? onRate;
  const _ItemRow({required this.item, required this.primary, this.canReview = false, this.onRate});

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
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
        ),
        // Rate this item (Shopee-style) once the order is purchased.
        if (canReview) ...[
          const SizedBox(height: 8),
          Align(
            alignment: Alignment.centerRight,
            child: item.reviewed
                ? Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Icon(Icons.check_circle, size: 16, color: Colors.green.shade600),
                      const SizedBox(width: 4),
                      Text('Rated',
                          style: TextStyle(fontSize: 12, color: Colors.green.shade700, fontWeight: FontWeight.w600)),
                    ],
                  )
                : OutlinedButton.icon(
                    onPressed: onRate,
                    icon: const Icon(Icons.star_outline_rounded, size: 18),
                    label: const Text('Rate'),
                    style: OutlinedButton.styleFrom(
                      foregroundColor: primary,
                      side: BorderSide(color: primary),
                      visualDensity: VisualDensity.compact,
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                    ),
                  ),
          ),
        ],
      ],
    );
  }
}

// ── One parcel block (inside the Delivery Tracking card) ────────────────────
class _ParcelBlock extends StatefulWidget {
  final ParcelDelivery parcel;
  final String orderId;
  const _ParcelBlock({required this.parcel, required this.orderId});

  @override
  State<_ParcelBlock> createState() => _ParcelBlockState();
}

class _ParcelBlockState extends State<_ParcelBlock> {
  bool _resending = false;
  bool _confirming = false;

  // Re-send myself the delivery code (notification + push) if I missed it.
  Future<void> _resendOtp() async {
    setState(() => _resending = true);
    try {
      await context.read<OrderService>().resendDeliveryOtp(widget.orderId, widget.parcel.deliveryId);
      if (mounted) context.showSnack('Code re-sent to your notifications.');
    } catch (e) {
      if (mounted) context.showSnack(e.toString());
    } finally {
      if (mounted) setState(() => _resending = false);
    }
  }

  // Confirm a Standard (3PL) parcel has arrived — "Order received". Marks it
  // Delivered and unlocks reviews, mirroring Shopee/Lazada.
  Future<void> _confirmReceipt() async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Confirm receipt?'),
        content: const Text(
            'Only confirm once you have received this parcel. This completes the delivery and lets you review the items.'),
        actions: [
          TextButton(onPressed: () => Navigator.of(ctx).pop(false), child: const Text('Not yet')),
          FilledButton(onPressed: () => Navigator.of(ctx).pop(true), child: const Text('Confirm')),
        ],
      ),
    );
    if (ok != true) return;
    setState(() => _confirming = true);
    try {
      await context.read<OrderService>().confirmReceipt(widget.orderId, widget.parcel.deliveryId);
      if (mounted) context.showSnack('Parcel marked as received. Thank you!');
      bumpRefresh();
    } catch (e) {
      if (mounted) context.showSnack(e.toString());
    } finally {
      if (mounted) setState(() => _confirming = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final parcel = widget.parcel;
    final color = _deliveryColors[parcel.deliveryStatus] ?? Colors.grey;
    // OTP is an IN-HOUSE courier mechanism only — a 3PL (Standard) parcel is
    // tracked by carrier + tracking number instead, so never show the OTP for it.
    final showOtp = !parcel.isStandard
        && parcel.deliveryStatus == 'OutForDelivery'
        && (parcel.otpCode?.isNotEmpty ?? false);
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
        const SizedBox(height: 12),
        // delivery progress timeline (per parcel)
        if (parcel.deliveryStatus == 'Failed')
          Row(
            children: [
              Icon(Icons.error_outline, size: 16, color: Colors.red.shade600),
              const SizedBox(width: 6),
              Text('Delivery failed — we’ll be in touch.',
                  style: TextStyle(fontSize: 12, color: Colors.red.shade700)),
            ],
          )
        else
          _DeliveryTimeline(status: parcel.deliveryStatus),
        if (parcel.estimatedDeliveryTime != null) ...[
          const SizedBox(height: 8),
          Text('Est. delivery: ${_fmt(parcel.estimatedDeliveryTime!)}', style: TextStyle(fontSize: 12, color: Colors.grey.shade600)),
        ],
        // 3PL (Standard) parcel: show the carrier + tracking number instead of an OTP.
        if (parcel.isStandard && parcel.deliveryStatus != 'Failed') ...[
          const SizedBox(height: 10),
          _StandardTrackingCard(
            carrier: parcel.trackingCarrier,
            trackingNumber: parcel.trackingNumber,
          ),
        ],
        // Standard parcel out for delivery → let the customer confirm receipt
        // (Shopee-style "Order received"), which completes the parcel.
        if (parcel.isStandard && parcel.deliveryStatus == 'OutForDelivery') ...[
          const SizedBox(height: 10),
          SizedBox(
            width: double.infinity,
            child: FilledButton.icon(
              onPressed: _confirming ? null : _confirmReceipt,
              icon: _confirming
                  ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                  : const Icon(Icons.check_circle_outline, size: 18),
              label: Text(_confirming ? 'Confirming…' : 'Confirm receipt'),
            ),
          ),
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
                const SizedBox(height: 4),
                TextButton.icon(
                  onPressed: _resending ? null : _resendOtp,
                  icon: _resending
                      ? const SizedBox(width: 14, height: 14, child: CircularProgressIndicator(strokeWidth: 2))
                      : Icon(Icons.refresh, size: 16, color: Colors.amber.shade900),
                  label: Text(_resending ? 'Sending…' : 'Resend code',
                      style: TextStyle(fontSize: 12, color: Colors.amber.shade900)),
                  style: TextButton.styleFrom(visualDensity: VisualDensity.compact),
                ),
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

// ── Standard (3PL) shipping card: carrier + tracking number with copy ───────
// Shown on a Standard parcel in place of the in-house OTP box. Before the seller
// ships it (no tracking number yet) we show a short "will appear" note instead.
class _StandardTrackingCard extends StatelessWidget {
  final String? carrier;
  final String? trackingNumber;
  const _StandardTrackingCard({this.carrier, this.trackingNumber});

  @override
  Widget build(BuildContext context) {
    final indigo = Colors.indigo;
    final hasTracking = trackingNumber != null && trackingNumber!.isNotEmpty;
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: indigo.shade50,
        border: Border.all(color: indigo.shade100),
        borderRadius: BorderRadius.circular(8),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(Icons.local_shipping_outlined, size: 16, color: indigo.shade700),
              const SizedBox(width: 6),
              Text('Standard shipping',
                  style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: indigo.shade700)),
            ],
          ),
          if (!hasTracking) ...[
            const SizedBox(height: 6),
            Text('Your parcel will be shipped by courier. The tracking number will appear here once the seller ships it.',
                style: TextStyle(fontSize: 12, color: indigo.shade900)),
          ] else ...[
            const SizedBox(height: 8),
            if (carrier != null && carrier!.isNotEmpty)
              Text('Courier: ${carrier!}', style: TextStyle(fontSize: 12, color: indigo.shade900)),
            const SizedBox(height: 4),
            Row(
              children: [
                Expanded(
                  child: SelectableText(
                    trackingNumber!,
                    style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w700, letterSpacing: 1),
                  ),
                ),
                TextButton.icon(
                  onPressed: () async {
                    await Clipboard.setData(ClipboardData(text: trackingNumber!));
                    if (context.mounted) context.showSnack('Tracking number copied.');
                  },
                  icon: Icon(Icons.copy, size: 16, color: indigo.shade700),
                  label: Text('Copy', style: TextStyle(fontSize: 12, color: indigo.shade700)),
                  style: TextButton.styleFrom(visualDensity: VisualDensity.compact),
                ),
              ],
            ),
          ],
        ],
      ),
    );
  }
}

// ── Refund request bottom sheet (Shopee/Lazada-style evidence form) ─────────
class _RefundSheet extends StatefulWidget {
  const _RefundSheet();

  @override
  State<_RefundSheet> createState() => _RefundSheetState();
}

class _RefundSheetState extends State<_RefundSheet> {
  static const _maxPhotos = 5;
  final _ctrl = TextEditingController();
  String? _error;
  final List<File> _proofs = []; // optional supporting photos

  @override
  void dispose() {
    _ctrl.dispose();
    super.dispose();
  }

  Future<void> _pickPhoto() async {
    if (_proofs.length >= _maxPhotos) return;
    final source = await showModalBottomSheet<ImageSource>(
      context: context,
      builder: (ctx) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            ListTile(
              leading: const Icon(Icons.camera_alt_outlined),
              title: const Text('Take a photo'),
              onTap: () => Navigator.of(ctx).pop(ImageSource.camera),
            ),
            ListTile(
              leading: const Icon(Icons.photo_library_outlined),
              title: const Text('Choose from gallery'),
              onTap: () => Navigator.of(ctx).pop(ImageSource.gallery),
            ),
          ],
        ),
      ),
    );
    if (source == null) return;
    final picked = await ImagePicker().pickImage(
      source: source,
      maxWidth: 1200,
      imageQuality: 85,
    );
    if (picked != null) setState(() => _proofs.add(File(picked.path)));
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
    Navigator.of(context).pop((reason, _proofs));
  }

  @override
  Widget build(BuildContext context) {
    final primary = Theme.of(context).colorScheme.primary;
    return Padding(
      // lift above the keyboard
      padding: EdgeInsets.only(bottom: MediaQuery.of(context).viewInsets.bottom),
      child: SingleChildScrollView(
        padding: const EdgeInsets.fromLTRB(20, 12, 20, 20),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // grab handle
            Center(
              child: Container(
                width: 40,
                height: 4,
                margin: const EdgeInsets.only(bottom: 16),
                decoration: BoxDecoration(
                    color: Colors.grey.shade300, borderRadius: BorderRadius.circular(2)),
              ),
            ),
            const Text('Request a refund',
                style: TextStyle(fontSize: 19, fontWeight: FontWeight.bold)),
            const SizedBox(height: 4),
            Text('Tell us why, and add photos as evidence. An admin will review it.',
                style: TextStyle(fontSize: 13, color: Colors.grey.shade600)),
            const SizedBox(height: 18),

            // ── Reason ──────────────────────────────────────────────────
            const Text('Reason', style: TextStyle(fontWeight: FontWeight.w600, fontSize: 14)),
            const SizedBox(height: 8),
            TextField(
              controller: _ctrl,
              autofocus: true,
              minLines: 3,
              maxLines: 5,
              maxLength: 255,
              decoration: InputDecoration(
                hintText: 'e.g. The shoe size doesn’t fit / item is defective…',
                filled: true,
                fillColor: Colors.grey.shade50,
                border: OutlineInputBorder(borderRadius: BorderRadius.circular(12)),
                errorText: _error,
              ),
              onChanged: (_) {
                if (_error != null) setState(() => _error = null);
              },
            ),
            const SizedBox(height: 6),

            // ── Photos ──────────────────────────────────────────────────
            Row(
              children: [
                const Text('Photos', style: TextStyle(fontWeight: FontWeight.w600, fontSize: 14)),
                const SizedBox(width: 6),
                Text('(optional · ${_proofs.length}/$_maxPhotos)',
                    style: TextStyle(fontSize: 12, color: Colors.grey.shade600)),
              ],
            ),
            const SizedBox(height: 10),
            Wrap(
              spacing: 10,
              runSpacing: 10,
              children: [
                for (int i = 0; i < _proofs.length; i++)
                  Stack(
                    clipBehavior: Clip.none,
                    children: [
                      ClipRRect(
                        borderRadius: BorderRadius.circular(10),
                        child: Image.file(_proofs[i], width: 72, height: 72, fit: BoxFit.cover),
                      ),
                      Positioned(
                        top: -8,
                        right: -8,
                        child: IconButton(
                          iconSize: 18,
                          visualDensity: VisualDensity.compact,
                          onPressed: () => setState(() => _proofs.removeAt(i)),
                          icon: const CircleAvatar(
                            radius: 10,
                            backgroundColor: Colors.black54,
                            child: Icon(Icons.close, size: 13, color: Colors.white),
                          ),
                        ),
                      ),
                    ],
                  ),
                // add tile
                if (_proofs.length < _maxPhotos)
                  InkWell(
                    onTap: _pickPhoto,
                    borderRadius: BorderRadius.circular(10),
                    child: Container(
                      width: 72,
                      height: 72,
                      decoration: BoxDecoration(
                        borderRadius: BorderRadius.circular(10),
                        border: Border.all(color: Colors.grey.shade400, style: BorderStyle.solid),
                        color: Colors.grey.shade50,
                      ),
                      child: Column(
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: [
                          Icon(Icons.add_a_photo_outlined, size: 22, color: Colors.grey.shade600),
                          const SizedBox(height: 4),
                          Text('Add', style: TextStyle(fontSize: 11, color: Colors.grey.shade600)),
                        ],
                      ),
                    ),
                  ),
              ],
            ),
            const SizedBox(height: 22),

            // ── Actions ─────────────────────────────────────────────────
            Row(
              children: [
                Expanded(
                  child: OutlinedButton(
                    onPressed: () => Navigator.of(context).pop(),
                    style: OutlinedButton.styleFrom(
                      minimumSize: const Size.fromHeight(50),
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
                    ),
                    child: const Text('Cancel'),
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: FilledButton(
                    onPressed: _submit,
                    style: FilledButton.styleFrom(
                      minimumSize: const Size.fromHeight(50),
                      backgroundColor: primary,
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
                    ),
                    child: const Text('Submit request', style: TextStyle(fontWeight: FontWeight.bold)),
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

// ── Per-parcel delivery progress timeline ───────────────────────────────────
class _DeliveryTimeline extends StatelessWidget {
  final String status; // delivery status: Pending/Assigned/PickedUp/OutForDelivery/Delivered
  const _DeliveryTimeline({required this.status});

  static const _steps = ['Preparing', 'Shipped', 'Out for delivery', 'Delivered'];

  int get _reached {
    switch (status) {
      case 'PickedUp':
        return 1;
      case 'OutForDelivery':
        return 2;
      case 'Delivered':
        return 3;
      default: // Pending / Assigned
        return 0;
    }
  }

  @override
  Widget build(BuildContext context) {
    final color = Theme.of(context).colorScheme.primary;
    final reached = _reached;
    return Column(
      children: [
        for (int i = 0; i < _steps.length; i++)
          IntrinsicHeight(
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Column(
                  children: [
                    Container(
                      width: 16,
                      height: 16,
                      decoration: BoxDecoration(
                        color: i <= reached ? color : Colors.grey.shade300,
                        shape: BoxShape.circle,
                      ),
                      child: i < reached
                          ? const Icon(Icons.check, size: 10, color: Colors.white)
                          : (i == reached
                              ? const Icon(Icons.circle, size: 7, color: Colors.white)
                              : null),
                    ),
                    if (i != _steps.length - 1)
                      Expanded(
                        child: Container(
                          width: 2,
                          color: i < reached ? color : Colors.grey.shade300,
                        ),
                      ),
                  ],
                ),
                const SizedBox(width: 10),
                Padding(
                  padding: EdgeInsets.only(bottom: i == _steps.length - 1 ? 0 : 12, top: 0),
                  child: Text(
                    _steps[i],
                    style: TextStyle(
                      fontSize: 13,
                      fontWeight: i <= reached ? FontWeight.w600 : FontWeight.normal,
                      color: i <= reached ? Colors.black87 : Colors.grey,
                    ),
                  ),
                ),
              ],
            ),
          ),
      ],
    );
  }
}
