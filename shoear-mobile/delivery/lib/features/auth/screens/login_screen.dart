import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import 'package:delivery/features/auth/state/auth_provider.dart';
import 'package:delivery/features/auth/screens/register_screen.dart';

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

  @override
  void dispose() {
    _identifier.dispose();
    _password.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    setState(() {
      _identifierError = _identifier.text.trim().isEmpty ? 'Email or username is required.' : null;
      _passwordError = _password.text.isEmpty ? 'Password is required.' : null;
    });
    if (_identifierError != null || _passwordError != null) return;

    setState(() => _loading = true);
    try {
      await context.read<AuthProvider>().login(_identifier.text.trim(), _password.text);
      // the shell swaps to the assignments screen on success
    } catch (e) {
      if (mounted) setState(() => _passwordError = e.toString());
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
                Icon(Icons.local_shipping, size: 48, color: theme.colorScheme.primary),
                const SizedBox(height: 8),
                const Text('ShoeAR Express',
                    style: TextStyle(fontSize: 26, fontWeight: FontWeight.bold), textAlign: TextAlign.center),
                const SizedBox(height: 4),
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
                        TextField(
                          controller: _identifier,
                          textInputAction: TextInputAction.next,
                          onChanged: _identifierError == null ? null : (_) => setState(() => _identifierError = null),
                          decoration: InputDecoration(
                            labelText: 'Email or username',
                            border: const OutlineInputBorder(),
                            errorText: _identifierError,
                          ),
                        ),
                        const SizedBox(height: 16),
                        TextField(
                          controller: _password,
                          obscureText: _obscure,
                          onChanged: _passwordError == null ? null : (_) => setState(() => _passwordError = null),
                          onSubmitted: (_) => _submit(),
                          decoration: InputDecoration(
                            labelText: 'Password',
                            border: const OutlineInputBorder(),
                            errorText: _passwordError,
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
                                ? const SizedBox(height: 20, width: 20, child: CircularProgressIndicator(strokeWidth: 2))
                                : const Text('Login'),
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
                const SizedBox(height: 12),
                TextButton(
                  onPressed: _loading
                      ? null
                      : () => Navigator.of(context).push(
                            MaterialPageRoute(builder: (_) => const RegisterScreen()),
                          ),
                  child: const Text('New here? Apply to be a courier'),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
