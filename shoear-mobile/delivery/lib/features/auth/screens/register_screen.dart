import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';

import 'package:delivery/features/auth/state/auth_provider.dart';
import 'package:delivery/features/auth/widgets/vehicle_picker.dart';

String? _passwordPolicyError(String pw) {
  if (pw.length < 8) return 'Password must be at least 8 characters.';
  if (!RegExp(r'[a-z]').hasMatch(pw)) return 'Password must include a lowercase letter.';
  if (!RegExp(r'[A-Z]').hasMatch(pw)) return 'Password must include an uppercase letter.';
  if (!RegExp(r'[0-9]').hasMatch(pw)) return 'Password must include a number.';
  if (!RegExp(r'[^a-zA-Z0-9]').hasMatch(pw)) return 'Password must include a special character.';
  return null;
}

enum _Step { form, verify }

/// Courier self-application. Step 1 collects the form; step 2 verifies the
/// email with a 6-digit code. On success the account is created as Pending
/// (awaiting admin approval), so we don't log in — we pop back and tell the
/// applicant to wait for approval.
class RegisterScreen extends StatefulWidget {
  const RegisterScreen({super.key});

  @override
  State<RegisterScreen> createState() => _RegisterScreenState();
}

class _RegisterScreenState extends State<RegisterScreen> {
  _Step _step = _Step.form;

  final _fullName     = TextEditingController();
  final _email        = TextEditingController();
  final _phone        = TextEditingController();
  String _vehicleType = 'Motorcycle';
  final _vehicleBrand = TextEditingController();
  final _vehicleModel = TextEditingController();
  final _vehiclePlate = TextEditingController();
  final _password     = TextEditingController();
  final _confirm      = TextEditingController();
  final _code         = TextEditingController();

  final _fullNameFocus     = FocusNode();
  final _emailFocus        = FocusNode();
  final _phoneFocus        = FocusNode();
  final _vehiclePlateFocus = FocusNode();
  final _passwordFocus     = FocusNode();
  final _confirmFocus      = FocusNode();

  bool _obscure   = true;
  bool _loading   = false;
  bool _resending = false;

  String? _fullNameError;
  String? _emailError;
  String? _phoneError;
  String? _vehicleBrandError;
  String? _vehicleModelError;
  String? _vehiclePlateError;
  String? _passwordError;
  String? _confirmError;
  String? _codeError;

  int    _resendIn = 0;
  Timer? _resendTimer;

  @override
  void initState() {
    super.initState();
    _fullNameFocus.addListener(()     => _onBlur(_fullNameFocus,     () => _fullNameError     = _validateFullName(_fullName.text)));
    _emailFocus.addListener(()        => _onBlur(_emailFocus,        () => _emailError        = _validateEmail(_email.text)));
    _phoneFocus.addListener(()        => _onBlur(_phoneFocus,        () => _phoneError        = _validatePhone(_phone.text)));
    _vehiclePlateFocus.addListener(() => _onBlur(_vehiclePlateFocus, () => _vehiclePlateError = _validatePlate(_vehiclePlate.text)));
    _passwordFocus.addListener(()     => _onBlur(_passwordFocus,     () => _passwordError     = _validatePassword(_password.text)));
    _confirmFocus.addListener(()      => _onBlur(_confirmFocus,      () => _confirmError      = _validateConfirm()));
  }

  void _onBlur(FocusNode node, VoidCallback validate) {
    if (!node.hasFocus) setState(validate);
  }

