import 'dart:io';

import 'package:delivery/core/api/api_client.dart';

/// Courier account: view/update own profile, change password, profile photo.
class AccountService {
  final ApiClient api;
  AccountService(this.api);

  /// GET /auth/me — full profile (incl. delivery_personnel block w/ vehicle fields).
  Future<Map<String, dynamic>> me() async => await api.get('/auth/me') as Map<String, dynamic>;

  /// PUT /auth/me — update editable fields (+ vehicle details for couriers).
  Future<void> updateProfile({
    required String fullName,
    required String phoneNumber,
    required String username,
    String? vehicleType,
    String? vehicleBrand,
    String? vehicleModel,
    List<String>? coverageZones,
  }) async {
    await api.put('/auth/me', {
      'fullName': fullName,
      'phoneNumber': phoneNumber,
      'username': username,
      if (vehicleType  != null) 'vehicleType':  vehicleType,
      if (vehicleBrand != null) 'vehicleBrand': vehicleBrand,
      if (vehicleModel != null) 'vehicleModel': vehicleModel,
      if (coverageZones != null) 'coverageZones': coverageZones,
    });
  }

  /// GET /courier/verification — current plate + licence (verified fields) and
  /// the latest change request (Pending banner / Rejected reason).
  Future<Map<String, dynamic>> verification() async =>
      await api.get('/courier/verification') as Map<String, dynamic>;

  /// POST /courier/verification/change-request — propose new plate/licence
  /// values for admin re-approval. The account stays active while pending.
  Future<void> submitVerificationChange({
    required String vehiclePlate,
    required String licenseNumber,
    required List<String> licenseClasses,
    required String licenseExpiry,   // YYYY-MM-DD
    required String licensePhotoUrl,
  }) async {
    await api.post('/courier/verification/change-request', {
      'vehiclePlate': vehiclePlate,
      'licenseNumber': licenseNumber,
      'licenseClass': licenseClasses,
      'licenseExpiry': licenseExpiry,
      'licensePhotoUrl': licensePhotoUrl,
    });
  }

  /// POST /auth/change-password
  Future<void> changePassword(String current, String next) async {
    await api.post('/auth/change-password', {'currentPassword': current, 'newPassword': next});
  }

  /// POST /auth/me/avatar — upload/replace the profile picture, returns its URL.
  Future<String> uploadAvatar(File photo) async {
    final data = await api.uploadFile('/auth/me/avatar', photo) as Map<String, dynamic>;
    return data['avatarUrl']?.toString() ?? '';
  }

  /// DELETE /auth/me/avatar — remove the profile picture (back to initials).
  Future<void> removeAvatar() async {
    await api.delete('/auth/me/avatar');
  }
}
