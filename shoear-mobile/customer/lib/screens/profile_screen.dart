import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../services/account_service.dart';
import '../state/auth_provider.dart';
import 'login_screen.dart';

/// The customer's profile: view/edit details, change password, delete account.
class ProfileScreen extends StatefulWidget {
  const ProfileScreen({super.key});

  @override
  State<ProfileScreen> createState() => _ProfileScreenState();
}

class _ProfileScreenState extends State<ProfileScreen> {
  Future<Map<String, dynamic>>? _future;
  bool _wasLoggedIn = false;

  void _reload() => setState(() => _future = context.read<AccountService>().me());

  @override
  Widget build(BuildContext context) {
    final loggedIn = context.watch<AuthProvider>().isLoggedIn;
    if (loggedIn != _wasLoggedIn) {
      _wasLoggedIn = loggedIn;
      _future = null; // reload on login / drop on logout
    }
    return Scaffold(
      appBar: AppBar(title: const Text('My Profile')),
      body: !loggedIn ? _signInPrompt(context) : _profileBody(context),
    );
  }

  Widget _signInPrompt(BuildContext context) => Center(
        child: Padding(
          padding: const EdgeInsets.all(32),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(Icons.person_outline, size: 48, color: Colors.grey.shade400),
              const SizedBox(height: 12),
              const Text('Sign in to manage your account.', textAlign: TextAlign.center),
              const SizedBox(height: 16),
              FilledButton(
                onPressed: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => const LoginScreen())),
                child: const Text('Login'),
              ),
            ],
          ),
        ),
      );

  Widget _profileBody(BuildContext context) {
    _future ??= context.read<AccountService>().me();
    return FutureBuilder<Map<String, dynamic>>(
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
              const SizedBox(height: 8),
              OutlinedButton.icon(
                onPressed: () => context.read<AuthProvider>().logout(),
                icon: const Icon(Icons.logout),
                label: const Text('Sign out'),
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
    final saved = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      builder: (_) => _EditProfileSheet(
        fullName: me['fullName']?.toString() ?? '',
        username: me['username']?.toString() ?? '',
        phone: me['phoneNumber']?.toString() ?? '',
        address: (profile['shippingAddress'] as String?) ?? '',
      ),
    );
    if (saved == true && mounted) _reload();
  }

  Future<void> _openChangePassword() async {
    final ok = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      builder: (_) => const _ChangePasswordSheet(),
    );
    if (ok == true && mounted) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Password changed.')));
    }
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
}

/// Shared field used by the profile sheets.
Widget _profileField(TextEditingController c, String label, {bool obscure = false, int maxLines = 1}) => Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: TextField(
        controller: c,
        obscureText: obscure,
        maxLines: obscure ? 1 : maxLines,
        decoration: InputDecoration(labelText: label, border: const OutlineInputBorder()),
      ),
    );

/// Edit-profile sheet — owns its controllers (disposed in dispose) and does its
/// own save, popping `true` on success so the caller can refresh.
class _EditProfileSheet extends StatefulWidget {
  final String fullName;
  final String username;
  final String phone;
  final String address;
  const _EditProfileSheet({required this.fullName, required this.username, required this.phone, required this.address});

  @override
  State<_EditProfileSheet> createState() => _EditProfileSheetState();
}

class _EditProfileSheetState extends State<_EditProfileSheet> {
  late final TextEditingController _name = TextEditingController(text: widget.fullName);
  late final TextEditingController _username = TextEditingController(text: widget.username);
  late final TextEditingController _phone = TextEditingController(text: widget.phone);
  late final TextEditingController _address = TextEditingController(text: widget.address);
  bool _saving = false;
  String? _err;

  @override
  void dispose() {
    for (final c in [_name, _username, _phone, _address]) {
      c.dispose();
    }
    super.dispose();
  }

  Future<void> _save() async {
    setState(() { _saving = true; _err = null; });
    try {
      await context.read<AccountService>().updateProfile(
            fullName: _name.text.trim(),
            phoneNumber: _phone.text.trim(),
            username: _username.text.trim(),
            shippingAddress: _address.text.trim(),
          );
      await context.read<AuthProvider>().applyProfile(fullName: _name.text.trim());
      if (mounted) Navigator.of(context).pop(true);
    } catch (e) {
      if (mounted) setState(() { _saving = false; _err = e.toString(); });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.only(left: 16, right: 16, top: 16, bottom: 16 + MediaQuery.of(context).viewInsets.bottom),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text('Edit profile', style: Theme.of(context).textTheme.titleLarge),
          const SizedBox(height: 12),
          if (_err != null) ...[
            Text(_err!, style: TextStyle(color: Colors.red.shade700)),
            const SizedBox(height: 8),
          ],
          _profileField(_name, 'Full name'),
          _profileField(_username, 'Username'),
          _profileField(_phone, 'Phone number'),
          _profileField(_address, 'Shipping address', maxLines: 2),
          const SizedBox(height: 8),
          FilledButton(
            onPressed: _saving ? null : _save,
            child: Padding(
              padding: const EdgeInsets.symmetric(vertical: 10),
              child: _saving
                  ? const SizedBox(height: 18, width: 18, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                  : const Text('Save'),
            ),
          ),
        ],
      ),
    );
  }
}

/// Change-password sheet — owns its controllers; pops `true` on success.
class _ChangePasswordSheet extends StatefulWidget {
  const _ChangePasswordSheet();

  @override
  State<_ChangePasswordSheet> createState() => _ChangePasswordSheetState();
}

class _ChangePasswordSheetState extends State<_ChangePasswordSheet> {
  final TextEditingController _current = TextEditingController();
  final TextEditingController _next = TextEditingController();
  bool _saving = false;
  String? _err;

  @override
  void dispose() {
    _current.dispose();
    _next.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    setState(() { _saving = true; _err = null; });
    try {
      await context.read<AccountService>().changePassword(_current.text, _next.text);
      if (mounted) Navigator.of(context).pop(true);
    } catch (e) {
      if (mounted) setState(() { _saving = false; _err = e.toString(); });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.only(left: 16, right: 16, top: 16, bottom: 16 + MediaQuery.of(context).viewInsets.bottom),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text('Change password', style: Theme.of(context).textTheme.titleLarge),
          const SizedBox(height: 12),
          if (_err != null) ...[
            Text(_err!, style: TextStyle(color: Colors.red.shade700)),
            const SizedBox(height: 8),
          ],
          _profileField(_current, 'Current password', obscure: true),
          _profileField(_next, 'New password', obscure: true),
          const SizedBox(height: 8),
          FilledButton(
            onPressed: _saving ? null : _save,
            child: Padding(
              padding: const EdgeInsets.symmetric(vertical: 10),
              child: _saving
                  ? const SizedBox(height: 18, width: 18, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                  : const Text('Update password'),
            ),
          ),
        ],
      ),
    );
  }
}
