import '../api/api_client.dart';

/// Account: customer sign-up (public) and profile/password/delete (token).
class AccountService {
  final ApiClient api;
  AccountService(this.api);

  /// POST /auth/register/customer — create a customer account (Active at once).
  Future<void> registerCustomer({
    required String username,
    required String email,
    required String password,
    required String fullName,
    required String phoneNumber,
    String? shippingAddress,
  }) async {
    await api.post('/auth/register/customer', {
      'username': username,
      'email': email,
      'password': password,
      'fullName': fullName,
      'phoneNumber': phoneNumber,
      if (shippingAddress != null && shippingAddress.isNotEmpty) 'shippingAddress': shippingAddress,
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

  /// DELETE /auth/me — close the account (soft-delete server-side).
  Future<void> deleteAccount() async {
    await api.delete('/auth/me');
  }
}
