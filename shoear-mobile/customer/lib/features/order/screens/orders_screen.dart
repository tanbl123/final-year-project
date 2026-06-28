import 'dart:async';

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
  // Status tabs, Shopee-style. Each tab loads its OWN paginated list — the
  // server filters by group, so tabs scroll independently and lazy-load.
  static const _tabs = ['All', 'To Pay', 'Paid', 'Completed', 'Cancelled'];
  static const _groups = [null, 'topay', 'paid', 'completed', 'cancelled'];

  @override
  Widget build(BuildContext context) {
    final loggedIn = context.watch<AuthProvider>().isLoggedIn;
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
    return TabBarView(
      children: [
        for (int t = 0; t < _tabs.length; t++)
          _OrderTabList(key: ValueKey(_groups[t]), status: _groups[t]),
      ],
    );
  }
}

/// One order tab: its own paginated, lazily-loaded list (server filters by the
/// status group). Kept alive so switching tabs doesn't refetch every time.
class _OrderTabList extends StatefulWidget {
  final String? status; // null = All
  const _OrderTabList({super.key, this.status});

  @override
  State<_OrderTabList> createState() => _OrderTabListState();
}

class _OrderTabListState extends State<_OrderTabList> with AutomaticKeepAliveClientMixin {
  final _scroll = ScrollController();
  final List<CustomerOrderSummary> _items = [];
  int _page = 1, _total = 0;
  bool _loading = true, _loadingMore = false;
  Object? _error;
  String? _payingId;
  bool get _hasMore => _items.length < _total;

  @override
  bool get wantKeepAlive => true;

  @override
  void initState() {
    super.initState();
    _scroll.addListener(_onScroll);
    appRefreshTick.addListener(_onTick); // push / app-resume → reload page 1
    _fetchFirst();
  }

  @override
  void dispose() {
    appRefreshTick.removeListener(_onTick);
    _scroll.dispose();
    super.dispose();
  }

  void _onTick() { if (mounted) _fetchFirst(); }

  Future<void> _fetchFirst() async {
    setState(() { _loading = true; _error = null; });
    try {
      final res = await context.read<OrderService>().listOrders(status: widget.status, page: 1);
      if (!mounted) return;
      setState(() {
        _items..clear()..addAll(res.orders);
        _page = res.page; _total = res.total; _loading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() { _error = e; _loading = false; });
    }
  }

  Future<void> _loadMore() async {
    if (_loadingMore || _loading || !_hasMore) return;
    setState(() => _loadingMore = true);
    try {
      final res = await context.read<OrderService>().listOrders(status: widget.status, page: _page + 1);
      if (!mounted) return;
      setState(() {
        _items.addAll(res.orders);
        _page = res.page; _total = res.total; _loadingMore = false;
      });
    } catch (_) {
      if (mounted) setState(() => _loadingMore = false);
    }
  }

  void _onScroll() {
    if (_scroll.hasClients && _scroll.position.pixels >= _scroll.position.maxScrollExtent - 300) {
      _loadMore();
    }
  }

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
      messenger..removeCurrentSnackBar()..showSnackBar(SnackBar(content: Text(e.toString())));
    } finally {
      if (mounted) setState(() => _payingId = null);
      await _fetchFirst();
    }
  }

  @override
  Widget build(BuildContext context) {
    super.build(context); // AutomaticKeepAlive
    if (_loading) return const Center(child: CircularProgressIndicator());
    if (_error != null) return _ErrorView(message: _error.toString(), onRetry: _fetchFirst);
    if (_items.isEmpty) {
      return RefreshIndicator(
        onRefresh: _fetchFirst,
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
      onRefresh: _fetchFirst,
      child: ListView.separated(
        controller: _scroll,
        padding: const EdgeInsets.all(12),
        itemCount: _items.length + (_loadingMore ? 1 : 0),
        separatorBuilder: (_, __) => const SizedBox(height: 8),
        itemBuilder: (context, i) {
          if (i >= _items.length) {
            return const Padding(
              padding: EdgeInsets.symmetric(vertical: 16),
              child: Center(child: CircularProgressIndicator()),
            );
          }
          final o = _items[i];
          return _OrderCard(
            order: o,
            paying: _payingId == o.orderId,
            onPay: () => _payOrder(o),
            onExpired: _fetchFirst, // window ran out → reload (server cancels it)
            onTap: () async {
              await Navigator.of(context).push(
                MaterialPageRoute(builder: (_) => OrderDetailScreen(orderId: o.orderId)),
              );
              _fetchFirst(); // status may have changed while viewing
            },
          );
        },
      ),
    );
  }
}

