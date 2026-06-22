import 'package:flutter/material.dart';

/// A coloured pill for a delivery status, shared across the list + detail.
class StatusChip extends StatelessWidget {
  final String status;
  const StatusChip({super.key, required this.status});

  @override
  Widget build(BuildContext context) {
    final (bg, fg, label) = _style(status);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
      decoration: BoxDecoration(color: bg, borderRadius: BorderRadius.circular(20)),
      child: Text(label, style: TextStyle(color: fg, fontSize: 12, fontWeight: FontWeight.w600)),
    );
  }

  (Color, Color, String) _style(String s) => switch (s) {
        'Assigned' => (Colors.blue.shade50, Colors.blue.shade800, 'Assigned'),
        'PickedUp' => (Colors.indigo.shade50, Colors.indigo.shade800, 'Picked up'),
        'OutForDelivery' => (Colors.orange.shade50, Colors.orange.shade900, 'Out for delivery'),
        'Delivered' => (Colors.green.shade50, Colors.green.shade800, 'Delivered'),
        'Failed' => (Colors.red.shade50, Colors.red.shade800, 'Failed'),
        'Pending' => (Colors.grey.shade200, Colors.grey.shade700, 'Pending'),
        _ => (Colors.grey.shade200, Colors.grey.shade700, s),
      };
}
