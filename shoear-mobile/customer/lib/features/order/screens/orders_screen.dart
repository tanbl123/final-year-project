import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import 'package:customer/features/order/models/order.dart';
import 'package:customer/features/order/services/order_service.dart';
import 'package:customer/features/order/services/order_payment.dart';
import 'package:customer/core/widgets/product_image.dart';
import 'package:customer/core/utils/refresh_bus.dart';
import 'package:customer/features/auth/state/auth_provider.dart';
import 'package:customer/features/auth/screens/login_screen.dart';
import 'package:customer/features/order/screens/order_detail_screen.dart';

const Map<String, Color> kOrderStatusColors = {
  'Placed': Colors.blueGrey,
  'Paid': Colors.indigo,
  'Processing': Colors.indigo,
  'Shipped': Colors.indigo,
  'OutForDelivery': Colors.indigo,
  'Delivered': Colors.green,
  'Completed': Colors.green,
  'Cancelled': Colors.red,
};

String prettyStatus(String s) => s.replaceAllMapped(RegExp(r'([a-z])([A-Z])'), (m) => '${m[1]} ${m[2]}');

/// The customer's order history.
class OrdersScreen extends StatefulWidget {
  const OrdersScreen({super.key});

  @override
  State<OrdersScreen> createState() => _OrdersScreenState();
}

class _OrdersScreenState extends State<OrdersScreen> {
  Future<List<CustomerOrderSummary>>? _future;
  bool _wasLoggedIn = false;
  String? _payingId; // order currently being paid (shows a spinner)

  @override
  void initState() {
    super.initState();
    appRefreshTick.addListener(_onRefreshSignal);
  }

  @override
  void dispose() {
    appRefreshTick.removeListener(_onRefreshSignal);
    super.dispose();
  }

  // A push arrived or the app resumed — re-fetch if signed in.
  void _onRefreshSignal() {
    if (mounted && _wasLoggedIn) _refresh();
  }

  Future<void> _refresh() async {
    final next = context.read<OrderService>().listOrders();
    setState(() => _future = next);
    await next;
  }

  /// Resume payment for an unpaid order (Shopee's "Pay Now"). Reuses the same
  /// Stripe flow as checkout; the server re-checks the order and stock first.
  Future<void> _payOrder(CustomerOrderSummary order) async {
    final orders = context.read<OrderService>();
    final messenger = ScaffoldMessenger.of(context);
    setState(() => _payingId = order.orderId);
    try {
      final result = await payOrderWithStripe(orders, order.orderId);
      if (!mounted) return;
      messenger
        ..removeCurrentSnackBar()
        ..showSnackBar(SnackBar(
          content: Text(result == PayResult.paid
              ? 'Payment successful.'
              : 'Payment cancelled — your order is still awaiting payment.'),
        ));
    } catch (e) {
      if (!mounted) return;
      messenger
        ..removeCurrentSnackBar()
        ..showSnackBar(SnackBar(content: Text(e.toString())));
    } finally {
      if (mounted) setState(() => _payingId = null);
      await _refresh(); // reflect Paid / Cancelled / still-Placed
    }
  }

  // Status tabs, Shopee-style. Filtering is done over the single fetched list.
  static const _tabs = ['All', 'To Pay', 'Paid', 'Completed', 'Cancelled'];

  List<CustomerOrderSummary> _filter(List<CustomerOrderSummary> all, int tab) {
    switch (tab) {
      case 1: // To Pay — created but not yet paid
        return all.where((o) => o.orderStatus == 'Placed').toList();
      case 2: // Paid / in progress
        return all
            .where((o) => const ['Paid', 'Processing', 'Shipped', 'OutForDelivery']
                .contains(o.orderStatus))
            .toList();
      case 3: // Completed
        return all
            .where((o) => const ['Delivered', 'Completed'].contains(o.orderStatus))
            .toList();
      case 4: // Cancelled
        return all.where((o) => o.orderStatus == 'Cancelled').toList();
      default: // All
        return all;
    }
  }

