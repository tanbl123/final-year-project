import 'dart:io';

import 'package:delivery/core/api/api_client.dart';
import 'package:delivery/features/delivery/models/delivery.dart';

/// Courier delivery calls against the PHP API. All require a DeliveryPersonnel
/// token (set on the [ApiClient] after login).
class DeliveryService {
  final ApiClient api;
  DeliveryService(this.api);

  /// GET /delivery/assignments — active deliveries (Assigned/PickedUp/OutForDelivery).
  Future<List<DeliverySummary>> assignments() async {
    final data = await api.get('/delivery/assignments') as Map<String, dynamic>;
    return ((data['deliveries'] as List?) ?? const [])
        .map((e) => DeliverySummary.fromJson(e as Map<String, dynamic>))
        .toList();
  }

  /// GET /delivery/history — finished deliveries (Delivered/Failed).
  Future<List<DeliverySummary>> history() async {
    final data = await api.get('/delivery/history') as Map<String, dynamic>;
    return ((data['deliveries'] as List?) ?? const [])
        .map((e) => DeliverySummary.fromJson(e as Map<String, dynamic>))
        .toList();
  }

  /// GET /delivery/availability — the courier's current online/offline status.
  Future<bool> getAvailability() async {
    final data = await api.get('/delivery/availability') as Map<String, dynamic>;
    return data['available'] == true;
  }

  /// PATCH /delivery/availability — go online (on-duty) or offline. Only online
  /// couriers are auto-assigned new deliveries.
  Future<bool> setAvailability(bool available) async {
    final data = await api.patch('/delivery/availability', {'available': available}) as Map<String, dynamic>;
    return data['available'] == true;
  }

  /// GET /deliveries/{id} — full detail.
  Future<DeliveryDetail> detail(String deliveryId) async {
    final data = await api.get('/deliveries/$deliveryId') as Map<String, dynamic>;
    return DeliveryDetail.fromJson(data);
  }

  /// PATCH /deliveries/{id}/status — Assigned→PickedUp→OutForDelivery (→Failed).
  Future<String> updateStatus(String deliveryId, String status) async {
    final data = await api.patch('/deliveries/$deliveryId/status', {'status': status}) as Map<String, dynamic>;
    return data['deliveryStatus']?.toString() ?? status;
  }

  /// POST /deliveries/{id}/verify-otp — confirm delivery with the customer's OTP
  /// AND a proof-of-delivery photo, sent together in one multipart request. Both
  /// are required: a parcel can't be marked Delivered without each.
  Future<void> verifyOtp(String deliveryId, String otp, File photo) async {
    await api.postMultipart('/deliveries/$deliveryId/verify-otp', {'otpCode': otp}, file: photo);
  }

  /// POST /deliveries/{id}/report-issue — structured reason (+ optional note/photo).
  Future<void> reportIssue(String deliveryId, String reason, {String? note, File? photo}) async {
    await api.postMultipart('/deliveries/$deliveryId/report-issue', {
      'reason': reason,
      if (note != null && note.trim().isNotEmpty) 'note': note.trim(),
    }, file: photo);
  }
}

/// The reasons a courier can report, shared by the report-issue UI.
/// (value sent to the API, label shown to the courier)
const deliveryIssueReasons = <(String, String)>[
  ('customer_unreachable', 'Customer unreachable'),
  ('customer_unavailable', 'Customer not available'),
  ('customer_refused', 'Customer refused delivery'),
  ('wrong_address', 'Wrong / incomplete address'),
  ('package_damaged', 'Package damaged or missing'),
  ('vehicle_emergency', 'Vehicle breakdown / emergency'),
  ('other', 'Other'),
];
