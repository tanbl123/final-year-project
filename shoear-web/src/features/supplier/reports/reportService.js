import { apiGet, getToken } from '../../../api/client';

// The signed-in supplier's own sales report (summary + per-product breakdown).
export function getSalesReport() {
  return apiGet('/reports/sales', getToken());
}
