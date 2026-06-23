import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';

import 'package:delivery/features/auth/state/auth_provider.dart';

String? _passwordPolicyError(String pw) {
  if (pw.length < 8) return 'Password must be at least 8 characters.';
  if (!RegExp(r'[a-z]').hasMatch(pw)) return 'Password must include a lowercase letter.';
  if (!RegExp(r'[A-Z]').hasMatch(pw)) return 'Password must include an uppercase letter.';
  if (!RegExp(r'[0-9]').hasMatch(pw)) return 'Password must include a number.';
  if (!RegExp(r'[^a-zA-Z0-9]').hasMatch(pw)) return 'Password must include a special character.';
  return null;
}

/// Forgot password — three steps:
///   1. request → enter email; backend emails a 6-digit code
///   2. verify  → enter the code (not consumed yet)
///   3. reset   → choose a new password
/// Pops `true` on success so the login screen can show a confirmation message.
class ForgotPasswordScreen extends StatefulWidget {
  const ForgotPasswordScreen({super.key});

  @override
  State<ForgotPasswordScreen> createState() => _ForgotPasswordScreenState();
}

enum _Step { request, verify, reset }

class _ForgotPasswordScreenState extends State<ForgotPasswordScreen> {
  _Step _step = _Step.request;

  final _email    = TextEditingController();
  final _code     = TextEditingController();
  final _password = TextEditingController();
  final _confirm  = TextEditingController();

  String? _emailError;
  String? _codeError;
  String? _passwordError;
  String? _confirmError;
  String? _info;

  bool _sending   = false;
  bool _verifying = false;
  bool _resetting = false;
  bool _resending = false;
  bool _showPw      = false;
  bool _showConfirm = false;

  int    _resendIn = 0;
  Timer? _resendTimer;

  @override
  void dispose() {
    _resendTimer?.cancel();
    _email.dispose();
    _code.dispose();
    _password.dispose();
    _confirm.dispose();
    super.dispose();
  }

  void _startResendCooldown() {
    _resendTimer?.cancel();
    setState(() => _resendIn = 60);
    _resendTimer = Timer.periodic(const Duration(seconds: 1), (t) {
      if (!mounted) return;
      setState(() => _resendIn--);
      if (_resendIn <= 0) t.cancel();
    });
  }

  bool _validEmail(String v) => RegExp(r'^[^\s@]+@[^\s@]+\.[^\s@]+$').hasMatch(v);

