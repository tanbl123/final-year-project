import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import 'package:delivery/features/delivery/models/delivery.dart';
import 'package:delivery/features/delivery/services/delivery_service.dart';
import 'package:delivery/features/delivery/screens/delivery_detail_screen.dart';
import 'package:delivery/features/delivery/widgets/status_chip.dart';

/// The courier's active jobs (Assigned / PickedUp / OutForDelivery).
class AssignmentsScreen extends StatefulWidget {
  const AssignmentsScreen({super.key});

  @override
  State<AssignmentsScreen> createState() => _AssignmentsScreenState();
}

class _AssignmentsScreenState extends State<AssignmentsScreen> {
  late Future<List<DeliverySummary>> _future;

  @override
  void initState() {
    super.initState();
    _future = _load();
  }

  Future<List<DeliverySummary>> _load() => context.read<DeliveryService>().assignments();

  Future<void> _refresh() async {
    final next = _load();
    setState(() => _future = next);
    await next;
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('My deliveries')),
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
                Center(child: TextButton(onPressed: _refresh, child: const Text('Retry'))),
              ]);
            }
            final items = snap.data ?? [];
            if (items.isEmpty) {
              return ListView(children: [
                const SizedBox(height: 140),
                Icon(Icons.inbox_outlined, size: 48, color: Colors.grey.shade400),
                const SizedBox(height: 12),
                const Center(child: Text('No active deliveries right now.')),
              ]);
            }
            return ListView.separated(
              padding: const EdgeInsets.all(12),
              itemCount: items.length,
              separatorBuilder: (_, __) => const SizedBox(height: 10),
              itemBuilder: (_, i) => _card(items[i]),
            );
          },
        ),
      ),
    );
  }

  Widget _card(DeliverySummary d) {
    return Card(
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: () async {
          await Navigator.of(context).push(
            MaterialPageRoute(builder: (_) => DeliveryDetailScreen(deliveryId: d.deliveryId)),
          );
          _refresh(); // status may have changed in the detail screen
        },
        child: Padding(
          padding: const EdgeInsets.all(14),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Text('Order ${d.orderId}', style: const TextStyle(fontWeight: FontWeight.bold)),
                  StatusChip(status: d.status),
                ],
              ),
              const SizedBox(height: 8),
              _line(Icons.store_outlined, 'Pick up', '${d.supplierName ?? '—'}\n${d.pickupAddress ?? '—'}'),
              const SizedBox(height: 6),
              _line(Icons.location_on_outlined, 'Deliver to', '${d.customerName ?? '—'}\n${d.deliveryAddress ?? '—'}'),
              const SizedBox(height: 6),
              Text('${d.itemCount} item(s)', style: TextStyle(color: Colors.grey.shade600, fontSize: 12)),
            ],
          ),
        ),
      ),
    );
  }

  Widget _line(IconData icon, String label, String value) => Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icon, size: 18, color: Colors.grey.shade600),
          const SizedBox(width: 8),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(label, style: TextStyle(fontSize: 11, color: Colors.grey.shade600)),
                Text(value),
              ],
            ),
          ),
        ],
      );
}
