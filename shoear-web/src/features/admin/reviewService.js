import { apiGet, apiPut, apiPatch, apiDelete, getToken } from '../../api/client';

// Supplier: add or edit their reply to a review on their product.
export function replyToReview(reviewId, reply) {
  return apiPut(`/supplier/reviews/${reviewId}/reply`, { reply }, getToken());
}

// Supplier: delete their own reply.
export function deleteReviewReply(reviewId) {
  return apiDelete(`/supplier/reviews/${reviewId}/reply`, getToken());
}

// Supplier: all reviews across their products (unreplied first). { reviews: [...] }.
export function getSupplierReviews() {
  return apiGet('/supplier/reviews', getToken());
}

// Admin moderation: remove an inappropriate supplier reply (review text kept).
export function removeReviewReply(reviewId) {
  return apiPatch(`/admin/reviews/${reviewId}/remove-reply`, {}, getToken());
}

// Admin: all reviews. filters: { status, rating, search }.
export function getAdminReviews(filters = {}) {
  const qs = new URLSearchParams();
  if (filters.status) qs.set('status', filters.status);
  if (filters.rating) qs.set('rating', filters.rating);
  if (filters.search) qs.set('search', filters.search);
  const suffix = qs.toString() ? `?${qs.toString()}` : '';
  return apiGet(`/admin/reviews${suffix}`, getToken());
}

// Admin moderation: status = 'Removed' | 'Published'.
export function setReviewStatus(reviewId, status) {
  return apiPatch(`/admin/reviews/${reviewId}/status`, { status }, getToken());
}
