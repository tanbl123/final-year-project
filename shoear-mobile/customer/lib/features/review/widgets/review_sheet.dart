import 'package:flutter/material.dart';

/// What the user entered in the review sheet (star rating + optional comment).
class ReviewResult {
  final int rating;
  final String comment;
  ReviewResult(this.rating, this.comment);
}

/// A bottom sheet for writing or editing a product review: a 1–5 star picker
/// plus an optional comment. Returns a [ReviewResult] when submitted, or null
/// when dismissed. Shared by the product page ("Write a review") and the order
/// detail ("Rate" each delivered item).
class ReviewSheet extends StatefulWidget {
  final int initialRating; // 0 = nothing selected yet (new review)
  final String initialComment;
  final bool editing; // false → "Write a review", true → "Edit your review"
  final String? productName; // shown as context when rating from an order

  const ReviewSheet({
    super.key,
    this.initialRating = 0,
    this.initialComment = '',
    this.editing = false,
    this.productName,
  });

  @override
  State<ReviewSheet> createState() => _ReviewSheetState();
}

class _ReviewSheetState extends State<ReviewSheet> {
  late int _rating = widget.initialRating;
  late final TextEditingController _comment = TextEditingController(text: widget.initialComment);

  @override
  void dispose() {
    _comment.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.only(
          left: 16, right: 16, top: 16, bottom: 16 + MediaQuery.of(context).viewInsets.bottom),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            widget.editing ? 'Edit your review' : 'Write a review',
            style: Theme.of(context).textTheme.titleLarge,
          ),
          if (widget.productName != null) ...[
            const SizedBox(height: 4),
            Text(widget.productName!,
                style: TextStyle(color: Colors.grey.shade600), maxLines: 1, overflow: TextOverflow.ellipsis),
          ],
          const SizedBox(height: 12),
          Row(
            children: [
              for (int i = 1; i <= 5; i++)
                IconButton(
                  onPressed: () => setState(() => _rating = i),
                  icon: Icon(
                    i <= _rating ? Icons.star_rounded : Icons.star_outline_rounded,
                    color: Colors.amber.shade700,
                    size: 36,
                  ),
                ),
              const SizedBox(width: 4),
              if (_rating == 0)
                Text('Tap to rate', style: TextStyle(color: Colors.grey.shade600, fontSize: 13)),
            ],
          ),
          const SizedBox(height: 8),
          TextField(
            controller: _comment,
            minLines: 2,
            maxLines: 5,
            maxLength: 1000,
            decoration: const InputDecoration(
              hintText: 'Share your thoughts (optional)',
              border: OutlineInputBorder(),
            ),
          ),
          const SizedBox(height: 8),
          SizedBox(
            width: double.infinity,
            child: FilledButton(
              // require an explicit star tap before submitting (no default rating)
              onPressed: _rating == 0
                  ? null
                  : () => Navigator.of(context).pop(ReviewResult(_rating, _comment.text.trim())),
              child: const Text('Submit'),
            ),
          ),
        ],
      ),
    );
  }
}
