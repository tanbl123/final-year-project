import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import 'package:customer/core/widgets/product_image.dart';
import 'package:provider/provider.dart';

import 'package:customer/core/utils/refresh_bus.dart';
import 'package:customer/features/catalog/models/category.dart';
import 'package:customer/features/catalog/models/product.dart';
import 'package:customer/features/catalog/services/catalog_service.dart';
import 'package:customer/features/catalog/services/recommendation_service.dart';
import 'package:customer/features/catalog/widgets/recommendation_carousel.dart';
import 'package:customer/features/auth/state/auth_provider.dart';
import 'package:customer/features/auth/screens/login_screen.dart';
import 'package:customer/features/catalog/screens/product_detail_screen.dart';
import 'package:customer/features/notification/state/notification_provider.dart';
import 'package:customer/features/notification/screens/notifications_screen.dart';
import 'package:customer/features/cart/state/cart_provider.dart';
import 'package:customer/features/shell/main_shell.dart';

/// Home screen: a searchable grid of approved products. Browsable as a guest;
/// an account menu in the app bar handles sign in / sign out.
class CatalogScreen extends StatefulWidget {
  const CatalogScreen({super.key});

  @override
  State<CatalogScreen> createState() => _CatalogScreenState();
}

class _CatalogScreenState extends State<CatalogScreen> {
  final _searchCtrl = TextEditingController();
  final _scroll = ScrollController();
  final List<ProductSummary> _items = [];
  int _page = 1;        // last page loaded
  int _total = 0;       // total matching products (from the API)
  bool _loading = true; // first-page load
  bool _loadingMore = false;
  Object? _error;
  bool get _hasMore => _items.length < _total;
  String _search = '';
  Timer? _debounce;   // debounces the live search so we don't hit the API on every keystroke

  // filters
  List<Category> _categories = [];
  String? _categoryId;
  double? _minPrice;
  double? _maxPrice;
  String? _sort;   // price_asc | price_desc | newest

  String? _lastUserId;   // remember who's signed in, to detect account switches
  int _recSeed = 0;      // bump to force the recommendation rails to reload

  bool get _filtersActive => _categoryId != null || _minPrice != null || _maxPrice != null || _sort != null;

  @override
  void initState() {
    super.initState();
    _scroll.addListener(_onScroll);
    _lastUserId = context.read<AuthProvider>().user?.userId;
    appRefreshTick.addListener(_onExternalRefresh);
    _fetchFirstPage();
    // categories for the filter dropdown (best-effort)
    context.read<CatalogService>().listCategories().then((cats) {
      if (mounted) setState(() => _categories = cats);
    }).catchError((_) {});
  }

  @override
  void dispose() {
    appRefreshTick.removeListener(_onExternalRefresh);
    _debounce?.cancel();
    _scroll.dispose();
    _searchCtrl.dispose();
    super.dispose();
  }

  // A global "something changed" tick (app resumed, order paid, etc.) — quietly
  // reload the catalog + recommendation rails so the home page stays current
  // without the customer pulling to refresh.
  void _onExternalRefresh() {
    if (!mounted) return;
    setState(() => _recSeed++);
    _fetchFirstPage();
  }

  Future<CatalogPage> _load(int page) => context.read<CatalogService>().listProducts(
        search: _search,
        categoryId: _categoryId,
        minPrice: _minPrice,
        maxPrice: _maxPrice,
        sort: _sort,
        page: page,
      );

