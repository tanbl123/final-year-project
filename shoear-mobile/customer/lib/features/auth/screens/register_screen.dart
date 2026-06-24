import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:google_sign_in/google_sign_in.dart';
import 'package:provider/provider.dart';

import 'package:customer/features/auth/services/account_service.dart';
import 'package:customer/features/auth/state/auth_provider.dart';
import 'package:customer/features/auth/screens/login_screen.dart';

String? _passwordPolicyError(String pw) {
  if (pw.length < 8) return 'Password must be at least 8 characters.';
  if (!RegExp(r'[a-z]').hasMatch(pw)) return 'Password must include a lowercase letter.';
  if (!RegExp(r'[A-Z]').hasMatch(pw)) return 'Password must include an uppercase letter.';
  if (!RegExp(r'[0-9]').hasMatch(pw)) return 'Password must include a number.';
  if (!RegExp(r'[^a-zA-Z0-9]').hasMatch(pw)) return 'Password must include a special character.';
  return null;
}

enum _Step { form, verify }

/// Customer self-service sign-up.
/// Step 1 collects the form; step 2 verifies the email with a 6-digit code.
/// On success the account is created and we log the customer straight in.
/// Alternatively, tap "Continue with Google" to skip the form entirely.
class RegisterScreen extends StatefulWidget {
  const RegisterScreen({super.key});

  @override
  State<RegisterScreen> createState() => _RegisterScreenState();
}

class _RegisterScreenState extends State<RegisterScreen> {
  _Step _step = _Step.form;

  final _username = TextEditingController();
  final _email    = TextEditingController();
  final _phone    = TextEditingController();
  final _address  = TextEditingController();
  final _password = TextEditingController();
  final _confirm  = TextEditingController();
  final _code     = TextEditingController();

  final _usernameFocus = FocusNode();
  final _emailFocus    = FocusNode();
  final _phoneFocus    = FocusNode();
  final _passwordFocus = FocusNode();
  final _confirmFocus  = FocusNode();

  bool _obscure   = true;
  bool _loading   = false;
  bool _resending = false;

  String? _usernameError;
  String? _emailError;
  String? _phoneError;
  String? _passwordError;
  String? _confirmError;
  String? _codeError;
  String? _googleError;

  int    _resendIn = 0;
  Timer? _resendTimer;

  @override
  void initState() {
    super.initState();
    _usernameFocus.addListener(() => _onBlur(_usernameFocus, () => _usernameError = _validateUsername(_username.text)));
    _emailFocus.addListener(()    => _onBlur(_emailFocus,    () => _emailError    = _validateEmail(_email.text)));
    _phoneFocus.addListener(()    => _onBlur(_phoneFocus,    () => _phoneError    = _validatePhone(_phone.text)));
    _passwordFocus.addListener(() => _onBlur(_passwordFocus, () => _passwordError = _validatePassword(_password.text)));
    _confirmFocus.addListener(()  => _onBlur(_confirmFocus,  () => _confirmError  = _validateConfirm()));
  }

  void _onBlur(FocusNode node, VoidCallback validate) {
    if (!node.hasFocus) setState(validate);
  }

