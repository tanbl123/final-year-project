import 'package:flutter/material.dart';
import 'package:flutter_stripe/flutter_stripe.dart';
import 'package:provider/provider.dart';

import 'package:customer/features/auth/services/account_service.dart';
import 'package:customer/features/auth/state/auth_provider.dart';
import 'package:customer/features/order/services/order_service.dart';
import 'package:customer/features/cart/state/cart_provider.dart';
import 'package:customer/features/checkout/screens/receipt_screen.dart';

/// Review the cart, confirm a delivery address, pick a (simulated) payment
/// method, then place + pay the order in one step.
///
/// For Google Sign-In users who haven't set a phone number yet, a required
/// phone field is shown before checkout (phone is passed to the backend when
/// the courier and admin need to contact the customer).
class CheckoutScreen extends StatefulWidget {
  const CheckoutScreen({super.key});

  @override
  State<CheckoutScreen> createState() => _CheckoutScreenState();
}

class _CheckoutScreenState extends State<CheckoutScreen> {
  final _addressCtrl = TextEditingController();
  final _phoneCtrl   = TextEditingController();
  String _method     = 'Stripe';
  bool _loadingAddr  = true;
  bool _placing      = false;
  String? _addrError;
  String? _phoneError;

  bool get _needsPhone => context.read<AuthProvider>().user?.phoneNumber == null;

  @override
  void initState() {
    super.initState();
    _prefillAddress();
  }

  @override
  void dispose() {
    _addressCtrl.dispose();
    _phoneCtrl.dispose();
    super.dispose();
  }

  Future<void> _prefillAddress() async {
    try {
      final saved = await context.read<OrderService>().savedShippingAddress();
      if (mounted && saved != null && _addressCtrl.text.isEmpty) _addressCtrl.text = saved;
    } catch (_) {
      // non-fatal — they can just type the address
    } finally {
      if (mounted) setState(() => _loadingAddr = false);
    }
  }

  Future<void> _placeOrder() async {
    final address = _addressCtrl.text.trim();
    if (address.isEmpty) {
      setState(() => _addrError = 'A delivery address is required.');
      return;
    }
    if (address.length < 10) {
      setState(() => _addrError = 'Please enter a complete delivery address.');
      return;
    }
    if (address.length > 255) {
      setState(() => _addrError = 'Address is too long (max 255 characters).');
      return;
    }

    // Google users who haven't provided a phone must do so before ordering
    if (_needsPhone) {
      final phone = _phoneCtrl.text.trim();
      if (phone.isEmpty) {
        setState(() => _phoneError = 'Phone number is required for delivery contact.');
        return;
      }
      if (!RegExp(r'^\+?[1-9]\d{7,14}$').hasMatch(phone)) {
        setState(() => _phoneError = 'Enter a valid phone number, e.g. +60123456789.');
        return;
      }
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

      if (_method == 'Stripe') {
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
      } else {
        await orders.pay(created.orderId, _method);
      }

      final receipt = await orders.getReceipt(created.orderId);
      await cart.refresh();
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
    final cart  = context.watch<CartProvider>().cart;
    final theme = Theme.of(context);
    final needsPhone = context.select<AuthProvider, bool>(
      (a) => a.user?.phoneNumber == null,
    );

    return Scaffold(
      appBar: AppBar(title: const Text('Checkout')),
      body: (cart == null || cart.items.isEmpty)
          ? const Center(child: Text('Your cart is empty.'))
          : ListView(
              padding: const EdgeInsets.all(16),
              children: [
                Text('Order summary', style: theme.textTheme.titleMedium),
                const SizedBox(height: 8),
                for (final it in cart.items)
                  Padding(
                    padding: const EdgeInsets.symmetric(vertical: 4),
                    child: Row(
                      children: [
                        Expanded(
                          child: Text('${it.productName}  ·  ${it.size}  ·  x${it.quantity}',
                              maxLines: 2, overflow: TextOverflow.ellipsis),
                        ),
                        const SizedBox(width: 8),
                        Text('RM ${it.subtotal.toStringAsFixed(2)}'),
                      ],
                    ),
                  ),
                const Divider(height: 24),
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Text('Total', style: theme.textTheme.titleMedium),
                    Text('RM ${cart.total.toStringAsFixed(2)}',
                        style: theme.textTheme.titleMedium?.copyWith(
                            fontWeight: FontWeight.bold,
                            color: theme.colorScheme.primary)),
                  ],
                ),

                // ── Phone number (Google users only) ──
                if (needsPhone) ...[
                  const SizedBox(height: 24),
                  Text('Contact phone number', style: theme.textTheme.titleMedium),
                  const SizedBox(height: 4),
                  Text(
                    'Your account was created with Google. Please add a phone number so the courier can reach you.',
                    style: TextStyle(fontSize: 13, color: theme.colorScheme.onSurfaceVariant),
                  ),
                  const SizedBox(height: 8),
                  TextField(
                    controller:   _phoneCtrl,
                    keyboardType: TextInputType.phone,
                    decoration: InputDecoration(
                      hintText: '+60123456789',
                      border:   const OutlineInputBorder(),
                      errorText: _phoneError,
                    ),
                    onChanged: (_) {
                      if (_phoneError != null) setState(() => _phoneError = null);
                    },
                  ),
                ],

                const SizedBox(height: 24),
                Text('Delivery address', style: theme.textTheme.titleMedium),
                const SizedBox(height: 8),
                _loadingAddr
                    ? const Padding(
                        padding: EdgeInsets.symmetric(vertical: 12),
                        child: LinearProgressIndicator())
                    : TextField(
                        controller: _addressCtrl,
                        minLines: 2,
                        maxLines: 4,
                        decoration: InputDecoration(
                          hintText: 'Where should we deliver your order?',
                          border: const OutlineInputBorder(),
                          errorText: _addrError,
                        ),
                        onChanged: (_) {
                          if (_addrError != null) setState(() => _addrError = null);
                        },
                      ),

                const SizedBox(height: 24),
                Text('Payment method', style: theme.textTheme.titleMedium),
                const SizedBox(height: 4),
                RadioListTile<String>(
                  value: 'Stripe',
                  groupValue: _method,
                  onChanged: (v) => setState(() => _method = v!),
                  title: const Text('Card (Stripe)'),
                  secondary: const Icon(Icons.credit_card),
                  contentPadding: EdgeInsets.zero,
                ),
                RadioListTile<String>(
                  value: 'PayPal',
                  groupValue: _method,
                  onChanged: (v) => setState(() => _method = v!),
                  title: const Text('PayPal'),
                  secondary: const Icon(Icons.account_balance_wallet),
                  contentPadding: EdgeInsets.zero,
                ),
                Text(
                  'Card payments use Stripe in test mode (try card 4242 4242 4242 4242). PayPal is simulated.',
                  style: TextStyle(fontSize: 12, color: Colors.grey.shade600),
                ),
              ],
            ),
      bottomNavigationBar: (cart == null || cart.items.isEmpty)
          ? null
          : SafeArea(
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: FilledButton.icon(
                  onPressed: _placing ? null : _placeOrder,
                  icon: _placing
                      ? const SizedBox(
                          width: 18, height: 18,
                          child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                      : const Icon(Icons.lock),
                  label: Text(_placing
                      ? 'Processing…'
                      : 'Place order · RM ${cart.total.toStringAsFixed(2)}'),
                  style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(48)),
                ),
              ),
            ),
    );
  }
}
