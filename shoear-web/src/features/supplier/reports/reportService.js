import { apiGet, getToken } from '../../../api/client';

// The signed-in supplier's own sales report (summary + per-product breakdown).
// Optional { from, to } (YYYY-MM-DD) scopes it to a reporting period.
export function getSalesReport({ from, to } = {}) {
  const qs = new URLSearchParams();
  if (from && to) { qs.set('from', from); qs.set('to', to); }
  const suffix = qs.toString() ? `?${qs}` : '';
  return apiGet(`/reports/sales${suffix}`, getToken());
}

// The supplier's overview dashboard: { kpis, actions, recentOrders, trend }.
export function getSupplierDashboard() {
  return apiGet('/supplier/dashboard', getToken());
}
