import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';

import 'package:customer/firebase_options.dart';
import 'package:customer/features/notification/services/notification_service.dart';

/// Firebase Cloud Messaging client (background push).
///
/// Best-effort + graceful: if Firebase isn't configured on this build (no
/// google-services.json / GoogleService-Info.plist), [init] catches the error
/// and every method becomes a no-op — the app and the in-app notification
/// centre keep working without push.
class PushService {
  final NotificationService _notifications;
  bool _available = false;

  /// Called when a push arrives while the app is foregrounded — wired to
  /// refresh the in-app bell so the badge stays in sync.
  void Function()? onMessageCallback;

  PushService(this._notifications);

  bool get available => _available;

  /// Initialise Firebase once at startup. Safe to call without Firebase set up.
  Future<void> init() async {
    try {
      await Firebase.initializeApp(options: DefaultFirebaseOptions.currentPlatform);
      _available = true;
      // FCM shows tray notifications itself when the app is backgrounded; in the
      // foreground we just refresh the bell.
      FirebaseMessaging.onMessage.listen((_) => onMessageCallback?.call());
      FirebaseMessaging.onMessageOpenedApp.listen((_) => onMessageCallback?.call());
    } catch (_) {
      _available = false; // Firebase not configured on this build → no push
    }
  }

  /// Register this device's FCM token for the signed-in user. Call after login.
  Future<void> registerDevice() async {
    if (!_available) return;
    try {
      final messaging = FirebaseMessaging.instance;
      await messaging.requestPermission();
      final token = await messaging.getToken();
      if (token != null && token.isNotEmpty) {
        await _notifications.registerDevice(token);
      }
      // keep the backend in sync if the token rotates
      messaging.onTokenRefresh.listen((t) {
        if (t.isNotEmpty) _notifications.registerDevice(t);
      });
    } catch (_) {
      // best-effort — never block login on push registration
    }
  }
}
