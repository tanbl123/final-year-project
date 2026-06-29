import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import 'package:delivery/features/auth/services/account_service.dart';
import 'package:delivery/features/auth/state/auth_provider.dart';
import 'package:delivery/features/auth/screens/register_screen.dart';

/// Shown to a REJECTED courier after login: fetches their existing application
/// (/auth/me) and renders the registration form in "fix & resubmit" mode,
/// pre-filled with their details + the rejection reason.
class ResubmitGate extends StatefulWidget {
  const ResubmitGate({super.key});

  @override
  State<ResubmitGate> createState() => _ResubmitGateState();
}

class _ResubmitGateState extends State<ResubmitGate> {
  Future<Map<String, dynamic>>? _future;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _future ??= context.read<AccountService>().me();
  }

  @override
  Widget build(BuildContext context) {
    return FutureBuilder<Map<String, dynamic>>(
      future: _future,
      builder: (context, snap) {
        if (snap.connectionState == ConnectionState.waiting) {
          return const Scaffold(body: Center(child: CircularProgressIndicator()));
        }
        if (snap.hasError || snap.data == null) {
          return Scaffold(
            appBar: AppBar(title: const Text('Update your application')),
            body: Center(
              child: Padding(
                padding: const EdgeInsets.all(24),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text('Could not load your application.\n${snap.error ?? ''}',
                        textAlign: TextAlign.center, style: const TextStyle(color: Colors.grey)),
                    const SizedBox(height: 12),
                    OutlinedButton(
                      onPressed: () => context.read<AuthProvider>().logout(),
                      child: const Text('Sign out'),
                    ),
                  ],
                ),
              ),
            ),
          );
        }
        return RegisterScreen(resubmit: snap.data!);
      },
    );
  }
}
