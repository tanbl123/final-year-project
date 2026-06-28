import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import 'package:delivery/features/earnings/services/earnings_service.dart';
import 'package:delivery/features/earnings/screens/require_payout_screen.dart';

/// Gates the app behind payout setup: a newly-approved courier must connect a
/// bank account (via Stripe) before they can use the app. Skipped when Stripe
/// isn't configured on the server (dev), so the app still works without it.
class PayoutGate extends StatefulWidget {
  final Widget child;
  const PayoutGate({super.key, required this.child});

  @override
  State<PayoutGate> createState() => _PayoutGateState();
}

class _PayoutGateState extends State<PayoutGate> {
  Future<Map<String, dynamic>>? _future;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _future ??= context.read<EarningsService>().stripeStatus();
  }

  void _recheck() => setState(() => _future = context.read<EarningsService>().stripeStatus());

  @override
  Widget build(BuildContext context) {
    return FutureBuilder<Map<String, dynamic>>(
      future: _future,
      builder: (context, snap) {
        if (snap.connectionState == ConnectionState.waiting) {
          return const Scaffold(body: Center(child: CircularProgressIndicator()));
        }
        // Don't lock the courier out on a transient error or when Stripe isn't
        // configured on the server — only gate when payouts are configured but
        // this courier hasn't enabled them yet.
        final d = snap.data ?? const {};
        final configured = d['configured'] == true;
        final enabled = d['payoutsEnabled'] == true;
        if (snap.hasError || !configured || enabled) return widget.child;
        return RequirePayoutScreen(onDone: _recheck);
      },
    );
  }
}
