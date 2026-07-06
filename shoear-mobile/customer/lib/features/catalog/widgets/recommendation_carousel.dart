import 'package:flutter/material.dart';

import 'package:customer/core/widgets/product_image.dart';
import 'package:customer/features/catalog/models/product.dart';
import 'package:customer/features/catalog/screens/product_detail_screen.dart';

/// A titled horizontal carousel of recommended products. Self-loading: it runs
/// [loader] and quietly renders nothing while loading, on error, or when there
/// are no results — so a screen can drop it in without extra state.
///
/// Bump [reloadTick] to refresh SILENTLY: it keeps the current products on
/// screen and swaps them only once the fresh ones arrive (no spinner flash),
/// which lets the home page auto-refresh on a timer without visual jank.
class RecommendationCarousel extends StatefulWidget {
  final String title;
  final Future<List<ProductSummary>> Function() loader;
  final int reloadTick;

  const RecommendationCarousel({
    super.key,
    required this.title,
    required this.loader,
    this.reloadTick = 0,
  });

  @override
  State<RecommendationCarousel> createState() => _RecommendationCarouselState();
}

class _RecommendationCarouselState extends State<RecommendationCarousel> {
  List<ProductSummary>? _items;   // null = still loading for the first time
  bool _failed = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void didUpdateWidget(RecommendationCarousel old) {
    super.didUpdateWidget(old);
    if (widget.reloadTick != old.reloadTick) _load(silent: true);
  }

  Future<void> _load({bool silent = false}) async {
    if (!silent) setState(() { _items = null; _failed = false; });
    try {
      final items = await widget.loader();
      if (mounted) setState(() { _items = items; _failed = false; });
    } catch (_) {
      // Silent refresh keeps whatever is already on screen; a failed first load
      // hides the rail.
      if (mounted && !silent) setState(() { _failed = true; _items = null; });
    }
  }

  @override
  Widget build(BuildContext context) {
    final items = _items;
    if (items == null) {
      if (_failed) return const SizedBox.shrink();
      return const SizedBox(
        height: 60,
        child: Center(child: SizedBox(width: 22, height: 22, child: CircularProgressIndicator(strokeWidth: 2))),
      );
    }
    if (items.isEmpty) return const SizedBox.shrink(); // hide when nothing to show

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 8, 16, 8),
          child: Text(widget.title, style: const TextStyle(fontSize: 16, fontWeight: FontWeight.bold)),
        ),
        SizedBox(
          height: 240,
          child: ListView.separated(
            scrollDirection: Axis.horizontal,
            padding: const EdgeInsets.symmetric(horizontal: 12),
            itemCount: items.length,
            separatorBuilder: (_, __) => const SizedBox(width: 8),
            itemBuilder: (_, i) => _RecCard(product: items[i]),
          ),
        ),
      ],
    );
  }
}

// A compact, fixed-width product card for the horizontal carousel — same visual
// language as the catalog grid card.
class _RecCard extends StatelessWidget {
  final ProductSummary product;
  const _RecCard({required this.product});

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: 150,
      child: Card(
        clipBehavior: Clip.antiAlias,
        child: InkWell(
          onTap: () => Navigator.of(context).push(
            MaterialPageRoute(builder: (_) => ProductDetailScreen(productId: product.id)),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // The image flexes to absorb any slack, so the card never overflows
              // regardless of how tall the text block below gets (e.g. the rating line).
              Expanded(
                child: SizedBox(
                  width: double.infinity,
                  child: Stack(
                    fit: StackFit.expand,
                    children: [
                      ProductImage(url: product.imageUrl),
                      if (product.virtualTryOnEnable)
                        Positioned(
                          top: 6, left: 6,
                          child: Container(
                            padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 3),
                            decoration: BoxDecoration(color: Colors.black87, borderRadius: BorderRadius.circular(10)),
                            child: const Text('AR', style: TextStyle(color: Colors.white, fontSize: 10, fontWeight: FontWeight.bold)),
                          ),
                        ),
                    ],
                  ),
                ),
              ),
              Padding(
                padding: const EdgeInsets.all(8),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(product.brand.toUpperCase(),
                        maxLines: 1, overflow: TextOverflow.ellipsis,
                        style: TextStyle(fontSize: 10, color: Colors.grey.shade600, letterSpacing: 0.5)),
                    Text(product.name,
                        maxLines: 2, overflow: TextOverflow.ellipsis,
                        style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 13)),
                    const SizedBox(height: 4),
                    Text('RM ${product.price.toStringAsFixed(2)}',
                        style: TextStyle(fontWeight: FontWeight.bold, color: Theme.of(context).colorScheme.primary)),
                    if (product.ratingCount > 0)
                      Text('★ ${product.ratingAverage} (${product.ratingCount})',
                          style: TextStyle(fontSize: 11, color: Colors.amber.shade800)),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
