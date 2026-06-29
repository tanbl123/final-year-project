import 'dart:convert';

/// Result of POST /orders (checkout) — the order is created (Placed) and the
/// cart is cleared server-side; payment is the next step.
class CheckoutResult {
  final String orderId;
  final double total;
  final String deliveryAddress;
  final int itemCount;

  CheckoutResult({required this.orderId, required this.total, required this.deliveryAddress, required this.itemCount});

  factory CheckoutResult.fromJson(Map<String, dynamic> j) => CheckoutResult(
        orderId: j['orderId'] as String,
        total: (j['total'] as num?)?.toDouble() ?? 0,
        deliveryAddress: j['deliveryAddress'] as String? ?? '',
        itemCount: (j['itemCount'] as num?)?.toInt() ?? 0,
      );
}

/// One line on a receipt.
class ReceiptItem {
  final String productName;
  final String brand;
  final String size;
  final int qty;
  final double unitPrice;
  final double subtotal;

  ReceiptItem({required this.productName, required this.brand, required this.size, required this.qty, required this.unitPrice, required this.subtotal});

  factory ReceiptItem.fromJson(Map<String, dynamic> j) => ReceiptItem(
        productName: j['productName'] as String? ?? '',
        brand: j['brand'] as String? ?? '',
        size: j['size']?.toString() ?? '',
        qty: (j['qty'] as num?)?.toInt() ?? 0,
        unitPrice: (j['unitPrice'] as num?)?.toDouble() ?? 0,
        subtotal: (j['subtotal'] as num?)?.toDouble() ?? 0,
      );
}

/// GET /orders/{id}/receipt — shown after a successful payment.
class Receipt {
  final String receiptId;
  final String orderId;
  final double total;
  final String deliveryAddress;
  final String? customerName; // who the receipt is billed to
  final List<String> sellers; // supplier(s) the items were bought from
  final String? paymentMethod;
  final String? transactionId;
  final double? paymentAmount;
  final String? paymentDate;
  final List<ReceiptItem> items;

  Receipt({
    required this.receiptId,
    required this.orderId,
    required this.total,
    required this.deliveryAddress,
    this.customerName,
    this.sellers = const [],
    this.paymentMethod,
    this.transactionId,
    this.paymentAmount,
    this.paymentDate,
    required this.items,
  });

  factory Receipt.fromJson(Map<String, dynamic> j) => Receipt(
        receiptId: j['receiptId'] as String? ?? '',
        orderId: j['orderId'] as String? ?? '',
        total: (j['orderTotalAmount'] as num?)?.toDouble() ?? 0,
        deliveryAddress: j['orderDeliveryAddress'] as String? ?? '',
        customerName: j['customerName'] as String?,
        sellers: ((j['sellers'] as List?) ?? []).map((e) => e.toString()).toList(),
        paymentMethod: j['paymentMethod'] as String?,
        transactionId: j['transactionId'] as String?,
        paymentAmount: (j['paymentAmount'] as num?)?.toDouble(),
        paymentDate: j['paymentDate'] as String?,
        items: ((j['items'] as List?) ?? [])
            .map((e) => ReceiptItem.fromJson(e as Map<String, dynamic>))
            .toList(),
      );
}

/// A row in the customer's order history (GET /orders).
class CustomerOrderSummary {
  final String orderId;
  final String? orderDate;
  final String orderStatus;
  final double total;
  final int itemCount;
  final String? paymentStatus;
  final String? deliveryStatus; // rolled up across parcels
  final String? payBy; // deadline to pay a 'Placed' order before auto-cancel
  final int? payBySeconds; // seconds left to pay (relative; timezone-proof)
  final String? previewName; // first item's product name (list preview)
  final String? previewBrand; // first item's brand
  final String? previewImage; // first item's image URL

  CustomerOrderSummary({
    required this.orderId,
    this.orderDate,
    required this.orderStatus,
    required this.total,
    required this.itemCount,
    this.paymentStatus,
    this.deliveryStatus,
    this.payBy,
    this.payBySeconds,
    this.previewName,
    this.previewBrand,
    this.previewImage,
  });