  @override
  Widget build(BuildContext context) {
    final loggedIn = context.watch<AuthProvider>().isLoggedIn;
    if (loggedIn != _wasLoggedIn) {
      _wasLoggedIn = loggedIn;
      _future = null; // reload on login / drop on logout
    }
    return DefaultTabController(
      length: _tabs.length,
      child: Scaffold(
        backgroundColor: Colors.grey.shade100,
        appBar: AppBar(
          title: const Text('My Orders'),
          bottom: loggedIn
              ? TabBar(
                  isScrollable: true,
                  tabs: [for (final t in _tabs) Tab(text: t)],
                )
              : null,
        ),
        body: !loggedIn ? _signInPrompt(context) : _ordersBody(context),
      ),
    );
  }

  Widget _signInPrompt(BuildContext context) => Center(
        child: Padding(
          padding: const EdgeInsets.all(32),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(Icons.receipt_long, size: 48, color: Colors.grey.shade400),
              const SizedBox(height: 12),
              const Text('Sign in to see your orders.', textAlign: TextAlign.center),
              const SizedBox(height: 16),
              FilledButton(
                onPressed: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => const LoginScreen())),
                child: const Text('Login'),
              ),
            ],
          ),
        ),
      );

  Widget _ordersBody(BuildContext context) {
    _future ??= context.read<OrderService>().listOrders();
    return FutureBuilder<List<CustomerOrderSummary>>(
      future: _future,
      builder: (context, snap) {
        if (snap.connectionState == ConnectionState.waiting) {
          return const Center(child: CircularProgressIndicator());
        }
        if (snap.hasError) {
          return _ErrorView(message: snap.error.toString(), onRetry: _refresh);
        }
        final orders = snap.data ?? [];
        return TabBarView(
          children: [
            for (int t = 0; t < _tabs.length; t++) _list(_filter(orders, t)),
          ],
        );
      },
    );
  }

  Widget _list(List<CustomerOrderSummary> orders) {
    if (orders.isEmpty) {
      return RefreshIndicator(
        onRefresh: _refresh,
        child: ListView(
          children: [
            const SizedBox(height: 120),
            Icon(Icons.receipt_long, size: 56, color: Colors.grey.shade400),
            const SizedBox(height: 12),
            const Center(child: Text('No orders here.')),
          ],
        ),
      );
    }
    return RefreshIndicator(
      onRefresh: _refresh,
      child: ListView.separated(
        padding: const EdgeInsets.all(12),
        itemCount: orders.length,
        separatorBuilder: (_, __) => const SizedBox(height: 8),
        itemBuilder: (context, i) => _OrderCard(
          order: orders[i],
          paying: _payingId == orders[i].orderId,
          onPay: () => _payOrder(orders[i]),
          onTap: () async {
            await Navigator.of(context).push(
              MaterialPageRoute(builder: (_) => OrderDetailScreen(orderId: orders[i].orderId)),
            );
            _refresh(); // status may have changed while viewing
          },
        ),
      ),
    );
  }
}

class _OrderCard extends StatelessWidget {
  final CustomerOrderSummary order;
  final VoidCallback onTap;
  final VoidCallback onPay;
  final bool paying;
  const _OrderCard({
    required this.order,
    required this.onTap,
    required this.onPay,
    this.paying = false,
  });

