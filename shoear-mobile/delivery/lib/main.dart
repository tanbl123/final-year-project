import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import 'package:delivery/core/api/api_client.dart';
import 'package:delivery/features/auth/services/auth_service.dart';
import 'package:delivery/features/auth/services/account_service.dart';
import 'package:delivery/features/auth/state/auth_provider.dart';
import 'package:delivery/features/delivery/services/delivery_service.dart';
import 'package:delivery/features/shell/main_shell.dart';

void main() {
  final api = ApiClient();
  final authProvider = AuthProvider(api: api, authService: AuthService(api))
    ..loadFromStorage();

  runApp(CourierApp(api: api, authProvider: authProvider));
}

class CourierApp extends StatelessWidget {
  final ApiClient api;
  final AuthProvider authProvider;
  const CourierApp({super.key, required this.api, required this.authProvider});

  @override
  Widget build(BuildContext context) {
    return MultiProvider(
      providers: [
        ChangeNotifierProvider<AuthProvider>.value(value: authProvider),
        Provider<DeliveryService>.value(value: DeliveryService(api)),
        Provider<AccountService>.value(value: AccountService(api)),
      ],
      child: MaterialApp(
        title: 'ShoeAR Courier',
        debugShowCheckedModeBanner: false,
        theme: ThemeData(
          colorScheme: ColorScheme.fromSeed(seedColor: const Color(0xFF0F766E)),
          useMaterial3: true,
        ),
        home: const MainShell(),
      ),
    );
  }
}
