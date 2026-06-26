import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import 'package:customer/core/widgets/profile_avatar.dart';
import 'package:customer/core/utils/snackbar.dart';
import 'package:customer/features/auth/services/account_service.dart';
import 'package:customer/features/auth/state/auth_provider.dart';
import 'package:customer/features/auth/screens/change_password_screen.dart';
import 'package:customer/features/auth/screens/login_screen.dart';
import 'package:customer/features/profile/screens/edit_profile_screen.dart';

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
              Center(child: _avatarHeader(me)),
              const SizedBox(height: 20),
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
              if (context.read<AuthProvider>().user?.hasPassword == true) ...[
                const SizedBox(height: 8),
                OutlinedButton.icon(
                  onPressed: _openChangePassword,
                  icon: const Icon(Icons.lock_outline),
                  label: const Text('Change password'),
                ),
              ],
              const SizedBox(height: 8),
              OutlinedButton.icon(
                onPressed: _confirmDelete,
                icon: const Icon(Icons.delete_forever),
                label: const Text('Delete my account'),
                style: OutlinedButton.styleFrom(
                  foregroundColor: Colors.red,
                  side: const BorderSide(color: Colors.red),
                ),
              ),
              const SizedBox(height: 24),
              OutlinedButton.icon(
                onPressed: () => context.read<AuthProvider>().logout(),
                icon: const Icon(Icons.logout),
                label: const Text('Sign out'),
              ),
            ],
          );
        },
      );
  }

  // display-only avatar (editing lives on the Edit profile page)
  Widget _avatarHeader(Map<String, dynamic> me) {
    final url = (me['avatarUrl'] as String?)?.isNotEmpty == true ? me['avatarUrl'] as String : null;
    final name = me['fullName']?.toString() ?? '';
    return ProfileAvatar(name: name, url: url, size: 96);
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
    final saved = await Navigator.of(context).push<bool>(
      MaterialPageRoute(
        builder: (_) => EditProfileScreen(
          fullName: me['fullName']?.toString() ?? '',
          username: me['username']?.toString() ?? '',
          phone: me['phoneNumber']?.toString() ?? '',
          address: (profile['shippingAddress'] as String?) ?? '',
          avatarUrl: (me['avatarUrl'] as String?)?.isNotEmpty == true ? me['avatarUrl'] as String : null,
        ),
      ),
    );
    // always reload after returning — the photo may have changed even if no save
    if (mounted) _reload();
    if (saved == true && mounted) {
      context.showSnack('Profile updated.');
    }
  }

  Future<void> _openChangePassword() async {
    final ok = await Navigator.of(context).push<bool>(
      MaterialPageRoute(builder: (_) => const ChangePasswordScreen()),
    );
    if (ok == true && mounted) {
      context.showSnack('Password changed.');
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
      if (mounted) context.showSnack(e.toString());
    }
  }
}
