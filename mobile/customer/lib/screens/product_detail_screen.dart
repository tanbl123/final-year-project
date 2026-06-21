import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../models/product.dart';
import '../services/catalog_service.dart';
import 'catalog_screen.dart' show ProductImage;

/// Full detail for one product: images, price, sizes, description, reviews,
/// and (when enabled) an AR try-on entry point. Cart/checkout arrive in a
/// later increment.
class ProductDetailScreen extends StatefulWidget {
  final String productId;
  const ProductDetailScreen({super.key, required this.productId});

  @override
  State<ProductDetailScreen> createState() => _ProductDetailScreenState();
}

class _ProductDetailScreenState extends State<ProductDetailScreen> {
  late Future<ProductDetail> _future;

  @override
  void initState() {
    super.initState();
    _future = context.read<CatalogService>().getProduct(widget.productId);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Product')),
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
                child: Text(snap.error.toString(), textAlign: TextAlign.center, style: const TextStyle(color: Colors.grey)),
              ),
            );
          }
          final p = snap.data!;
          return _body(context, p);
        },
      ),
    );
  }

  Widget _body(BuildContext context, ProductDetail p) {
    final theme = Theme.of(context);
    return ListView(
      children: [
        SizedBox(
          height: 300,
          child: p.images.isEmpty
              ? const ProductImage(url: null)
              : PageView(children: [for (final url in p.images) ProductImage(url: url)]),
        ),
        Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(p.brand.toUpperCase(), style: TextStyle(color: Colors.grey.shade600, letterSpacing: 0.5)),
              const SizedBox(height: 2),
              Text(p.name, style: theme.textTheme.headlineSmall?.copyWith(fontWeight: FontWeight.bold)),
              const SizedBox(height: 8),
              Text('RM ${p.price.toStringAsFixed(2)}',
                  style: theme.textTheme.titleLarge?.copyWith(color: theme.colorScheme.primary, fontWeight: FontWeight.bold)),
              if (p.ratingCount > 0) ...[
                const SizedBox(height: 4),
                Text('★ ${p.ratingAverage}  ·  ${p.ratingCount} review(s)', style: TextStyle(color: Colors.amber.shade800)),
              ],

              if (p.virtualTryOnEnable) ...[
                const SizedBox(height: 16),
                OutlinedButton.icon(
                  onPressed: () => ScaffoldMessenger.of(context).showSnackBar(
                    const SnackBar(content: Text('AR try-on is coming in the next update.')),
                  ),
                  icon: const Icon(Icons.view_in_ar),
                  label: const Text('AR Try-On'),
                ),
              ],

              const SizedBox(height: 20),
              if (p.variants.isNotEmpty) ...[
                Text('Sizes', style: theme.textTheme.titleMedium),
                const SizedBox(height: 8),
                Wrap(
                  spacing: 8,
                  runSpacing: 8,
                  children: [
                    for (final v in p.variants)
                      Chip(
                        label: Text(v.size),
                        backgroundColor: v.inStock ? null : Colors.grey.shade200,
                        labelStyle: TextStyle(
                          color: v.inStock ? null : Colors.grey,
                          decoration: v.inStock ? null : TextDecoration.lineThrough,
                        ),
                      ),
                  ],
                ),
                const SizedBox(height: 20),
              ],

              if ((p.description ?? '').isNotEmpty) ...[
                Text('Description', style: theme.textTheme.titleMedium),
                const SizedBox(height: 6),
                Text(p.description!),
                const SizedBox(height: 20),
              ],

              if (p.supplierName != null) ...[
                Text('Sold by ${p.supplierName}', style: TextStyle(color: Colors.grey.shade700)),
                const SizedBox(height: 20),
              ],

              Text('Reviews', style: theme.textTheme.titleMedium),
              const SizedBox(height: 8),
              if (p.reviews.isEmpty)
                Text('No reviews yet.', style: TextStyle(color: Colors.grey.shade600))
              else
                for (final r in p.reviews) _ReviewTile(review: r),
            ],
          ),
        ),
      ],
    );
  }
}

class _ReviewTile extends StatelessWidget {
  final ProductReview review;
  const _ReviewTile({required this.review});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 14),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Text(review.customerName, style: const TextStyle(fontWeight: FontWeight.w600)),
              const SizedBox(width: 8),
              Text('★' * review.ratingScore, style: TextStyle(color: Colors.amber.shade800)),
            ],
          ),
          if ((review.comment ?? '').isNotEmpty) Text(review.comment!),
          if ((review.supplierReply ?? '').isNotEmpty)
            Container(
              margin: const EdgeInsets.only(top: 6, left: 12),
              padding: const EdgeInsets.all(8),
              decoration: BoxDecoration(color: Colors.grey.shade100, borderRadius: BorderRadius.circular(8)),
              child: Text('Seller reply: ${review.supplierReply}', style: const TextStyle(fontSize: 13)),
            ),
        ],
      ),
    );
  }
}
