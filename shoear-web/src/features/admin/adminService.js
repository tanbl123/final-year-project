import { apiGet, apiPost, apiPut, apiPatch, apiDelete, getToken } from '../../api/client';

// Sidebar work-queue badge counts (how many items in each queue need the admin
// to act). One cheap call, polled by the sidebar. Returns { counts: {...} }.
export function getBadgeCounts() {
  return apiGet('/admin/badge-counts', getToken());
}

// Ask the sidebar to re-fetch its badge counts right now (instead of waiting
// for the next poll). Call after any action that changes a work-queue count,
// e.g. approving/rejecting a courier. The Sidebar listens for this event.
export function refreshBadges() {
  window.dispatchEvent(new Event('shoear:badges-refresh'));
}

// Platform overview dashboard: { kpis, actions, recentOrders, trend, period }.
// Optional { from, to } (YYYY-MM-DD) scopes the KPIs/trend to a period.
export function getAdminDashboard({ from, to } = {}) {
  const qs = new URLSearchParams();
  if (from && to) { qs.set('from', from); qs.set('to', to); }
  const suffix = qs.toString() ? `?${qs}` : '';
  return apiGet(`/admin/dashboard${suffix}`, getToken());
}

// Run the time-based notification sweeps on demand (payment reminders,
// abandoned-cart, review reminders, auto-cancel). Returns { swept: {...} }.
// In production a cron hits this; the button is for live demos.
export function runSweeps() {
  return apiPost('/admin/run-sweeps', {}, getToken());
}

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

// ── courier payouts ──────────────────────────────────────────────────
// Every active courier with their pending earnings balance + Stripe status.
export function getCourierPayouts() {
  return apiGet('/admin/courier-payouts', getToken());
}

// Pay a courier their whole pending balance via Stripe. Returns the payout.
export function payCourier(deliveryPersonnelId) {
  return apiPost(`/admin/couriers/${deliveryPersonnelId}/payout`, {}, getToken());
}

// A single courier's payout history.
export function getCourierPayoutHistory(deliveryPersonnelId) {
  return apiGet(`/admin/couriers/${deliveryPersonnelId}/payouts`, getToken());
}

// Nudge an approved courier who hasn't connected their bank account yet.
export function remindCourierPayout(deliveryPersonnelId) {
  return apiPost(`/admin/couriers/${deliveryPersonnelId}/remind-payout`, {}, getToken());
}

// Products awaiting approval.
export function getPendingProducts() {
  return apiGet('/admin/products/pending', getToken());
}

// Full product detail (images, description, sizes, 3D model) for review before
// approving/rejecting. Works for any status, unlike the customer catalog.
export function getAdminProduct(productId) {
  return apiGet(`/admin/products/${productId}`, getToken());
}

// Approve a pending product (status → Approved, so it's visible on the platform).
export function approveProduct(productId) {
  return apiPost(`/admin/products/${productId}/approve`, {}, getToken());
}

// Reject a pending product (status → Rejected). reason is required and is shown
// to the supplier in-app and emailed to them.
export function rejectProduct(productId, reason) {
  return apiPost(`/admin/products/${productId}/reject`, { reason }, getToken());
}

// Record (or clear) the Snapchat Camera Kit AR lens id for a product's 3D model,
// after building the foot-tracking try-on lens in Lens Studio. Pass '' to remove.
export function setProductArLens(productId, arLensId) {
  return apiPut(`/admin/products/${productId}/ar-lens`, { arLensId }, getToken());
}

// Run the product's uploaded 3D model through the ML auto-fit and return the
// analysis (dimensions, orientation confidence, anchor suggestion, occluder
// note, warnings). Pass { files: true } to also get the fitted per-foot .glb
// files as base64 (heavier — only when previewing/downloading). count is
// 'auto' | 1 | 2; side is 'left' | 'right'; length is the real shoe length (cm).
export function getProductAutofit(productId, { count = 'auto', side = 'right', length, files = false } = {}) {
  const qs = new URLSearchParams({ count: String(count), side, files: files ? '1' : '0' });
  if (length) { qs.set('length', String(length)); }
  return apiGet(`/admin/products/${productId}/autofit?${qs}`, getToken());
}

// Camera Kit config for the admin lens PICKER: the staging api token + lens group
// id, handed to a logged-in admin so their browser can list the group's lenses.
// Token stays server-side otherwise (admin-only endpoint).
export function getCameraKitConfig() {
  return apiGet('/admin/ar/camerakit-config', getToken());
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

// ── courier vehicle/licence change requests (re-approval queue) ───────
export function getCourierChangeRequests() {
  return apiGet('/admin/courier-changes', getToken());
}

export function approveCourierChangeRequest(requestId) {
  return apiPost(`/admin/courier-changes/${requestId}/approve`, {}, getToken());
}

export function rejectCourierChangeRequest(requestId, reason) {
  return apiPost(`/admin/courier-changes/${requestId}/reject`, { reason }, getToken());
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
// the auto-assigner uses) — powers the manual-assign dropdown. Pass the parcel's
// delivery state to rank couriers who COVER that area first (and flag them).
export function getCouriers(state) {
  const qs = state ? `?state=${encodeURIComponent(state)}` : '';
  return apiGet(`/admin/couriers${qs}`, getToken());
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
// Optional { from, to } (YYYY-MM-DD) scopes it to a period, and { supplierId }
// scopes it to a single company (omit/empty for all companies).
function reportQs({ from, to, supplierId } = {}) {
  const qs = new URLSearchParams();
  if (from && to) { qs.set('from', from); qs.set('to', to); }
  if (supplierId) { qs.set('supplierId', supplierId); }
  return qs.toString() ? `?${qs}` : '';
}

// Active suppliers for the report "Company" filter dropdown.
export function getReportCompanies() {
  return apiGet('/admin/reports/companies', getToken());
}

export function getCommissionReport(range = {}) {
  return apiGet(`/admin/reports/commission${reportQs(range)}`, getToken());
}

// Supplier performance leaderboard (gross, units, products, avg rating).
export function getAdminSupplierReport(range = {}) {
  return apiGet(`/admin/reports/suppliers${reportQs(range)}`, getToken());
}

// Platform-wide orders by status + on-time delivery rate.
export function getAdminOrderReport(range = {}) {
  return apiGet(`/admin/reports/orders${reportQs(range)}`, getToken());
}

// Platform-wide refunds by status + refund rate.
export function getAdminRefundReport(range = {}) {
  return apiGet(`/admin/reports/refunds${reportQs(range)}`, getToken());
}

// New sign-ups by role over a period.
export function getAdminGrowthReport(range = {}) {
  return apiGet(`/admin/reports/growth${reportQs(range)}`, getToken());
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
