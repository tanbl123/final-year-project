import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_stripe/flutter_stripe.dart';
import 'package:provider/provider.dart';

import 'package:customer/features/auth/services/account_service.dart';
import 'package:customer/features/auth/state/auth_provider.dart';
import 'package:customer/features/order/services/order_service.dart';
import 'package:customer/features/cart/state/cart_provider.dart';
import 'package:customer/features/cart/models/cart.dart';
import 'package:customer/core/widgets/product_image.dart';
import 'package:customer/core/services/postcode_service.dart';
import 'package:customer/core/services/places_service.dart';
import 'package:customer/features/checkout/screens/receipt_screen.dart';

class CheckoutScreen extends StatefulWidget {
  const CheckoutScreen({super.key});

  @override
  State<CheckoutScreen> createState() => _CheckoutScreenState();
}

class _CheckoutScreenState extends State<CheckoutScreen> {
  // The 16 Malaysian states + federal territories (must match the backend list).
  static const _states = [
    'Johor', 'Kedah', 'Kelantan', 'Melaka', 'Negeri Sembilan', 'Pahang',
    'Perak', 'Perlis', 'Pulau Pinang', 'Sabah', 'Sarawak', 'Selangor',
    'Terengganu', 'Kuala Lumpur', 'Labuan', 'Putrajaya',
  ];

  final _nameCtrl     = TextEditingController();
  final _line1Ctrl    = TextEditingController();
  final _postcodeCtrl = TextEditingController();
  final _cityCtrl     = TextEditingController();
  final _phoneCtrl    = TextEditingController();
  String? _state;

  bool _loadingAddr   = true;
  bool _placing       = false;
  bool _nameTouched   = false;
  bool _phoneTouched  = false;
  bool _addrTouched   = false;
  String? _nameError;
  String? _line1Error;
  String? _postcodeError;
  String? _cityError;
  String? _stateError;
  String? _phoneError;

  /// true once a typed postcode auto-filled the city + state (shows a hint).
  bool _postcodeMatched = false;

  /// true while the current city/state came from a postcode lookup (not typed
  /// by hand). Lets us safely clear stale auto-fill when the postcode changes,
  /// without ever wiping a city the customer entered manually.
  bool _addrAutoFilled = false;

  // ── Google Places autocomplete (only active when an API key is configured) ─
  List<PlaceSuggestion> _suggestions = const [];
  Timer? _debounce;
  String? _placeSessionToken;
  bool get _placesOn => PlacesService.instance.enabled;

  /// Focus node for the postcode field, so we can jump the cursor there when a
  /// picked address came back without a postcode.
  final _postcodeFocus = FocusNode();

  /// true after a Places selection that had no postcode — shows a prompt asking
  /// the customer to type it in. Cleared once they enter a postcode.
  bool _postcodePrompt = false;

  bool get _needsPhone => context.read<AuthProvider>().user?.phoneNumber == null;

  /// Debounced address search as the customer types line 1. No-op (and no
  /// network call) when Places is disabled — line 1 stays a plain text field.
  void _onLine1Changed(String value) {
    if (!_placesOn) return;
    _debounce?.cancel();
    final q = value.trim();
    if (q.length < 3) {
      if (_suggestions.isNotEmpty) setState(() => _suggestions = const []);
      return;
    }
    _placeSessionToken ??= PlacesService.instance.newSessionToken();
    _debounce = Timer(const Duration(milliseconds: 350), () async {
      final results =
          await PlacesService.instance.autocomplete(q, _placeSessionToken!);
      if (!mounted) return;
      setState(() => _suggestions = results);
    });
  }