  Future<void> _request() async {
    final email = _email.text.trim();
    if (email.isEmpty || !_validEmail(email)) {
      setState(() => _emailError = 'Please enter a valid email.');
      return;
    }
    setState(() { _emailError = null; _sending = true; });
    try {
      await context.read<AuthProvider>().authService.forgotPassword(email);
      if (!mounted) return;
      setState(() { _info = null; _code.clear(); _codeError = null; _step = _Step.verify; });
      _startResendCooldown();
    } catch (e) {
      if (mounted) setState(() => _emailError = e.toString());
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  Future<void> _verify() async {
    final code = _code.text.trim();
    if (!RegExp(r'^\d{6}$').hasMatch(code)) {
      setState(() => _codeError = 'Enter the 6-digit code from your email.');
      return;
    }
    setState(() { _codeError = null; _verifying = true; });
    try {
      await context.read<AuthProvider>().authService.verifyResetCode(_email.text.trim(), code);
      if (!mounted) return;
      setState(() {
        _passwordError = null; _confirmError = null;
        _password.clear(); _confirm.clear();
        _info = null; _step = _Step.reset;
      });
    } catch (e) {
      if (mounted) setState(() => _codeError = e.toString());
    } finally {
      if (mounted) setState(() => _verifying = false);
    }
  }

  Future<void> _reset() async {
    final pwErr = _passwordPolicyError(_password.text);
    final cfErr = _confirm.text.isEmpty
        ? 'Please confirm your password.'
        : (_password.text != _confirm.text ? 'Passwords do not match.' : null);
    setState(() { _passwordError = pwErr; _confirmError = cfErr; });
    if (pwErr != null || cfErr != null) return;

    setState(() => _resetting = true);
    try {
      await context.read<AuthProvider>().authService
          .resetPassword(_email.text.trim(), _code.text.trim(), _password.text);
      if (mounted) Navigator.of(context).pop(true);
    } catch (e) {
      final msg = e.toString();
      final lower = msg.toLowerCase();
      if (!mounted) return;
      setState(() {
        _resetting = false;
        if (lower.contains('different from your current')) {
          _passwordError = msg;
        } else if (lower.contains('code') &&
            (lower.contains('expired') || lower.contains('request') ||
             lower.contains('incorrect') || lower.contains('attempts'))) {
          _codeError = msg;
          _step = _Step.verify;
        } else {
          _passwordError = msg;
        }
      });
    }
  }

  Future<void> _resend() async {
    if (_resendIn > 0 || _resending) return;
    setState(() { _codeError = null; _info = null; _resending = true; });
    try {
      await context.read<AuthProvider>().authService.forgotPassword(_email.text.trim());
      if (!mounted) return;
      setState(() => _info = 'A new code has been sent to your email.');
      _startResendCooldown();
    } catch (e) {
      if (mounted) setState(() => _codeError = e.toString());
    } finally {
      if (mounted) setState(() => _resending = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Text(switch (_step) {
          _Step.request => 'Forgot password',
          _Step.verify  => 'Enter code',
          _Step.reset   => 'New password',
        }),
        leading: _step == _Step.request
            ? null
            : IconButton(
                icon: const Icon(Icons.arrow_back),
                onPressed: () => setState(() {
                  _info = null;
                  if (_step == _Step.verify) { _codeError = null; _step = _Step.request; }
                  else { _step = _Step.verify; }
                }),
              ),
      ),
      body: Center(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(24),
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 420),
            child: switch (_step) {
              _Step.request => _requestStep(),
              _Step.verify  => _verifyStep(),
              _Step.reset   => _resetStep(),
            },
          ),
        ),
      ),
    );
  }

  Widget _card(List<Widget> children) => Card(
        elevation: 1.5,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
        child: Padding(
          padding: const EdgeInsets.all(20),
          child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: children),
        ),
      );

  Widget _submit(String label, bool busy, VoidCallback? onPressed) => FilledButton(
        onPressed: busy ? null : onPressed,
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: 12),
          child: busy
              ? const SizedBox(height: 20, width: 20, child: CircularProgressIndicator(strokeWidth: 2))
              : Text(label),
        ),
      );

  Widget _requestStep() => _card([
        const Text('🔑 Forgot password',
            style: TextStyle(fontSize: 22, fontWeight: FontWeight.bold), textAlign: TextAlign.center),
        const SizedBox(height: 12),
        Text("Enter your account email and we'll send you a 6-digit code to reset your password.",
            style: TextStyle(color: Theme.of(context).colorScheme.onSurfaceVariant)),
        const SizedBox(height: 16),
        TextField(
          controller: _email,
          keyboardType: TextInputType.emailAddress,
          textInputAction: TextInputAction.done,
          autofocus: true,
          onChanged: (v) => setState(() => _emailError =
              v.trim().isEmpty ? null : (_validEmail(v.trim()) ? null : 'Please enter a valid email.')),
          onSubmitted: (_) => _request(),
          decoration: InputDecoration(
            labelText: 'Email',
            border: const OutlineInputBorder(),
            errorText: _emailError,
          ),
        ),
        const SizedBox(height: 20),
        _submit(_sending ? 'Sending code…' : 'Send reset code', _sending, _request),
      ]);

  Widget _verifyStep() => _card([
        const Text('📧 Enter code',
            style: TextStyle(fontSize: 22, fontWeight: FontWeight.bold), textAlign: TextAlign.center),
        const SizedBox(height: 12),
        Text.rich(TextSpan(
          style: TextStyle(color: Theme.of(context).colorScheme.onSurfaceVariant),
          children: [
            const TextSpan(text: "We've sent a 6-digit code to "),
            TextSpan(text: _email.text.trim(), style: const TextStyle(fontWeight: FontWeight.bold)),
            const TextSpan(text: ' (if an account exists). Enter it below to continue.'),
          ],
        )),
        if (_info != null) ...[
          const SizedBox(height: 12),
          Container(
            padding: const EdgeInsets.all(10),
            decoration: BoxDecoration(color: Colors.green.shade50, borderRadius: BorderRadius.circular(8)),
            child: Text(_info!, style: TextStyle(color: Colors.green.shade800)),
          ),
        ],
        const SizedBox(height: 16),
        TextField(
          controller: _code,
          keyboardType: TextInputType.number,
          textAlign: TextAlign.center,
          autofocus: true,
          maxLength: 6,
          style: const TextStyle(fontSize: 22, letterSpacing: 8),
          inputFormatters: [FilteringTextInputFormatter.digitsOnly, LengthLimitingTextInputFormatter(6)],
          onChanged: _codeError == null ? null : (_) => setState(() => _codeError = null),
          decoration: InputDecoration(
            labelText: 'Verification code',
            border: const OutlineInputBorder(),
            counterText: '',
            errorText: _codeError,
          ),
        ),
        const SizedBox(height: 12),
        _submit(_verifying ? 'Verifying…' : 'Verify code', _verifying, _verify),
        const SizedBox(height: 8),
        OutlinedButton(
          onPressed: (_resendIn > 0 || _resending) ? null : _resend,
          child: Padding(
            padding: const EdgeInsets.symmetric(vertical: 12),
            child: Text(_resending ? 'Sending…'
                : _resendIn > 0 ? 'Resend code (${_resendIn}s)' : 'Resend code'),
          ),
        ),
      ]);

  Widget _resetStep() => _card([
        const Text('🔑 New password',
            style: TextStyle(fontSize: 22, fontWeight: FontWeight.bold), textAlign: TextAlign.center),
        const SizedBox(height: 12),
        Text.rich(TextSpan(
          style: TextStyle(color: Theme.of(context).colorScheme.onSurfaceVariant),
          children: [
            const TextSpan(text: 'Code verified. Choose a new password for '),
            TextSpan(text: _email.text.trim(), style: const TextStyle(fontWeight: FontWeight.bold)),
            const TextSpan(text: '.'),
          ],
        )),
        const SizedBox(height: 16),
        TextField(
          controller: _password,
          obscureText: !_showPw,
          onChanged: (v) => setState(() {
            _passwordError = v.isEmpty ? null : _passwordPolicyError(v);
            if (_confirm.text.isNotEmpty)
              _confirmError = _confirm.text == v ? null : 'Passwords do not match.';
          }),
          decoration: InputDecoration(
            labelText: 'New password',
            border: const OutlineInputBorder(),
            errorText: _passwordError,
            suffixIcon: IconButton(
              icon: Icon(_showPw ? Icons.visibility : Icons.visibility_off),
              onPressed: () => setState(() => _showPw = !_showPw),
            ),
          ),
        ),
        const SizedBox(height: 16),
        TextField(
          controller: _confirm,
          obscureText: !_showConfirm,
          onChanged: (v) => setState(() =>
              _confirmError = v.isEmpty ? null : (v == _password.text ? null : 'Passwords do not match.')),
          decoration: InputDecoration(
            labelText: 'Confirm new password',
            border: const OutlineInputBorder(),
            errorText: _confirmError,
            suffixIcon: IconButton(
              icon: Icon(_showConfirm ? Icons.visibility : Icons.visibility_off),
              onPressed: () => setState(() => _showConfirm = !_showConfirm),
            ),
          ),
        ),
        const SizedBox(height: 20),
        _submit(_resetting ? 'Resetting…' : 'Reset password', _resetting, _reset),
      ]);
}
