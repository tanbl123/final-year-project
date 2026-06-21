/// The signed-in user's basic profile (from POST /auth/login).
class AuthUser {
  final String userId;
  final String role;
  final String fullName;
  final String status;

  AuthUser({
    required this.userId,
    required this.role,
    required this.fullName,
    required this.status,
  });

  factory AuthUser.fromJson(Map<String, dynamic> j) => AuthUser(
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
class UserSession {
  final String token;
  final AuthUser user;

  UserSession({required this.token, required this.user});

  factory UserSession.fromJson(Map<String, dynamic> j) => UserSession(
        token: j['token'] as String,
        user: AuthUser.fromJson(j['user'] as Map<String, dynamic>),
      );
}