  /// Customer tapped a suggestion: fetch its structured address and fill line 1,
  /// city, postcode, and state. Falls back to the suggestion text on any miss.
  Future<void> _selectSuggestion(PlaceSuggestion s) async {
    final token =
        _placeSessionToken ?? PlacesService.instance.newSessionToken();
    setState(() => _suggestions = const []);
    final addr = await PlacesService.instance.details(s.placeId, token);
    _placeSessionToken = null; // session closed by the details call
    if (!mounted) return;
    setState(() {
      // Address line 1 = street/premise only (never the city/state/postcode —
      // those go in the dedicated fields below to avoid duplication).
      final street = (addr != null && addr.line1.isNotEmpty)
          ? addr.line1
          : (s.mainText.isNotEmpty
              ? s.mainText
              : s.description.split(',').first.trim());
      _line1Ctrl.text = street;
      _line1Error = _validateLine1(_line1Ctrl.text);
      if (addr != null) {
        if (addr.city.isNotEmpty) {
          _cityCtrl.text = addr.city;
          _cityError = null;
        }
        if (addr.postcode.isNotEmpty) {
          _postcodeCtrl.text = addr.postcode;
          _postcodeError = null;
        }
        if (addr.state.isNotEmpty && _states.contains(addr.state)) {
          _state = addr.state;
          _stateError = null;
        }
        _addrAutoFilled = true;
        // Some places (areas/POIs) have no single postcode — prompt for it.
        _postcodePrompt = addr.postcode.isEmpty;
      }
      _addrTouched = true;
      _postcodeMatched = false;
    });
    // Jump the cursor to the postcode field when it needs filling in.
    if (_postcodePrompt) _postcodeFocus.requestFocus();
  }

  /// Look up the postcode and pre-fill city + state. Silent on miss — the
  /// customer just types the city manually (graceful fallback, never blocks).
  Future<void> _onPostcodeChanged(String value) async {
    if (!_addrTouched) setState(() => _addrTouched = true);
    final code = value.trim();
    setState(() {
      _postcodeError = _validatePostcode(value);
      _postcodeMatched = false;
      if (code.isNotEmpty) _postcodePrompt = false; // they're entering it now
      // Drop any previously auto-filled city/state so a stale value from an
      // earlier postcode doesn't linger when the postcode changes. A city the
      // customer typed themselves (_addrAutoFilled == false) is left alone.
      if (_addrAutoFilled) {
        _cityCtrl.clear();
        _state = null;
        _addrAutoFilled = false;
      }
    });
    if (!RegExp(r'^\d{5}$').hasMatch(code)) return;
    final loc = await PostcodeService.instance.lookup(code);
    if (!mounted || loc == null) return;
    // Only auto-fill if this is still the current postcode (user may type on).
    if (_postcodeCtrl.text.trim() != code) return;
    setState(() {
      _cityCtrl.text = loc.city;
      _cityError = null;
      if (_states.contains(loc.state)) {
        _state = loc.state;
        _stateError = null;
      }
      _postcodeMatched = true;
      _addrAutoFilled = true;
    });
  }

  String? _validateName(String value) {
    final v = value.trim();
    if (v.isEmpty) return 'Full name is required.';
    if (v.length < 2) return 'Please enter your full name.';
    if (v.length > 120) return 'Name is too long (max 120 characters).';
    return null;
  }

  String? _validatePhone(String value) {
    final v = value.trim();
    if (v.isEmpty) return 'Phone number is required for delivery contact.';
    if (!RegExp(r'^\+?[1-9]\d{7,14}$').hasMatch(v)) {
      return 'Enter a valid phone number, e.g. +60123456789.';
    }
    return null;
  }

  String? _validateLine1(String value) {
    final v = value.trim();
    if (v.isEmpty) return 'Address line 1 is required.';
    if (v.length > 255) return 'Address is too long.';
    return null;
  }

  String? _validatePostcode(String value) {
    final v = value.trim();
    if (v.isEmpty) return 'Postcode is required.';
    if (!RegExp(r'^\d{5}$').hasMatch(v)) return 'Postcode must be 5 digits.';
    return null;
  }

  String? _validateCity(String value) {
    final v = value.trim();
    if (v.isEmpty) return 'City is required.';
    if (v.length > 100) return 'City name is too long.';
    return null;
  }

  // Run every address validator and update the per-field error state.
  // Returns true when all parts are valid.
  bool _runAddressValidation() {
    setState(() {
      _line1Error    = _validateLine1(_line1Ctrl.text);
      _postcodeError = _validatePostcode(_postcodeCtrl.text);
      _cityError     = _validateCity(_cityCtrl.text);
      _stateError    = _state == null ? 'Please select a state.' : null;
    });
    return _line1Error == null &&
        _postcodeError == null &&
        _cityError == null &&
        _stateError == null;
  }

