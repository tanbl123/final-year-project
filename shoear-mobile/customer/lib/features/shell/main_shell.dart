import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import 'package:customer/core/utils/refresh_bus.dart';
import 'package:customer/features/cart/state/cart_provider.dart';
import 'package:customer/features/cart/screens/cart_screen.dart';
import 'package:customer/features/catalog/screens/catalog_screen.dart';
import 'package:customer/features/order/screens/orders_screen.dart';
import 'package:customer/features/profile/screens/profile_screen.dart';
import 'package:customer/features/wishlist/screens/wishlist_screen.dart';

/// Bottom-nav tab indices, and a shared notifier so other screens (e.g. the
/// receipt's "Continue shopping" / "View order") can switch the active tab
/// after popping back to the shell.
class MainTab {
  static const home = 0;
  static const wishlist = 1;
  static const cart = 2;
  static const orders = 3;
  static const profile = 4;
}

final ValueNotifier<int> mainShellTab = ValueNotifier<int>(MainTab.home);

/// Root scaffold with a bottom navigation bar — the customer's primary
/// destinations. Tabs are kept alive in an IndexedStack so each preserves its
/// scroll position and state when switching. (Detail pages — product, checkout,
/// order detail, login — push over the bar full-screen.)
class MainShell extends StatefulWidget {
  const MainShell({super.key});

  @override
  State<MainShell> createState() => _MainShellState();
}

class _MainShellState extends State<MainShell> with WidgetsBindingObserver {
  static const _tabs = [
    CatalogScreen(),
    WishlistScreen(),
    CartScreen(),
    OrdersScreen(),
    ProfileScreen(),
  ];

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    // Returning to the foreground may mean statuses changed while away.
    if (state == AppLifecycleState.resumed) bumpRefresh();
  }

  @override
  Widget build(BuildContext context) {
    final cartCount = context.watch<CartProvider>().count;
    return ValueListenableBuilder<int>(
      valueListenable: mainShellTab,
      builder: (context, index, _) => Scaffold(
      body: IndexedStack(index: index, children: _tabs),
      bottomNavigationBar: NavigationBar(
        selectedIndex: index,
        onDestinationSelected: (i) => mainShellTab.value = i,
        destinations: [
          const NavigationDestination(icon: Icon(Icons.storefront_outlined), selectedIcon: Icon(Icons.storefront), label: 'Home'),
          const NavigationDestination(icon: Icon(Icons.favorite_border), selectedIcon: Icon(Icons.favorite), label: 'Wishlist'),
          NavigationDestination(
            icon: Badge(isLabelVisible: cartCount > 0, label: Text('$cartCount'), child: const Icon(Icons.shopping_cart_outlined)),
            selectedIcon: Badge(isLabelVisible: cartCount > 0, label: Text('$cartCount'), child: const Icon(Icons.shopping_cart)),
            label: 'Cart',
          ),
          const NavigationDestination(icon: Icon(Icons.receipt_long_outlined), selectedIcon: Icon(Icons.receipt_long), label: 'Orders'),
          const NavigationDestination(icon: Icon(Icons.person_outline), selectedIcon: Icon(Icons.person), label: 'Profile'),
        ],
      ),
      ),
    );
  }
}