  /// An order still awaiting payment (created but not yet paid).
  bool get awaitingPayment => orderStatus == 'Placed';

  factory CustomerOrderSummary.fromJson(Map<String, dynamic> j) => CustomerOrderSummary(
        orderId: j['orderId'] as String,
        orderDate: j['orderDate'] as String?,
        orderStatus: j['orderStatus'] as String? ?? '',
        total: (j['orderTotalAmount'] as num?)?.toDouble() ?? 0,
        itemCount: (j['itemCount'] as num?)?.toInt() ?? 0,
        paymentStatus: j['paymentStatus'] as String?,
        deliveryStatus: j['deliveryStatus'] as String?,
        payBy: j['payBy'] as String?,
        payBySeconds: (j['payBySeconds'] as num?)?.toInt(),
        previewName: j['previewName'] as String?,
        previewBrand: j['previewBrand'] as String?,
        previewImage: (j['previewImage'] as String?)?.isNotEmpty == true ? j['previewImage'] as String : null,
      );
}

/// A line item on an order (detail view).
class OrderItem {
  final String productId;
  final String productName;
  final String brand;
  final String size;
  final int qty;
  final double unitPrice;
  final double subtotal;
  final String? imageUrl;
  final bool reviewed; // has this customer already reviewed this product?

  OrderItem({required this.productId, required this.productName, required this.brand, required this.size, required this.qty, required this.unitPrice, required this.subtotal, this.imageUrl, this.reviewed = false});

  factory OrderItem.fromJson(Map<String, dynamic> j) => OrderItem(
        productId: j['productId'] as String? ?? '',
        productName: j['productName'] as String? ?? '',
        brand: j['brand'] as String? ?? '',
        size: j['size']?.toString() ?? '',
        qty: (j['qty'] as num?)?.toInt() ?? 0,
        unitPrice: (j['unitPrice'] as num?)?.toDouble() ?? 0,
        subtotal: (j['subtotal'] as num?)?.toDouble() ?? 0,
        imageUrl: (j['imageUrl'] as String?)?.isNotEmpty == true ? j['imageUrl'] as String : null,
        reviewed: j['reviewed'] == true,
      );
}

/// One parcel of a (possibly multi-supplier) order. Each ships independently and
/// has its own delivery status and confirmation OTP.
class ParcelDelivery {
  final String deliveryId;
  final String deliveryStatus;
  final String? estimatedDeliveryTime;
  final String? otpCode;
  final String? proofOfDelivery;
  final String supplierName;
  final String deliveryMethod; // 'InHouse' (own courier + OTP) or 'Standard' (3PL)
  final String? trackingCarrier; // Standard only: e.g. "J&T Express"
  final String? trackingNumber; // Standard only: the AWB / tracking number

  ParcelDelivery({
    required this.deliveryId,
    required this.deliveryStatus,
    this.estimatedDeliveryTime,
    this.otpCode,
    this.proofOfDelivery,
    required this.supplierName,
    this.deliveryMethod = 'InHouse',
    this.trackingCarrier,
    this.trackingNumber,
  });

  /// A 3PL (standard-shipping) parcel — the customer tracks it by carrier +
  /// tracking number instead of confirming an OTP with an in-house courier.
  bool get isStandard => deliveryMethod == 'Standard';

  factory ParcelDelivery.fromJson(Map<String, dynamic> j) => ParcelDelivery(
        deliveryId: j['deliveryId'] as String? ?? '',
        deliveryStatus: j['deliveryStatus'] as String? ?? '',
        estimatedDeliveryTime: j['estimatedDeliveryTime'] as String?,
        otpCode: j['otpCode']?.toString(),
        proofOfDelivery: j['proofOfDelivery'] as String?,
        supplierName: j['supplierName'] as String? ?? '',
        deliveryMethod: j['deliveryMethod'] as String? ?? 'InHouse',
        trackingCarrier: (j['trackingCarrier'] as String?)?.trim().isEmpty ?? true
            ? null
            : j['trackingCarrier'] as String?,
        trackingNumber: (j['trackingNumber'] as String?)?.trim().isEmpty ?? true
            ? null
            : j['trackingNumber'] as String?,
      );
}