  @override
  void initState() {
    super.initState();
    // Pre-fill name from session; email-registered customers have username as
    // fullName so the field will be editable but pre-populated.
    final sessionName = context.read<AuthProvider>().user?.fullName ?? '';
    _nameCtrl.text = sessionName;
    _prefillAddress();
  }

  @override
  void dispose() {
    _debounce?.cancel();
    _nameCtrl.dispose();
    _line1Ctrl.dispose();
    _postcodeCtrl.dispose();
    _cityCtrl.dispose();
    _phoneCtrl.dispose();
    _postcodeFocus.dispose();
    super.dispose();
  }

  Future<void> _prefillAddress() async {
    try {
      final saved = await context.read<OrderService>().savedAddress();
      if (mounted && saved.isNotEmpty && _line1Ctrl.text.isEmpty) {
        _line1Ctrl.text    = saved['addressLine1'] ?? '';
        _postcodeCtrl.text = saved['postcode'] ?? '';
        _cityCtrl.text     = saved['city'] ?? '';
        final s = saved['state'] ?? '';
        if (_states.contains(s)) _state = s;
      }
    } catch (_) {
      // non-fatal
    } finally {
      if (mounted) setState(() => _loadingAddr = false);
    }
  }

  Future<void> _placeOrder() async {
    // Mark all touched so errors show immediately on submit.
    setState(() {
      _nameTouched  = true;
      _addrTouched  = true;
      _phoneTouched = true;
      _nameError    = _validateName(_nameCtrl.text);
      if (_needsPhone) _phoneError = _validatePhone(_phoneCtrl.text);
    });
    final addressOk = _runAddressValidation();

    if (_nameError != null) return;
    if (!addressOk) return;
    if (_needsPhone && _phoneError != null) return;

    if (_needsPhone) {
      final phone = _phoneCtrl.text.trim();
      setState(() => _phoneError = null);
      try {
        await context.read<AccountService>().updatePhone(phone);
        await context.read<AuthProvider>().applyPhone(phone);
      } catch (e) {
        if (mounted) setState(() => _phoneError = e.toString());
        return;
      }
    }

    setState(() => _placing = true);
    final orders = context.read<OrderService>();
    final cart   = context.read<CartProvider>();
    try {
      final created = await orders.checkout(
        addressLine1: _line1Ctrl.text.trim(),
        postcode:     _postcodeCtrl.text.trim(),
        city:         _cityCtrl.text.trim(),
        state:        _state!,
      );

      final pi = await orders.createPaymentIntent(created.orderId);
      Stripe.publishableKey = pi['publishableKey'] as String? ?? '';
      await Stripe.instance.applySettings();
      await Stripe.instance.initPaymentSheet(
        paymentSheetParameters: SetupPaymentSheetParameters(
          paymentIntentClientSecret: pi['clientSecret'] as String,
          merchantDisplayName: 'ShoeAR',
        ),
      );
      await Stripe.instance.presentPaymentSheet();
      await orders.pay(created.orderId, 'Stripe',
          paymentIntentId: pi['paymentIntentId'] as String?);

      final receipt = await orders.getReceipt(created.orderId);
      await cart.refresh();

      // Persist name to DB and update session (silent — order already placed).
      final newName = _nameCtrl.text.trim();
      final currentName = context.read<AuthProvider>().user?.fullName ?? '';
      if (newName != currentName) {
        try {
          await context.read<AccountService>().updateFullName(newName);
          if (mounted) await context.read<AuthProvider>().applyProfile(fullName: newName);
        } catch (_) {
          // non-fatal — order is placed, name update failure is acceptable
        }
      }

      if (!mounted) return;
      Navigator.of(context).pushReplacement(
        MaterialPageRoute(builder: (_) => ReceiptScreen(receipt: receipt)),
      );
    } on StripeException catch (e) {
      if (!mounted) return;
      setState(() => _placing = false);
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(e.error.localizedMessage ?? 'Payment cancelled.')),
      );
    } catch (e) {
      if (!mounted) return;
      setState(() => _placing = false);
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString())));
    }
  }

  // Shared builder for the structured address text fields.
  Widget _addrField({
    required TextEditingController controller,
    required String hint,
    required IconData icon,
    required String? error,
    required ValueChanged<String> onChanged,
    TextInputType? keyboardType,
    int? maxLength,
    VoidCallback? onClear,
    FocusNode? focusNode,
    List<TextInputFormatter>? inputFormatters,
  }) {
    // Show the clear (X) button only when a clear handler is given and the
    // field has text.
    final showClear = onClear != null && controller.text.isNotEmpty;
    return TextField(
      controller:      controller,
      focusNode:       focusNode,
      keyboardType:    keyboardType,
      maxLength:       maxLength,
      inputFormatters: inputFormatters,
      decoration: InputDecoration(
        hintText:   hint,
        border:     const OutlineInputBorder(),
        errorText:  error,
        prefixIcon: Icon(icon),
        suffixIcon: showClear
            ? IconButton(
                icon: const Icon(Icons.clear, size: 18),
                tooltip: 'Clear',
                onPressed: onClear,
              )
            : null,
        filled:     true,
        fillColor:  Colors.white,
        counterText: '',
        isDense:    true,
      ),
      onChanged: onChanged,
    );
  }

  @override
  Widget build(BuildContext context) {
    final cart       = context.watch<CartProvider>().cart;
    final needsPhone = context.select<AuthProvider, bool>(
      (a) => a.user?.phoneNumber == null,
    );

    return Scaffold(
      backgroundColor: Colors.grey.shade100,
      appBar: AppBar(
        title: const Text('Checkout'),
        backgroundColor: Colors.white,
        surfaceTintColor: Colors.white,
      ),
      body: (cart == null || cart.items.isEmpty)
          ? const Center(child: Text('Your cart is empty.'))
          : ListView(
              padding: const EdgeInsets.fromLTRB(16, 16, 16, 100),
              children: [
                // ── 1. Delivery information ────────────────────────────────
                _SectionCard(
                  icon: Icons.location_on_outlined,
                  title: 'Delivery Information',
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      // ── Full name (always shown) ─────────────────────────
                      _FieldLabel(
                        icon: Icons.person_outline,
                        label: 'Full Name',
                      ),
                      const SizedBox(height: 8),
                      TextField(
                        controller:     _nameCtrl,
                        textCapitalization: TextCapitalization.words,
                        decoration: InputDecoration(
                          hintText:   'e.g. Ahmad bin Abdullah',
                          border:     const OutlineInputBorder(),
                          errorText:  _nameError,
                          prefixIcon: const Icon(Icons.person_outline),
                          filled:     true,
                          fillColor:  Colors.white,
                        ),
                        onChanged: (v) {
                          if (!_nameTouched) setState(() => _nameTouched = true);
                          setState(() => _nameError = _validateName(v));
                        },
                      ),
                      const SizedBox(height: 20),

                      if (needsPhone) ...[
                        _FieldLabel(
                          icon: Icons.phone_outlined,
                          label: 'Contact Phone Number',
                        ),
                        const SizedBox(height: 4),
                        Text(
                          'Your account was created with Google. Add a phone number so the courier can reach you.',
                          style: TextStyle(
                              fontSize: 12,
                              color: Colors.grey.shade600),
                        ),
                        const SizedBox(height: 8),
                        TextField(
                          controller:   _phoneCtrl,
                          keyboardType: TextInputType.phone,
                          inputFormatters: [
                            // Digits only, plus an optional leading '+'.
                            FilteringTextInputFormatter.allow(RegExp(r'[0-9+]')),
                          ],
                          decoration: InputDecoration(
                            hintText:  '+60123456789',
                            border:    const OutlineInputBorder(),
                            errorText: _phoneError,
                            prefixIcon: const Icon(Icons.phone_outlined),
                            filled: true,
                            fillColor: Colors.white,
                          ),
                          onChanged: (v) {
                            if (!_phoneTouched) setState(() => _phoneTouched = true);
                            setState(() => _phoneError = _validatePhone(v));
                          },
                        ),
                        const SizedBox(height: 20),
                      ],
                      _FieldLabel(
                        icon: Icons.home_outlined,
                        label: 'Delivery Address',
                      ),
                      const SizedBox(height: 8),
                      if (_loadingAddr)
                        const Padding(
                          padding: EdgeInsets.symmetric(vertical: 14),
                          child: LinearProgressIndicator())
                      else ...[
                        // Address line 1 (with Google Places search when on)
                        _addrField(
                          controller: _line1Ctrl,
                          hint: _placesOn
                              ? 'Start typing your address…'
                              : 'Address line 1 (unit, street)',
                          icon: Icons.home_outlined,
                          error: _line1Error,
                          onChanged: (v) {
                            if (!_addrTouched) setState(() => _addrTouched = true);
                            setState(() => _line1Error = _validateLine1(v));
                            _onLine1Changed(v);
                          },
                          onClear: () => setState(() {
                            _line1Ctrl.clear();
                            _suggestions = const [];
                            _line1Error = _validateLine1('');
                          }),
                        ),
                        // Google Places suggestions
                        if (_suggestions.isNotEmpty)
                          Container(
                            margin: const EdgeInsets.only(top: 4),
                            decoration: BoxDecoration(
                              color: Colors.white,
                              border: Border.all(color: Colors.grey.shade300),
                              borderRadius: BorderRadius.circular(8),
                            ),
                            child: Column(
                              children: [
                                for (final s in _suggestions)
                                  ListTile(
                                    dense: true,
                                    visualDensity: VisualDensity.compact,
                                    leading: Icon(Icons.location_on_outlined,
                                        size: 18,
                                        color: Theme.of(context)
                                            .colorScheme
                                            .primary),
                                    title: Text(s.description,
                                        style: const TextStyle(fontSize: 13)),
                                    onTap: () => _selectSuggestion(s),
                                  ),
                              ],
                            ),
                          ),
                        const SizedBox(height: 12),
                        // Postcode (full width so the error text has room)
                        _addrField(
                          controller: _postcodeCtrl,
                          hint: 'Postcode',
                          icon: Icons.markunread_mailbox_outlined,
                          error: _postcodeError,
                          keyboardType: TextInputType.number,
                          maxLength: 5,
                          inputFormatters: [
                            FilteringTextInputFormatter.digitsOnly,
                          ],
                          focusNode: _postcodeFocus,
                          onChanged: _onPostcodeChanged,
                        ),
                        if (_postcodePrompt) ...[
                          const SizedBox(height: 6),
                          Row(
                            children: [
                              Icon(Icons.info_outline,
                                  size: 14, color: Colors.orange.shade700),
                              const SizedBox(width: 6),
                              Expanded(
                                child: Text(
                                  'No postcode for this area — please enter it.',
                                  style: TextStyle(
                                      fontSize: 12, color: Colors.orange.shade800),
                                ),
                              ),
                            ],
                          ),
                        ],
                        const SizedBox(height: 12),
                        // City (auto-filled from postcode, still editable)
                        _addrField(
                          controller: _cityCtrl,
                          hint: 'City',
                          icon: Icons.location_city_outlined,
                          error: _cityError,
                          onChanged: (v) {
                            if (!_addrTouched) setState(() => _addrTouched = true);
                            setState(() {
                              _cityError = _validateCity(v);
                              // Customer is editing the city by hand — stop
                              // treating it as auto-filled so it won't be wiped.
                              _addrAutoFilled = false;
                              _postcodeMatched = false;
                            });
                          },
                        ),
                        const SizedBox(height: 12),
                        // State dropdown
                        DropdownButtonFormField<String>(
                          value: _state,
                          isExpanded: true,
                          decoration: InputDecoration(
                            hintText:   'Select state',
                            border:     const OutlineInputBorder(),
                            errorText:  _stateError,
                            prefixIcon: const Icon(Icons.map_outlined),
                            filled:     true,
                            fillColor:  Colors.white,
                          ),
                          items: [
                            for (final s in _states)
                              DropdownMenuItem(value: s, child: Text(s)),
                          ],
                          onChanged: (v) => setState(() {
                            _state = v;
                            _stateError = v == null ? 'Please select a state.' : null;
                            _postcodeMatched = false;
                            _addrAutoFilled = false;
                          }),
                        ),
                        if (_postcodeMatched) ...[
                          const SizedBox(height: 8),
                          Row(
                            children: [
                              Icon(Icons.check_circle,
                                  size: 14, color: Colors.green.shade600),
                              const SizedBox(width: 6),
                              Expanded(
                                child: Text(
                                  'City & state filled from postcode. Tap to edit if needed.',
                                  style: TextStyle(
                                      fontSize: 12, color: Colors.green.shade700),
                                ),
                              ),
                            ],
                          ),
                        ],
                      ],
                    ],
                  ),
                ),

                const SizedBox(height: 12),

                // ── 2. Order items ─────────────────────────────────────────
                _SectionCard(
                  icon: Icons.shopping_bag_outlined,
                  title: 'Order Items (${cart.items.length})',
                  child: Column(
                    children: [
                      for (int i = 0; i < cart.items.length; i++) ...[
                        if (i > 0) const Divider(height: 16),
                        _OrderItemRow(item: cart.items[i]),
                      ],
                    ],
                  ),
                ),

                const SizedBox(height: 12),

                // ── 3. Payment method ──────────────────────────────────────
                _SectionCard(
                  icon: Icons.payment_outlined,
                  title: 'Payment Method',
                  child: Column(
                    children: [
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
                        decoration: BoxDecoration(
                          color: Theme.of(context).colorScheme.primaryContainer.withValues(alpha: 0.4),
                          border: Border.all(color: Theme.of(context).colorScheme.primary, width: 1.5),
                          borderRadius: BorderRadius.circular(10),
                        ),
                        child: Row(
                          children: [
                            Container(
                              width: 40,
                              height: 40,
                              decoration: BoxDecoration(
                                color: Theme.of(context).colorScheme.primary,
                                borderRadius: BorderRadius.circular(8),
                              ),
                              child: const Icon(Icons.credit_card, size: 20, color: Colors.white),
                            ),
                            const SizedBox(width: 12),
                            const Expanded(
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text('Credit / Debit Card',
                                      style: TextStyle(fontWeight: FontWeight.w600)),
                                  Text('Secured by Stripe',
                                      style: TextStyle(fontSize: 12, color: Colors.grey)),
                                ],
                              ),
                            ),
                            const Icon(Icons.lock_outline, size: 16, color: Colors.grey),
                          ],
                        ),
                      ),
                    ],
                  ),
                ),

                const SizedBox(height: 12),

                // ── 4. Price breakdown ─────────────────────────────────────
                _SectionCard(
                  icon: Icons.receipt_long_outlined,
                  title: 'Price Details',
                  child: Column(
                    children: [
                      _PriceRow(
                        label: 'Subtotal (${cart.items.fold<int>(0, (s, i) => s + i.quantity)} item${cart.items.fold<int>(0, (s, i) => s + i.quantity) == 1 ? '' : 's'})',
                        value: 'RM ${cart.total.toStringAsFixed(2)}',
                      ),
                      const SizedBox(height: 6),
                      _PriceRow(
                        label: 'Shipping fee',
                        value: 'Free',
                        valueColor: Colors.green.shade600,
                      ),
                      const Padding(
                        padding: EdgeInsets.symmetric(vertical: 10),
                        child: Divider(height: 1),
                      ),
                      _PriceRow(
                        label: 'Total',
                        value: 'RM ${cart.total.toStringAsFixed(2)}',
                        bold: true,
                        valueColor: Theme.of(context).colorScheme.primary,
                      ),
                    ],
                  ),
                ),
              ],
            ),

      // ── Place order bar ─────────────────────────────────────────────────
      bottomNavigationBar: (cart == null || cart.items.isEmpty)
          ? null
          : SafeArea(
              child: Container(
                padding: const EdgeInsets.fromLTRB(16, 12, 16, 12),
                decoration: BoxDecoration(
                  color: Colors.white,
                  boxShadow: [
                    BoxShadow(
                        color: Colors.black.withValues(alpha: 0.07),
                        blurRadius: 12,
                        offset: const Offset(0, -3)),
                  ],
                ),
                child: FilledButton.icon(
                  onPressed: _placing ? null : _placeOrder,
                  icon: _placing
                      ? const SizedBox(
                          width: 18,
                          height: 18,
                          child: CircularProgressIndicator(
                              strokeWidth: 2, color: Colors.white))
                      : const Icon(Icons.lock_outline, size: 18),
                  label: Text(
                    _placing
                        ? 'Processing…'
                        : 'Place Order  ·  RM ${cart.total.toStringAsFixed(2)}',
                    style: const TextStyle(
                        fontSize: 15, fontWeight: FontWeight.bold),
                  ),
                  style: FilledButton.styleFrom(
                    minimumSize: const Size.fromHeight(52),
                    shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(14)),
                  ),
                ),
              ),
            ),
    );
  }
}

