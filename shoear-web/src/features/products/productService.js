import { apiGet, apiPost, apiDelete, getToken } from '../../api/client';

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

export function deleteProduct(id) {
  return apiDelete('/products/' + id, getToken());
}

export function fetchCategories() {
  return apiGet('/categories', getToken());
}
