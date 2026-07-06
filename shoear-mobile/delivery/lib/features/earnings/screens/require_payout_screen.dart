import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:url_launcher/url_launcher.dart';

import 'package:delivery/core/utils/snackbar.dart';
import 'package:delivery/features/auth/state/auth_provider.dart';
import 'package:delivery/features/earnings/services/earnings_service.dart';

/// Blocking step shown to a newly-approved courier who hasn't connected a payout
/// (bank) account yet. They can't use the app until they finish — they get paid
/// per delivery, so a bank account is required to complete setup.
class RequirePayoutScreen extends StatefulWidget {
  final VoidCallback onDone;   // called to re-check status after they finish
  const RequirePayoutScreen({super.key, required this.onDone});

  @override
  State<RequirePayoutScreen> createState() => _RequirePayoutScreenState();
}

class _RequirePayoutScreenState extends State<RequirePayoutScreen> {
  bool _connecting = false;

  Future<void> _connect() async {
    setState(() => _connecting = true);
    try {
      final url = await context.read<EarningsService>().onboardUrl();
      if (url.isEmpty) throw Exception('Could not start payout setup.');
      final ok = await launchUrl(Uri.parse(url), mode: LaunchMode.externalApplication);
      if (!ok && mounted) context.showSnack('Could not open the payout setup page.');
    } catch (e) {
      if (mounted) context.showSnack(e.toString());
    } finally {
      if (mounted) setState(() => _connecting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Finish setup'),
        actions: [
          TextButton(
            onPressed: () => context.read<AuthProvider>().logout(),
            child: const Text('Sign out', style: TextStyle(color: Colors.white)),
          ),
        ],
      ),
      body: Center(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Icon(Icons.account_balance_outlined, size: 64, color: Color(0xFF4F46E5)),
              const SizedBox(height: 16),
              Text('Add your bank account', style: Theme.of(context).textTheme.headlineSmall,
                  textAlign: TextAlign.center),
              const SizedBox(height: 12),
              const Text(
                'Your application is approved! 🎉\n\nBefore you can start delivering, set up '
                'your payout account so ShoeAR can pay your per-delivery earnings. '
                'Your bank details are collected securely by Stripe.',
                textAlign: TextAlign.center,
                style: TextStyle(color: Colors.grey, height: 1.4),
              ),
              const SizedBox(height: 24),
              SizedBox(
                width: double.infinity,
                child: FilledButton.icon(
                  onPressed: _connecting ? null : _connect,
                  icon: _connecting
                      ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2))
                      : const Icon(Icons.link),
                  label: const Text('Set up bank account'),
                ),
              ),
              const SizedBox(height: 8),
              SizedBox(
                width: double.infinity,
                child: OutlinedButton(
                  onPressed: widget.onDone,
                  child: const Text("I've finished — continue"),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
