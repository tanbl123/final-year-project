import { apiGet, apiPost, apiPut, apiPatch, apiDelete, getToken } from '../../api/client';

// Suppliers awaiting approval.
export function getPendingSuppliers() {
  return apiGet('/admin/suppliers/pending', getToken());
}

// Approve a pending supplier (status → Active, so they can log in).
export function approveSupplier(userId) {
  return apiPost(`/admin/suppliers/${userId}/approve`, {}, getToken());
}

// Reject a pending supplier. reason is required and shown to the supplier;
// terminal=true bans them permanently, otherwise they may fix it and resubmit.
export function rejectSupplier(userId, { reason, terminal = false } = {}) {
  return apiPost(`/admin/suppliers/${userId}/reject`, { reason, terminal }, getToken());
}

// ── courier (delivery personnel) approvals ───────────────────────────
// Couriers awaiting approval (self-applied via the delivery app).
export function getPendingCouriers() {
  return apiGet('/admin/couriers/pending', getToken());
}

// Approve a pending courier (status → Active, so they can log in).
export function approveCourier(userId) {
  return apiPost(`/admin/couriers/${userId}/approve`, {}, getToken());
}

// Reject a pending courier. reason is required and shown to the courier at login;
// terminal=true bans them permanently.
export function rejectCourier(userId, { reason, terminal = false } = {}) {
  return apiPost(`/admin/couriers/${userId}/reject`, { reason, terminal }, getToken());
}

// Products awaiting approval.
export function getPendingProducts() {
  return apiGet('/admin/products/pending', getToken());
}

// Approve a pending product (status → Approved, so it's visible on the platform).
export function approveProduct(productId) {
  return apiPost(`/admin/products/${productId}/approve`, {}, getToken());
}

// Reject a pending product (status → Rejected).
export function rejectProduct(productId) {
  return apiPost(`/admin/products/${productId}/reject`, {}, getToken());
}

// ── supplier business-detail change requests (re-approval queue) ──────
export function getSupplierChangeRequests() {
  return apiGet('/admin/supplier-changes', getToken());
}

export function approveChangeRequest(requestId) {
  return apiPost(`/admin/supplier-changes/${requestId}/approve`, {}, getToken());
}

export function rejectChangeRequest(requestId, reason) {
  return apiPost(`/admin/supplier-changes/${requestId}/reject`, { reason }, getToken());
}

// ── category management ──────────────────────────────────────────────
// List categories with how many products use each.
export function getCategoriesAdmin() {
  return apiGet('/admin/categories', getToken());
}

export function createCategory(name) {
  return apiPost('/admin/categories', { name }, getToken());
}

export function renameCategory(id, name) {
  return apiPut(`/admin/categories/${id}`, { name }, getToken());
}

export function deleteCategory(id) {
  return apiDelete(`/admin/categories/${id}`, getToken());
}

// ── user management ──────────────────────────────────────────────────
// filters: { role, status, search } — any can be omitted/empty.
export function getUsers(filters = {}) {
  const qs = new URLSearchParams();
  if (filters.role) qs.set('role', filters.role);
  if (filters.status) qs.set('status', filters.status);
  if (filters.search) qs.set('search', filters.search);
  const suffix = qs.toString() ? `?${qs.toString()}` : '';
  return apiGet(`/admin/users${suffix}`, getToken());
}

export function getUser(userId) {
  return apiGet(`/admin/users/${userId}`, getToken());
}

export function setUserStatus(userId, status) {
  return apiPatch(`/admin/users/${userId}/status`, { status }, getToken());
}

// ── delivery dispatch ────────────────────────────────────────────────
// filters: { status, unassigned } — any can be omitted/empty.
export function getDeliveries(filters = {}) {
  const qs = new URLSearchParams();
  if (filters.status) qs.set('status', filters.status);
  if (filters.unassigned) qs.set('unassigned', '1');
  const suffix = qs.toString() ? `?${qs.toString()}` : '';
  return apiGet(`/admin/deliveries${suffix}`, getToken());
}

// The Active courier roster, ranked best-first by current load (same scoring
// the auto-assigner uses) — powers the manual-assign dropdown.
export function getCouriers() {
  return apiGet('/admin/couriers', getToken());
}

// Manually (re)assign a courier to a delivery.
export function assignDelivery(deliveryId, deliveryPersonnelId) {
  return apiPost(`/admin/deliveries/${deliveryId}/assign`, { deliveryPersonnelId }, getToken());
}

// Delivery issues reported by couriers. Optional { status: 'Open' | 'Resolved' }.
export function getDeliveryIssues(filters = {}) {
  const qs = new URLSearchParams();
  if (filters.status) qs.set('status', filters.status);
  const suffix = qs.toString() ? `?${qs.toString()}` : '';
  return apiGet(`/admin/delivery-issues${suffix}`, getToken());
}

// Mark a reported issue resolved.
export function resolveDeliveryIssue(issueId) {
  return apiPatch(`/admin/delivery-issues/${issueId}/resolve`, {}, getToken());
}

// ── reports ──────────────────────────────────────────────────────────
// Platform commission across all suppliers (paid orders only).
export function getCommissionReport() {
  return apiGet('/admin/reports/commission', getToken());
}

// ── order oversight ──────────────────────────────────────────────────
// filters: { status, search }
export function getAdminOrders(filters = {}) {
  const qs = new URLSearchParams();
  if (filters.status) qs.set('status', filters.status);
  if (filters.search) qs.set('search', filters.search);
  const suffix = qs.toString() ? `?${qs.toString()}` : '';
  return apiGet(`/admin/orders${suffix}`, getToken());
}

export function getAdminOrder(orderId) {
  return apiGet(`/admin/orders/${orderId}`, getToken());
}

// ── product inventory across all suppliers ───────────────────────────
// filters: { status, search }
export function getAdminInventory(filters = {}) {
  const qs = new URLSearchParams();
  if (filters.status) qs.set('status', filters.status);
  if (filters.search) qs.set('search', filters.search);
  const suffix = qs.toString() ? `?${qs.toString()}` : '';
  return apiGet(`/admin/inventory${suffix}`, getToken());
}

// ── commission rate configuration ────────────────────────────────────
// Current active rate + the full change history.
export function getCommission() {
  return apiGet('/admin/commission', getToken());
}

// Set a new active rate (percentage 0–100); deactivates the previous one.
export function setCommission(commissionRateValue) {
  return apiPost('/admin/commission', { commissionRateValue }, getToken());
}
