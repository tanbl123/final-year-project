import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import 'package:delivery/core/widgets/profile_avatar.dart';
import 'package:delivery/features/auth/services/account_service.dart';
import 'package:delivery/features/auth/state/auth_provider.dart';
import 'package:delivery/features/auth/screens/change_password_screen.dart';
import 'package:delivery/features/profile/screens/edit_profile_screen.dart';

/// The courier's profile: view/edit details, change password, sign out.
class ProfileScreen extends StatefulWidget {
  const ProfileScreen({super.key});

  @override
  State<ProfileScreen> createState() => _ProfileScreenState();
}

class _ProfileScreenState extends State<ProfileScreen> {
  Future<Map<String, dynamic>>? _future;

  void _reload() => setState(() => _future = context.read<AccountService>().me());

  @override
  Widget build(BuildContext context) {
    _future ??= context.read<AccountService>().me();
    return Scaffold(
      appBar: AppBar(title: const Text('Profile')),
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
          final url = (me['avatarUrl'] as String?)?.isNotEmpty == true ? me['avatarUrl'] as String : null;
          final name = me['fullName']?.toString() ?? '';
          return ListView(
            padding: const EdgeInsets.all(16),
            children: [
              Center(child: ProfileAvatar(name: name, url: url, size: 96)),
              const SizedBox(height: 20),
              _row('Username', me['username']?.toString() ?? '—'),
              _row('Name', name.isEmpty ? '—' : name),
              _row('Email', me['email']?.toString() ?? '—'),
              _row('Phone', me['phoneNumber']?.toString() ?? '—'),
              _row('Vehicle type', profile['vehicleType']?.toString() ?? '—'),
              _row('Brand', profile['vehicleBrand']?.toString() ?? '—'),
              _row('Model', profile['vehicleModel']?.toString() ?? '—'),
              _row('Plate', profile['vehiclePlate']?.toString() ?? '—'),
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
              OutlinedButton.icon(
                onPressed: () => context.read<AuthProvider>().logout(),
                icon: const Icon(Icons.logout),
                label: const Text('Sign out'),
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
            SizedBox(width: 110, child: Text(k, style: const TextStyle(color: Colors.grey))),
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
          vehicleType:  profile['vehicleType']?.toString()  ?? 'Motorcycle',
          vehicleBrand: profile['vehicleBrand']?.toString() ?? '',
          vehicleModel: profile['vehicleModel']?.toString() ?? '',
          vehiclePlate: profile['vehiclePlate']?.toString() ?? '',
          avatarUrl: (me['avatarUrl'] as String?)?.isNotEmpty == true ? me['avatarUrl'] as String : null,
        ),
      ),
    );
    if (mounted) _reload();
    if (saved == true && mounted) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Profile updated.')));
    }
  }

  Future<void> _openChangePassword() async {
    final ok = await Navigator.of(context).push<bool>(
      MaterialPageRoute(builder: (_) => const ChangePasswordScreen()),
    );
    if (ok == true && mounted) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Password changed.')));
    }
  }
}