  @override
  void dispose() {
    _resendTimer?.cancel();
    for (final c in [_username, _email, _phone, _address, _password, _confirm, _code]) c.dispose();
    for (final f in [_usernameFocus, _emailFocus, _phoneFocus, _passwordFocus, _confirmFocus]) f.dispose();
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

  // ── field validators ──
  String? _validateUsername(String v) {
    final t = v.trim();
    if (t.isEmpty) return 'Username is required.';
    if (!RegExp(r'^[A-Za-z0-9_]{3,20}$').hasMatch(t)) return 'Username must be 3–20 letters, numbers or underscores.';
    return null;
  }

  String? _validateEmail(String v) {
    final t = v.trim();
    if (t.isEmpty) return 'Email is required.';
    if (!RegExp(r'^[^\s@]+@[^\s@]+\.[^\s@]+$').hasMatch(t)) return 'Please enter a valid email.';
    return null;
  }

  String? _validatePhone(String v) {
    final t = v.trim();
    if (t.isEmpty) return 'Phone number is required.';
    if (!RegExp(r'^\+?[1-9]\d{7,14}$').hasMatch(t)) return 'Enter a valid phone number, e.g. +60123456789.';
    return null;
  }

  String? _validatePassword(String v) {
    if (v.isEmpty) return 'Password is required.';
    return _passwordPolicyError(v);
  }

  String? _validateConfirm() {
    if (_confirm.text.isEmpty) return 'Please confirm your password.';
    if (_password.text != _confirm.text) return 'Passwords do not match.';
    return null;
  }

  // Step 1 → validate form and email the 6-digit code
  Future<void> _sendCode() async {
    setState(() {
      _usernameError = _validateUsername(_username.text);
      _emailError    = _validateEmail(_email.text);
      _phoneError    = _validatePhone(_phone.text);
      _passwordError = _validatePassword(_password.text);
      _confirmError  = _validateConfirm();
      _googleError   = null;
    });
    if (_usernameError != null || _emailError != null || _phoneError != null ||
        _passwordError != null || _confirmError != null) return;

    setState(() => _loading = true);
    try {
      await context.read<AccountService>().sendRegisterCode(_email.text.trim());
      if (!mounted) return;
      setState(() { _code.clear(); _codeError = null; _step = _Step.verify; });
      _startResendCooldown();
    } catch (e) {
      if (!mounted) return;
      final msg = e.toString();
      setState(() => _emailError = msg.toLowerCase().contains('already registered')
          ? msg : 'Could not send the code. Please try again.');
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  // Step 2 → verify code and create account
  Future<void> _submit() async {
    final code = _code.text.trim();
    if (!RegExp(r'^\d{6}$').hasMatch(code)) {
      setState(() => _codeError = 'Enter the 6-digit code from your email.');
      return;
    }
    setState(() { _codeError = null; _loading = true; });
    try {
      await context.read<AccountService>().registerCustomer(
            username:         _username.text.trim(),
            email:            _email.text.trim(),
            password:         _password.text,
            fullName:         _username.text.trim(),
            phoneNumber:      _phone.text.trim(),
            verificationCode: code,
            shippingAddress:  _address.text.trim(),
          );
      // account created — log straight in
      await context.read<AuthProvider>().login(_email.text.trim(), _password.text);
      if (mounted) Navigator.of(context).pop();
    } catch (e) {
      final msg   = e.toString();
      final lower = msg.toLowerCase();
      if (!mounted) return;
      setState(() {
        if (lower.contains('code') || lower.contains('expired') ||
            lower.contains('no_code') || lower.contains('attempts')) {
          _codeError = msg;
        } else if (lower.contains('username')) {
          _step = _Step.form;
          _usernameError = msg;
        } else if (lower.contains('email')) {
          _step = _Step.form;
          _emailError = msg;
        } else {
          _codeError = msg;
        }
      });
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _resend() async {
    if (_resendIn > 0 || _resending) return;
    setState(() { _codeError = null; _resending = true; });
    try {
      await context.read<AccountService>().sendRegisterCode(_email.text.trim());
      if (!mounted) return;
      _startResendCooldown();
    } catch (e) {
      if (mounted) setState(() => _codeError = e.toString());
    } finally {
      if (mounted) setState(() => _resending = false);
    }
  }

  Future<void> _signInWithGoogle() async {
    setState(() { _googleError = null; _loading = true; });
    try {
      final googleUser = await GoogleSignIn().signIn();
      if (googleUser == null) {
        if (mounted) setState(() => _loading = false);
        return;
      }
      final auth = await googleUser.authentication;
      final idToken = auth.idToken;
      if (idToken == null) {
        if (mounted) setState(() {
          _googleError = 'Google did not return an ID token. Please try again.';
          _loading = false;
        });
        return;
      }
      await context.read<AuthProvider>().loginWithGoogle(idToken);
      if (mounted) Navigator.of(context).pop();
    } catch (e) {
      if (mounted) setState(() { _googleError = e.toString(); _loading = false; });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Text(_step == _Step.form ? 'Create account' : 'Verify email'),
        leading: _step == _Step.verify
            ? IconButton(
                icon: const Icon(Icons.arrow_back),
                onPressed: () => setState(() { _step = _Step.form; _codeError = null; }),
              )
            : null,
      ),
      body: _step == _Step.form ? _formStep() : _verifyStep(),
    );
  }

  Widget _formStep() {
    final theme = Theme.of(context);
    return ListView(
      padding: const EdgeInsets.all(20),
      children: [
        // ── Google Sign-In as an alternative to the form ──
        _GoogleButton(
          onPressed: _loading ? null : _signInWithGoogle,
          label: 'Continue with Google',
        ),
        if (_googleError != null) ...[
          const SizedBox(height: 8),
          Text(_googleError!,
              style: TextStyle(color: theme.colorScheme.error, fontSize: 13)),
        ],
        const Padding(
          padding: EdgeInsets.symmetric(vertical: 16),
          child: Row(children: [
            Expanded(child: Divider()),
            Padding(
              padding: EdgeInsets.symmetric(horizontal: 12),
              child: Text('or sign up with email'),
            ),
            Expanded(child: Divider()),
          ]),
        ),
        // ── form fields ──
        _field(
          controller: _username,
          focusNode:  _usernameFocus,
          label:  'Username',
          error:  _usernameError,
          onChanged: (v) => setState(() => _usernameError = _validateUsername(v)),
        ),
        _field(
          controller: _email,
          focusNode:  _emailFocus,
          label:    'Email',
          keyboard: TextInputType.emailAddress,
          error:    _emailError,
          onChanged: (v) => setState(() => _emailError = _validateEmail(v)),
        ),
        _field(
          controller: _phone,
          focusNode:  _phoneFocus,
          label:    'Phone number',
          keyboard: TextInputType.phone,
          error:    _phoneError,
          onChanged: (v) => setState(() => _phoneError = _validatePhone(v)),
        ),
        _field(
          controller: _address,
          focusNode:  null,
          label:    'Shipping address (optional)',
          error:    null,
          maxLines: 2,
          onChanged: (_) {},
        ),
        TextField(
          controller:  _password,
          focusNode:   _passwordFocus,
          obscureText: _obscure,
          onChanged: (v) => setState(() {
            _passwordError = _validatePassword(v);
            if (_confirm.text.isNotEmpty) _confirmError = _validateConfirm();
          }),
          decoration: InputDecoration(
            labelText:  'Password',
            border:     const OutlineInputBorder(),
            helperText: '8+ chars with upper, lower, number & symbol',
            errorText:  _passwordError,
            suffixIcon: IconButton(
              icon: Icon(_obscure ? Icons.visibility_off : Icons.visibility),
              onPressed: () => setState(() => _obscure = !_obscure),
            ),
          ),
        ),
        const SizedBox(height: 16),
        TextField(
          controller:  _confirm,
          focusNode:   _confirmFocus,
          obscureText: _obscure,
          onChanged:   (_) => setState(() => _confirmError = _validateConfirm()),
          decoration:  InputDecoration(
            labelText: 'Confirm password',
            border:    const OutlineInputBorder(),
            errorText: _confirmError,
          ),
        ),
        const SizedBox(height: 24),
        FilledButton(
          onPressed: _loading ? null : _sendCode,
          child: Padding(
            padding: const EdgeInsets.symmetric(vertical: 12),
            child: _loading
                ? const SizedBox(height: 20, width: 20, child: CircularProgressIndicator(strokeWidth: 2))
                : const Text('Send verification code'),
          ),
        ),
        const SizedBox(height: 12),
        Row(mainAxisAlignment: MainAxisAlignment.center, children: [
          Text('Already have an account?',
              style: TextStyle(color: theme.colorScheme.onSurfaceVariant, fontSize: 13)),
          TextButton(
            onPressed: _loading ? null : () => Navigator.of(context).pushReplacement(
                  MaterialPageRoute(builder: (_) => const LoginScreen()),
                ),
            child: const Text('Sign in'),
          ),
        ]),
      ],
    );
  }

  Widget _verifyStep() => ListView(
        padding: const EdgeInsets.all(20),
        children: [
          Text.rich(TextSpan(
            style: TextStyle(color: Theme.of(context).colorScheme.onSurfaceVariant),
            children: [
              const TextSpan(text: "We've sent a 6-digit code to "),
              TextSpan(text: _email.text.trim(), style: const TextStyle(fontWeight: FontWeight.bold)),
              const TextSpan(text: '. Enter it below to create your account.'),
            ],
          )),
          const SizedBox(height: 20),
          TextField(
            controller:     _code,
            keyboardType:   TextInputType.number,
            textAlign:      TextAlign.center,
            autofocus:      true,
            maxLength:      6,
            style:          const TextStyle(fontSize: 22, letterSpacing: 8),
            inputFormatters: [
              FilteringTextInputFormatter.digitsOnly,
              LengthLimitingTextInputFormatter(6),
            ],
            onChanged: _codeError == null ? null : (_) => setState(() => _codeError = null),
            decoration: InputDecoration(
              labelText:   'Verification code',
              border:      const OutlineInputBorder(),
              counterText: '',
              errorText:   _codeError,
            ),
          ),
          const SizedBox(height: 20),
          FilledButton(
            onPressed: _loading ? null : _submit,
            child: Padding(
              padding: const EdgeInsets.symmetric(vertical: 12),
              child: _loading
                  ? const SizedBox(height: 20, width: 20, child: CircularProgressIndicator(strokeWidth: 2))
                  : const Text('Create account'),
            ),
          ),
          const SizedBox(height: 8),
          OutlinedButton(
            onPressed: (_resendIn > 0 || _resending) ? null : _resend,
            child: Padding(
              padding: const EdgeInsets.symmetric(vertical: 12),
              child: Text(_resending ? 'Sending…'
                  : _resendIn > 0 ? 'Resend code (${_resendIn}s)' : 'Resend code'),
            ),
          ),
        ],
      );

  Widget _field({
    required TextEditingController controller,
    required FocusNode? focusNode,
    required String label,
    required String? error,
    required void Function(String) onChanged,
    TextInputType? keyboard,
    int maxLines = 1,
  }) =>
      Padding(
        padding: const EdgeInsets.only(bottom: 16),
        child: TextField(
          controller:  controller,
          focusNode:   focusNode,
          keyboardType: keyboard,
          maxLines:    maxLines,
          onChanged:   onChanged,
          decoration:  InputDecoration(
            labelText: label,
            border:    const OutlineInputBorder(),
            errorText: error,
          ),
        ),
      );
}

/// Reusable Google-branded sign-in button.
class _GoogleButton extends StatelessWidget {
  final VoidCallback? onPressed;
  final String label;
  const _GoogleButton({required this.onPressed, required this.label});

  @override
  Widget build(BuildContext context) {
    return OutlinedButton(
      onPressed: onPressed,
      style: OutlinedButton.styleFrom(
        backgroundColor: Colors.white,
        side: const BorderSide(color: Color(0xFFDDDDDD)),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
      ),
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 12),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Container(
              width: 22,
              height: 22,
              decoration: const BoxDecoration(
                shape: BoxShape.circle,
                color: Color(0xFF4285F4),
              ),
              child: const Center(
                child: Text('G',
                    style: TextStyle(
                        color: Colors.white, fontSize: 13, fontWeight: FontWeight.bold)),
              ),
            ),
            const SizedBox(width: 12),
            Text(label, style: const TextStyle(color: Colors.black87, fontSize: 15)),
          ],
        ),
      ),
    );
  }
}
