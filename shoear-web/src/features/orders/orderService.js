import { apiGet, getToken } from '../../api/client';

// Orders that contain the logged-in supplier's products (their share only).
export function getSupplierOrders(filters = {}) {
  const qs = new URLSearchParams();
  if (filters.status) qs.set('status', filters.status);
  const suffix = qs.toString() ? `?${qs.toString()}` : '';
  return apiGet(`/supplier/orders${suffix}`, getToken());
}

export function getSupplierOrder(orderId) {
  return apiGet(`/supplier/orders/${orderId}`, getToken());
}
