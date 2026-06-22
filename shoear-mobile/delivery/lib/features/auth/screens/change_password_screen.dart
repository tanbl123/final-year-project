import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import 'package:delivery/features/auth/services/account_service.dart';

// Mirrors the backend password policy so we can flag problems before submitting.
String? _passwordPolicyError(String pw) {
  if (pw.length < 8) return 'Password must be at least 8 characters.';
  if (!RegExp(r'[a-z]').hasMatch(pw)) return 'Password must include a lowercase letter.';
  if (!RegExp(r'[A-Z]').hasMatch(pw)) return 'Password must include an uppercase letter.';
  if (!RegExp(r'[0-9]').hasMatch(pw)) return 'Password must include a number.';
  if (!RegExp(r'[^a-zA-Z0-9]').hasMatch(pw)) return 'Password must include a special character.';
  return null;
}

/// Full-page change-password form (current / new / confirm). Pops `true` on success.
class ChangePasswordScreen extends StatefulWidget {
  const ChangePasswordScreen({super.key});

  @override
  State<ChangePasswordScreen> createState() => _ChangePasswordScreenState();
}

class _ChangePasswordScreenState extends State<ChangePasswordScreen> {
  final _current = TextEditingController();
  final _next = TextEditingController();
  final _confirm = TextEditingController();
  bool _showCurrent = false;
  bool _showNew = false;
  bool _showConfirm = false;
  bool _saving = false;
  String? _currentError; // server-side, shown under the Current password field

  @override
  void dispose() {
    _current.dispose();
    _next.dispose();
    _confirm.dispose();
    super.dispose();
  }

  String? get _newPwError {
    if (_next.text.isEmpty) return null;
    final policy = _passwordPolicyError(_next.text);
    if (policy != null) return policy;
    if (_next.text == _current.text) return 'New password must be different from your current one.';
    return null;
  }

  bool get _confirmMismatch => _confirm.text.isNotEmpty && _confirm.text != _next.text;

  bool get _ready =>
      _current.text.isNotEmpty &&
      _next.text.isNotEmpty &&
      _confirm.text.isNotEmpty &&
      _newPwError == null &&
      !_confirmMismatch;

  Future<void> _save() async {
    setState(() {
      _saving = true;
      _currentError = null;
    });
    try {
      await context.read<AccountService>().changePassword(_current.text, _next.text);
      if (mounted) Navigator.of(context).pop(true);
    } catch (e) {
      if (mounted) {
        setState(() {
          _saving = false;
          _currentError = e.toString();
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Change password')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          _pwField(
            controller: _current,
            label: 'Current password',
            show: _showCurrent,
            onToggle: () => setState(() => _showCurrent = !_showCurrent),
            errorText: _currentError,
            autofocus: true,
          ),
          const SizedBox(height: 16),
          _pwField(
            controller: _next,
            label: 'New password',
            show: _showNew,
            onToggle: () => setState(() => _showNew = !_showNew),
            errorText: _newPwError,
          ),
          const SizedBox(height: 16),
          _pwField(
            controller: _confirm,
            label: 'Confirm new password',
            show: _showConfirm,
            onToggle: () => setState(() => _showConfirm = !_showConfirm),
            errorText: _confirmMismatch ? 'Passwords do not match.' : null,
          ),
          const SizedBox(height: 24),
          FilledButton(
            onPressed: (!_ready || _saving) ? null : _save,
            child: Padding(
              padding: const EdgeInsets.symmetric(vertical: 12),
              child: _saving
                  ? const SizedBox(height: 20, width: 20, child: CircularProgressIndicator(strokeWidth: 2))
                  : const Text('Update password'),
            ),
          ),
        ],
      ),
    );
  }

  Widget _pwField({
    required TextEditingController controller,
    required String label,
    required bool show,
    required VoidCallback onToggle,
    String? errorText,
    bool autofocus = false,
  }) {
    return TextField(
      controller: controller,
      obscureText: !show,
      autofocus: autofocus,
      onChanged: (_) => setState(() => _currentError = null), // refresh validation, clear server error
      decoration: InputDecoration(
        labelText: label,
        border: const OutlineInputBorder(),
        errorText: errorText,
        suffixIcon: IconButton(
          icon: Icon(show ? Icons.visibility : Icons.visibility_off),
          onPressed: onToggle,
        ),
      ),
    );
  }
}
