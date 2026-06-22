/// The signed-in courier's basic profile (from POST /auth/login).
class CourierUser {
  final String userId;
  final String role;
  final String fullName;
  final String status;

  CourierUser({
    required this.userId,
    required this.role,
    required this.fullName,
    required this.status,
  });

  factory CourierUser.fromJson(Map<String, dynamic> j) => CourierUser(
        userId: j['userId'] as String? ?? '',
        role: j['role'] as String? ?? '',
        fullName: j['fullName'] as String? ?? '',
        status: j['status'] as String? ?? '',
      );

  Map<String, dynamic> toJson() => {
        'userId': userId,
        'role': role,
        'fullName': fullName,
        'status': status,
      };
}

/// A successful login: the JWT plus the user it belongs to.
class CourierSession {
  final String token;
  final CourierUser user;

  CourierSession({required this.token, required this.user});

  factory CourierSession.fromJson(Map<String, dynamic> j) => CourierSession(
        token: j['token'] as String,
        user: CourierUser.fromJson(j['user'] as Map<String, dynamic>),
      );
}
