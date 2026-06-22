import 'package:flutter/foundation.dart';

import 'package:customer/features/notification/models/app_notification.dart';
import 'package:customer/features/notification/services/notification_service.dart';

/// Holds the customer's notifications + unread count for the bell badge.
/// Loads on login and clears on logout (driven by [syncWithAuth]), same as the
/// cart/wishlist providers.
class NotificationProvider extends ChangeNotifier {
  final NotificationService _service;
  NotificationProvider(this._service);

  List<AppNotification> _items = [];
  List<AppNotification> get items => _items;

  int _unread = 0;
  int get unread => _unread;

  bool _loading = false;
  bool get loading => _loading;
  String? error;

  bool? _wasLoggedIn;

  void syncWithAuth(bool loggedIn) {
    if (_wasLoggedIn == loggedIn) return;
    _wasLoggedIn = loggedIn;
    if (loggedIn) {
      Future.microtask(refresh);
    } else {
      _items = [];
      _unread = 0;
      error = null;
      Future.microtask(notifyListeners);
    }
  }

  Future<void> refresh() async {
    _loading = true;
    error = null;
    notifyListeners();
    try {
      final res = await _service.list();
      _items = res.items;
      _unread = res.unread;
    } catch (e) {
      error = e.toString();
    } finally {
      _loading = false;
      notifyListeners();
    }
  }

  Future<void> markRead(String id) async {
    final i = _items.indexWhere((n) => n.id == id);
    if (i == -1 || _items[i].isRead) return;
    // optimistic
    _items[i] = AppNotification(
      id: _items[i].id,
      type: _items[i].type,
      title: _items[i].title,
      body: _items[i].body,
      orderId: _items[i].orderId,
      isRead: true,
      createdAt: _items[i].createdAt,
    );
    if (_unread > 0) _unread--;
    notifyListeners();
    try {
      await _service.markRead(id);
    } catch (_) {
      // best-effort; a later refresh reconciles
    }
  }

  Future<void> markAllRead() async {
    if (_unread == 0) return;
    _items = [for (final n in _items) if (n.isRead) n else _copyRead(n)];
    _unread = 0;
    notifyListeners();
    try {
      await _service.markAllRead();
    } catch (_) {}
  }

  AppNotification _copyRead(AppNotification n) => AppNotification(
        id: n.id,
        type: n.type,
        title: n.title,
        body: n.body,
        orderId: n.orderId,
        isRead: true,
        createdAt: n.createdAt,
      );
}
