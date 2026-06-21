import 'package:customer/core/api/api_client.dart';
import 'package:customer/features/order/models/order.dart';

/// Checkout, payment and receipt (all require a Customer token).
class OrderService {
  final ApiClient api;
  OrderService(this.api);

  /// The customer's saved shipping address (from their profile), used to
  /// prefill the checkout address. Null when they haven't set one.
  Future<String?> savedShippingAddress() async {
    final me = await api.get('/auth/me') as Map<String, dynamic>;
    final profile = me['profile'];
    if (profile is Map && profile['shippingAddress'] is String) {
      final s = (profile['shippingAddress'] as String).trim();
      return s.isEmpty ? null : s;
    }
    return null;
  }

  /// POST /orders — turn the cart into an order (Placed) and clear the cart.
  Future<CheckoutResult> checkout(String deliveryAddress) async => CheckoutResult.fromJson(
        await api.post('/orders', {'deliveryAddress': deliveryAddress}) as Map<String, dynamic>,
      );

  /// POST /orders/{id}/payment-intent — start a Stripe payment; returns
  /// { clientSecret, paymentIntentId, publishableKey } for the payment sheet.
  Future<Map<String, dynamic>> createPaymentIntent(String orderId) async =>
      await api.post('/orders/$orderId/payment-intent', {}) as Map<String, dynamic>;

  /// POST /orders/{id}/payment — finalize. For Stripe, pass the paymentIntentId
  /// (verified server-side); otherwise it's a simulated success. On success the
  /// order is Paid and dispatched. Throws [ApiException] on failure.
  Future<void> pay(String orderId, String method, {String? paymentIntentId}) async {
    await api.post('/orders/$orderId/payment', {
      'paymentMethod': method,
      if (paymentIntentId != null) 'paymentIntentId': paymentIntentId,
    });
  }

  /// GET /orders/{id}/receipt
  Future<Receipt> getReceipt(String orderId) async => Receipt.fromJson(
        await api.get('/orders/$orderId/receipt') as Map<String, dynamic>,
      );

  /// GET /orders — the customer's order history (newest first).
  Future<List<CustomerOrderSummary>> listOrders() async {
    final data = await api.get('/orders') as Map<String, dynamic>;
    return ((data['orders'] as List?) ?? [])
        .map((e) => CustomerOrderSummary.fromJson(e as Map<String, dynamic>))
        .toList();
  }

  /// GET /orders/{id} — full order detail (items, payment, per-parcel tracking).
  Future<CustomerOrder> getOrder(String orderId) async => CustomerOrder.fromJson(
        await api.get('/orders/$orderId') as Map<String, dynamic>,
      );

  /// POST /orders/{id}/refund — request a (full) refund. Throws on failure
  /// (e.g. not a paid order, or a refund already in progress).
  Future<void> requestRefund(String orderId, String reason) async {
    await api.post('/orders/$orderId/refund', {'refundReason': reason});
  }
}
