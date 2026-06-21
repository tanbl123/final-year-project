import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import 'api/api_client.dart';
import 'services/auth_service.dart';
import 'services/catalog_service.dart';
import 'services/cart_service.dart';
import 'services/order_service.dart';
import 'services/review_service.dart';
import 'services/wishlist_service.dart';
import 'state/auth_provider.dart';
import 'state/cart_provider.dart';
import 'state/wishlist_provider.dart';
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
