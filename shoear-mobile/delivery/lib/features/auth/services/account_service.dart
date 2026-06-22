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
    String? vehiclePlate,
  }) async {
    await api.put('/auth/me', {
      'fullName': fullName,
      'phoneNumber': phoneNumber,
      'username': username,
      if (vehicleType  != null) 'vehicleType':  vehicleType,
      if (vehicleBrand != null) 'vehicleBrand': vehicleBrand,
      if (vehicleModel != null) 'vehicleModel': vehicleModel,
      if (vehiclePlate != null) 'vehiclePlate': vehiclePlate,
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
