import '../api/api_client.dart';
import '../models/product.dart';

/// Public catalog browsing (no token required).
class CatalogService {
  final ApiClient api;
  CatalogService(this.api);

  /// GET /catalog/products — approved products, optionally filtered by search.
  Future<CatalogPage> listProducts({String? search, int page = 1, int limit = 20}) async {
    final query = <String, String>{'page': '$page', 'limit': '$limit'};
    if (search != null && search.trim().isNotEmpty) query['search'] = search.trim();
    final data = await api.get('/catalog/products', query: query);
    return CatalogPage.fromJson(data as Map<String, dynamic>);
  }

  /// GET /catalog/products/{id} — full detail of one approved product.
  Future<ProductDetail> getProduct(String id) async {
    final data = await api.get('/catalog/products/$id');
    return ProductDetail.fromJson(data as Map<String, dynamic>);
  }
}
