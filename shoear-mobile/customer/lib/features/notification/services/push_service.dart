import 'package:flutter/material.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';

import 'package:customer/firebase_options.dart';
import 'package:customer/core/utils/refresh_bus.dart';
import 'package:customer/features/notification/services/notification_service.dart';
import 'package:customer/features/catalog/screens/product_detail_screen.dart';
import 'package:customer/features/order/screens/order_detail_screen.dart';

/// App-wide navigator, so a push tap can navigate without a BuildContext.
/// Wired to MaterialApp.navigatorKey in main.dart.
final navigatorKey = GlobalKey<NavigatorState>();

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
      // foreground we refresh the bell AND signal order screens to re-fetch
      // (a push usually means a status changed).
      FirebaseMessaging.onMessage.listen((_) {
        onMessageCallback?.call();
        bumpRefresh();
      });
      // Tapped a push while the app was backgrounded → refresh + deep-link.
      FirebaseMessaging.onMessageOpenedApp.listen((message) {
        onMessageCallback?.call();
        bumpRefresh();
        _openFromData(message.data);
      });
      // Tapped a push that launched the app from terminated → navigate once the
      // first frame is up (the navigator doesn't exist yet during init()).
      final initial = await FirebaseMessaging.instance.getInitialMessage();
      if (initial != null) {
        WidgetsBinding.instance.addPostFrameCallback((_) => _openFromData(initial.data));
      }
    } catch (_) {
      _available = false; // Firebase not configured on this build → no push
    }
  }

  // Deep-link from a push's data payload (set by the backend fcmSend).
  void _openFromData(Map<String, dynamic> data) {
    final nav = navigatorKey.currentState;
    if (nav == null) return;
    final type = data['type']?.toString();
    if (type == 'product' && (data['productId']?.toString().isNotEmpty ?? false)) {
      nav.push(MaterialPageRoute(builder: (_) => ProductDetailScreen(productId: data['productId'].toString())));
    } else if (type == 'order' && (data['orderId']?.toString().isNotEmpty ?? false)) {
      nav.push(MaterialPageRoute(builder: (_) => OrderDetailScreen(orderId: data['orderId'].toString())));
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
