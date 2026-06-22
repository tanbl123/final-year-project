/// One in-app notification (the bell list). Mirrors the backend `notification`
/// row returned by GET /notifications.
class AppNotification {
  final String id;
  final String type; // 'order' | 'refund' | 'system'
  final String title;
  final String body;
  final String? orderId; // deep-link target, when present
  final bool isRead;
  final DateTime? createdAt;

  AppNotification({
    required this.id,
    required this.type,
    required this.title,
    required this.body,
    required this.orderId,
    required this.isRead,
    required this.createdAt,
  });

  factory AppNotification.fromJson(Map<String, dynamic> j) => AppNotification(
        id: j['notificationId']?.toString() ?? '',
        type: j['type']?.toString() ?? 'system',
        title: j['title']?.toString() ?? '',
        body: j['body']?.toString() ?? '',
        orderId: (j['orderId'] as String?)?.isNotEmpty == true ? j['orderId'] as String : null,
        isRead: j['isRead'] == true,
        createdAt: DateTime.tryParse(j['createdAt']?.toString() ?? ''),
      );
}
