import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import 'package:customer/features/catalog/models/product.dart';
import 'package:customer/features/review/models/review.dart';
import 'package:customer/features/catalog/services/catalog_service.dart';
import 'package:customer/features/review/services/review_service.dart';
import 'package:customer/features/review/widgets/review_sheet.dart';
import 'package:customer/features/auth/state/auth_provider.dart';
import 'package:customer/features/cart/state/cart_provider.dart';
import 'package:customer/features/wishlist/state/wishlist_provider.dart';
import 'package:customer/core/widgets/product_image.dart';
import 'package:customer/core/utils/snackbar.dart';
import 'package:customer/features/auth/screens/login_screen.dart';

class ProductDetailScreen extends StatefulWidget {
  final String productId;
  const ProductDetailScreen({super.key, required this.productId});

  @override
  State<ProductDetailScreen> createState() => _ProductDetailScreenState();
}

class _ProductDetailScreenState extends State<ProductDetailScreen> {
  late Future<ProductDetail> _future;
  MyReviewStatus? _myStatus; // null until loaded / not logged in
  String? _selectedVariantId;
  bool _adding = false;

  @override
  void initState() {
    super.initState();
    _future = context.read<CatalogService>().getProduct(widget.productId);
    if (context.read<AuthProvider>().isLoggedIn) _loadMyReview();
  }

  Future<void> _loadMyReview() async {
    try {
      final s = await context.read<ReviewService>().myReview(widget.productId);
      if (mounted) setState(() => _myStatus = s);
    } catch (_) {/* eligibility just won't show */}
  }

  void _reloadReviews() {
    setState(() {
      _future = context.read<CatalogService>().getProduct(widget.productId);
    });
    if (context.read<AuthProvider>().isLoggedIn) _loadMyReview();
  }

  Future<void> _addToCart(ProductDetail p) async {
    if (!context.read<AuthProvider>().isLoggedIn) {
      Navigator.of(context).push(MaterialPageRoute(builder: (_) => const LoginScreen()));
      return;
    }
    if (_selectedVariantId == null) {
      context.showSnack('Please select a size.');
      return;
    }
    setState(() => _adding = true);
    try {
      await context.read<CartProvider>().add(_selectedVariantId!);
      if (!mounted) return;
      context.showSnack('Added "${p.name}" to your cart.');
    } catch (e) {
      if (!mounted) return;
      context.showSnack(e.toString());
    } finally {
      if (mounted) setState(() => _adding = false);
    }
  }

  Future<void> _toggleWishlist() async {
    if (!context.read<AuthProvider>().isLoggedIn) {
      Navigator.of(context).push(MaterialPageRoute(builder: (_) => const LoginScreen()));
      return;
    }
    try {
      await context.read<WishlistProvider>().toggle(widget.productId);
    } catch (e) {
      if (mounted) context.showSnack(e.toString());
    }
  }

  @override
  Widget build(BuildContext context) {
    final saved = context.watch<WishlistProvider>().isSaved(widget.productId);
    return Scaffold(
      body: FutureBuilder<ProductDetail>(
        future: _future,
        builder: (context, snap) {
          if (snap.connectionState == ConnectionState.waiting) {
            return const Center(child: CircularProgressIndicator());
          }
          if (snap.hasError) {
            return Center(
              child: Padding(
                padding: const EdgeInsets.all(24),
                child: Text(snap.error.toString(),
                    textAlign: TextAlign.center,
                    style: const TextStyle(color: Colors.grey)),
              ),
            );
          }
          return _body(context, snap.data!, saved);
        },
      ),
    );
  }

