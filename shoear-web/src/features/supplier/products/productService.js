import { apiGet, apiPost, apiPut, apiPatch, apiDelete, apiUpload, getToken } from '../../../api/client';

// All product data now comes from the real PHP API (with the JWT token).

// Supplier sidebar badge counts (e.g. { inventory: <items needing restock> }).
export function getSupplierBadgeCounts() {
  return apiGet('/supplier/badge-counts', getToken());
}

// Ask the sidebar to re-fetch its badge counts now (e.g. after a stock save),
// instead of waiting for the next poll. The Sidebar listens for this event.
export function refreshBadges() {
  window.dispatchEvent(new Event('shoear:badges-refresh'));
}

export function fetchProducts() {
  return apiGet('/products', getToken());
}

export function fetchProductById(id) {
  return apiGet('/products/' + id, getToken());
}

export function createProduct(data) {
  return apiPost('/products', data, getToken());
}

export function updateProduct(id, data) {
  return apiPut('/products/' + id, data, getToken());
}

export function deleteProduct(id) {
  return apiDelete('/products/' + id, getToken());
}

export function fetchCategories() {
  return apiGet('/categories', getToken());
}

// ── inventory (quick stock management) ──
export function getInventory() {
  return apiGet('/supplier/inventory', getToken());
}

// updates: [{ variantId, stock }]
export function updateInventory(updates) {
  return apiPatch('/supplier/inventory', { updates }, getToken());
}

// Upload one file (kind = 'image' | 'model'); resolves to { url }.
export function uploadFile(file, kind) {
  const form = new FormData();
  form.append('kind', kind);
  form.append('file', file);
  return apiUpload('/uploads', form, getToken());
}

// Fail-fast AR validation of a just-uploaded 3D model. Returns
// { available, rejected, rejectReason, warnings, shoeCount, dimensionsCm, ... }.
// available=false means the AR service is offline (upload should still proceed).
export function validateModel(modelUrl) {
  return apiPost('/supplier/models/validate', { modelUrl }, getToken());
}
