import 'package:customer/core/api/api_client.dart';

/// Public (no auth) suspension-appeal calls, reached from the suspended-login
/// error which carries the appeal uid + token.
class AppealService {
  final ApiClient api;
  AppealService(this.api);

  /// GET /appeal — the suspension reason + whether an appeal is already open.
  Future<Map<String, dynamic>> context(String uid, String token) async {
    final data = await api.get('/appeal', query: {'uid': uid, 'token': token});
    return (data as Map).cast<String, dynamic>();
  }

  /// POST /appeal — submit the appeal.
  Future<void> submit(String uid, String token, String message) async {
    await api.post('/appeal', {'uid': uid, 'token': token, 'message': message});
  }
}
