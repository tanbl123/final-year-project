import 'dart:io';

import 'package:customer/core/api/api_client.dart';
import 'package:customer/features/order/models/order.dart';

/// One page of the customer's order history (for infinite scroll).
class OrdersPage {
  final List<CustomerOrderSummary> orders;
  final int page;
  final int total;
  OrdersPage({required this.orders, required this.page, required this.total});
}

/// Checkout, payment and receipt (all require a Customer token).
class OrderService {
  final ApiClient api;
  OrderService(this.api);

  /// The customer's saved structured address (from their profile), used to
  /// prefill the checkout form. Returns an empty map when none is set; keys:
  /// addressLine1, postcode, city, state.
  Future<Map<String, String>> savedAddress() async {
    final me = await api.get('/auth/me') as Map<String, dynamic>;
    final profile = me['profile'];
    if (profile is! Map) return {};
    String pick(String k) => (profile[k] as String?)?.trim() ?? '';
    return {
      'addressLine1': pick('addressLine1'),
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
    required String postcode,
    required String city,
    required String state,
    List<String>? selectedCartItemIds, // null = whole cart
  }) async => CheckoutResult.fromJson(
        await api.post('/orders', {
          'addressLine1': addressLine1,
          'postcode':     postcode,
          'city':         city,
          'state':        state,
          if (selectedCartItemIds != null && selectedCartItemIds.isNotEmpty)
            'selectedCartItemIds': selectedCartItemIds,
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

  /// GET /orders — one page of the customer's order history (newest first).
  /// [status] filters by tab group: topay | paid | completed | cancelled
  /// (null = all). Returns the page items plus total, for infinite scroll.
  Future<OrdersPage> listOrders({String? status, int page = 1, int limit = 15}) async {
    final query = <String, String>{'page': '$page', 'limit': '$limit'};
    if (status != null && status.isNotEmpty) query['status'] = status;
    final data = await api.get('/orders', query: query) as Map<String, dynamic>;
    return OrdersPage(
      orders: ((data['orders'] as List?) ?? [])
          .map((e) => CustomerOrderSummary.fromJson(e as Map<String, dynamic>))
          .toList(),
      page: (data['page'] as num?)?.toInt() ?? page,
      total: (data['total'] as num?)?.toInt() ?? 0,
    );
  }

  /// GET /orders/{id} — full order detail (items, payment, per-parcel tracking).
  Future<CustomerOrder> getOrder(String orderId) async => CustomerOrder.fromJson(
        await api.get('/orders/$orderId') as Map<String, dynamic>,
      );

  /// POST /orders/{id}/cancel — cancel a paid order that hasn't shipped yet
  /// (full refund). Throws if the order can no longer be cancelled.
  Future<void> cancelOrder(String orderId) async {
    await api.post('/orders/$orderId/cancel', {});
  }

  /// POST /orders/{id}/deliveries/{deliveryId}/resend-otp — re-send myself the
  /// delivery code (notification + push) for one out-for-delivery parcel.
  Future<void> resendDeliveryOtp(String orderId, String deliveryId) async {
    await api.post('/orders/$orderId/deliveries/$deliveryId/resend-otp', {});
  }

  /// POST /orders/{id}/deliveries/{deliveryId}/confirm-receipt — confirm a
  /// Standard (3PL) parcel has arrived ("Order received"). Marks it Delivered.
  Future<void> confirmReceipt(String orderId, String deliveryId) async {
    await api.post('/orders/$orderId/deliveries/$deliveryId/confirm-receipt', {});
  }

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
