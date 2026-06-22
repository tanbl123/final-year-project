import 'package:delivery/core/api/api_client.dart';
import 'package:delivery/features/auth/models/courier_session.dart';

/// Authentication calls against the PHP API.
class AuthService {
  final ApiClient api;
  AuthService(this.api);

  /// POST /auth/login — [identifier] may be an email or a username.
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
    required String username,
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
      'username': username,
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
}
