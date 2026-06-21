import 'dart:async';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../models/category.dart';
import '../models/product.dart';
import '../services/catalog_service.dart';
import '../state/auth_provider.dart';
import '../state/cart_provider.dart';
import 'cart_screen.dart';
import 'login_screen.dart';
import 'orders_screen.dart';
import 'product_detail_screen.dart';
import 'profile_screen.dart';
import 'wishlist_screen.dart';

/// Home screen: a searchable grid of approved products. Browsable as a guest;
/// an account menu in the app bar handles sign in / sign out.
class CatalogScreen extends StatefulWidget {
  const CatalogScreen({super.key});

  @override
  State<CatalogScreen> createState() => _CatalogScreenState();
}

class _CatalogScreenState extends State<CatalogScreen> {
  final _searchCtrl = TextEditingController();
  late Future<CatalogPage> _future;
  String _search = '';
  Timer? _debounce;   // debounces the live search so we don't hit the API on every keystroke

  // filters
  List<Category> _categories = [];
  String? _categoryId;
  double? _minPrice;
  double? _maxPrice;
  String? _sort;   // price_asc | price_desc | newest

  bool get _filtersActive => _categoryId != null || _minPrice != null || _maxPrice != null || _sort != null;

  @override
  void initState() {
    super.initState();
    _future = _load();
    // categories for the filter dropdown (best-effort)
    context.read<CatalogService>().listCategories().then((cats) {
      if (mounted) setState(() => _categories = cats);
    }).catchError((_) {});
  }

  @override
  void dispose() {
    _debounce?.cancel();
    _searchCtrl.dispose();
    super.dispose();
  }

  Future<CatalogPage> _load() => context.read<CatalogService>().listProducts(
        search: _search,
        categoryId: _categoryId,
        minPrice: _minPrice,
        maxPrice: _maxPrice,
        sort: _sort,
      );

  Future<void> _refresh() async {
    final next = _load();
    setState(() => _future = next);
    await next;
  }

  // type-to-search: rebuild now (for the clear button), then reload after a pause
  void _onSearchChanged(String value) {
    setState(() {});
    _debounce?.cancel();
    _debounce = Timer(const Duration(milliseconds: 350), () => _applySearch(value));
  }

