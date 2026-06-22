/// A delivery row in the courier's assignment / history list.
class DeliverySummary {
  final String deliveryId;
  final String orderId;
  final String status;
  final String? deliveryAddress;
  final String? customerName;
  final String? customerPhone;
  final String? supplierName;
  final String? pickupAddress;
  final int itemCount;
  final DateTime? estimatedTime;
  final DateTime? deliveredDate;

  DeliverySummary({
    required this.deliveryId,
    required this.orderId,
    required this.status,
    this.deliveryAddress,
    this.customerName,
    this.customerPhone,
    this.supplierName,
    this.pickupAddress,
    this.itemCount = 0,
    this.estimatedTime,
    this.deliveredDate,
  });

  factory DeliverySummary.fromJson(Map<String, dynamic> j) => DeliverySummary(
        deliveryId: j['deliveryId']?.toString() ?? '',
        orderId: j['orderId']?.toString() ?? '',
        status: j['deliveryStatus']?.toString() ?? '',
        deliveryAddress: j['orderDeliveryAddress'] as String?,
        customerName: j['customerName'] as String?,
        customerPhone: j['customerPhone'] as String?,
        supplierName: j['supplierName'] as String?,
        pickupAddress: j['pickupAddress'] as String?,
        itemCount: (j['itemCount'] as num?)?.toInt() ?? 0,
        estimatedTime: DateTime.tryParse(j['estimatedDeliveryTime']?.toString() ?? ''),
        deliveredDate: DateTime.tryParse(j['deliveryDate']?.toString() ?? ''),
      );
}

/// One line item in a parcel.
class DeliveryItem {
  final String productName;
  final String brand;
  final String size;
  final int qty;

  DeliveryItem({required this.productName, required this.brand, required this.size, required this.qty});

  factory DeliveryItem.fromJson(Map<String, dynamic> j) => DeliveryItem(
        productName: j['productName']?.toString() ?? '',
        brand: j['brand']?.toString() ?? '',
        size: j['size']?.toString() ?? '',
        qty: (j['qty'] as num?)?.toInt() ?? 0,
      );
}

/// Full delivery detail (GET /deliveries/{id}).
class DeliveryDetail {
  final String deliveryId;
  final String orderId;
  final String status;
  final String? deliveryAddress;
  final double orderTotal;
  final String? customerName;
  final String? customerPhone;
  final String? supplierName;
  final String? pickupAddress;
  final String? proofOfDelivery;
  final DateTime? estimatedTime;
  final List<DeliveryItem> items;

  DeliveryDetail({
    required this.deliveryId,
    required this.orderId,
    required this.status,
    required this.deliveryAddress,
    required this.orderTotal,
    required this.customerName,
    required this.customerPhone,
    required this.supplierName,
    required this.pickupAddress,
    required this.proofOfDelivery,
    required this.estimatedTime,
    required this.items,
  });

  factory DeliveryDetail.fromJson(Map<String, dynamic> j) => DeliveryDetail(
        deliveryId: j['deliveryId']?.toString() ?? '',
        orderId: j['orderId']?.toString() ?? '',
        status: j['deliveryStatus']?.toString() ?? '',
        deliveryAddress: j['orderDeliveryAddress'] as String?,
        orderTotal: (j['orderTotalAmount'] as num?)?.toDouble() ?? 0,
        customerName: j['customerName'] as String?,
        customerPhone: j['customerPhone'] as String?,
        supplierName: j['supplierName'] as String?,
        pickupAddress: j['pickupAddress'] as String?,
        proofOfDelivery: (j['proofOfDelivery'] as String?)?.isNotEmpty == true ? j['proofOfDelivery'] as String : null,
        estimatedTime: DateTime.tryParse(j['estimatedDeliveryTime']?.toString() ?? ''),
        items: ((j['items'] as List?) ?? const [])
            .map((e) => DeliveryItem.fromJson(e as Map<String, dynamic>))
            .toList(),
      );
}