  Widget _body(BuildContext context, ProductDetail p, bool saved) {
    final theme = Theme.of(context);
    final hasStock = p.variants.any((v) => v.inStock);
    final selectedVariant = _selectedVariantId == null
        ? null
        : p.variants.where((v) => v.variantId == _selectedVariantId).firstOrNull;

    return Stack(
      children: [
        CustomScrollView(
          slivers: [
            // ── Image + floating back/heart ──────────────────────────────────
            SliverAppBar(
              expandedHeight: 360,
              pinned: true,
              backgroundColor: Colors.transparent,
              elevation: 0,
              leading: Padding(
                padding: const EdgeInsets.all(8),
                child: CircleAvatar(
                  backgroundColor: Colors.black45,
                  child: IconButton(
                    icon: const Icon(Icons.arrow_back, color: Colors.white, size: 20),
                    onPressed: () => Navigator.of(context).pop(),
                  ),
                ),
              ),
              actions: [
                Padding(
                  padding: const EdgeInsets.all(8),
                  child: CircleAvatar(
                    backgroundColor: Colors.black45,
                    child: IconButton(
                      icon: Icon(
                        saved ? Icons.favorite : Icons.favorite_border,
                        color: saved ? Colors.red.shade300 : Colors.white,
                        size: 20,
                      ),
                      tooltip: saved ? 'Remove from wishlist' : 'Save to wishlist',
                      onPressed: _toggleWishlist,
                    ),
                  ),
                ),
              ],
              flexibleSpace: FlexibleSpaceBar(
                collapseMode: CollapseMode.pin,
                background: p.images.isEmpty
                    ? const ProductImage(url: null)
                    : _ImageCarousel(images: p.images),
              ),
            ),

            // ── Product info card ─────────────────────────────────────────────
            SliverToBoxAdapter(
              child: Container(
                decoration: const BoxDecoration(
                  color: Colors.white,
                  borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
                ),
                transform: Matrix4.translationValues(0, -20, 0),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    // ── Brand / name / price / rating ─────────────────────────
                    Padding(
                      padding: const EdgeInsets.fromLTRB(20, 24, 20, 0),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(p.brand.toUpperCase(),
                              style: TextStyle(
                                  color: theme.colorScheme.primary,
                                  fontSize: 12,
                                  fontWeight: FontWeight.w600,
                                  letterSpacing: 1.2)),
                          const SizedBox(height: 4),
                          Text(p.name,
                              style: theme.textTheme.headlineSmall
                                  ?.copyWith(fontWeight: FontWeight.bold)),
                          const SizedBox(height: 12),
                          Row(
                            crossAxisAlignment: CrossAxisAlignment.center,
                            children: [
                              Text('RM ${p.price.toStringAsFixed(2)}',
                                  style: theme.textTheme.headlineMedium?.copyWith(
                                      color: theme.colorScheme.primary,
                                      fontWeight: FontWeight.bold)),
                              const Spacer(),
                              if (p.ratingCount > 0)
                                Row(
                                  children: [
                                    Icon(Icons.star_rounded,
                                        color: Colors.amber.shade600, size: 18),
                                    const SizedBox(width: 4),
                                    Text(
                                      '${p.ratingAverage}  (${p.ratingCount})',
                                      style: TextStyle(
                                          color: Colors.grey.shade700,
                                          fontWeight: FontWeight.w500),
                                    ),
                                  ],
                                ),
                            ],
                          ),
                        ],
                      ),
                    ),

                    // ── AR Try-On ─────────────────────────────────────────────
                    if (p.virtualTryOnEnable) ...[
                      const SizedBox(height: 16),
                      Padding(
                        padding: const EdgeInsets.symmetric(horizontal: 20),
                        child: OutlinedButton.icon(
                          onPressed: () => context.showSnack('AR try-on is coming in the next update.'),
                          icon: const Icon(Icons.view_in_ar),
                          label: const Text('AR Try-On'),
                          style: OutlinedButton.styleFrom(
                            minimumSize: const Size(double.infinity, 44),
                            shape: RoundedRectangleBorder(
                                borderRadius: BorderRadius.circular(10)),
                          ),
                        ),
                      ),
                    ],

                    const SizedBox(height: 20),
                    const Divider(height: 1),

                    // ── Size selection ────────────────────────────────────────
                    if (p.variants.isNotEmpty) ...[
                      Padding(
                        padding: const EdgeInsets.fromLTRB(20, 20, 20, 0),
                        child: Row(
                          children: [
                            Text('Select Size',
                                style: theme.textTheme.titleMedium
                                    ?.copyWith(fontWeight: FontWeight.bold)),
                            const Spacer(),
                            if (_selectedVariantId != null && selectedVariant != null)
                              Text(selectedVariant.size,
                                  style: TextStyle(
                                      color: theme.colorScheme.primary,
                                      fontWeight: FontWeight.w600)),
                          ],
                        ),
                      ),
                      const SizedBox(height: 12),
                      Padding(
                        padding: const EdgeInsets.symmetric(horizontal: 20),
                        child: Wrap(
                          spacing: 10,
                          runSpacing: 10,
                          children: [
                            for (final v in p.variants)
                              _SizeChip(
                                label: v.size,
                                selected: _selectedVariantId == v.variantId,
                                inStock: v.inStock,
                                onTap: v.inStock
                                    ? () => setState(() => _selectedVariantId = v.variantId)
                                    : null,
                              ),
                          ],
                        ),
                      ),
                      const SizedBox(height: 20),
                      const Divider(height: 1),
                    ],

                    // ── Description ───────────────────────────────────────────
                    if ((p.description ?? '').isNotEmpty) ...[
                      Padding(
                        padding: const EdgeInsets.fromLTRB(20, 20, 20, 0),
                        child: Text('Description',
                            style: theme.textTheme.titleMedium
                                ?.copyWith(fontWeight: FontWeight.bold)),
                      ),
                      const SizedBox(height: 8),
                      Padding(
                        padding: const EdgeInsets.fromLTRB(20, 0, 20, 0),
                        child: Text(p.description!,
                            style: TextStyle(
                                color: Colors.grey.shade700, height: 1.5)),
                      ),
                      const SizedBox(height: 20),
                      const Divider(height: 1),
                    ],

                    // ── Seller info ───────────────────────────────────────────
                    if (p.supplierName != null) ...[
                      Padding(
                        padding: const EdgeInsets.fromLTRB(20, 16, 20, 16),
                        child: Row(
                          children: [
                            Container(
                              width: 40,
                              height: 40,
                              decoration: BoxDecoration(
                                color: theme.colorScheme.primaryContainer,
                                shape: BoxShape.circle,
                              ),
                              child: Icon(Icons.storefront_outlined,
                                  color: theme.colorScheme.primary, size: 20),
                            ),
                            const SizedBox(width: 12),
                            Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text('Sold by',
                                    style: TextStyle(
                                        fontSize: 12, color: Colors.grey.shade500)),
                                Text(p.supplierName!,
                                    style: const TextStyle(fontWeight: FontWeight.w600)),
                              ],
                            ),
                          ],
                        ),
                      ),
                      const Divider(height: 1),
                    ],

                    // ── Reviews ───────────────────────────────────────────────
                    Padding(
                      padding: const EdgeInsets.fromLTRB(20, 20, 20, 0),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Row(
                            children: [
                              Text('Reviews',
                                  style: theme.textTheme.titleMedium
                                      ?.copyWith(fontWeight: FontWeight.bold)),
                              if (p.ratingCount > 0) ...[
                                const SizedBox(width: 8),
                                Text('(${p.ratingCount})',
                                    style: TextStyle(color: Colors.grey.shade500)),
                              ],
                            ],
                          ),
                          const SizedBox(height: 12),
                          _reviewPrompt(),
                          if (p.reviews.isEmpty)
                            Padding(
                              padding: const EdgeInsets.only(bottom: 20),
                              child: Text('No reviews yet.',
                                  style: TextStyle(color: Colors.grey.shade500)),
                            )
                          else
                            for (final r in _orderedReviews(p.reviews))
                              _ReviewTile(
                                review: r,
                                isMine: r.reviewId.isNotEmpty && r.reviewId == _myStatus?.myReview?.reviewId,
                                onEdit: () => _openReviewEditor(existing: _myStatus!.myReview),
                                onDelete: () => _deleteReview(r.reviewId),
                              ),
                        ],
                      ),
                    ),

                    // bottom padding so content clears the add-to-cart bar
                    const SizedBox(height: 100),
                  ],
                ),
              ),
            ),
          ],
        ),

        // ── Sticky add-to-cart bar ────────────────────────────────────────────
        Positioned(
          left: 0,
          right: 0,
          bottom: 0,
          child: _addToCartBar(context, p, hasStock),
        ),
      ],
    );
  }

  // The customer's own review goes FIRST in the list (so Edit/Delete live in the
  // reviews section, like Shopee/Lazada), the rest follow in their server order.
  List<ProductReview> _orderedReviews(List<ProductReview> reviews) {
    final mineId = _myStatus?.myReview?.reviewId;
    if (mineId == null || mineId.isEmpty) return reviews;
    final mine = <ProductReview>[];
    final others = <ProductReview>[];
    for (final r in reviews) {
      (r.reviewId == mineId ? mine : others).add(r);
    }
    return [...mine, ...others];
  }

  // Above the list: a "Write a review" CTA (eligible, not yet reviewed) or an
  // eligibility hint. Once the customer HAS a review it shows inline in the
  // list (with Edit/Delete), so nothing is rendered here.
  Widget _reviewPrompt() {
    final st = _myStatus;
    if (st == null) return const SizedBox.shrink();
    // An admin-removed review isn't in the public list, so note it here.
    if (st.myReview != null) {
      if (st.myReview!.reviewStatus == 'Removed') {
        return Padding(
          padding: const EdgeInsets.only(bottom: 12),
          child: Text('Your review was removed by an admin.',
              style: TextStyle(fontSize: 12, color: Colors.red.shade400)),
        );
      }
      return const SizedBox.shrink(); // shown inline in the list
    }
    if (st.canReview) {
      return Padding(
        padding: const EdgeInsets.only(bottom: 16),
        child: OutlinedButton.icon(
          onPressed: () => _openReviewEditor(),
          icon: const Icon(Icons.rate_review_outlined),
          label: const Text('Write a review'),
          style: OutlinedButton.styleFrom(
            minimumSize: const Size(double.infinity, 44),
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
          ),
        ),
      );
    }
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Text('You can review this product after your order is delivered.',
          style: TextStyle(fontSize: 12, color: Colors.grey.shade500)),
    );
  }

  Future<void> _openReviewEditor({MyReview? existing}) async {
    final result = await showModalBottomSheet<ReviewResult>(
      context: context,
      isScrollControlled: true,
      builder: (_) => ReviewSheet(
        initialRating: existing?.ratingScore ?? 0,
        initialComment: existing?.reviewComment ?? '',
        editing: existing != null,
      ),
    );
    if (result != null) {
      await _submitReview(existing, result.rating, result.comment);
    }
  }

  Future<void> _submitReview(MyReview? existing, int rating, String comment) async {
    final reviews = context.read<ReviewService>();
    try {
      if (existing == null) {
        await reviews.create(widget.productId, rating, comment);
      } else {
        await reviews.update(existing.reviewId, rating, comment);
      }
      if (!mounted) return;
      context.showSnack('Review saved.');
      _reloadReviews();
    } catch (e) {
      if (mounted) context.showSnack(e.toString());
    }
  }

  Future<void> _deleteReview(String reviewId) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Delete review?'),
        content: const Text('This permanently removes your review.'),
        actions: [
          TextButton(onPressed: () => Navigator.of(ctx).pop(false), child: const Text('Cancel')),
          FilledButton(
            style: FilledButton.styleFrom(backgroundColor: Colors.red),
            onPressed: () => Navigator.of(ctx).pop(true),
            child: const Text('Delete'),
          ),
        ],
      ),
    );
    if (ok != true) return;
    try {
      await context.read<ReviewService>().delete(reviewId);
      if (!mounted) return;
      context.showSnack('Review deleted.');
      _reloadReviews();
    } catch (e) {
      if (mounted) context.showSnack(e.toString());
    }
  }

  Widget _addToCartBar(BuildContext context, ProductDetail p, bool hasStock) {
    final theme = Theme.of(context);
    return SafeArea(
      top: false,
      child: Container(
        padding: const EdgeInsets.fromLTRB(16, 12, 16, 12),
        decoration: BoxDecoration(
          color: theme.colorScheme.surface,
          boxShadow: [
            BoxShadow(
                color: Colors.black.withValues(alpha: 0.08),
                blurRadius: 12,
                offset: const Offset(0, -3)),
          ],
        ),
        child: Row(
          children: [
            // price + size reminder
            Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                Text('RM ${p.price.toStringAsFixed(2)}',
                    style: theme.textTheme.titleMedium?.copyWith(
                        color: theme.colorScheme.primary,
                        fontWeight: FontWeight.bold)),
                Text(
                  _selectedVariantId == null ? 'No size selected' : 'Size selected',
                  style: TextStyle(
                      fontSize: 11,
                      color: _selectedVariantId == null
                          ? Colors.red.shade400
                          : Colors.grey.shade500),
                ),
              ],
            ),
            const SizedBox(width: 16),
            Expanded(
              child: FilledButton.icon(
                onPressed: (!hasStock || _adding) ? null : () => _addToCart(p),
                icon: _adding
                    ? const SizedBox(
                        width: 18,
                        height: 18,
                        child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                    : const Icon(Icons.add_shopping_cart),
                label: Text(hasStock ? 'Add to Cart' : 'Out of Stock'),
                style: FilledButton.styleFrom(
                  padding: const EdgeInsets.symmetric(vertical: 14),
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// Custom size chip — larger than Flutter's default ChoiceChip,
/// with a clear selected state and strikethrough for out-of-stock.
class _SizeChip extends StatelessWidget {
  final String label;
  final bool selected;
  final bool inStock;
  final VoidCallback? onTap;

  const _SizeChip({
    required this.label,
    required this.selected,
    required this.inStock,
    this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final bg = selected
        ? theme.colorScheme.primary
        : inStock
            ? theme.colorScheme.surface
            : Colors.grey.shade100;
    final fg = selected
        ? Colors.white
        : inStock
            ? theme.colorScheme.onSurface
            : Colors.grey.shade400;
    final border = selected
        ? BorderSide.none
        : BorderSide(color: inStock ? Colors.grey.shade300 : Colors.grey.shade200);

    return GestureDetector(
      onTap: onTap,
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 150),
        padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 10),
        decoration: BoxDecoration(
          color: bg,
          border: Border.fromBorderSide(border),
          borderRadius: BorderRadius.circular(30),
        ),
        child: Text(
          label,
          style: TextStyle(
            color: fg,
            fontWeight: selected ? FontWeight.bold : FontWeight.w500,
            fontSize: 14,
            decoration: inStock ? null : TextDecoration.lineThrough,
            decorationColor: Colors.grey.shade400,
          ),
        ),
      ),
    );
  }
}

class _ReviewTile extends StatelessWidget {
  final ProductReview review;
  final bool isMine;
  final VoidCallback? onEdit;
  final VoidCallback? onDelete;
  const _ReviewTile({required this.review, this.isMine = false, this.onEdit, this.onDelete});

  @override
  Widget build(BuildContext context) {
    final primary = Theme.of(context).colorScheme.primary;
    final body = Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              CircleAvatar(
                radius: 16,
                backgroundColor: Colors.grey.shade200,
                child: Text(
                  review.customerName.isNotEmpty ? review.customerName[0].toUpperCase() : '?',
                  style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 13),
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Flexible(
                          child: Text(review.customerName,
                              maxLines: 1, overflow: TextOverflow.ellipsis,
                              style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 13)),
                        ),
                        if (isMine) ...[
                          const SizedBox(width: 6),
                          Container(
                            padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 1),
                            decoration: BoxDecoration(
                              color: primary.withValues(alpha: 0.12),
                              borderRadius: BorderRadius.circular(6),
                            ),
                            child: Text('You',
                                style: TextStyle(fontSize: 10, color: primary, fontWeight: FontWeight.w700)),
                          ),
                        ],
                      ],
                    ),
                    Row(
                      children: [
                        for (int i = 1; i <= 5; i++)
                          Icon(
                            i <= review.ratingScore ? Icons.star_rounded : Icons.star_outline_rounded,
                            color: Colors.amber.shade600,
                            size: 14,
                          ),
                      ],
                    ),
                  ],
                ),
              ),
            ],
          ),
          if ((review.comment ?? '').isNotEmpty) ...[
            const SizedBox(height: 6),
            Text(review.comment!,
                style: TextStyle(color: Colors.grey.shade700, height: 1.4)),
          ],
          if ((review.supplierReply ?? '').isNotEmpty) ...[
            const SizedBox(height: 8),
            Container(
              padding: const EdgeInsets.fromLTRB(12, 8, 12, 8),
              decoration: BoxDecoration(
                color: Colors.grey.shade100,
                borderRadius: BorderRadius.circular(8),
              ),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Icon(Icons.storefront_outlined, size: 14, color: Colors.grey.shade500),
                  const SizedBox(width: 6),
                  Expanded(
                    child: Text('Seller: ${review.supplierReply}',
                        style: TextStyle(fontSize: 12, color: Colors.grey.shade600)),
                  ),
                ],
              ),
            ),
          ],
          if (isMine) ...[
            const SizedBox(height: 2),
            Row(
              children: [
                TextButton.icon(
                  onPressed: onEdit,
                  icon: const Icon(Icons.edit, size: 15),
                  label: const Text('Edit'),
                  style: TextButton.styleFrom(visualDensity: VisualDensity.compact),
                ),
                TextButton.icon(
                  onPressed: onDelete,
                  icon: const Icon(Icons.delete_outline, size: 15),
                  label: const Text('Delete'),
                  style: TextButton.styleFrom(foregroundColor: Colors.red, visualDensity: VisualDensity.compact),
                ),
              ],
            ),
          ],
          const SizedBox(height: 4),
          const Divider(height: 1),
        ],
      );

    // Highlight the customer's own review so it's easy to spot in the list.
    if (isMine) {
      return Padding(
        padding: const EdgeInsets.only(bottom: 16),
        child: Container(
          padding: const EdgeInsets.all(12),
          decoration: BoxDecoration(
            color: Colors.grey.shade50,
            border: Border.all(color: Colors.grey.shade200),
            borderRadius: BorderRadius.circular(10),
          ),
          child: body,
        ),
      );
    }
    return Padding(padding: const EdgeInsets.only(bottom: 16), child: body);
  }
}