  @override
  void dispose() {
    _resendTimer?.cancel();
    for (final c in [_fullName, _email, _phone, _vehicleBrand, _vehicleModel, _vehiclePlate, _password, _confirm, _code]) c.dispose();
    for (final f in [_fullNameFocus, _emailFocus, _phoneFocus, _vehiclePlateFocus, _passwordFocus, _confirmFocus]) f.dispose();
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
  String? _validateFullName(String v) => v.trim().isEmpty ? 'Full name is required.' : null;

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
    final t = v.trim().toUpperCase();
    if (t.isEmpty) return 'Plate number is required.';
    if (t.length < 3) return 'Plate number must be at least 3 characters.';
    if (!RegExp(r'^[A-Z0-9 \-]+$').hasMatch(t)) return 'Only letters, numbers, spaces or hyphens.';
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
      _fullNameError     = _validateFullName(_fullName.text);
      _emailError        = _validateEmail(_email.text);
      _phoneError        = _validatePhone(_phone.text);
      _vehicleBrandError = _validateBrand(_vehicleBrand.text);
      _vehicleModelError = _validateModel(_vehicleModel.text);
      _vehiclePlateError = _validatePlate(_vehiclePlate.text);
      _passwordError     = _validatePassword(_password.text);
      _confirmError      = _validateConfirm();
    });
    if (_fullNameError != null || _emailError != null || _phoneError != null ||
        _vehicleBrandError != null || _vehicleModelError != null ||
        _vehiclePlateError != null || _passwordError != null || _confirmError != null) return;

    setState(() => _loading = true);
    try {
      await context.read<AuthProvider>().authService.sendRegisterCode(_email.text.trim());
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

  // Step 2 → verify code and submit application
  Future<void> _submit() async {
    final code = _code.text.trim();
    if (!RegExp(r'^\d{6}$').hasMatch(code)) {
      setState(() => _codeError = 'Enter the 6-digit code from your email.');
      return;
    }
    setState(() { _codeError = null; _loading = true; });
    try {
      final message = await context.read<AuthProvider>().authService.registerCourier(
            fullName:         _fullName.text.trim(),
            email:            _email.text.trim(),
            phoneNumber:      _phone.text.trim(),
            vehicleType:      _vehicleType,
            vehicleBrand:     _vehicleBrand.text.trim(),
            vehicleModel:     _vehicleModel.text.trim(),
            vehiclePlate:     _vehiclePlate.text.trim(),
            password:         _password.text,
            verificationCode: code,
          );
      if (!mounted) return;
      // Pending account — no auto-login. Pop back and tell them to wait.
      Navigator.of(context).pop();
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(message), duration: const Duration(seconds: 5)),
      );
    } catch (e) {
      final msg   = e.toString();
      final lower = msg.toLowerCase();
      if (!mounted) return;
      setState(() {
        if (lower.contains('code') || lower.contains('expired') ||
            lower.contains('no_code') || lower.contains('attempts')) {
          _codeError = msg;
        } else if (lower.contains('email')) {
          _step = _Step.form;
          _emailError = msg;
        } else if (lower.contains('brand')) {
          _step = _Step.form;
          _vehicleBrandError = msg;
        } else if (lower.contains('model')) {
          _step = _Step.form;
          _vehicleModelError = msg;
        } else if (lower.contains('plate')) {
          _step = _Step.form;
          _vehiclePlateError = msg;
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
      await context.read<AuthProvider>().authService.sendRegisterCode(_email.text.trim());
      if (!mounted) return;
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
        title: Text(_step == _Step.form ? 'Apply to be a courier' : 'Verify email'),
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

  Widget _formStep() => ListView(
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
            focusNode:  _fullNameFocus,
            label:     'Full name',
            error:     _fullNameError,
            maxLength: 120,
            onChanged: (v) => setState(() => _fullNameError = _validateFullName(v)),
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
            inputFormatters: [FilteringTextInputFormatter.allow(RegExp(r'[0-9+]'))],
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
          VehiclePicker(
            vehicleType:    _vehicleType,
            brand:          _vehicleBrand,
            model:          _vehicleModel,
            brandError:     _vehicleBrandError,
            modelError:     _vehicleModelError,
            onBrandChanged: () => setState(() => _vehicleBrandError = _validateBrand(_vehicleBrand.text)),
            onModelChanged: () => setState(() => _vehicleModelError = _validateModel(_vehicleModel.text)),
          ),
          Padding(
            padding: const EdgeInsets.only(bottom: 16),
            child: TextField(
              controller:         _vehiclePlate,
              focusNode:          _vehiclePlateFocus,
              maxLength:          20,
              textCapitalization: TextCapitalization.characters,
              inputFormatters:    [UpperCaseTextFormatter()],
              onChanged: (v) => setState(() => _vehiclePlateError = _validatePlate(v)),
              decoration: InputDecoration(
                labelText:   'Plate number (e.g. ABC 1234)',
                border:      const OutlineInputBorder(),
                errorText:   _vehiclePlateError,
                counterText: '',
              ),
            ),
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
        ],
      );

  Widget _verifyStep() => ListView(
        padding: const EdgeInsets.all(20),
        children: [
          Text.rich(TextSpan(
            style: TextStyle(color: Theme.of(context).colorScheme.onSurfaceVariant),
            children: [
              const TextSpan(text: "We've sent a 6-digit code to "),
              TextSpan(text: _email.text.trim(), style: const TextStyle(fontWeight: FontWeight.bold)),
              const TextSpan(text: '. Enter it below to complete your application.'),
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
                  : const Text('Submit application'),
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
    int? maxLength,
    List<TextInputFormatter>? inputFormatters,
  }) =>
      Padding(
        padding: const EdgeInsets.only(bottom: 16),
        child: TextField(
          controller:      controller,
          focusNode:       focusNode,
          keyboardType:    keyboard,
          maxLines:        maxLines,
          maxLength:       maxLength,
          inputFormatters: inputFormatters,
          onChanged:       onChanged,
          decoration: InputDecoration(
            labelText: label,
            border:    const OutlineInputBorder(),
            errorText: error,
          ),
        ),
      );
}

class UpperCaseTextFormatter extends TextInputFormatter {
  @override
  TextEditingValue formatEditUpdate(TextEditingValue old, TextEditingValue next) =>
      next.copyWith(text: next.text.toUpperCase());
}
