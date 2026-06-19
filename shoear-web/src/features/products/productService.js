import { apiGet, apiPost, apiPut, apiPatch, apiDelete, apiUpload, getToken } from '../../api/client';

// All product data now comes from the real PHP API (with the JWT token).

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
