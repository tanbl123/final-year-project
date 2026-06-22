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

  /// POST /deliveries/{id}/verify-otp — confirm delivery with the customer's OTP.
  Future<void> verifyOtp(String deliveryId, String otp) async {
    await api.post('/deliveries/$deliveryId/verify-otp', {'otpCode': otp});
  }

  /// POST /deliveries/{id}/proof — multipart upload of the proof photo.
  Future<String> uploadProof(String deliveryId, File photo) async {
    final data = await api.uploadFile('/deliveries/$deliveryId/proof', photo) as Map<String, dynamic>;
    return data['proofOfDelivery']?.toString() ?? '';
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
