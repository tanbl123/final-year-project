import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import 'package:customer/features/auth/state/auth_provider.dart';
import 'package:customer/features/wishlist/state/wishlist_provider.dart';
import 'package:customer/core/widgets/product_image.dart';
import 'package:customer/core/utils/snackbar.dart';
import 'package:customer/features/auth/screens/login_screen.dart';
import 'package:customer/features/catalog/screens/product_detail_screen.dart';

/// The customer's saved products. Tap to view; tap the heart to remove.
class WishlistScreen extends StatefulWidget {
  const WishlistScreen({super.key});

  @override
  State<WishlistScreen> createState() => _WishlistScreenState();
}

class _WishlistScreenState extends State<WishlistScreen> {
  final _scroll = ScrollController();

  @override
  void initState() {
    super.initState();
    _scroll.addListener(_onScroll);
    if (context.read<AuthProvider>().isLoggedIn) {
      WidgetsBinding.instance.addPostFrameCallback((_) => context.read<WishlistProvider>().refresh());
    }
  }

  @override
  void dispose() {
    _scroll.dispose();
    super.dispose();
  }

  void _onScroll() {
    if (_scroll.hasClients && _scroll.position.pixels >= _scroll.position.maxScrollExtent - 400) {
      context.read<WishlistProvider>().loadMore();
    }
  }

  @override
  Widget build(BuildContext context) {
    final loggedIn = context.watch<AuthProvider>().isLoggedIn;
    return Scaffold(
      appBar: AppBar(title: const Text('Wishlist')),
      body: !loggedIn ? _signInPrompt(context) : _body(context),
    );
  }

  Widget _signInPrompt(BuildContext context) => Center(
        child: Padding(
          padding: const EdgeInsets.all(32),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(Icons.favorite_border, size: 48, color: Colors.grey.shade400),
              const SizedBox(height: 12),
              const Text('Sign in to save products.', textAlign: TextAlign.center),
              const SizedBox(height: 16),
              FilledButton(
                onPressed: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => const LoginScreen())),
                child: const Text('Login'),
              ),
            ],
          ),
        ),
      );

  Widget _body(BuildContext context) {
    final wl = context.watch<WishlistProvider>();
    final items = wl.wishlist?.items ?? [];

    if (wl.loading && wl.wishlist == null) {
      return const Center(child: CircularProgressIndicator());
    }
    if (items.isEmpty) {
      return RefreshIndicator(
        onRefresh: () => wl.refresh(),
        child: ListView(
          children: [
            const SizedBox(height: 120),
            Icon(Icons.favorite_border, size: 56, color: Colors.grey.shade400),
            const SizedBox(height: 12),
            const Center(child: Text('Your wishlist is empty.')),
          ],
        ),
      );
    }

    return RefreshIndicator(
      onRefresh: () => wl.refresh(),
      child: CustomScrollView(
        controller: _scroll,
        physics: const AlwaysScrollableScrollPhysics(),
        slivers: [
          SliverPadding(
            padding: const EdgeInsets.all(12),
            sliver: SliverGrid(
              gridDelegate: const SliverGridDelegateWithMaxCrossAxisExtent(
                maxCrossAxisExtent: 220,
                childAspectRatio: 0.62,
                crossAxisSpacing: 12,
                mainAxisSpacing: 12,
              ),
              delegate: SliverChildBuilderDelegate(
                (context, i) {
                  final it = items[i];
                  return Card(
            clipBehavior: Clip.antiAlias,
            child: InkWell(
              onTap: () => Navigator.of(context).push(
                MaterialPageRoute(builder: (_) => ProductDetailScreen(productId: it.productId)),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Expanded(
                    child: Stack(
                      fit: StackFit.expand,
                      children: [
                        ProductImage(url: it.imageUrl),
                        Positioned(
                          top: 4,
                          right: 4,
                          child: Material(
                            color: Colors.white70,
                            shape: const CircleBorder(),
                            child: IconButton(
                              iconSize: 20,
                              icon: const Icon(Icons.favorite, color: Colors.red),
                              tooltip: 'Remove',
                              onPressed: () async {
                                try {
                                  await context.read<WishlistProvider>().remove(it.productId);
                                } catch (e) {
                                  if (context.mounted) {
                                    context.showSnack(e.toString());
                                  }
                                }
                              },
                            ),
                          ),
                        ),
                        if (!it.available || !it.inStock)
                          Positioned(
                            bottom: 0, left: 0, right: 0,
                            child: Container(
                              color: !it.available ? Colors.black54 : Colors.orange.shade800,
                              padding: const EdgeInsets.symmetric(vertical: 2),
                              child: Text(
                                  !it.available ? 'No longer available' : 'Out of stock',
                                  textAlign: TextAlign.center,
                                  style: const TextStyle(color: Colors.white, fontSize: 11)),
                            ),
                          ),
                      ],
                    ),
                  ),
                  Padding(
                    padding: const EdgeInsets.all(8),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(it.brand.toUpperCase(),
                            style: TextStyle(fontSize: 11, color: Colors.grey.shade600, letterSpacing: 0.5)),
                        Text(it.name, maxLines: 2, overflow: TextOverflow.ellipsis,
                            style: const TextStyle(fontWeight: FontWeight.w600)),
                        const SizedBox(height: 4),
                        Text('RM ${it.price.toStringAsFixed(2)}',
                            style: TextStyle(fontWeight: FontWeight.bold, color: Theme.of(context).colorScheme.primary)),
                      ],
                    ),
                  ),
                ],
              ),
            ),
          );
                },
                childCount: items.length,
              ),
            ),
          ),
          if (wl.loadingMore)
            const SliverToBoxAdapter(
              child: Padding(
                padding: EdgeInsets.symmetric(vertical: 16),
                child: Center(child: CircularProgressIndicator()),
              ),
            ),
        ],
      ),
    );
  }
}