  // "3:45 PM" style time from a payBy datetime string.
  String? _payByLabel() {
    if (order.payBy == null) return null;
    final dt = DateTime.tryParse(order.payBy!);
    if (dt == null) return null;
    final h12 = dt.hour % 12 == 0 ? 12 : dt.hour % 12;
    final ampm = dt.hour < 12 ? 'AM' : 'PM';
    final mm = dt.minute.toString().padLeft(2, '0');
    return '$h12:$mm $ampm';
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final primary = theme.colorScheme.primary;
    final dt = order.orderDate == null ? null : DateTime.tryParse(order.orderDate!)?.toLocal();
    final dateStr = dt == null ? '' : '${dt.day}/${dt.month}/${dt.year}';
    final payBy = _payByLabel();
    final statusColor = order.awaitingPayment
        ? Colors.orange.shade700
        : (kOrderStatusColors[order.orderStatus] ?? Colors.grey);
    final statusLabel =
        order.awaitingPayment ? 'To Pay' : prettyStatus(order.orderStatus);

    return Container(
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16),
        boxShadow: [
          BoxShadow(
              color: Colors.black.withValues(alpha: 0.04),
              blurRadius: 8,
              offset: const Offset(0, 2)),
        ],
      ),
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(16),
          child: Padding(
            padding: const EdgeInsets.all(14),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                // top: order id (secondary) + status
                Row(
                  children: [
                    Expanded(
                      child: Text(order.orderId,
                          style: TextStyle(
                              color: Colors.grey.shade600,
                              fontSize: 12,
                              fontWeight: FontWeight.w600)),
                    ),
                    _Chip(label: statusLabel, color: statusColor),
                  ],
                ),
                const SizedBox(height: 10),
                // product preview — shows WHAT was ordered at a glance
                Row(
                  crossAxisAlignment: CrossAxisAlignment.center,
                  children: [
                    ClipRRect(
                      borderRadius: BorderRadius.circular(10),
                      child: SizedBox(
                          width: 56,
                          height: 56,
                          child: ProductImage(url: order.previewImage)),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          if ((order.previewBrand ?? '').isNotEmpty)
                            Text(order.previewBrand!.toUpperCase(),
                                style: TextStyle(
                                    fontSize: 10,
                                    color: primary,
                                    fontWeight: FontWeight.w600,
                                    letterSpacing: 0.8)),
                          Text(
                              order.previewName ??
                                  '${order.itemCount} item${order.itemCount == 1 ? '' : 's'}',
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: const TextStyle(
                                  fontWeight: FontWeight.w600, fontSize: 14)),
                          const SizedBox(height: 2),
                          Text(
                              order.itemCount > 1
                                  ? '$dateStr · +${order.itemCount - 1} more item${order.itemCount - 1 == 1 ? '' : 's'}'
                                  : '$dateStr · 1 item',
                              style: TextStyle(
                                  color: Colors.grey.shade600, fontSize: 12)),
                        ],
                      ),
                    ),
                  ],
                ),
                if (order.deliveryStatus != null) ...[
                  const SizedBox(height: 10),
                  _Chip(
                      label: 'Parcel: ${prettyStatus(order.deliveryStatus!)}',
                      color: Colors.teal,
                      outlined: true),
                ],
                const Padding(
                  padding: EdgeInsets.symmetric(vertical: 10),
                  child: Divider(height: 1),
                ),
                // total
                Row(
                  children: [
                    Text('Total',
                        style: TextStyle(
                            color: Colors.grey.shade700, fontSize: 13)),
                    const Spacer(),
                    Text('RM ${order.total.toStringAsFixed(2)}',
                        style: TextStyle(
                            fontWeight: FontWeight.bold,
                            fontSize: 16,
                            color: primary)),
                  ],
                ),
                // pay-now bar for unpaid orders
                if (order.awaitingPayment) ...[
                  const SizedBox(height: 10),
                  Row(
                    children: [
                      Expanded(
                        child: Text(
                          payBy == null
                              ? 'Awaiting payment'
                              : 'Pay before $payBy or it will be cancelled',
                          style: TextStyle(
                              fontSize: 11.5, color: Colors.orange.shade800),
                        ),
                      ),
                      const SizedBox(width: 8),
                      FilledButton(
                        onPressed: paying ? null : onPay,
                        style: FilledButton.styleFrom(
                          visualDensity: VisualDensity.compact,
                          padding: const EdgeInsets.symmetric(horizontal: 20),
                        ),
                        child: paying
                            ? const SizedBox(
                                width: 16,
                                height: 16,
                                child: CircularProgressIndicator(
                                    strokeWidth: 2, color: Colors.white),
                              )
                            : const Text('Pay now'),
                      ),
                    ],
                  ),
                ],
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _Chip extends StatelessWidget {
  final String label;
  final Color color;
  final bool outlined;
  const _Chip({required this.label, required this.color, this.outlined = false});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        color: outlined ? Colors.transparent : color.withValues(alpha: 0.12),
        border: outlined ? Border.all(color: color) : null,
        borderRadius: BorderRadius.circular(12),
      ),
      child: Text(label, style: TextStyle(color: color, fontSize: 12, fontWeight: FontWeight.w600)),
    );
  }
}

class _ErrorView extends StatelessWidget {
  final String message;
  final VoidCallback onRetry;
  const _ErrorView({required this.message, required this.onRetry});

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(Icons.cloud_off, size: 48, color: Colors.grey),
            const SizedBox(height: 12),
            Text(message, textAlign: TextAlign.center, style: const TextStyle(color: Colors.grey)),
            const SizedBox(height: 16),
            OutlinedButton(onPressed: onRetry, child: const Text('Retry')),
          ],
        ),
      ),
    );
  }
}
