import 'package:delivery/core/api/api_client.dart';
import 'package:delivery/features/auth/models/courier_session.dart';

/// Authentication calls against the PHP API.
class AuthService {
  final ApiClient api;
  AuthService(this.api);

  /// POST /auth/login — [identifier] is the courier's email.
  Future<CourierSession> login(String identifier, String password) async {
    final data = await api.post('/auth/login', {
      'identifier': identifier,
      'password': password,
    });
    return CourierSession.fromJson(data as Map<String, dynamic>);
  }

  /// POST /auth/register/courier — self-apply as a courier. The account is
  /// created as Pending (awaiting admin approval), so there's no auto-login;
  /// returns the server's confirmation message.
  Future<String> registerCourier({
    required String fullName,
    required String email,
    required String phoneNumber,
    required String vehicleType,
    required String vehicleBrand,
    required String vehicleModel,
    required String vehiclePlate,
    required String password,
  }) async {
    final data = await api.post('/auth/register/courier', {
      'fullName': fullName,
      'email': email,
      'phoneNumber': phoneNumber,
      'vehicleType':  vehicleType,
      'vehicleBrand': vehicleBrand,
      'vehicleModel': vehicleModel,
      'vehiclePlate': vehiclePlate,
      'password': password,
    });
    return (data as Map<String, dynamic>)['message']?.toString() ??
        'Registration submitted. Your account is pending admin approval.';
  }

  /// POST /auth/forgot-password — email a 6-digit reset code.
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
