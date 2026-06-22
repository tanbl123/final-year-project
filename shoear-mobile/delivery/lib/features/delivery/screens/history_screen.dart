import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import 'package:delivery/features/delivery/models/delivery.dart';
import 'package:delivery/features/delivery/services/delivery_service.dart';
import 'package:delivery/features/delivery/screens/delivery_detail_screen.dart';
import 'package:delivery/features/delivery/widgets/status_chip.dart';

/// Finished deliveries (Delivered / Failed).
class HistoryScreen extends StatefulWidget {
  const HistoryScreen({super.key});

  @override
  State<HistoryScreen> createState() => _HistoryScreenState();
}

class _HistoryScreenState extends State<HistoryScreen> {
  late Future<List<DeliverySummary>> _future;

  @override
  void initState() {
    super.initState();
    _future = _load();
  }

  Future<List<DeliverySummary>> _load() => context.read<DeliveryService>().history();

  Future<void> _refresh() async {
    final next = _load();
    setState(() => _future = next);
    await next;
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('History')),
      body: RefreshIndicator(
        onRefresh: _refresh,
        child: FutureBuilder<List<DeliverySummary>>(
          future: _future,
          builder: (context, snap) {
            if (snap.connectionState == ConnectionState.waiting) {
              return const Center(child: CircularProgressIndicator());
            }
            if (snap.hasError) {
              return ListView(children: [
                const SizedBox(height: 120),
                Center(child: Padding(padding: const EdgeInsets.all(24), child: Text(snap.error.toString(), textAlign: TextAlign.center))),
              ]);
            }
            final items = snap.data ?? [];
            if (items.isEmpty) {
              return ListView(children: const [
                SizedBox(height: 140),
                Center(child: Text('No completed deliveries yet.')),
              ]);
            }
            return ListView.separated(
              padding: const EdgeInsets.all(12),
              itemCount: items.length,
              separatorBuilder: (_, __) => const Divider(height: 1),
              itemBuilder: (_, i) {
                final d = items[i];
                return ListTile(
                  title: Text('Order ${d.orderId}'),
                  subtitle: Text('${d.customerName ?? '—'} · ${d.deliveryAddress ?? '—'}',
                      maxLines: 2, overflow: TextOverflow.ellipsis),
                  trailing: StatusChip(status: d.status),
                  onTap: () => Navigator.of(context).push(
                    MaterialPageRoute(builder: (_) => DeliveryDetailScreen(deliveryId: d.deliveryId)),
                  ),
                );
              },
            );
          },
        ),
      ),
    );
  }
}
