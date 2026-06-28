import 'package:customer/core/api/api_client.dart';
import 'package:customer/features/wishlist/models/wishlist.dart';

/// Wishlist calls (all require a Customer token). Each returns the full wishlist.
class WishlistService {
  final ApiClient api;
  WishlistService(this.api);

  /// GET /wishlist — one page of items + the full saved-id set.
  Future<Wishlist> getWishlist({int page = 1, int limit = 20}) async =>
      Wishlist.fromJson(await api.get('/wishlist',
          query: {'page': '$page', 'limit': '$limit'}) as Map<String, dynamic>);

  /// POST /wishlist/items — save a product (idempotent).
  Future<Wishlist> add(String productId) async =>
      Wishlist.fromJson(await api.post('/wishlist/items', {'productId': productId}) as Map<String, dynamic>);

  /// DELETE /wishlist/items/{productId}
  Future<Wishlist> remove(String productId) async =>
      Wishlist.fromJson(await api.delete('/wishlist/items/$productId') as Map<String, dynamic>);
}
