import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import 'package:customer/features/notification/models/app_notification.dart';
import 'package:customer/features/notification/state/notification_provider.dart';
import 'package:customer/features/order/screens/order_detail_screen.dart';

/// The bell: lists the customer's notifications, lets them mark all read, and
/// deep-links order/refund notifications to the relevant order.
class NotificationsScreen extends StatefulWidget {
  const NotificationsScreen({super.key});

  @override
  State<NotificationsScreen> createState() => _NotificationsScreenState();
}

class _NotificationsScreenState extends State<NotificationsScreen> {
  @override
  void initState() {
    super.initState();
    // make sure we're showing the latest
    Future.microtask(() => context.read<NotificationProvider>().refresh());
  }

  @override
  Widget build(BuildContext context) {
    final prov = context.watch<NotificationProvider>();
    return Scaffold(
      appBar: AppBar(
        title: const Text('Notifications'),
        actions: [
          if (prov.unread > 0)
            TextButton(
              onPressed: () => context.read<NotificationProvider>().markAllRead(),
              child: const Text('Mark all read'),
            ),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: () => context.read<NotificationProvider>().refresh(),
        child: _body(context, prov),
      ),
    );
  }

  Widget _body(BuildContext context, NotificationProvider prov) {
    if (prov.loading && prov.items.isEmpty) {
      return const Center(child: CircularProgressIndicator());
    }
    if (prov.error != null && prov.items.isEmpty) {
      return ListView(children: [
        const SizedBox(height: 120),
        Center(child: Padding(padding: const EdgeInsets.all(24), child: Text(prov.error!, textAlign: TextAlign.center))),
      ]);
    }
    if (prov.items.isEmpty) {
      return ListView(children: [
        const SizedBox(height: 120),
        Icon(Icons.notifications_none, size: 48, color: Colors.grey.shade400),
        const SizedBox(height: 12),
        const Center(child: Text("You're all caught up.")),
      ]);
    }
    return ListView.separated(
      itemCount: prov.items.length,
      separatorBuilder: (_, __) => const Divider(height: 1),
      itemBuilder: (_, i) => _tile(context, prov.items[i]),
    );
  }

  Widget _tile(BuildContext context, AppNotification n) {
    final theme = Theme.of(context);
    return ListTile(
      leading: CircleAvatar(
        backgroundColor: n.isRead ? Colors.grey.shade200 : theme.colorScheme.primaryContainer,
        child: Icon(_iconFor(n.type),
            color: n.isRead ? Colors.grey.shade600 : theme.colorScheme.onPrimaryContainer, size: 20),
      ),
      title: Text(n.title,
          style: TextStyle(fontWeight: n.isRead ? FontWeight.w500 : FontWeight.bold)),
      subtitle: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(n.body),
          if (n.createdAt != null)
            Padding(
              padding: const EdgeInsets.only(top: 2),
              child: Text(_relative(n.createdAt!), style: TextStyle(fontSize: 11, color: Colors.grey.shade600)),
            ),
        ],
      ),
      trailing: n.isRead
          ? null
          : Container(width: 10, height: 10, decoration: BoxDecoration(color: theme.colorScheme.primary, shape: BoxShape.circle)),
      onTap: () {
        context.read<NotificationProvider>().markRead(n.id);
        if (n.orderId != null) {
          Navigator.of(context).push(
            MaterialPageRoute(builder: (_) => OrderDetailScreen(orderId: n.orderId!)),
          );
        }
      },
    );
  }

  IconData _iconFor(String type) => switch (type) {
        'order' => Icons.local_shipping_outlined,
        'refund' => Icons.assignment_return_outlined,
        _ => Icons.notifications_outlined,
      };

  String _relative(DateTime t) {
    final d = DateTime.now().difference(t);
    if (d.inMinutes < 1) return 'just now';
    if (d.inMinutes < 60) return '${d.inMinutes}m ago';
    if (d.inHours < 24) return '${d.inHours}h ago';
    if (d.inDays < 7) return '${d.inDays}d ago';
    return '${t.year}-${t.month.toString().padLeft(2, '0')}-${t.day.toString().padLeft(2, '0')}';
  }
}