class _OrderCard extends StatelessWidget {
  final CustomerOrderSummary order;
  final VoidCallback onTap;
  final VoidCallback onPay;
  final VoidCallback? onExpired; // payment window ran out → refresh the list
  final bool paying;
  const _OrderCard({
    required this.order,
    required this.onTap,
    required this.onPay,
    this.onExpired,
    this.paying = false,
  });

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final primary = theme.colorScheme.primary;
    final dt = order.orderDate == null ? null : DateTime.tryParse(order.orderDate!)?.toLocal();
    final dateStr = dt == null ? '' : '${dt.day}/${dt.month}/${dt.year}';
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
                        child: (order.payBySeconds == null || order.payBySeconds! <= 0)
                            ? Text('Awaiting payment',
                                style: TextStyle(fontSize: 11.5, color: Colors.orange.shade800))
                            : _PayCountdown(secondsLeft: order.payBySeconds!, onExpired: onExpired),
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

// Live "Pay within MM:SS" countdown for an unpaid order. When it hits zero it
// shows an expiring note and asks the list to reload (the server cancels the
// order on that refresh).
class _PayCountdown extends StatefulWidget {
  final int secondsLeft; // seconds remaining at fetch time (relative)
  final VoidCallback? onExpired;
  const _PayCountdown({required this.secondsLeft, this.onExpired});

  @override
  State<_PayCountdown> createState() => _PayCountdownState();
}

class _PayCountdownState extends State<_PayCountdown> {
  Timer? _timer;
  // Anchor the deadline to the device clock at build time using the relative
  // seconds from the server — so it's correct regardless of timezone.
  late final DateTime _deadline = DateTime.now().add(Duration(seconds: widget.secondsLeft));
  late Duration _left = _remaining();
  bool _firedExpired = false;

  @override
  void initState() {
    super.initState();
    _timer = Timer.periodic(const Duration(seconds: 1), (_) {
      if (!mounted) return;
      final r = _remaining();
      setState(() => _left = r);
      if (r <= Duration.zero && !_firedExpired) {
        _firedExpired = true;
        _timer?.cancel();
        WidgetsBinding.instance.addPostFrameCallback((_) => widget.onExpired?.call());
      }
    });
  }

  Duration _remaining() {
    final d = _deadline.difference(DateTime.now());
    return d.isNegative ? Duration.zero : d;
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  String _fmt(Duration d) {
    final mm = (d.inMinutes % 60).toString().padLeft(2, '0');
    final ss = (d.inSeconds % 60).toString().padLeft(2, '0');
    return d.inHours > 0 ? '${d.inHours.toString().padLeft(2, '0')}:$mm:$ss' : '$mm:$ss';
  }

  @override
  Widget build(BuildContext context) {
    if (_left <= Duration.zero) {
      return Text('Payment expired — cancelling…',
          style: TextStyle(fontSize: 11.5, color: Colors.red.shade700));
    }
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(Icons.timer_outlined, size: 13, color: Colors.orange.shade800),
        const SizedBox(width: 4),
        Flexible(
          child: Text('Pay within ${_fmt(_left)} or it will be cancelled',
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(fontSize: 11.5, color: Colors.orange.shade800, fontWeight: FontWeight.w600)),
        ),
      ],
    );
  }
}
