import '../api/api_client.dart';
import '../models/user_session.dart';

/// Authentication calls against the PHP API.
class AuthService {
  final ApiClient api;
  AuthService(this.api);

  /// POST /auth/login — [identifier] may be an email or a username.
  /// Returns the session (JWT + user) or throws [ApiException].
  Future<UserSession> login(String identifier, String password) async {
    final data = await api.post('/auth/login', {
      'identifier': identifier,
      'password': password,
    });
    return UserSession.fromJson(data as Map<String, dynamic>);
  }
}
