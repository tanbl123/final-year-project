import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import 'package:delivery/core/utils/snackbar.dart';
import 'package:delivery/features/auth/state/auth_provider.dart';
import 'package:delivery/features/auth/screens/register_screen.dart';
import 'package:delivery/features/auth/screens/forgot_password_screen.dart';

/// Courier sign-in. The shell shows this whenever there's no session.
class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key});

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final _identifier = TextEditingController();
  final _password = TextEditingController();
  bool _obscure = true;
  bool _loading = false;
  String? _identifierError;
  String? _passwordError;
  String? _loginError;           // message shown under password field
  bool   _identifierLoginRed = false; // red outline on identifier after failed login

  @override
  void dispose() {
    _identifier.dispose();
    _password.dispose();
    super.dispose();
  }

  String? _validateIdentifier(String val) {
    final trimmed = val.trim();
    if (trimmed.isEmpty) return 'Email is required.';
    if (!trimmed.contains('@')) return 'Please enter a valid email.';
    return null;
  }

  String? _validatePassword(String val) {
    if (val.isEmpty) return 'Password is required.';
    return null;
  }

  Future<void> _openForgotPassword() async {
    final reset = await Navigator.of(context).push<bool>(
      MaterialPageRoute(builder: (_) => const ForgotPasswordScreen()),
    );
    if (reset == true && mounted) {
      context.showSnack('Your password has been reset — please log in.');
    }
  }

  Future<void> _submit() async {
    setState(() {
      _identifierError      = _validateIdentifier(_identifier.text);
      _passwordError        = _validatePassword(_password.text);
      _loginError           = null;
      _identifierLoginRed   = false;
    });
    if (_identifierError != null || _passwordError != null) return;

    setState(() => _loading = true);
    try {
      await context.read<AuthProvider>().login(_identifier.text.trim(), _password.text);
      // the shell swaps to the assignments screen on success
    } catch (e) {
      if (mounted) setState(() { _loginError = e.toString(); _identifierLoginRed = true; });
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Scaffold(
      body: Center(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(24),
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 420),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Image.asset('assets/branding/logo.png', height: 150, fit: BoxFit.contain),
                const SizedBox(height: 8),
                Text('Delivery personnel sign in',
                    textAlign: TextAlign.center,
                    style: TextStyle(color: theme.colorScheme.onSurfaceVariant)),
                const SizedBox(height: 20),
                Card(
                  elevation: 1.5,
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                  child: Padding(
                    padding: const EdgeInsets.all(20),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        // ── Email or username ──
                        ValueListenableBuilder<TextEditingValue>(
                          valueListenable: _identifier,
                          builder: (_, val, __) => TextField(
                            controller:      _identifier,
                            textInputAction: TextInputAction.next,
                            onChanged: (v) => setState(() {
                              _identifierError    = _validateIdentifier(v);
                              _identifierLoginRed = false;
                            }),
                            decoration: InputDecoration(
                              labelText:  'Email',
                              border:     const OutlineInputBorder(),
                              helperText: ' ',
                              errorText:  _identifierError ?? (_identifierLoginRed ? '' : null),
                              suffixIcon: val.text.isNotEmpty
                                  ? IconButton(
                                      icon: const Icon(Icons.clear, size: 18),
                                      onPressed: () => setState(() {
                                        _identifier.clear();
                                        _identifierError    = null;
                                        _identifierLoginRed = false;
                                      }),
                                    )
                                  : null,
                            ),
                          ),
                        ),
                        const SizedBox(height: 16),
                        // ── Password ──
                        TextField(
                          controller:  _password,
                          obscureText: _obscure,
                          onChanged: (v) => setState(() {
                            _passwordError      = _validatePassword(v);
                            _loginError         = null;
                            _identifierLoginRed = false;
                          }),
                          onSubmitted: (_) => _submit(),
                          decoration: InputDecoration(
                            labelText:  'Password',
                            border:     const OutlineInputBorder(),
                            helperText: ' ',
                            errorText:  _passwordError ?? _loginError,
                            errorMaxLines: 4,   // let long messages (e.g. "pending approval") wrap
                            suffixIcon: IconButton(
                              icon: Icon(_obscure ? Icons.visibility_off : Icons.visibility),
                              onPressed: () => setState(() => _obscure = !_obscure),
                            ),
                          ),
                        ),
                        const SizedBox(height: 20),
                        FilledButton(
                          onPressed: _loading ? null : _submit,
                          child: Padding(
                            padding: const EdgeInsets.symmetric(vertical: 12),
                            child: _loading
                                ? const SizedBox(
                                    height: 20, width: 20,
                                    child: CircularProgressIndicator(strokeWidth: 2))
                                : const Text('Login'),
                          ),
                        ),
                        const SizedBox(height: 8),
                        OutlinedButton(
                          onPressed: _loading ? null : _openForgotPassword,
                          child: const Padding(
                            padding: EdgeInsets.symmetric(vertical: 12),
                            child: Text('Forgot password?'),
                          ),
                        ),
                        const Padding(
                          padding: EdgeInsets.symmetric(vertical: 12),
                          child: Divider(),
                        ),
                        OutlinedButton(
                          onPressed: _loading
                              ? null
                              : () => Navigator.of(context).push(
                                    MaterialPageRoute(builder: (_) => const RegisterScreen()),
                                  ),
                          child: const Padding(
                            padding: EdgeInsets.symmetric(vertical: 12),
                            child: Text('Apply to be a courier'),
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
