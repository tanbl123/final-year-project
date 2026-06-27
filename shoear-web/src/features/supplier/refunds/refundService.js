import { apiGet, apiPatch, getToken } from '../../../api/client';

// Admin: all refund requests. filters: { status }.
export function getRefunds(filters = {}) {
  const qs = new URLSearchParams();
  if (filters.status) qs.set('status', filters.status);
  const suffix = qs.toString() ? `?${qs.toString()}` : '';
  return apiGet(`/admin/refunds${suffix}`, getToken());
}

// Admin: move a refund along its flow. status = 'Approved' | 'Rejected' | 'Completed'.
export function setRefundStatus(refundId, status) {
  return apiPatch(`/admin/refunds/${refundId}/status`, { status }, getToken());
}

// Supplier: refunds on orders containing their products (read-only). { status }.
export function getSupplierRefunds(filters = {}) {
  const qs = new URLSearchParams();
  if (filters.status) qs.set('status', filters.status);
  const suffix = qs.toString() ? `?${qs.toString()}` : '';
  return apiGet(`/supplier/refunds${suffix}`, getToken());
}

// refundProof may be a single URL (legacy) or a JSON array of URLs (multiple
// evidence photos). Always return an array of URLs for display.
export function refundProofUrls(proof) {
  if (!proof) return [];
  try {
    const arr = JSON.parse(proof);
    if (Array.isArray(arr)) return arr.filter(Boolean);
  } catch {
    /* not JSON → treat as a single URL */
  }
  return [proof];
}
