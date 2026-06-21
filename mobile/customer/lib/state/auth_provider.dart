import 'dart:convert';
import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../api/api_client.dart';
import '../models/user_session.dart';
import '../services/auth_service.dart';

/// Holds the signed-in session and persists it across launches.
///
/// Note: this is the CUSTOMER app, so only Customer accounts may sign in.
/// (The token is stored in shared_preferences for simplicity — fine for a
/// demo; a production app would use secure storage.)
class AuthProvider extends ChangeNotifier {
  final ApiClient api;
  final AuthService authService;

  UserSession? _session;
  UserSession? get session => _session;
  bool get isLoggedIn => _session != null;
  AuthUser? get user => _session?.user;

  AuthProvider({required this.api, required this.authService});

  static const _kToken = 'token';
  static const _kUser = 'user';

  /// Restore a saved session (call once at startup).
  Future<void> loadFromStorage() async {
    final prefs = await SharedPreferences.getInstance();
    final token = prefs.getString(_kToken);
    final userJson = prefs.getString(_kUser);
    if (token != null && userJson != null) {
      _session = UserSession(
        token: token,
        user: AuthUser.fromJson(jsonDecode(userJson) as Map<String, dynamic>),
      );
      api.setToken(token);
      notifyListeners();
    }
  }

  /// Log in and persist the session. Throws [ApiException] on failure.
  Future<void> login(String identifier, String password) async {
    final session = await authService.login(identifier, password);
    if (session.user.role != 'Customer') {
      throw ApiException('Please sign in with a customer account.');
    }
    _session = session;
    api.setToken(session.token);
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_kToken, session.token);
    await prefs.setString(_kUser, jsonEncode(session.user.toJson()));
    notifyListeners();
  }

  Future<void> logout() async {
    _session = null;
    api.setToken(null);
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove(_kToken);
    await prefs.remove(_kUser);
    notifyListeners();
  }
}
