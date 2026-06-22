import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import 'package:delivery/features/auth/state/auth_provider.dart';

// Password policy mirrors the backend: 8+ chars with at least one lowercase,
// uppercase, digit and special character. Returns an error string, or null.
String? _passwordPolicyError(String pw) {
  if (pw.length < 8) return 'Password must be at least 8 characters.';
  if (!RegExp(r'[a-z]').hasMatch(pw)) return 'Password must include a lowercase letter.';
  if (!RegExp(r'[A-Z]').hasMatch(pw)) return 'Password must include an uppercase letter.';
  if (!RegExp(r'[0-9]').hasMatch(pw)) return 'Password must include a number.';
  if (!RegExp(r'[^a-zA-Z0-9]').hasMatch(pw)) return 'Password must include a special character.';
  return null;
}

/// Courier self-application. On success the account is created as Pending
/// (awaiting admin approval), so we don't log in — we pop back to the login
/// screen and tell the applicant to wait for approval.
class RegisterScreen extends StatefulWidget {
  const RegisterScreen({super.key});

  @override
  State<RegisterScreen> createState() => _RegisterScreenState();
}

class _RegisterScreenState extends State<RegisterScreen> {
  final _fullName = TextEditingController();
  final _username = TextEditingController();
  final _email = TextEditingController();
  final _phone = TextEditingController();
  String _vehicleType = 'Motorcycle';
  final _vehicleBrand = TextEditingController();
  final _vehicleModel = TextEditingController();
  final _vehiclePlate = TextEditingController();
  final _password = TextEditingController();
  final _confirm = TextEditingController();

  // a focus node per validated field so we can validate on blur (like the web)
  final _fullNameFocus = FocusNode();
  final _usernameFocus = FocusNode();
  final _emailFocus = FocusNode();
  final _phoneFocus = FocusNode();
  final _vehicleBrandFocus = FocusNode();
  final _vehicleModelFocus = FocusNode();
  final _vehiclePlateFocus = FocusNode();
  final _passwordFocus = FocusNode();
  final _confirmFocus = FocusNode();

  bool _obscure = true;
  bool _loading = false;
  // per-field inline errors
  String? _fullNameError;
  String? _usernameError;
  String? _emailError;
  String? _phoneError;
  String? _vehicleBrandError;
  String? _vehicleModelError;
  String? _vehiclePlateError;
  String? _passwordError;
  String? _confirmError;

  @override
  void initState() {
    super.initState();
    _fullNameFocus.addListener(() => _onBlur(_fullNameFocus, () => _fullNameError = _validateFullName(_fullName.text)));
    _usernameFocus.addListener(() => _onBlur(_usernameFocus, () => _usernameError = _validateUsername(_username.text)));
    _emailFocus.addListener(() => _onBlur(_emailFocus, () => _emailError = _validateEmail(_email.text)));
    _phoneFocus.addListener(() => _onBlur(_phoneFocus, () => _phoneError = _validatePhone(_phone.text)));
    _vehicleBrandFocus.addListener(() => _onBlur(_vehicleBrandFocus, () => _vehicleBrandError = _validateBrand(_vehicleBrand.text)));
    _vehicleModelFocus.addListener(() => _onBlur(_vehicleModelFocus, () => _vehicleModelError = _validateModel(_vehicleModel.text)));
    _vehiclePlateFocus.addListener(() => _onBlur(_vehiclePlateFocus, () => _vehiclePlateError = _validatePlate(_vehiclePlate.text)));
    _passwordFocus.addListener(() => _onBlur(_passwordFocus, () => _passwordError = _validatePassword(_password.text)));
    _confirmFocus.addListener(() => _onBlur(_confirmFocus, () => _confirmError = _validateConfirm()));
  }

  void _onBlur(FocusNode node, VoidCallback validate) {
    if (!node.hasFocus) setState(validate);
  }

  @override
  void dispose() {
    for (final c in [_fullName, _username, _email, _phone, _vehicleBrand, _vehicleModel, _vehiclePlate, _password, _confirm]) {
      c.dispose();
    }
    for (final f in [_fullNameFocus, _usernameFocus, _emailFocus, _phoneFocus, _vehicleBrandFocus, _vehicleModelFocus, _vehiclePlateFocus, _passwordFocus, _confirmFocus]) {
      f.dispose();
    }
    super.dispose();
  }

