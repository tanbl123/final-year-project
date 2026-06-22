import 'dart:io';

import 'package:delivery/core/api/api_client.dart';

/// Courier account: view/update own profile, change password, profile photo.
class AccountService {
  final ApiClient api;
  AccountService(this.api);

  /// GET /auth/me — full profile (incl. delivery_personnel block w/ vehicleInfo).
  Future<Map<String, dynamic>> me() async => await api.get('/auth/me') as Map<String, dynamic>;

  /// PUT /auth/me — update editable fields (+ vehicle info for couriers).
  Future<void> updateProfile({
    required String fullName,
    required String phoneNumber,
    required String username,
    String? vehicleInfo,
  }) async {
    await api.put('/auth/me', {
      'fullName': fullName,
      'phoneNumber': phoneNumber,
      'username': username,
      if (vehicleInfo != null) 'vehicleInfo': vehicleInfo,
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
