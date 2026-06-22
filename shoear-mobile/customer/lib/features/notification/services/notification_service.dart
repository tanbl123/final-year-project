import 'package:customer/core/api/api_client.dart';
import 'package:customer/features/notification/models/app_notification.dart';

/// Reads/acks the customer's in-app notifications and registers the device's
/// push token. All calls require a logged-in token (set on the [ApiClient]).
class NotificationService {
  final ApiClient api;
  NotificationService(this.api);

  /// GET /notifications → (list, unreadCount).
  Future<({List<AppNotification> items, int unread})> list() async {
    final data = await api.get('/notifications') as Map<String, dynamic>;
    final raw = (data['notifications'] as List?) ?? const [];
    final items = raw.map((e) => AppNotification.fromJson(e as Map<String, dynamic>)).toList();
    return (items: items, unread: (data['unreadCount'] as num?)?.toInt() ?? 0);
  }

  /// PATCH /notifications/{id}/read
  Future<void> markRead(String id) async => api.patch('/notifications/$id/read', const {});

  /// POST /notifications/read-all
  Future<void> markAllRead() async => api.post('/notifications/read-all', const {});

  /// POST /notifications/device — register an FCM token for background push.
  /// Called once push is wired up on the client (see README).
  Future<void> registerDevice(String token, {String platform = 'android'}) async =>
      api.post('/notifications/device', {'token': token, 'platform': platform});
}