  // ── field validators (same rules as the backend) ──
  String? _validateFullName(String v) => v.trim().isEmpty ? 'Full name is required.' : null;

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
    if (!RegExp(r'^\+?[1-9]\d{7,14}$').hasMatch(t)) {
      return 'Enter a valid phone number, e.g. +60123456789.';
    }
    return null;
  }

  String? _validateBrand(String v) {
    final t = v.trim();
    if (t.isEmpty) return 'Vehicle brand is required.';
    if (t.length > 50) return 'Brand is too long (max 50 characters).';
    return null;
  }

  String? _validateModel(String v) {
    final t = v.trim();
    if (t.isEmpty) return 'Vehicle model is required.';
    if (t.length > 50) return 'Model is too long (max 50 characters).';
    return null;
  }

  String? _validatePlate(String v) {
    final t = v.trim();
    if (t.isEmpty) return 'Plate number is required.';
    if (t.length > 20) return 'Plate number is too long (max 20 characters).';
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

  Future<void> _submit() async {
    setState(() {
      _fullNameError     = _validateFullName(_fullName.text);
      _usernameError     = _validateUsername(_username.text);
      _emailError        = _validateEmail(_email.text);
      _phoneError        = _validatePhone(_phone.text);
      _vehicleBrandError = _validateBrand(_vehicleBrand.text);
      _vehicleModelError = _validateModel(_vehicleModel.text);
      _vehiclePlateError = _validatePlate(_vehiclePlate.text);
      _passwordError     = _validatePassword(_password.text);
      _confirmError      = _validateConfirm();
    });
    if (_fullNameError != null ||
        _usernameError != null ||
        _emailError != null ||
        _phoneError != null ||
        _vehicleBrandError != null ||
        _vehicleModelError != null ||
        _vehiclePlateError != null ||
        _passwordError != null ||
        _confirmError != null) {
      return;
    }
    setState(() => _loading = true);
    try {
      final message = await context.read<AuthProvider>().authService.registerCourier(
            fullName:     _fullName.text.trim(),
            username:     _username.text.trim(),
            email:        _email.text.trim(),
            phoneNumber:  _phone.text.trim(),
            vehicleType:  _vehicleType,
            vehicleBrand: _vehicleBrand.text.trim(),
            vehicleModel: _vehicleModel.text.trim(),
            vehiclePlate: _vehiclePlate.text.trim(),
            password:     _password.text,
          );
      if (!mounted) return;
      // Pending account — no auto-login. Pop back and tell them to wait.
      Navigator.of(context).pop();
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(message), duration: const Duration(seconds: 5)),
      );
    } catch (e) {
      final msg = e.toString();
      final lower = msg.toLowerCase();
      setState(() {
        if (lower.contains('username')) {
          _usernameError = msg;
        } else if (lower.contains('email')) {
          _emailError = msg;
        } else if (lower.contains('brand')) {
          _vehicleBrandError = msg;
        } else if (lower.contains('model')) {
          _vehicleModelError = msg;
        } else if (lower.contains('plate')) {
          _vehiclePlateError = msg;
        } else {
          _passwordError = msg;
        }
      });
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Apply to be a courier')),
      body: ListView(
        padding: const EdgeInsets.all(20),
        children: [
          const Text(
            'Create a courier account. Your application is reviewed by an admin '
            'before you can sign in.',
            style: TextStyle(fontSize: 13),
          ),
          const SizedBox(height: 16),
          _field(
            controller: _fullName,
            focusNode: _fullNameFocus,
            label: 'Full name',
            error: _fullNameError,
            maxLength: 120,
            onChanged: (v) => setState(() => _fullNameError = _validateFullName(v)),
          ),
          _field(
            controller: _username,
            focusNode: _usernameFocus,
            label: 'Username',
            error: _usernameError,
            onChanged: (v) => setState(() => _usernameError = _validateUsername(v)),
          ),
          _field(
            controller: _email,
            focusNode: _emailFocus,
            label: 'Email',
            keyboard: TextInputType.emailAddress,
            error: _emailError,
            onChanged: (v) => setState(() => _emailError = _validateEmail(v)),
          ),
          _field(
            controller: _phone,
            focusNode: _phoneFocus,
            label: 'Phone number',
            keyboard: TextInputType.phone,
            error: _phoneError,
            onChanged: (v) => setState(() => _phoneError = _validatePhone(v)),
          ),
          // ── Vehicle details ──
          Padding(
            padding: const EdgeInsets.only(bottom: 16),
            child: DropdownButtonFormField<String>(
              value: _vehicleType,
              decoration: const InputDecoration(
                labelText: 'Vehicle type',
                border: OutlineInputBorder(),
              ),
              items: const [
                DropdownMenuItem(value: 'Motorcycle', child: Text('Motorcycle')),
                DropdownMenuItem(value: 'Car',        child: Text('Car')),
                DropdownMenuItem(value: 'Van',        child: Text('Van')),
                DropdownMenuItem(value: 'Truck',      child: Text('Truck')),
              ],
              onChanged: (v) => setState(() => _vehicleType = v ?? 'Motorcycle'),
            ),
          ),
          _field(
            controller: _vehicleBrand,
            focusNode: _vehicleBrandFocus,
            label: 'Vehicle brand (e.g. Honda, Yamaha)',
            error: _vehicleBrandError,
            onChanged: (v) => setState(() => _vehicleBrandError = _validateBrand(v)),
          ),
          _field(
            controller: _vehicleModel,
            focusNode: _vehicleModelFocus,
            label: 'Vehicle model (e.g. EX5, LC135)',
            error: _vehicleModelError,
            onChanged: (v) => setState(() => _vehicleModelError = _validateModel(v)),
          ),
          _field(
            controller: _vehiclePlate,
            focusNode: _vehiclePlateFocus,
            label: 'Plate number (e.g. ABC 1234)',
            error: _vehiclePlateError,
            maxLength: 20,
            onChanged: (v) => setState(() => _vehiclePlateError = _validatePlate(v)),
          ),
          TextField(
            controller: _password,
            focusNode: _passwordFocus,
            obscureText: _obscure,
            onChanged: (v) => setState(() {
              _passwordError = _validatePassword(v);
              if (_confirm.text.isNotEmpty) _confirmError = _validateConfirm();
            }),
            decoration: InputDecoration(
              labelText: 'Password',
              border: const OutlineInputBorder(),
              helperText: '8+ chars with upper, lower, number & symbol',
              errorText: _passwordError,
              suffixIcon: IconButton(
                icon: Icon(_obscure ? Icons.visibility_off : Icons.visibility),
                onPressed: () => setState(() => _obscure = !_obscure),
              ),
            ),
          ),
          const SizedBox(height: 16),
          TextField(
            controller: _confirm,
            focusNode: _confirmFocus,
            obscureText: _obscure,
            onChanged: (_) => setState(() => _confirmError = _validateConfirm()),
            decoration: InputDecoration(
              labelText: 'Confirm password',
              border: const OutlineInputBorder(),
              errorText: _confirmError,
            ),
          ),
          const SizedBox(height: 24),
          FilledButton(
            onPressed: _loading ? null : _submit,
            child: Padding(
              padding: const EdgeInsets.symmetric(vertical: 12),
              child: _loading
                  ? const SizedBox(height: 20, width: 20, child: CircularProgressIndicator(strokeWidth: 2))
                  : const Text('Submit application'),
            ),
          ),
        ],
      ),
    );
  }

  Widget _field({
    required TextEditingController controller,
    required FocusNode? focusNode,
    required String label,
    required String? error,
    required void Function(String) onChanged,
    TextInputType? keyboard,
    int maxLines = 1,
    int? maxLength,
  }) =>
      Padding(
        padding: const EdgeInsets.only(bottom: 16),
        child: TextField(
          controller: controller,
          focusNode: focusNode,
          keyboardType: keyboard,
          maxLines: maxLines,
          maxLength: maxLength,
          onChanged: onChanged,
          decoration: InputDecoration(
            labelText: label,
            border: const OutlineInputBorder(),
            errorText: error,
          ),
        ),
      );
}
