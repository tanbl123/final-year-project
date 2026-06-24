import 'package:customer/core/api/api_client.dart';
import 'package:customer/features/auth/models/user_session.dart';

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

  /// POST /auth/google — verify a Google ID token server-side and return a session.
  /// The token is obtained via the google_sign_in package. On success the backend
  /// links (or creates) a Customer account and issues a JWT.
  Future<UserSession> googleAuth(String idToken) async {
    final data = await api.post('/auth/google', {'idToken': idToken});
    return UserSession.fromJson(data as Map<String, dynamic>);
  }
}
