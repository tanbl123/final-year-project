import 'dart:io';

import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';
import 'package:provider/provider.dart';

import 'package:customer/core/widgets/profile_avatar.dart';
import 'package:customer/features/auth/services/account_service.dart';
import 'package:customer/features/auth/state/auth_provider.dart';

/// Full-page edit-profile form: change the photo (take/choose/remove) and the
/// account fields. Pops `true` on a successful save so the caller can refresh.
class EditProfileScreen extends StatefulWidget {
  final String fullName;
  final String username;
  final String phone;
  final String address;
  final String? avatarUrl;

  const EditProfileScreen({
    super.key,
    required this.fullName,
    required this.username,
    required this.phone,
    required this.address,
    required this.avatarUrl,
  });

  @override
  State<EditProfileScreen> createState() => _EditProfileScreenState();
}

class _EditProfileScreenState extends State<EditProfileScreen> {
  late final TextEditingController _name = TextEditingController(text: widget.fullName);
  late final TextEditingController _username = TextEditingController(text: widget.username);
  late final TextEditingController _phone = TextEditingController(text: widget.phone);
  late final TextEditingController _address = TextEditingController(text: widget.address);

  late String? _avatarUrl = widget.avatarUrl;
  bool _avatarBusy = false;
  bool _saving = false;
  // whether the photo changed, so the caller refreshes even if fields didn't
  bool _avatarChanged = false;

  String? _nameError;
  String? _usernameError;
  String? _phoneError;

  @override
  void dispose() {
    for (final c in [_name, _username, _phone, _address]) {
      c.dispose();
    }
    super.dispose();
  }

  Future<void> _changeAvatar() async {
    final action = await showModalBottomSheet<String>(
      context: context,
      builder: (_) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            ListTile(
              leading: const Icon(Icons.photo_camera_outlined),
              title: const Text('Take a photo'),
              onTap: () => Navigator.pop(context, 'camera'),
            ),
            ListTile(
              leading: const Icon(Icons.photo_library_outlined),
              title: const Text('Choose from gallery'),
              onTap: () => Navigator.pop(context, 'gallery'),
            ),
            if (_avatarUrl != null)
              ListTile(
                leading: const Icon(Icons.delete_outline, color: Colors.red),
                title: const Text('Remove photo', style: TextStyle(color: Colors.red)),
                onTap: () => Navigator.pop(context, 'remove'),
              ),
          ],
        ),
      ),
    );
    if (action == null || !mounted) return;

    setState(() => _avatarBusy = true);
    try {
      final account = context.read<AccountService>();
      if (action == 'remove') {
        await account.removeAvatar();
        setState(() => _avatarUrl = null);
        _avatarChanged = true;
      } else {
        final picked = await ImagePicker().pickImage(
          source: action == 'camera' ? ImageSource.camera : ImageSource.gallery,
          maxWidth: 800,
          imageQuality: 85,
        );
        if (picked == null) return;
        final url = await account.uploadAvatar(File(picked.path));
        setState(() => _avatarUrl = url);
        _avatarChanged = true;
      }
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString())));
    } finally {
      if (mounted) setState(() => _avatarBusy = false);
    }
  }

  Future<void> _save() async {
    setState(() {
      _saving = true;
      _nameError = _name.text.trim().isEmpty ? 'Full name is required.' : null;
      _usernameError = _username.text.trim().isEmpty ? 'Username is required.' : null;
    });
    if (_nameError != null || _usernameError != null) {
      setState(() => _saving = false);
      return;
    }
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
      final msg = e.toString();
      final lower = msg.toLowerCase();
      if (mounted) {
        setState(() {
          _saving = false;
          if (lower.contains('phone')) {
            _phoneError = msg;
          } else if (lower.contains('name')) {
            _nameError = msg;
          } else {
            _usernameError = msg;
          }
        });
      }
    }
  }

  // unsaved text-field edits (the photo uploads immediately, so it's never
  // "unsaved"). Mirrors the web's `dirty` check.
  bool get _dirty =>
      _name.text.trim() != widget.fullName.trim() ||
      _username.text.trim() != widget.username.trim() ||
      _phone.text.trim() != widget.phone.trim() ||
      _address.text.trim() != widget.address.trim();

  // "Discard changes?" prompt — same wording as the web portal.
  Future<bool> _confirmDiscard() async {
    final leave = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Discard changes?'),
        content: const Text('You have unsaved changes. Are you sure you want to discard them?'),
        actions: [
          TextButton(onPressed: () => Navigator.of(ctx).pop(false), child: const Text('Keep editing')),
          FilledButton(
            style: FilledButton.styleFrom(backgroundColor: Colors.red),
            onPressed: () => Navigator.of(ctx).pop(true),
            child: const Text('Discard'),
          ),
        ],
      ),
    );
    return leave ?? false;
  }

  @override
  Widget build(BuildContext context) {
    return PopScope(
      // block an accidental back when there are unsaved field edits; confirm first
      canPop: false,
      onPopInvokedWithResult: (didPop, result) async {
        if (didPop) return;
        final nav = Navigator.of(context);
        if (!_dirty || await _confirmDiscard()) nav.pop();
      },
      child: Scaffold(
        appBar: AppBar(title: const Text('Edit profile')),
        body: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            Center(child: _avatarEditor()),
            const SizedBox(height: 24),
            _field(_name, 'Full name',
                error: _nameError, onChanged: () => setState(() => _nameError = null)),
            _field(_username, 'Username',
                error: _usernameError, onChanged: () => setState(() => _usernameError = null)),
            _field(_phone, 'Phone number',
                keyboard: TextInputType.phone,
                error: _phoneError, onChanged: () => setState(() => _phoneError = null)),
            _field(_address, 'Shipping address', maxLines: 2),
            const SizedBox(height: 8),
            FilledButton(
              onPressed: _saving ? null : _save,
              child: Padding(
                padding: const EdgeInsets.symmetric(vertical: 12),
                child: _saving
                    ? const SizedBox(height: 20, width: 20, child: CircularProgressIndicator(strokeWidth: 2))
                    : const Text('Save'),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _avatarEditor() {
    return Stack(
      children: [
        ProfileAvatar(name: _name.text, url: _avatarUrl, size: 100),
        if (_avatarBusy)
          const Positioned.fill(
            child: CircleAvatar(
              backgroundColor: Colors.black38,
              child: SizedBox(width: 22, height: 22, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white)),
            ),
          ),
        Positioned(
          right: 0,
          bottom: 0,
          child: Material(
            color: Theme.of(context).colorScheme.primary,
            shape: const CircleBorder(),
            child: InkWell(
              customBorder: const CircleBorder(),
              onTap: _avatarBusy ? null : _changeAvatar,
              child: const Padding(
                padding: EdgeInsets.all(7),
                child: Icon(Icons.camera_alt, size: 18, color: Colors.white),
              ),
            ),
          ),
        ),
      ],
    );
  }

  Widget _field(TextEditingController c, String label,
          {int maxLines = 1, TextInputType? keyboard, String? error, VoidCallback? onChanged}) =>
      Padding(
        padding: const EdgeInsets.only(bottom: 16),
        child: TextField(
          controller: c,
          keyboardType: keyboard,
          maxLines: maxLines,
          onChanged: (error == null || onChanged == null) ? null : (_) => onChanged(),
          decoration: InputDecoration(
            labelText: label,
            border: const OutlineInputBorder(),
            errorText: error,
          ),
        ),
      );
}