/// A refund request on an order.
class OrderRefund {
  final String refundId;
  final String refundReason;
  final String refundStatus;
  final double refundAmount;
  final String? requestDate;
  final List<String> proofUrls; // supporting evidence photos

  OrderRefund({
    required this.refundId,
    required this.refundReason,
    required this.refundStatus,
    required this.refundAmount,
    this.requestDate,
    this.proofUrls = const [],
  });

  // refundProof is a single URL (legacy) or a JSON array of URLs.
  static List<String> _parseProof(dynamic raw) {
    final s = (raw as String?)?.trim() ?? '';
    if (s.isEmpty) return const [];
    if (s.startsWith('[')) {
      try {
        final list = jsonDecode(s);
        if (list is List) {
          return list.map((e) => e.toString()).where((e) => e.isNotEmpty).toList();
        }
      } catch (_) {/* fall through to single */}
    }
    return [s];
  }

  factory OrderRefund.fromJson(Map<String, dynamic> j) => OrderRefund(
        refundId: j['refundId'] as String? ?? '',
        refundReason: j['refundReason'] as String? ?? '',
        refundStatus: j['refundStatus'] as String? ?? '',
        refundAmount: (j['refundAmount'] as num?)?.toDouble() ?? 0,
        requestDate: j['requestDate'] as String?,
        proofUrls: _parseProof(j['refundProof']),
      );
}

/// Full order detail (GET /orders/{id}).
class CustomerOrder {
  final String orderId;
  final String? orderDate;
  final String orderStatus;
  final double total;
  final String deliveryAddress;
  final String? paymentMethod;
  final String? paymentStatus;
  final String? paymentDate;
  final List<OrderItem> items;
  final List<ParcelDelivery> deliveries;
  final List<OrderRefund> refunds;
  /// Server-computed action eligibility (refund policy lives on the backend).
  final bool canCancel;
  final bool canRefund;
  final bool canReview;
  final int refundWindowDays;

  CustomerOrder({
    required this.orderId,
    this.orderDate,
    required this.orderStatus,
    required this.total,
    required this.deliveryAddress,
    this.paymentMethod,
    this.paymentStatus,
    this.paymentDate,
    required this.items,
    required this.deliveries,
    required this.refunds,
    this.canCancel = false,
    this.canRefund = false,
    this.canReview = false,
    this.refundWindowDays = 7,
  });

  factory CustomerOrder.fromJson(Map<String, dynamic> j) => CustomerOrder(
        orderId: j['orderId'] as String,
        orderDate: j['orderDate'] as String?,
        orderStatus: j['orderStatus'] as String? ?? '',
        total: (j['orderTotalAmount'] as num?)?.toDouble() ?? 0,
        deliveryAddress: j['orderDeliveryAddress'] as String? ?? '',
        paymentMethod: j['paymentMethod'] as String?,
        paymentStatus: j['paymentStatus'] as String?,
        paymentDate: j['paymentDate'] as String?,
        items: ((j['items'] as List?) ?? [])
            .map((e) => OrderItem.fromJson(e as Map<String, dynamic>))
            .toList(),
        deliveries: ((j['deliveries'] as List?) ?? [])
            .map((e) => ParcelDelivery.fromJson(e as Map<String, dynamic>))
            .toList(),
        refunds: ((j['refunds'] as List?) ?? [])
            .map((e) => OrderRefund.fromJson(e as Map<String, dynamic>))
            .toList(),
        canCancel: j['canCancel'] as bool? ?? false,
        canRefund: j['canRefund'] as bool? ?? false,
        canReview: j['canReview'] as bool? ?? false,
        refundWindowDays: (j['refundWindowDays'] as num?)?.toInt() ?? 7,
      );
}

