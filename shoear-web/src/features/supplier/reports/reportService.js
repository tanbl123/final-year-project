import { apiGet, getToken } from '../../../api/client';

// Build a "?from=&to=" suffix for a reporting period (empty when all-time).
function periodQs({ from, to } = {}) {
  const qs = new URLSearchParams();
  if (from && to) { qs.set('from', from); qs.set('to', to); }
  return qs.toString() ? `?${qs}` : '';
}

// The signed-in supplier's own sales report (summary + per-product breakdown).
// Optional { from, to } (YYYY-MM-DD) scopes it to a reporting period.
export function getSalesReport(range = {}) {
  return apiGet(`/reports/sales${periodQs(range)}`, getToken());
}

// Product performance — every approved product's units/revenue (incl. no-sales).
export function getProductReport(range = {}) {
  return apiGet(`/reports/products${periodQs(range)}`, getToken());
}

// Current stock snapshot + valuation (no period — it's a live snapshot).
export function getInventoryReport() {
  return apiGet('/reports/inventory', getToken());
}

// Order & fulfilment — this supplier's parcels by status + on-time rate.
export function getFulfilmentReport(range = {}) {
  return apiGet(`/reports/orders${periodQs(range)}`, getToken());
}

// Refunds raised on orders containing this supplier's products.
export function getRefundReport(range = {}) {
  return apiGet(`/reports/refunds${periodQs(range)}`, getToken());
}

// The supplier's overview dashboard: { kpis, actions, recentOrders, trend, period }.
// Optional { from, to } (YYYY-MM-DD) scopes the KPIs/trend to a period.
export function getSupplierDashboard({ from, to } = {}) {
  const qs = new URLSearchParams();
  if (from && to) { qs.set('from', from); qs.set('to', to); }
  const suffix = qs.toString() ? `?${qs}` : '';
  return apiGet(`/supplier/dashboard${suffix}`, getToken());
}
