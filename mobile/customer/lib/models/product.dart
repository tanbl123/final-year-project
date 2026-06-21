/// A product as it appears in the catalog list (GET /catalog/products).
class ProductSummary {
  final String id;
  final String name;
  final String brand;
  final double price;
  final bool virtualTryOnEnable;
  final String? categoryName;
  final String? imageUrl;
  final double ratingAverage;
  final int ratingCount;

  ProductSummary({
    required this.id,
    required this.name,
    required this.brand,
    required this.price,
    required this.virtualTryOnEnable,
    this.categoryName,
    this.imageUrl,
    required this.ratingAverage,
    required this.ratingCount,
  });

  factory ProductSummary.fromJson(Map<String, dynamic> j) => ProductSummary(
        id: j['id'] as String,
        name: j['name'] as String? ?? '',
        brand: j['brand'] as String? ?? '',
        price: (j['price'] as num?)?.toDouble() ?? 0,
        virtualTryOnEnable: j['virtualTryOnEnable'] == true,
        categoryName: j['categoryName'] as String?,
        imageUrl: (j['imageUrl'] as String?)?.isNotEmpty == true ? j['imageUrl'] as String : null,
        ratingAverage: (j['ratingAverage'] as num?)?.toDouble() ?? 0,
        ratingCount: (j['ratingCount'] as num?)?.toInt() ?? 0,
      );
}

/// One page of catalog results.
class CatalogPage {
  final List<ProductSummary> items;
  final int page;
  final int limit;
  final int total;

  CatalogPage({required this.items, required this.page, required this.limit, required this.total});

  factory CatalogPage.fromJson(Map<String, dynamic> j) => CatalogPage(
        items: ((j['items'] as List?) ?? [])
            .map((e) => ProductSummary.fromJson(e as Map<String, dynamic>))
            .toList(),
        page: (j['page'] as num?)?.toInt() ?? 1,
        limit: (j['limit'] as num?)?.toInt() ?? 20,
        total: (j['total'] as num?)?.toInt() ?? 0,
      );
}

/// A size/stock option for a product (product_variant).
class ProductVariant {
  final String variantId;
  final String size;
  final int stock;

  ProductVariant({required this.variantId, required this.size, required this.stock});

  factory ProductVariant.fromJson(Map<String, dynamic> j) => ProductVariant(
        variantId: j['variantId'] as String? ?? '',
        size: j['size']?.toString() ?? '',
        stock: (j['stock'] as num?)?.toInt() ?? 0,
      );

  bool get inStock => stock > 0;
}

/// A published review on a product.
class ProductReview {
  final String customerName;
  final int ratingScore;
  final String? comment;
  final String? date;
  final String? supplierReply;

  ProductReview({
    required this.customerName,
    required this.ratingScore,
    this.comment,
    this.date,
    this.supplierReply,
  });

  factory ProductReview.fromJson(Map<String, dynamic> j) => ProductReview(
        customerName: j['customerName'] as String? ?? 'Customer',
        ratingScore: (j['ratingScore'] as num?)?.toInt() ?? 0,
        comment: j['reviewComment'] as String?,
        date: j['reviewDate'] as String?,
        supplierReply: j['supplierReply'] as String?,
      );
}

/// Full product detail (GET /catalog/products/{id}).
class ProductDetail {
  final String id;
  final String name;
  final String brand;
  final String? description;
  final double price;
  final bool virtualTryOnEnable;
  final String? categoryName;
  final String? supplierName;
  final List<String> images;
  final String? modelUrl;
  final List<ProductVariant> variants;
  final List<ProductReview> reviews;
  final double ratingAverage;
  final int ratingCount;

  ProductDetail({
    required this.id,
    required this.name,
    required this.brand,
    this.description,
    required this.price,
    required this.virtualTryOnEnable,
    this.categoryName,
    this.supplierName,
    required this.images,
    this.modelUrl,
    required this.variants,
    required this.reviews,
    required this.ratingAverage,
    required this.ratingCount,
  });

  factory ProductDetail.fromJson(Map<String, dynamic> j) => ProductDetail(
        id: j['id'] as String,
        name: j['name'] as String? ?? '',
        brand: j['brand'] as String? ?? '',
        description: j['description'] as String?,
        price: (j['price'] as num?)?.toDouble() ?? 0,
        virtualTryOnEnable: j['virtualTryOnEnable'] == true,
        categoryName: j['categoryName'] as String?,
        supplierName: j['supplierName'] as String?,
        images: ((j['images'] as List?) ?? []).map((e) => e.toString()).toList(),
        modelUrl: j['modelUrl'] as String?,
        variants: ((j['variants'] as List?) ?? [])
            .map((e) => ProductVariant.fromJson(e as Map<String, dynamic>))
            .toList(),
        reviews: ((j['reviews'] as List?) ?? [])
            .map((e) => ProductReview.fromJson(e as Map<String, dynamic>))
            .toList(),
        ratingAverage: (j['ratingAverage'] as num?)?.toDouble() ?? 0,
        ratingCount: (j['ratingCount'] as num?)?.toInt() ?? 0,
      );
}