  // run the search immediately (on submit / clear), skipping the debounce
  void _applySearch(String value) {
    _debounce?.cancel();
    final q = value.trim();
    if (q == _search) return;
    setState(() {
      _search = q;
      _future = _load();
    });
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('👟 ShoeAR'),
        actions: [_filterAction(context), _cartAction(context), _accountAction(context)],
        bottom: PreferredSize(
          preferredSize: const Size.fromHeight(60),
          child: Padding(
            padding: const EdgeInsets.fromLTRB(12, 0, 12, 10),
            child: TextField(
              controller: _searchCtrl,
              textInputAction: TextInputAction.search,
              onChanged: _onSearchChanged,
              onSubmitted: _applySearch,
              decoration: InputDecoration(
                hintText: 'Search shoes or brands…',
                filled: true,
                fillColor: Theme.of(context).colorScheme.surface,
                prefixIcon: const Icon(Icons.search),
                suffixIcon: _searchCtrl.text.isEmpty
                    ? null
                    : IconButton(
                        icon: const Icon(Icons.clear),
                        onPressed: () {
                          _searchCtrl.clear();
                          _applySearch('');
                        },
                      ),
                isDense: true,
                border: OutlineInputBorder(borderRadius: BorderRadius.circular(24), borderSide: BorderSide.none),
              ),
            ),
          ),
        ),
      ),
      body: RefreshIndicator(
        onRefresh: _refresh,
        child: FutureBuilder<CatalogPage>(
          future: _future,
          builder: (context, snap) {
            if (snap.connectionState == ConnectionState.waiting) {
              return const Center(child: CircularProgressIndicator());
            }
            if (snap.hasError) {
              return _ErrorView(message: snap.error.toString(), onRetry: _refresh);
            }
            final items = snap.data?.items ?? [];
            if (items.isEmpty) {
              return ListView(
                children: const [
                  SizedBox(height: 120),
                  Center(child: Text('No products found.')),
                ],
              );
            }
            return GridView.builder(
              padding: const EdgeInsets.all(12),
              gridDelegate: const SliverGridDelegateWithMaxCrossAxisExtent(
                maxCrossAxisExtent: 220,
                childAspectRatio: 0.62,
                crossAxisSpacing: 12,
                mainAxisSpacing: 12,
              ),
              itemCount: items.length,
              itemBuilder: (context, i) => _ProductCard(product: items[i]),
            );
          },
        ),
      ),
    );
  }

  Widget _filterAction(BuildContext context) {
    return Badge(
      isLabelVisible: _filtersActive,
      smallSize: 8,
      child: IconButton(
        icon: const Icon(Icons.tune),
        tooltip: 'Filters',
        onPressed: _openFilters,
      ),
    );
  }

  Future<void> _openFilters() async {
    // local copies so Cancel discards
    String? cat = _categoryId;
    String? sort = _sort;
    final minCtrl = TextEditingController(text: _minPrice?.toStringAsFixed(0) ?? '');
    final maxCtrl = TextEditingController(text: _maxPrice?.toStringAsFixed(0) ?? '');

    final applied = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      builder: (ctx) => Padding(
        padding: EdgeInsets.only(left: 16, right: 16, top: 16, bottom: 16 + MediaQuery.of(ctx).viewInsets.bottom),
        child: StatefulBuilder(
          builder: (ctx, setSheet) => Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text('Filters', style: Theme.of(ctx).textTheme.titleLarge),
              const SizedBox(height: 16),
              DropdownButtonFormField<String?>(
                value: cat,
                decoration: const InputDecoration(labelText: 'Category', border: OutlineInputBorder()),
                items: [
                  const DropdownMenuItem<String?>(value: null, child: Text('All categories')),
                  for (final c in _categories) DropdownMenuItem<String?>(value: c.id, child: Text(c.name)),
                ],
                onChanged: (v) => setSheet(() => cat = v),
              ),
              const SizedBox(height: 12),
              DropdownButtonFormField<String?>(
                value: sort,
                decoration: const InputDecoration(labelText: 'Sort by', border: OutlineInputBorder()),
                items: const [
                  DropdownMenuItem<String?>(value: null, child: Text('Newest')),
                  DropdownMenuItem<String?>(value: 'price_asc', child: Text('Price: low to high')),
                  DropdownMenuItem<String?>(value: 'price_desc', child: Text('Price: high to low')),
                ],
                onChanged: (v) => setSheet(() => sort = v),
              ),
              const SizedBox(height: 12),
              Row(
                children: [
                  Expanded(
                    child: TextField(
                      controller: minCtrl,
                      keyboardType: TextInputType.number,
                      decoration: const InputDecoration(labelText: 'Min price', prefixText: 'RM ', border: OutlineInputBorder()),
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: TextField(
                      controller: maxCtrl,
                      keyboardType: TextInputType.number,
                      decoration: const InputDecoration(labelText: 'Max price', prefixText: 'RM ', border: OutlineInputBorder()),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 16),
              Row(
                children: [
                  Expanded(
                    child: OutlinedButton(
                      onPressed: () {
                        setSheet(() {
                          cat = null;
                          sort = null;
                          minCtrl.clear();
                          maxCtrl.clear();
                        });
                      },
                      child: const Text('Clear'),
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: FilledButton(
                      onPressed: () => Navigator.of(ctx).pop(true),
                      child: const Text('Apply'),
                    ),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );

    if (applied == true) {
      setState(() {
        _categoryId = cat;
        _sort = sort;
        _minPrice = double.tryParse(minCtrl.text.trim());
        _maxPrice = double.tryParse(maxCtrl.text.trim());
        _future = _load();
      });
    }
    minCtrl.dispose();
    maxCtrl.dispose();
  }

  Widget _cartAction(BuildContext context) {
    final count = context.watch<CartProvider>().count;
    return Badge(
      isLabelVisible: count > 0,
      label: Text('$count'),
      offset: const Offset(-4, 4),
      child: IconButton(
        icon: const Icon(Icons.shopping_cart_outlined),
        tooltip: 'Cart',
        onPressed: () => Navigator.of(context).push(
          MaterialPageRoute(builder: (_) => const CartScreen()),
        ),
      ),
    );
  }

  Widget _accountAction(BuildContext context) {
    final auth = context.watch<AuthProvider>();
    if (!auth.isLoggedIn) {
      return TextButton.icon(
        onPressed: () => Navigator.of(context).push(
          MaterialPageRoute(builder: (_) => const LoginScreen()),
        ),
        icon: const Icon(Icons.login),
        label: const Text('Login'),
      );
    }
    return PopupMenuButton<String>(
      icon: const Icon(Icons.account_circle),
      onSelected: (v) {
        if (v == 'logout') {
          context.read<AuthProvider>().logout();
        } else if (v == 'orders') {
          Navigator.of(context).push(MaterialPageRoute(builder: (_) => const OrdersScreen()));
        } else if (v == 'wishlist') {
          Navigator.of(context).push(MaterialPageRoute(builder: (_) => const WishlistScreen()));
        } else if (v == 'profile') {
          Navigator.of(context).push(MaterialPageRoute(builder: (_) => const ProfileScreen()));
        }
      },
      itemBuilder: (context) => <PopupMenuEntry<String>>[
        PopupMenuItem<String>(
          enabled: false,
          child: Text('Hi, ${auth.user?.fullName ?? 'Customer'}'),
        ),
        const PopupMenuDivider(),
        const PopupMenuItem<String>(value: 'profile', child: Text('Profile')),
        const PopupMenuItem<String>(value: 'orders', child: Text('My orders')),
        const PopupMenuItem<String>(value: 'wishlist', child: Text('My wishlist')),
        const PopupMenuItem<String>(value: 'logout', child: Text('Sign out')),
      ],
    );
  }
}

class _ProductCard extends StatelessWidget {
  final ProductSummary product;
  const _ProductCard({required this.product});

  @override
  Widget build(BuildContext context) {
    return Card(
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: () => Navigator.of(context).push(
          MaterialPageRoute(builder: (_) => ProductDetailScreen(productId: product.id)),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Expanded(
              child: Stack(
                fit: StackFit.expand,
                children: [
                  ProductImage(url: product.imageUrl),
                  if (product.virtualTryOnEnable)
                    Positioned(
                      top: 8,
                      left: 8,
                      child: Container(
                        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                        decoration: BoxDecoration(
                          color: Colors.black87,
                          borderRadius: BorderRadius.circular(12),
                        ),
                        child: const Text('AR', style: TextStyle(color: Colors.white, fontSize: 11, fontWeight: FontWeight.bold)),
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
                  Text(product.brand.toUpperCase(),
                      style: TextStyle(fontSize: 11, color: Colors.grey.shade600, letterSpacing: 0.5)),
                  Text(product.name,
                      maxLines: 2, overflow: TextOverflow.ellipsis,
                      style: const TextStyle(fontWeight: FontWeight.w600)),
                  const SizedBox(height: 4),
                  Text('RM ${product.price.toStringAsFixed(2)}',
                      style: TextStyle(fontWeight: FontWeight.bold, color: Theme.of(context).colorScheme.primary)),
                  if (product.ratingCount > 0)
                    Text('★ ${product.ratingAverage} (${product.ratingCount})',
                        style: TextStyle(fontSize: 12, color: Colors.amber.shade800)),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// Network image with a graceful placeholder when the URL is missing/broken.
class ProductImage extends StatelessWidget {
  final String? url;
  const ProductImage({super.key, this.url});

  @override
  Widget build(BuildContext context) {
    if (url == null) return _placeholder();
    return Image.network(
      url!,
      fit: BoxFit.cover,
      errorBuilder: (_, __, ___) => _placeholder(),
      loadingBuilder: (context, child, progress) =>
          progress == null ? child : const Center(child: CircularProgressIndicator(strokeWidth: 2)),
    );
  }

  Widget _placeholder() => Container(
        color: Colors.grey.shade200,
        child: Icon(Icons.image_not_supported_outlined, color: Colors.grey.shade400, size: 40),
      );
}

class _ErrorView extends StatelessWidget {
  final String message;
  final Future<void> Function() onRetry;
  const _ErrorView({required this.message, required this.onRetry});

  @override
  Widget build(BuildContext context) {
    return ListView(
      children: [
        const SizedBox(height: 100),
        const Icon(Icons.cloud_off, size: 48, color: Colors.grey),
        const SizedBox(height: 12),
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 32),
          child: Text(message, textAlign: TextAlign.center, style: const TextStyle(color: Colors.grey)),
        ),
        const SizedBox(height: 16),
        Center(child: OutlinedButton(onPressed: onRetry, child: const Text('Retry'))),
      ],
    );
  }
}