// ── Shared section card ──────────────────────────────────────────────────────

class _SectionCard extends StatelessWidget {
  final IconData icon;
  final String title;
  final Widget child;

  const _SectionCard({
    required this.icon,
    required this.title,
    required this.child,
  });

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Container(
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(14),
        boxShadow: [
          BoxShadow(
              color: Colors.black.withValues(alpha: 0.04),
              blurRadius: 8,
              offset: const Offset(0, 2)),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // section header
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 14, 16, 10),
            child: Row(
              children: [
                Icon(icon, size: 18, color: theme.colorScheme.primary),
                const SizedBox(width: 8),
                Text(title,
                    style: theme.textTheme.titleSmall?.copyWith(
                        fontWeight: FontWeight.bold)),
              ],
            ),
          ),
          const Divider(height: 1),
          Padding(
            padding: const EdgeInsets.all(16),
            child: child,
          ),
        ],
      ),
    );
  }
}

// ── Field label with icon ────────────────────────────────────────────────────

class _FieldLabel extends StatelessWidget {
  final IconData icon;
  final String label;

  const _FieldLabel({required this.icon, required this.label});

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Icon(icon, size: 15, color: Colors.grey.shade600),
        const SizedBox(width: 6),
        Text(label,
            style: TextStyle(
                fontWeight: FontWeight.w600,
                fontSize: 13,
                color: Colors.grey.shade800)),
      ],
    );
  }
}

