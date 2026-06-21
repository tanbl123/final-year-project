import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../services/account_service.dart';
import '../state/auth_provider.dart';

/// The customer's profile: view/edit details, change password, delete account.
class ProfileScreen extends StatefulWidget {
  const ProfileScreen({super.key});

  @override
  State<ProfileScreen> createState() => _ProfileScreenState();
}

class _ProfileScreenState extends State<ProfileScreen> {
  late Future<Map<String, dynamic>> _future;

  @override
  void initState() {
    super.initState();
    _future = context.read<AccountService>().me();
  }

  void _reload() => setState(() => _future = context.read<AccountService>().me());

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('My Profile')),
      body: FutureBuilder<Map<String, dynamic>>(
        future: _future,
        builder: (context, snap) {
          if (snap.connectionState == ConnectionState.waiting) {
            return const Center(child: CircularProgressIndicator());
          }
          if (snap.hasError) {
            return Center(child: Padding(padding: const EdgeInsets.all(24), child: Text(snap.error.toString(), textAlign: TextAlign.center)));
          }
          final me = snap.data!;
          final profile = me['profile'] is Map ? me['profile'] as Map<String, dynamic> : const {};
          return ListView(
            padding: const EdgeInsets.all(16),
            children: [
              _row('Username', me['username']?.toString() ?? '—'),
              _row('Name', me['fullName']?.toString() ?? '—'),
              _row('Email', me['email']?.toString() ?? '—'),
              _row('Phone', me['phoneNumber']?.toString() ?? '—'),
              _row('Shipping address', (profile['shippingAddress'] as String?)?.isNotEmpty == true ? profile['shippingAddress'] as String : '—'),
              const SizedBox(height: 20),
              FilledButton.icon(
                onPressed: () => _openEdit(me, profile),
                icon: const Icon(Icons.edit),
                label: const Text('Edit profile'),
              ),
              const SizedBox(height: 8),
              OutlinedButton.icon(
                onPressed: _openChangePassword,
                icon: const Icon(Icons.lock_outline),
                label: const Text('Change password'),
              ),
              const SizedBox(height: 24),
              TextButton.icon(
                onPressed: _confirmDelete,
                icon: const Icon(Icons.delete_forever, color: Colors.red),
                label: const Text('Delete my account', style: TextStyle(color: Colors.red)),
              ),
            ],
          );
        },
      ),
    );
  }

  Widget _row(String k, String v) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 6),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            SizedBox(width: 130, child: Text(k, style: const TextStyle(color: Colors.grey))),
            Expanded(child: Text(v)),
          ],
        ),
      );

  Future<void> _openEdit(Map<String, dynamic> me, Map profile) async {
    final name = TextEditingController(text: me['fullName']?.toString() ?? '');
    final username = TextEditingController(text: me['username']?.toString() ?? '');
    final phone = TextEditingController(text: me['phoneNumber']?.toString() ?? '');
    final address = TextEditingController(text: (profile['shippingAddress'] as String?) ?? '');
    bool saving = false;
    String? err;

    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      builder: (ctx) => Padding(
        padding: EdgeInsets.only(left: 16, right: 16, top: 16, bottom: 16 + MediaQuery.of(ctx).viewInsets.bottom),
        child: StatefulBuilder(
          builder: (ctx, setSheet) => Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text('Edit profile', style: Theme.of(ctx).textTheme.titleLarge),
              const SizedBox(height: 12),
              if (err != null) ...[
                Text(err!, style: TextStyle(color: Colors.red.shade700)),
                const SizedBox(height: 8),
              ],
              _sheetField(name, 'Full name'),
              _sheetField(username, 'Username'),
              _sheetField(phone, 'Phone number'),
              _sheetField(address, 'Shipping address', maxLines: 2),
              const SizedBox(height: 8),
              FilledButton(
                onPressed: saving
                    ? null
                    : () async {
                        setSheet(() { saving = true; err = null; });
                        try {
                          await context.read<AccountService>().updateProfile(
                                fullName: name.text.trim(),
                                phoneNumber: phone.text.trim(),
                                username: username.text.trim(),
                                shippingAddress: address.text.trim(),
                              );
                          await context.read<AuthProvider>().applyProfile(fullName: name.text.trim());
                          if (ctx.mounted) Navigator.of(ctx).pop();
                        } catch (e) {
                          setSheet(() { saving = false; err = e.toString(); });
                        }
                      },
                child: Padding(
                  padding: const EdgeInsets.symmetric(vertical: 10),
                  child: saving
                      ? const SizedBox(height: 18, width: 18, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                      : const Text('Save'),
                ),
              ),
            ],
          ),
        ),
      ),
    );
    for (final c in [name, username, phone, address]) {
      c.dispose();
    }
    if (mounted) _reload();
  }

  Future<void> _openChangePassword() async {
    final current = TextEditingController();
    final next = TextEditingController();
    bool saving = false;
    String? err;

    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      builder: (ctx) => Padding(
        padding: EdgeInsets.only(left: 16, right: 16, top: 16, bottom: 16 + MediaQuery.of(ctx).viewInsets.bottom),
        child: StatefulBuilder(
          builder: (ctx, setSheet) => Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text('Change password', style: Theme.of(ctx).textTheme.titleLarge),
              const SizedBox(height: 12),
              if (err != null) ...[
                Text(err!, style: TextStyle(color: Colors.red.shade700)),
                const SizedBox(height: 8),
              ],
              _sheetField(current, 'Current password', obscure: true),
              _sheetField(next, 'New password', obscure: true),
              const SizedBox(height: 8),
              FilledButton(
                onPressed: saving
                    ? null
                    : () async {
                        setSheet(() { saving = true; err = null; });
                        try {
                          await context.read<AccountService>().changePassword(current.text, next.text);
                          if (ctx.mounted) {
                            Navigator.of(ctx).pop();
                            ScaffoldMessenger.of(ctx).showSnackBar(const SnackBar(content: Text('Password changed.')));
                          }
                        } catch (e) {
                          setSheet(() { saving = false; err = e.toString(); });
                        }
                      },
                child: Padding(
                  padding: const EdgeInsets.symmetric(vertical: 10),
                  child: saving
                      ? const SizedBox(height: 18, width: 18, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                      : const Text('Update password'),
                ),
              ),
            ],
          ),
        ),
      ),
    );
    current.dispose();
    next.dispose();
  }

  Future<void> _confirmDelete() async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Delete account?'),
        content: const Text('This closes your account and signs you out. Your past orders are kept for records.'),
        actions: [
          TextButton(onPressed: () => Navigator.of(ctx).pop(false), child: const Text('Cancel')),
          FilledButton(
            style: FilledButton.styleFrom(backgroundColor: Colors.red),
            onPressed: () => Navigator.of(ctx).pop(true),
            child: const Text('Delete'),
          ),
        ],
      ),
    );
    if (ok != true) return;
    try {
      await context.read<AccountService>().deleteAccount();
      if (!mounted) return;
      await context.read<AuthProvider>().logout();
      if (mounted) Navigator.of(context).popUntil((route) => route.isFirst);
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString())));
    }
  }

  Widget _sheetField(TextEditingController c, String label, {bool obscure = false, int maxLines = 1}) => Padding(
        padding: const EdgeInsets.only(bottom: 12),
        child: TextField(
          controller: c,
          obscureText: obscure,
          maxLines: obscure ? 1 : maxLines,
          decoration: InputDecoration(labelText: label, border: const OutlineInputBorder()),
        ),
      );
}
