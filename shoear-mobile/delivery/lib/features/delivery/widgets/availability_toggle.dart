import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import 'package:delivery/core/utils/snackbar.dart';
import 'package:delivery/features/delivery/services/delivery_service.dart';

/// A banner + switch letting the courier flip themselves online (on-duty) or
/// offline. Only ONLINE couriers are auto-assigned new deliveries, so this is
/// how a courier controls their own working hours (nights, weekends, breaks).
class AvailabilityToggle extends StatefulWidget {
  const AvailabilityToggle({super.key});

  @override
  State<AvailabilityToggle> createState() => _AvailabilityToggleState();
}

class _AvailabilityToggleState extends State<AvailabilityToggle> {
  bool? _online; // null = still loading
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final v = await context.read<DeliveryService>().getAvailability();
      if (mounted) setState(() => _online = v);
    } catch (_) {
      // if we can't load it, assume online (the default) so the UI isn't stuck
      if (mounted) setState(() => _online = true);
    }
  }

  Future<void> _toggle(bool value) async {
    setState(() => _busy = true);
    try {
      final v = await context.read<DeliveryService>().setAvailability(value);
      if (!mounted) return;
      setState(() { _online = v; _busy = false; });
      context.showSnack(v
          ? "You're online — you'll receive new deliveries."
          : "You're offline — you won't be assigned new deliveries.");
    } catch (e) {
      if (mounted) {
        setState(() => _busy = false);
        context.showSnack(e.toString());
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final online = _online ?? true;
    final theme = Theme.of(context);
    final color = _online == null
        ? Colors.grey
        : (online ? theme.colorScheme.primary : Colors.orange.shade800);
    return Container(
      width: double.infinity,
      color: color.withValues(alpha: 0.08),
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
      child: Row(
        children: [
          Icon(online ? Icons.wifi_tethering : Icons.wifi_tethering_off, color: color, size: 22),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  _online == null ? 'Checking status…' : (online ? "You're online" : "You're offline"),
                  style: TextStyle(fontWeight: FontWeight.bold, color: color),
                ),
                Text(
                  online
                      ? 'Available for new deliveries.'
                      : 'You won\'t be assigned new deliveries until you go online.',
                  style: const TextStyle(fontSize: 12),
                ),
              ],
            ),
          ),
          if (_busy)
            const SizedBox(width: 22, height: 22, child: CircularProgressIndicator(strokeWidth: 2))
          else
            Switch(
              value: online,
              onChanged: _online == null ? null : _toggle,
            ),
        ],
      ),
    );
  }
}
