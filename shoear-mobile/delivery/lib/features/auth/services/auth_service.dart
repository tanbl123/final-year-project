import 'dart:io';

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

  /// POST /auth/register/send-code — email a 6-digit verification code to the
  /// address the courier is about to register with.
  Future<void> sendRegisterCode(String email) async {
    await api.post('/auth/register/send-code', {'email': email});
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
    required String verificationCode,
    required String licenseNumber,
    required String licensePhotoUrl,
    required String icNumber,
    required String icPhotoUrl,
    required String avatarUrl,
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
      'verificationCode': verificationCode,
      'licenseNumber': licenseNumber,
      'licensePhotoUrl': licensePhotoUrl,
      'icNumber': icNumber,
      'icPhotoUrl': icPhotoUrl,
      'avatarUrl': avatarUrl,
    });
    return (data as Map<String, dynamic>)['message']?.toString() ??
        'Registration submitted. Your account is pending admin approval.';
  }

  /// POST /uploads/registration-doc — public (pre-login) upload for the courier's
  /// licence / IC / profile photo during registration. Returns the stored URL.
  Future<String> uploadRegistrationDoc(File file) async {
    final data = await api.uploadFile('/uploads/registration-doc', file) as Map<String, dynamic>;
    return data['url']?.toString() ?? '';
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