// ── Order item row ────────────────────────────────────────────────────────────

class _OrderItemRow extends StatelessWidget {
  final CartItem item;
  const _OrderItemRow({required this.item});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Row(
      crossAxisAlignment: CrossAxisAlignment.center,
      children: [
        ClipRRect(
          borderRadius: BorderRadius.circular(8),
          child: SizedBox(
              width: 56, height: 56, child: ProductImage(url: item.imageUrl)),
        ),
        const SizedBox(width: 12),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(item.brand.toUpperCase(),
                  style: TextStyle(
                      fontSize: 10,
                      color: theme.colorScheme.primary,
                      fontWeight: FontWeight.w600,
                      letterSpacing: 0.8)),
              Text(item.productName,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                      fontWeight: FontWeight.w600, fontSize: 13)),
              Row(
                children: [
                  _Tag('Size ${item.size}'),
                  const SizedBox(width: 6),
                  _Tag('Qty ${item.quantity}'),
                ],
              ),
            ],
          ),
        ),
        const SizedBox(width: 8),
        Text('RM ${item.subtotal.toStringAsFixed(2)}',
            style: TextStyle(
                fontWeight: FontWeight.bold,
                color: theme.colorScheme.primary)),
      ],
    );
  }
}

class _Tag extends StatelessWidget {
  final String label;
  const _Tag(this.label);

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
      decoration: BoxDecoration(
        color: Colors.grey.shade100,
        borderRadius: BorderRadius.circular(4),
      ),
      child: Text(label,
          style: TextStyle(fontSize: 11, color: Colors.grey.shade700)),
    );
  }
}

// ── Price breakdown row ───────────────────────────────────────────────────────

class _PriceRow extends StatelessWidget {
  final String label;
  final String value;
  final bool bold;
  final Color? valueColor;

  const _PriceRow({
    required this.label,
    required this.value,
    this.bold = false,
    this.valueColor,
  });

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisAlignment: MainAxisAlignment.spaceBetween,
      children: [
        Text(label,
            style: TextStyle(
                fontSize: bold ? 15 : 13,
                fontWeight: bold ? FontWeight.bold : FontWeight.normal,
                color: bold ? Colors.black87 : Colors.grey.shade700)),
        Text(value,
            style: TextStyle(
                fontSize: bold ? 16 : 13,
                fontWeight: bold ? FontWeight.bold : FontWeight.w500,
                color: valueColor ??
                    (bold ? Colors.black87 : Colors.grey.shade800))),
      ],
    );
  }
}
