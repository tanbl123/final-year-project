import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import 'package:delivery/core/utils/snackbar.dart';
import 'package:delivery/features/delivery/services/delivery_service.dart';
import 'package:delivery/features/earnings/services/earnings_service.dart';
import 'package:delivery/features/earnings/screens/require_payout_screen.dart';

/// A banner + switch letting the courier flip themselves online (on-duty) or
/// offline. Only ONLINE couriers are auto-assigned new deliveries, so this is
/// how a courier controls their own working hours (nights, weekends, breaks).
///
/// Payout gate: a courier can only go ONLINE once their Stripe payout account
/// is connected, so the platform never owes delivery fees to a courier it can't
/// pay. Until then this shows a "connect payouts first" prompt instead of the
/// switch. Skipped when Stripe isn't configured on the server (dev).
class AvailabilityToggle extends StatefulWidget {
  const AvailabilityToggle({super.key});

  @override
  State<AvailabilityToggle> createState() => _AvailabilityToggleState();
}

class _AvailabilityToggleState extends State<AvailabilityToggle> {
  bool? _online;          // null = still loading
  bool _busy = false;
  bool _payoutBlocked = false;   // Stripe configured but this courier isn't payouts-enabled

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    // availability + payout status in parallel
    try {
      final results = await Future.wait([
        context.read<DeliveryService>().getAvailability(),
        context.read<EarningsService>().stripeStatus(),
      ]);
      if (!mounted) return;
      final online = results[0] as bool;
      final status = results[1] as Map<String, dynamic>;
      final blocked = status['configured'] == true && status['payoutsEnabled'] != true;
      setState(() {
        _online = online;
        _payoutBlocked = blocked;
      });
    } catch (_) {
      // if we can't load it, assume online + not blocked so the UI isn't stuck
      if (mounted) setState(() { _online = true; _payoutBlocked = false; });
    }
  }

  Future<void> _openPayoutSetup() async {
    await Navigator.of(context).push(MaterialPageRoute(
      builder: (_) => RequirePayoutScreen(onDone: () => Navigator.of(context).pop()),
    ));
    if (mounted) _load();   // re-check once they return
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
    // Payout not set up yet → prompt to connect instead of the online switch.
    if (_payoutBlocked) {
      final color = Colors.orange.shade800;
      return Container(
        width: double.infinity,
        color: color.withValues(alpha: 0.08),
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
        child: Row(
          children: [
            Icon(Icons.account_balance_outlined, color: color, size: 22),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('Connect your payout account',
                      style: TextStyle(fontWeight: FontWeight.bold, color: color)),
                  const Text('Set up how you get paid before you can go online for deliveries.',
                      style: TextStyle(fontSize: 12)),
                ],
              ),
            ),
            const SizedBox(width: 8),
            FilledButton(onPressed: _openPayoutSetup, child: const Text('Set up')),
          ],
        ),
      );
    }

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
