import '../api/api_client.dart';
import '../models/review.dart';

/// Customer review actions (require a Customer token). A customer may review a
/// product only after purchasing it, one review per product.
class ReviewService {
  final ApiClient api;
  ReviewService(this.api);

  /// GET /products/{id}/reviews/mine — my review (or null) + eligibility.
  Future<MyReviewStatus> myReview(String productId) async => MyReviewStatus.fromJson(
        await api.get('/products/$productId/reviews/mine') as Map<String, dynamic>,
      );

  /// POST /products/{id}/reviews — create. Throws on 403 (not purchased) / 409.
  Future<void> create(String productId, int rating, String? comment) async {
    await api.post('/products/$productId/reviews', {
      'ratingScore': rating,
      if (comment != null && comment.isNotEmpty) 'reviewComment': comment,
    });
  }

  /// PUT /reviews/{id} — edit my own review.
  Future<void> update(String reviewId, int rating, String? comment) async {
    await api.put('/reviews/$reviewId', {
      'ratingScore': rating,
      if (comment != null && comment.isNotEmpty) 'reviewComment': comment,
    });
  }

  /// DELETE /reviews/{id} — delete my own review.
  Future<void> delete(String reviewId) async {
    await api.delete('/reviews/$reviewId');
  }
}