  // (Re)load from page 1 — on first open, refresh, search or filter change.
  Future<void> _fetchFirstPage() async {
    setState(() { _loading = true; _error = null; });
    try {
      final res = await _load(1);
      if (!mounted) return;
      setState(() {
        _items..clear()..addAll(res.items);
        _page = res.page;
        _total = res.total;
        _loading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() { _error = e; _loading = false; });
    }
  }

  // Append the next page when the user nears the bottom.
  Future<void> _loadMore() async {
    if (_loadingMore || _loading || !_hasMore) return;
    setState(() => _loadingMore = true);
    try {
      final res = await _load(_page + 1);
      if (!mounted) return;
      setState(() {
        _items.addAll(res.items);
        _page = res.page;
        _total = res.total;
        _loadingMore = false;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() => _loadingMore = false); // keep what we have; user can scroll again to retry
    }
  }

  void _onScroll() {
    if (!_scroll.hasClients) return;
    if (_scroll.position.pixels >= _scroll.position.maxScrollExtent - 400) {
      _loadMore();
    }
  }

  Future<void> _refresh() => _fetchFirstPage();

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
    _search = q;
    _fetchFirstPage();
  }

  @override
  Widget build(BuildContext context) {
    // Auto-refresh on account switch: if the signed-in user changed (login,
    // logout, or switching accounts), reload products + recommendation rails so
    // the home page never shows the previous account's data.
    final userId = context.watch<AuthProvider>().user?.userId;
    if (userId != _lastUserId) {
      _lastUserId = userId;
      _recSeed++;
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) _fetchFirstPage();
      });
    }

    return Scaffold(
      appBar: AppBar(
        title: const Text('👟 ShoeAR'),
        actions: [_cartAction(context), _notificationsAction(context), _filterAction(context), _accountAction(context)],
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
      body: _body(),
    );
  }

  Widget _body() {
    if (_loading) return const Center(child: CircularProgressIndicator());
    if (_error != null) return _ErrorView(message: _error.toString(), onRetry: _fetchFirstPage);
    return RefreshIndicator(
      onRefresh: _refresh,
      child: CustomScrollView(
        controller: _scroll,
        physics: const AlwaysScrollableScrollPhysics(),
        slivers: [
          // Recommendation rails — only on the clean home view (not while
          // searching/filtering), like Shopee/Lazada. Each rail self-hides when
          // it has nothing to show. "Recommended for you" needs a login.
          if (_search.isEmpty && !_filtersActive)
            SliverToBoxAdapter(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  if (context.watch<AuthProvider>().isLoggedIn)
                    RecommendationCarousel(
                      key: ValueKey('foryou-$_recSeed'),
                      title: 'Recommended for you',
                      loader: () => context.read<RecommendationService>().forYou(),
                    ),
                  RecommendationCarousel(
                    key: ValueKey('trending-$_recSeed'),
                    title: 'Trending now',
                    loader: () => context.read<RecommendationService>().trending(),
                  ),
                ],
              ),
            ),
          if (_items.isEmpty)
            const SliverFillRemaining(
              hasScrollBody: false,
              child: Center(child: Padding(padding: EdgeInsets.all(40), child: Text('No products found.'))),
            )
          else ...[
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
                  (context, i) => _ProductCard(product: _items[i]),
                  childCount: _items.length,
                ),
              ),
            ),
            if (_loadingMore)
              const SliverToBoxAdapter(
                child: Padding(padding: EdgeInsets.symmetric(vertical: 16), child: Center(child: CircularProgressIndicator())),
              ),
          ],
        ],
      ),
    );
  }

  // cart with an item-count badge; tapping switches to the Cart tab. Cart is
  // the highest-intent action, so it gets a shortcut in the app bar too (as in
  // Shopee/Lazada), in addition to the bottom-nav tab.
  Widget _cartAction(BuildContext context) {
    final count = context.watch<CartProvider>().count;
    return Badge(
      isLabelVisible: count > 0,
      label: Text(count > 99 ? '99+' : '$count'),
      child: IconButton(
        icon: const Icon(Icons.shopping_cart_outlined),
        tooltip: 'Cart',
        onPressed: () => mainShellTab.value = MainTab.cart,
      ),
    );
  }

  // bell with an unread badge; only for signed-in customers (guests have none)
  Widget _notificationsAction(BuildContext context) {
    final loggedIn = context.watch<AuthProvider>().isLoggedIn;
    if (!loggedIn) return const SizedBox.shrink();
    final unread = context.watch<NotificationProvider>().unread;
    return Badge(
      isLabelVisible: unread > 0,
      label: Text(unread > 99 ? '99+' : '$unread'),
      child: IconButton(
        icon: const Icon(Icons.notifications_outlined),
        tooltip: 'Notifications',
        onPressed: () => Navigator.of(context).push(
          MaterialPageRoute(builder: (_) => const NotificationsScreen()),
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
    final result = await showModalBottomSheet<_FilterResult>(
      context: context,
      isScrollControlled: true,
      builder: (_) => _FilterSheet(
        categories: _categories,
        categoryId: _categoryId,
        sort: _sort,
        minPrice: _minPrice,
        maxPrice: _maxPrice,
      ),
    );
    if (result != null) {
      _categoryId = result.categoryId;
      _sort = result.sort;
      _minPrice = result.minPrice;
      _maxPrice = result.maxPrice;
      _fetchFirstPage();
    }
  }


  // Home keeps a Login shortcut for guests; signed-in users manage everything
  // from the Wishlist / Orders / Profile tabs in the bottom bar.
  Widget _accountAction(BuildContext context) {
    final loggedIn = context.watch<AuthProvider>().isLoggedIn;
    if (loggedIn) return const SizedBox.shrink();
    return TextButton.icon(
      onPressed: () => Navigator.of(context).push(
        MaterialPageRoute(builder: (_) => const LoginScreen()),
      ),
      icon: const Icon(Icons.login),
      label: const Text('Login'),
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

/// Result of the filter sheet.
class _FilterResult {
  final String? categoryId;
  final String? sort;
  final double? minPrice;
  final double? maxPrice;
  _FilterResult({this.categoryId, this.sort, this.minPrice, this.maxPrice});
}

/// Filter sheet — owns its own controllers (disposed in dispose) so they're
/// never freed while their text fields are still attached.
class _FilterSheet extends StatefulWidget {
  final List<Category> categories;
  final String? categoryId;
  final String? sort;
  final double? minPrice;
  final double? maxPrice;
  const _FilterSheet({
    required this.categories,
    this.categoryId,
    this.sort,
    this.minPrice,
    this.maxPrice,
  });

  @override
  State<_FilterSheet> createState() => _FilterSheetState();
}

class _FilterSheetState extends State<_FilterSheet> {
  late String? _cat = widget.categoryId;
  late String? _sort = widget.sort;
  late final TextEditingController _min = TextEditingController(text: widget.minPrice?.toStringAsFixed(0) ?? '');
  late final TextEditingController _max = TextEditingController(text: widget.maxPrice?.toStringAsFixed(0) ?? '');
  String? _priceError;

  @override
  void dispose() {
    _min.dispose();
    _max.dispose();
    super.dispose();
  }

  // numeric, non-negative, and min <= max
  void _apply() {
    final minTxt = _min.text.trim();
    final maxTxt = _max.text.trim();
    final min = minTxt.isEmpty ? null : double.tryParse(minTxt);
    final max = maxTxt.isEmpty ? null : double.tryParse(maxTxt);

    if (minTxt.isNotEmpty && (min == null || min < 0)) {
      setState(() => _priceError = 'Enter a valid minimum price.');
      return;
    }
    if (maxTxt.isNotEmpty && (max == null || max < 0)) {
      setState(() => _priceError = 'Enter a valid maximum price.');
      return;
    }
    if (min != null && max != null && min > max) {
      setState(() => _priceError = 'Min price cannot be greater than max price.');
      return;
    }
    Navigator.of(context).pop(_FilterResult(categoryId: _cat, sort: _sort, minPrice: min, maxPrice: max));
  }

  static final _priceFormatters = [FilteringTextInputFormatter.allow(RegExp(r'[0-9.]'))];

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.only(left: 16, right: 16, top: 16, bottom: 16 + MediaQuery.of(context).viewInsets.bottom),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('Filters', style: Theme.of(context).textTheme.titleLarge),
          const SizedBox(height: 16),
          DropdownButtonFormField<String?>(
            value: _cat,
            decoration: const InputDecoration(labelText: 'Category', border: OutlineInputBorder()),
            items: [
              const DropdownMenuItem<String?>(value: null, child: Text('All categories')),
              for (final c in widget.categories) DropdownMenuItem<String?>(value: c.id, child: Text(c.name)),
            ],
            onChanged: (v) => setState(() => _cat = v),
          ),
          const SizedBox(height: 12),
          DropdownButtonFormField<String?>(
            value: _sort,
            decoration: const InputDecoration(labelText: 'Sort by', border: OutlineInputBorder()),
            items: const [
              DropdownMenuItem<String?>(value: null, child: Text('Newest')),
              DropdownMenuItem<String?>(value: 'price_asc', child: Text('Price: low to high')),
              DropdownMenuItem<String?>(value: 'price_desc', child: Text('Price: high to low')),
            ],
            onChanged: (v) => setState(() => _sort = v),
          ),
          const SizedBox(height: 12),
          Row(
            children: [
              Expanded(
                child: TextField(
                  controller: _min,
                  keyboardType: const TextInputType.numberWithOptions(decimal: true),
                  inputFormatters: _priceFormatters,
                  onChanged: _priceError == null ? null : (_) => setState(() => _priceError = null),
                  decoration: const InputDecoration(labelText: 'Min price', prefixText: 'RM ', border: OutlineInputBorder()),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: TextField(
                  controller: _max,
                  keyboardType: const TextInputType.numberWithOptions(decimal: true),
                  inputFormatters: _priceFormatters,
                  onChanged: _priceError == null ? null : (_) => setState(() => _priceError = null),
                  decoration: const InputDecoration(labelText: 'Max price', prefixText: 'RM ', border: OutlineInputBorder()),
                ),
              ),
            ],
          ),
          if (_priceError != null) ...[
            const SizedBox(height: 6),
            Text(_priceError!, style: TextStyle(color: Theme.of(context).colorScheme.error, fontSize: 12)),
          ],
          const SizedBox(height: 16),
          Row(
            children: [
              Expanded(
                child: OutlinedButton(
                  onPressed: () => setState(() {
                    _cat = null;
                    _sort = null;
                    _min.clear();
                    _max.clear();
                    _priceError = null;
                  }),
                  child: const Text('Clear'),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: FilledButton(
                  onPressed: _apply,
                  child: const Text('Apply'),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}
