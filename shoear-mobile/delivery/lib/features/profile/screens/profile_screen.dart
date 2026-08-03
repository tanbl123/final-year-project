import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import 'package:delivery/core/widgets/profile_avatar.dart';
import 'package:delivery/core/utils/snackbar.dart';
import 'package:delivery/features/auth/services/account_service.dart';
import 'package:delivery/features/auth/state/auth_provider.dart';
import 'package:delivery/features/auth/screens/change_password_screen.dart';
import 'package:delivery/features/profile/screens/edit_profile_screen.dart';
import 'package:delivery/features/profile/screens/vehicle_licence_screen.dart';
import 'package:delivery/features/earnings/screens/earnings_screen.dart';

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
              _row('IC number', profile['icNumber']?.toString() ?? '—'),
              // IC is a fixed identity document (verified at approval), so it's
              // shown here read-only — it isn't editable in Vehicle & licence.
              if (_hasIc(profile)) ...[
                const SizedBox(height: 12),
                const Text('Identity card (IC)', style: TextStyle(fontWeight: FontWeight.w600)),
                const SizedBox(height: 8),
                _docThumb('IC (front)', profile['icPhotoUrl']?.toString()),
                _docThumb('IC (back)', profile['icPhotoBackUrl']?.toString()),
              ],
              const SizedBox(height: 20),
              FilledButton.icon(
                onPressed: () => Navigator.of(context).push(
                  MaterialPageRoute(builder: (_) => const EarningsScreen()),
                ),
                icon: const Icon(Icons.account_balance_wallet_outlined),
                label: const Text('My earnings'),
              ),
              const SizedBox(height: 8),
              OutlinedButton.icon(
                onPressed: () => _openEdit(me, profile),
                icon: const Icon(Icons.edit),
                label: const Text('Edit profile'),
              ),
              const SizedBox(height: 8),
              OutlinedButton.icon(
                onPressed: _openVehicleLicence,
                icon: const Icon(Icons.badge_outlined),
                label: const Text('Vehicle & licence'),
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

  static bool _hasIc(Map profile) =>
      (profile['icPhotoUrl']?.toString().isNotEmpty ?? false) ||
      (profile['icPhotoBackUrl']?.toString().isNotEmpty ?? false);

  // A labelled, read-only document preview. Tap to open full-screen and zoom.
  Widget _docThumb(String label, String? url) {
    if (url == null || url.isEmpty) return const SizedBox.shrink();
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(label, style: const TextStyle(fontSize: 12, color: Colors.grey)),
          const SizedBox(height: 4),
          GestureDetector(
            onTap: () => _openFullScreen(label, url),
            child: ClipRRect(
              borderRadius: BorderRadius.circular(8),
              child: Stack(
                children: [
                  Image.network(url, height: 150, width: double.infinity, fit: BoxFit.cover,
                      errorBuilder: (_, __, ___) => Container(
                            height: 90, width: double.infinity, color: Colors.grey.shade200,
                            child: const Center(child: Icon(Icons.description_outlined, color: Colors.grey)),
                          )),
                  Positioned(
                    right: 6,
                    bottom: 6,
                    child: Container(
                      padding: const EdgeInsets.all(4),
                      decoration: BoxDecoration(color: Colors.black54, borderRadius: BorderRadius.circular(6)),
                      child: const Icon(Icons.zoom_in, color: Colors.white, size: 18),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }

  void _openFullScreen(String label, String url) {
    Navigator.of(context).push(MaterialPageRoute(
      fullscreenDialog: true,
      builder: (_) => Scaffold(
        backgroundColor: Colors.black,
        appBar: AppBar(
          backgroundColor: Colors.black,
          foregroundColor: Colors.white,
          title: Text(label, style: const TextStyle(color: Colors.white, fontSize: 16)),
        ),
        body: Center(
          child: InteractiveViewer(
            minScale: 0.8,
            maxScale: 5,
            child: Image.network(url, fit: BoxFit.contain,
                loadingBuilder: (_, child, progress) =>
                    progress == null ? child : const CircularProgressIndicator(color: Colors.white),
                errorBuilder: (_, __, ___) => const Icon(Icons.broken_image_outlined, color: Colors.white70, size: 48)),
          ),
        ),
      ),
    ));
  }

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
          coverageZones: profile['coverageZones']?.toString() ?? '',
          avatarUrl: (me['avatarUrl'] as String?)?.isNotEmpty == true ? me['avatarUrl'] as String : null,
        ),
      ),
    );
    if (mounted) _reload();
    if (saved == true && mounted) {
      context.showSnack('Profile updated.');
    }
  }

  Future<void> _openVehicleLicence() async {
    final changed = await Navigator.of(context).push<bool>(
      MaterialPageRoute(builder: (_) => const VehicleLicenceScreen()),
    );
    if (changed == true && mounted) _reload();
  }

  Future<void> _openChangePassword() async {
    final ok = await Navigator.of(context).push<bool>(
      MaterialPageRoute(builder: (_) => const ChangePasswordScreen()),
    );
    if (ok == true && mounted) {
      context.showSnack('Password changed.');
    }
  }
}
