import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/foundation.dart';

import 'package:delivery/firebase_options.dart';
import 'package:delivery/features/notification/services/notification_service.dart';

/// Firebase Cloud Messaging client for the courier app.
///
/// Best-effort + graceful: if Firebase isn't configured on this build (no
/// google-services.json), [init] catches the error and every method becomes a
/// no-op — the app keeps working without push.
class PushService extends ChangeNotifier {
  final NotificationService _notifications;
  bool _available = false;
  bool? _wasLoggedIn;

  /// Called when a push arrives (or is tapped) while the app is running — wired
  /// to refresh the in-app bell so the badge stays in sync.
  void Function()? onMessageCallback;

  PushService(this._notifications);

  bool get available => _available;

  /// Initialise Firebase once at startup. Safe to call without Firebase set up.
  Future<void> init() async {
    try {
      await Firebase.initializeApp(options: DefaultFirebaseOptions.currentPlatform);
      _available = true;
      // FCM shows tray notifications itself when backgrounded; in the foreground
      // we refresh the bell so the new notification appears immediately.
      FirebaseMessaging.onMessage.listen((_) => onMessageCallback?.call());
      FirebaseMessaging.onMessageOpenedApp.listen((_) => onMessageCallback?.call());
    } catch (_) {
      _available = false;
    }
  }

  /// Called by ChangeNotifierProxyProvider when auth state changes.
  void syncWithAuth(bool isLoggedIn) {
    if (_wasLoggedIn == isLoggedIn) return;
    _wasLoggedIn = isLoggedIn;
    if (isLoggedIn) registerDevice();
  }

  /// Register this device's FCM token for the signed-in courier.
  Future<void> registerDevice() async {
    if (!_available) return;
    try {
      final messaging = FirebaseMessaging.instance;
      await messaging.requestPermission();
      final token = await messaging.getToken();
      if (token != null && token.isNotEmpty) {
        await _notifications.registerDevice(token);
      }
      messaging.onTokenRefresh.listen((t) {
        if (t.isNotEmpty) _notifications.registerDevice(t);
      });
    } catch (_) {
      // best-effort — never block login on push registration
    }
  }
}
