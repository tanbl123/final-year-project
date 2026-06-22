import 'dart:convert';
import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:delivery/core/api/api_client.dart';
import 'package:delivery/features/auth/models/courier_session.dart';
import 'package:delivery/features/auth/services/auth_service.dart';

/// Holds the signed-in courier session and persists it across launches.
///
/// This is the DELIVERY app, so only DeliveryPersonnel accounts may sign in.
class AuthProvider extends ChangeNotifier {
  final ApiClient api;
  final AuthService authService;

  CourierSession? _session;
  CourierSession? get session => _session;
  bool get isLoggedIn => _session != null;
  CourierUser? get user => _session?.user;

  AuthProvider({required this.api, required this.authService});

  static const _kToken = 'token';
  static const _kUser = 'user';

  /// Restore a saved session (call once at startup).
  Future<void> loadFromStorage() async {
    final prefs = await SharedPreferences.getInstance();
    final token = prefs.getString(_kToken);
    final userJson = prefs.getString(_kUser);
    if (token != null && userJson != null) {
      _session = CourierSession(
        token: token,
        user: CourierUser.fromJson(jsonDecode(userJson) as Map<String, dynamic>),
      );
      api.setToken(token);
      notifyListeners();
    }
  }

  /// Log in and persist the session. Throws [ApiException] on failure.
  Future<void> login(String identifier, String password) async {
    final session = await authService.login(identifier, password);
    if (session.user.role != 'DeliveryPersonnel') {
      throw ApiException('Please sign in with a delivery personnel account.');
    }
    _session = session;
    api.setToken(session.token);
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_kToken, session.token);
    await prefs.setString(_kUser, jsonEncode(session.user.toJson()));
    notifyListeners();
  }

  /// Update the cached display name after a profile edit (keeps the UI in sync).
  Future<void> applyProfile({required String fullName}) async {
    final s = _session;
    if (s == null) return;
    _session = CourierSession(
      token: s.token,
      user: CourierUser(userId: s.user.userId, role: s.user.role, fullName: fullName, status: s.user.status),
    );
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_kUser, jsonEncode(_session!.user.toJson()));
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
