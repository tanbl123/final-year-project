import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import 'api/api_client.dart';
import 'services/auth_service.dart';
import 'services/catalog_service.dart';
import 'state/auth_provider.dart';
import 'screens/catalog_screen.dart';

void main() {
  final api = ApiClient();
  final authProvider = AuthProvider(api: api, authService: AuthService(api))
    ..loadFromStorage();

  runApp(ShoeArApp(api: api, authProvider: authProvider));
}

class ShoeArApp extends StatelessWidget {
  final ApiClient api;
  final AuthProvider authProvider;
  const ShoeArApp({super.key, required this.api, required this.authProvider});

  @override
  Widget build(BuildContext context) {
    return MultiProvider(
      providers: [
        ChangeNotifierProvider<AuthProvider>.value(value: authProvider),
        Provider<CatalogService>.value(value: CatalogService(api)),
      ],
      child: MaterialApp(
        title: 'ShoeAR',
        debugShowCheckedModeBanner: false,
        theme: ThemeData(
          colorScheme: ColorScheme.fromSeed(seedColor: const Color(0xFF4F46E5)),
          useMaterial3: true,
        ),
        home: const CatalogScreen(),
      ),
    );
  }
}
