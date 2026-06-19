import { apiGet, apiPatch, getToken } from '../../api/client';

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
