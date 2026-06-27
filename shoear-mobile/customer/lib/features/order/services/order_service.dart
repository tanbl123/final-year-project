import 'dart:io';

import 'package:customer/core/api/api_client.dart';
import 'package:customer/features/order/models/order.dart';

/// Checkout, payment and receipt (all require a Customer token).
class OrderService {
  final ApiClient api;
  OrderService(this.api);

  /// The customer's saved structured address (from their profile), used to
  /// prefill the checkout form. Returns an empty map when none is set; keys:
  /// addressLine1, addressLine2, postcode, city, state.
  Future<Map<String, String>> savedAddress() async {
    final me = await api.get('/auth/me') as Map<String, dynamic>;
    final profile = me['profile'];
    if (profile is! Map) return {};
    String pick(String k) => (profile[k] as String?)?.trim() ?? '';
    return {
      'addressLine1': pick('addressLine1'),
      'addressLine2': pick('addressLine2'),
      'postcode':     pick('postcode'),
      'city':         pick('city'),
      'state':        pick('state'),
    };
  }

  /// POST /orders — turn the cart into an order (Placed) and clear the cart.
  /// Sends the structured Malaysian address; the backend builds the combined
  /// display string and stores both.
  Future<CheckoutResult> checkout({
    required String addressLine1,
    String addressLine2 = '',
    required String postcode,
    required String city,
    required String state,
  }) async => CheckoutResult.fromJson(
        await api.post('/orders', {
          'addressLine1': addressLine1,
          'addressLine2': addressLine2,
          'postcode':     postcode,
          'city':         city,
          'state':        state,
        }) as Map<String, dynamic>,
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

  /// POST /uploads/refund-proof — upload a supporting photo for a refund,
  /// returns its stored URL (sent back as refundProof).
  Future<String> uploadRefundProof(File photo) async {
    final data = await api.uploadFile('/uploads/refund-proof', photo) as Map<String, dynamic>;
    return data['url']?.toString() ?? '';
  }

  /// POST /orders/{id}/refund — request a (full) refund, optionally with one or
  /// more proof image URLs. Throws on failure (e.g. not a paid order, or a
  /// refund already in progress).
  Future<void> requestRefund(String orderId, String reason, {List<String>? refundProofs}) async {
    await api.post('/orders/$orderId/refund', {
      'refundReason': reason,
      if (refundProofs != null && refundProofs.isNotEmpty) 'refundProof': refundProofs,
    });
  }
}
