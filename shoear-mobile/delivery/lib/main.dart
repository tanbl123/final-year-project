import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import 'package:delivery/core/api/api_client.dart';
import 'package:delivery/features/auth/services/auth_service.dart';
import 'package:delivery/features/auth/services/account_service.dart';
import 'package:delivery/features/auth/state/auth_provider.dart';
import 'package:delivery/features/delivery/services/delivery_service.dart';
import 'package:delivery/features/earnings/services/earnings_service.dart';
import 'package:delivery/features/notification/services/notification_service.dart';
import 'package:delivery/features/notification/services/push_service.dart';
import 'package:delivery/features/notification/state/notification_provider.dart';
import 'package:delivery/features/shell/main_shell.dart';

void main() async {
  WidgetsFlutterBinding.ensureInitialized();
  final api = ApiClient();
  final authProvider = AuthProvider(api: api, authService: AuthService(api))
    ..loadFromStorage();

  // best-effort FCM init (no-op if Firebase isn't configured on this build)
  final pushService = PushService(NotificationService(api));
  await pushService.init();

  runApp(CourierApp(api: api, authProvider: authProvider, pushService: pushService));
}

class CourierApp extends StatelessWidget {
  final ApiClient api;
  final AuthProvider authProvider;
  final PushService pushService;
  const CourierApp({super.key, required this.api, required this.authProvider, required this.pushService});

  @override
  Widget build(BuildContext context) {
    return MultiProvider(
      providers: [
        ChangeNotifierProvider<AuthProvider>.value(value: authProvider),
        Provider<DeliveryService>.value(value: DeliveryService(api)),
        Provider<AccountService>.value(value: AccountService(api)),
        Provider<EarningsService>.value(value: EarningsService(api)),
        // in-app notification bell + FCM registration: loads on login, clears
        // on logout, registers this device's push token on login, and refreshes
        // when a foreground push arrives (via pushService.onMessageCallback).
        // NOTE: registration lives here (not in a PushService proxy) because
        // this provider is actually read by the bell — a lazy PushService proxy
        // that nothing reads would never fire.
        ChangeNotifierProxyProvider<AuthProvider, NotificationProvider>(
          create: (_) => NotificationProvider(NotificationService(api), pushService),
          update: (_, auth, notif) => notif!..syncWithAuth(auth.isLoggedIn),
        ),
      ],
      child: MaterialApp(
        title: 'ShoeAR Express',
        debugShowCheckedModeBanner: false,
        theme: ThemeData(
          colorScheme: ColorScheme.fromSeed(seedColor: const Color(0xFF4F46E5)),
          useMaterial3: true,
        ),
        home: const MainShell(),
      ),
    );
  }
}
