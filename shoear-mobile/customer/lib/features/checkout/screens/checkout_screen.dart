import 'package:flutter/material.dart';
import 'package:flutter_stripe/flutter_stripe.dart';
import 'package:provider/provider.dart';

import 'package:customer/features/auth/services/account_service.dart';
import 'package:customer/features/auth/state/auth_provider.dart';
import 'package:customer/features/order/services/order_service.dart';
import 'package:customer/features/cart/state/cart_provider.dart';
import 'package:customer/features/cart/models/cart.dart';
import 'package:customer/core/widgets/product_image.dart';
import 'package:customer/features/checkout/screens/receipt_screen.dart';

class CheckoutScreen extends StatefulWidget {
  const CheckoutScreen({super.key});

  @override
  State<CheckoutScreen> createState() => _CheckoutScreenState();
}

class _CheckoutScreenState extends State<CheckoutScreen> {
  final _nameCtrl    = TextEditingController();
  final _addressCtrl = TextEditingController();
  final _phoneCtrl   = TextEditingController();
  bool _loadingAddr   = true;
  bool _placing       = false;
  bool _nameTouched   = false;
  bool _phoneTouched  = false;
  bool _addrTouched   = false;
  String? _nameError;
  String? _addrError;
  String? _phoneError;

  bool get _needsPhone => context.read<AuthProvider>().user?.phoneNumber == null;

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

  String? _validateAddress(String value) {
    final v = value.trim();
    if (v.isEmpty) return 'A delivery address is required.';
    if (v.length < 10) return 'Please enter a complete delivery address.';
    if (v.length > 255) return 'Address is too long (max 255 characters).';
    return null;
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
    _nameCtrl.dispose();
    _addressCtrl.dispose();
    _phoneCtrl.dispose();
    super.dispose();
  }

  Future<void> _prefillAddress() async {
    try {
      final saved = await context.read<OrderService>().savedShippingAddress();
      if (mounted && saved != null && _addressCtrl.text.isEmpty) {
        _addressCtrl.text = saved;
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
      _addrError    = _validateAddress(_addressCtrl.text);
      if (_needsPhone) _phoneError = _validatePhone(_phoneCtrl.text);
    });

    if (_nameError != null) return;
    if (_addrError != null) return;
    if (_needsPhone && _phoneError != null) return;

    final address = _addressCtrl.text.trim();

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

    setState(() {
      _addrError = null;
      _placing   = true;
    });
    final orders = context.read<OrderService>();
    final cart   = context.read<CartProvider>();
    try {
      final created = await orders.checkout(address);

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
                      _loadingAddr
                          ? const Padding(
                              padding: EdgeInsets.symmetric(vertical: 14),
                              child: LinearProgressIndicator())
                          : TextField(
                              controller: _addressCtrl,
                              minLines:   3,
                              maxLines:   4,
                              decoration: InputDecoration(
                                hintText: 'Street, city, postcode, state',
                                border:   const OutlineInputBorder(),
                                errorText: _addrError,
                                filled:    true,
                                fillColor: Colors.white,
                                prefixIcon: const Padding(
                                  padding: EdgeInsets.only(bottom: 40),
                                  child: Icon(Icons.edit_location_alt_outlined),
                                ),
                              ),
                              onChanged: (v) {
                                if (!_addrTouched) setState(() => _addrTouched = true);
                                setState(() => _addrError = _validateAddress(v));
                              },
                            ),
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
