import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import 'package:customer/core/api/api_client.dart';
import 'package:customer/features/auth/services/account_service.dart';
import 'package:customer/features/auth/services/auth_service.dart';
import 'package:customer/features/catalog/services/catalog_service.dart';
import 'package:customer/features/catalog/services/recommendation_service.dart';
import 'package:customer/features/cart/services/cart_service.dart';
import 'package:customer/features/order/services/order_service.dart';
import 'package:customer/features/review/services/review_service.dart';
import 'package:customer/features/wishlist/services/wishlist_service.dart';
import 'package:customer/features/notification/services/notification_service.dart';
import 'package:customer/features/notification/services/push_service.dart';
import 'package:customer/features/auth/state/auth_provider.dart';
import 'package:customer/features/cart/state/cart_provider.dart';
import 'package:customer/features/wishlist/state/wishlist_provider.dart';
import 'package:customer/features/notification/state/notification_provider.dart';
import 'package:customer/features/shell/main_shell.dart';

void main() async {
  WidgetsFlutterBinding.ensureInitialized();
  // NOTE: the Camera Kit lens cache is no longer cleared here on every launch (that
  // re-downloaded the lens + images each session). It's now cleared lazily — only
  // when the AR try-on opens a lens id we haven't cached before (a new/changed lens)
  // — see ArTryOnService.open(). Normal launches stay fast.
  final api = ApiClient();
  final authProvider = AuthProvider(api: api, authService: AuthService(api))
    ..loadFromStorage();

  // best-effort FCM init (no-op if Firebase isn't configured on this build)
  final pushService = PushService(NotificationService(api));
  await pushService.init();

  runApp(ShoeArApp(api: api, authProvider: authProvider, pushService: pushService));
}

class ShoeArApp extends StatelessWidget {
  final ApiClient api;
  final AuthProvider authProvider;
  final PushService pushService;
  const ShoeArApp({super.key, required this.api, required this.authProvider, required this.pushService});

  @override
  Widget build(BuildContext context) {
    return MultiProvider(
      providers: [
        ChangeNotifierProvider<AuthProvider>.value(value: authProvider),
        Provider<CatalogService>.value(value: CatalogService(api)),
        Provider<RecommendationService>.value(value: RecommendationService(api)),
        Provider<AccountService>.value(value: AccountService(api)),
        Provider<OrderService>.value(value: OrderService(api)),
        Provider<ReviewService>.value(value: ReviewService(api)),
        // the cart loads on login and clears on logout (driven by AuthProvider)
        ChangeNotifierProxyProvider<AuthProvider, CartProvider>(
          create: (_) => CartProvider(CartService(api)),
          update: (_, auth, cart) => cart!..syncWithAuth(auth.isLoggedIn),
        ),
        ChangeNotifierProxyProvider<AuthProvider, WishlistProvider>(
          create: (_) => WishlistProvider(WishlistService(api)),
          update: (_, auth, wl) => wl!..syncWithAuth(auth.isLoggedIn),
        ),
        // notifications load on login and clear on logout, like cart/wishlist;
        // also registers this device for FCM push on login (via PushService)
        ChangeNotifierProxyProvider<AuthProvider, NotificationProvider>(
          create: (_) => NotificationProvider(NotificationService(api), pushService),
          update: (_, auth, notif) => notif!..syncWithAuth(auth.isLoggedIn),
        ),
      ],
      child: MaterialApp(
        title: 'ShoeAR',
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
