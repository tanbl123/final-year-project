import 'package:delivery/core/api/api_client.dart';
import 'package:delivery/features/notification/models/app_notification.dart';

/// Reads/acks the courier's in-app notifications and registers the device's
/// FCM push token. All calls require a logged-in token (set on the [ApiClient]).
class NotificationService {
  final ApiClient _api;
  NotificationService(this._api);

  /// GET /notifications → (list, unreadCount).
  Future<({List<AppNotification> items, int unread})> list() async {
    final data = await _api.get('/notifications') as Map<String, dynamic>;
    final raw = (data['notifications'] as List?) ?? const [];
    final items = raw.map((e) => AppNotification.fromJson(e as Map<String, dynamic>)).toList();
    return (items: items, unread: (data['unreadCount'] as num?)?.toInt() ?? 0);
  }

  /// PATCH /notifications/{id}/read
  Future<void> markRead(String id) => _api.patch('/notifications/$id/read', const {});

  /// POST /notifications/read-all
  Future<void> markAllRead() => _api.post('/notifications/read-all', const {});

  /// POST /notifications/device — register this device's FCM token so the
  /// server can send push notifications to this courier.
  Future<void> registerDevice(String fcmToken) =>
      _api.post('/notifications/device', {'token': fcmToken});
}
