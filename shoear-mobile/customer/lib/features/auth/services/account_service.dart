import 'dart:io';

import 'package:customer/core/api/api_client.dart';

/// Account: customer sign-up (public) and profile/password/delete (token).
class AccountService {
  final ApiClient api;
  AccountService(this.api);

  /// POST /auth/me/avatar — upload a new profile picture, returns its URL.
  Future<String> uploadAvatar(File photo) async {
    final data = await api.uploadFile('/auth/me/avatar', photo) as Map<String, dynamic>;
    return data['avatarUrl']?.toString() ?? '';
  }

  /// DELETE /auth/me/avatar — remove the profile picture (back to initials).
  Future<void> removeAvatar() async {
    await api.delete('/auth/me/avatar');
  }

  /// POST /auth/register/send-code — email a 6-digit verification code to the
  /// address the customer is about to register with.
  Future<void> sendRegisterCode(String email) async {
    await api.post('/auth/register/send-code', {'email': email});
  }

  /// POST /auth/register/customer — create a customer account (Active at once).
  Future<void> registerCustomer({
    required String username,
    required String email,
    required String password,
    required String verificationCode,
  }) async {
    await api.post('/auth/register/customer', {
      'username': username,
      'email': email,
      'password': password,
      'verificationCode': verificationCode,
    });
  }

  /// GET /auth/me — full profile (incl. role-specific profile block).
  Future<Map<String, dynamic>> me() async => await api.get('/auth/me') as Map<String, dynamic>;

  /// PUT /auth/me — update editable profile fields (+ shipping address).
  Future<void> updateProfile({
    required String fullName,
    required String phoneNumber,
    required String username,
    String? shippingAddress,
  }) async {
    await api.put('/auth/me', {
      'fullName': fullName,
      'phoneNumber': phoneNumber,
      'username': username,
      if (shippingAddress != null) 'shippingAddress': shippingAddress,
    });
  }

  /// POST /auth/change-password
  Future<void> changePassword(String current, String next) async {
    await api.post('/auth/change-password', {'currentPassword': current, 'newPassword': next});
  }

  /// PATCH /auth/me/phone — set or update the phone number. Used at checkout
  /// for Google Sign-In users who haven't provided a phone number yet.
  Future<void> updatePhone(String phoneNumber) async {
    await api.patch('/auth/me/phone', {'phoneNumber': phoneNumber});
  }

  /// PATCH /auth/me/name — update the customer's display name. Used at checkout
  /// so email-registered customers (whose fullName defaults to their username)
  /// can provide their real name before placing an order.
  Future<void> updateFullName(String fullName) async {
    await api.patch('/auth/me/name', {'fullName': fullName});
  }

  /// DELETE /auth/me — close the account (soft-delete server-side).
  Future<void> deleteAccount() async {
    await api.delete('/auth/me');
  }

  /// POST /auth/forgot-password — email a 6-digit reset code (public).
  Future<void> forgotPassword(String email) async {
    await api.post('/auth/forgot-password', {'email': email});
  }

  /// POST /auth/reset-password/verify-code — check the code without consuming it.
  Future<void> verifyResetCode(String email, String code) async {
    await api.post('/auth/reset-password/verify-code', {'email': email, 'code': code});
  }

  /// POST /auth/reset-password — verify the code and set a new password.
  Future<void> resetPassword(String email, String code, String newPassword) async {
    await api.post('/auth/reset-password', {'email': email, 'code': code, 'newPassword': newPassword});
  }
}
