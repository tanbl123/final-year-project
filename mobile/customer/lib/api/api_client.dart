import 'dart:convert';
import 'package:http/http.dart' as http;
import '../config.dart';

/// Thrown when the API returns an error envelope or an unexpected response.
class ApiException implements Exception {
  final String message;
  final int? statusCode;
  final String? code;
  ApiException(this.message, {this.statusCode, this.code});
  @override
  String toString() => message;
}

/// Thin HTTP wrapper around the PHP API. Mirrors the web client: every response
/// is the envelope { success, data, error }, so we unwrap `data` on success and
/// throw [ApiException] with the server's message otherwise.
class ApiClient {
  final String baseUrl;
  String? _token;

  ApiClient({this.baseUrl = apiBaseUrl});

  /// Attach (or clear) the JWT sent as `Authorization: Bearer <token>`.
  void setToken(String? token) => _token = token;

  Map<String, String> _headers({bool json = false}) {
    final h = <String, String>{};
    if (json) h['Content-Type'] = 'application/json';
    if (_token != null) h['Authorization'] = 'Bearer $_token';
    return h;
  }

  Future<dynamic> get(String path, {Map<String, String>? query}) async {
    var uri = Uri.parse('$baseUrl$path');
    if (query != null && query.isNotEmpty) uri = uri.replace(queryParameters: query);
    final res = await http.get(uri, headers: _headers());
    return _unwrap(res);
  }

  Future<dynamic> post(String path, Map<String, dynamic> body) async {
    final uri = Uri.parse('$baseUrl$path');
    final res = await http.post(uri, headers: _headers(json: true), body: jsonEncode(body));
    return _unwrap(res);
  }

  dynamic _unwrap(http.Response res) {
    dynamic json;
    try {
      json = jsonDecode(res.body);
    } catch (_) {
      throw ApiException('Server did not return valid JSON.', statusCode: res.statusCode);
    }
    if (json is! Map || json['success'] != true) {
      final err = (json is Map) ? json['error'] : null;
      throw ApiException(
        (err is Map ? err['message'] as String? : null) ?? 'Request failed.',
        statusCode: res.statusCode,
        code: err is Map ? err['code'] as String? : null,
      );
    }
    return json['data'];
  }
}
