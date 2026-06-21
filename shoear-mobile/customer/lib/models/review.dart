/// The signed-in customer's own review for a product (or null), with whether
/// they're allowed to write one (GET /products/{id}/reviews/mine).
class MyReview {
  final String reviewId;
  final int ratingScore;
  final String? reviewComment;
  final String? reviewDate;
  final String reviewStatus;

  MyReview({required this.reviewId, required this.ratingScore, this.reviewComment, this.reviewDate, required this.reviewStatus});

  factory MyReview.fromJson(Map<String, dynamic> j) => MyReview(
        reviewId: j['reviewId'] as String,
        ratingScore: (j['ratingScore'] as num?)?.toInt() ?? 0,
        reviewComment: j['reviewComment'] as String?,
        reviewDate: j['reviewDate'] as String?,
        reviewStatus: j['reviewStatus'] as String? ?? 'Published',
      );
}

class MyReviewStatus {
  final MyReview? myReview;
  final bool canReview;

  MyReviewStatus({this.myReview, required this.canReview});

  factory MyReviewStatus.fromJson(Map<String, dynamic> j) => MyReviewStatus(
        myReview: j['myReview'] is Map ? MyReview.fromJson(j['myReview'] as Map<String, dynamic>) : null,
        canReview: j['canReview'] == true,
      );
}