class _ImageCarousel extends StatefulWidget {
  final List<String> images;
  const _ImageCarousel({required this.images});

  @override
  State<_ImageCarousel> createState() => _ImageCarouselState();
}

class _ImageCarouselState extends State<_ImageCarousel> {
  final _controller = PageController();
  int _page = 0;

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final images = widget.images;
    if (images.length == 1) return ProductImage(url: images.first);

    return Stack(
      children: [
        PageView(
          controller: _controller,
          onPageChanged: (i) => setState(() => _page = i),
          children: [for (final url in images) ProductImage(url: url)],
        ),
        Positioned(
          top: 12,
          right: 12,
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
            decoration: BoxDecoration(
              color: Colors.black54,
              borderRadius: BorderRadius.circular(12),
            ),
            child: Text('${_page + 1} / ${images.length}',
                style: const TextStyle(color: Colors.white, fontSize: 12)),
          ),
        ),
        Positioned(
          left: 0,
          right: 0,
          bottom: 28,
          child: Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              for (int i = 0; i < images.length; i++)
                AnimatedContainer(
                  duration: const Duration(milliseconds: 200),
                  margin: const EdgeInsets.symmetric(horizontal: 3),
                  width: i == _page ? 18 : 6,
                  height: 6,
                  decoration: BoxDecoration(
                    color: i == _page
                        ? Theme.of(context).colorScheme.primary
                        : Colors.white70,
                    borderRadius: BorderRadius.circular(3),
                  ),
                ),
            ],
          ),
        ),
      ],
    );
  }
}
