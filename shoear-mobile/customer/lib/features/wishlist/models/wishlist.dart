/// A saved product in the wishlist (GET /wishlist → items[]).
class WishlistItem {
  final String wishlistItemId;
  final String productId;
  final String name;
  final String brand;
  final double price;
  final String? imageUrl;
  final String? categoryName;
  final double ratingAverage;
  final int ratingCount;
  final bool available;

  WishlistItem({
    required this.wishlistItemId,
    required this.productId,
    required this.name,
    required this.brand,
    required this.price,
    this.imageUrl,
    this.categoryName,
    required this.ratingAverage,
    required this.ratingCount,
    required this.available,
  });

  factory WishlistItem.fromJson(Map<String, dynamic> j) => WishlistItem(
        wishlistItemId: j['wishlistItemId'] as String? ?? '',
        productId: j['productId'] as String? ?? '',
        name: j['name'] as String? ?? '',
        brand: j['brand'] as String? ?? '',
        price: (j['price'] as num?)?.toDouble() ?? 0,
        imageUrl: (j['imageUrl'] as String?)?.isNotEmpty == true ? j['imageUrl'] as String : null,
        categoryName: j['categoryName'] as String?,
        ratingAverage: (j['ratingAverage'] as num?)?.toDouble() ?? 0,
        ratingCount: (j['ratingCount'] as num?)?.toInt() ?? 0,
        available: j['available'] == true,
      );
}

class Wishlist {
  final String wishlistId;
  final List<WishlistItem> items;  // one page of items
  final int itemCount;             // total saved (count badge)
  final int total;                 // total saved (for pagination)
  final int page;                  // which page these items are
  final List<String> savedIds;     // ALL saved product ids (hearts app-wide)

  Wishlist({
    required this.wishlistId,
    required this.items,
    required this.itemCount,
    this.total = 0,
    this.page = 1,
    this.savedIds = const [],
  });

  factory Wishlist.fromJson(Map<String, dynamic> j) => Wishlist(
        wishlistId: j['wishlistId'] as String? ?? '',
        items: ((j['items'] as List?) ?? [])
            .map((e) => WishlistItem.fromJson(e as Map<String, dynamic>))
            .toList(),
        itemCount: (j['itemCount'] as num?)?.toInt() ?? 0,
        total: (j['total'] as num?)?.toInt() ?? (j['itemCount'] as num?)?.toInt() ?? 0,
        page: (j['page'] as num?)?.toInt() ?? 1,
        savedIds: ((j['savedIds'] as List?) ?? []).map((e) => e.toString()).toList(),
      );
}
