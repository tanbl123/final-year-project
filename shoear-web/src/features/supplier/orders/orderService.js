import { apiGet, apiPost, apiPatch, getToken } from '../../../api/client';

// Carriers a supplier can pick when shipping a Standard (3PL) parcel.
export const STANDARD_CARRIERS = ['J&T Express', 'Pos Laju', 'Ninja Van', 'DHL eCommerce', 'GDEX', 'City-Link', 'Other'];

// Ship a Standard parcel: record the carrier + tracking number (Pending → in transit).
export function shipStandardParcel(deliveryId, carrier, trackingNumber) {
  return apiPost(`/supplier/deliveries/${deliveryId}/ship`, { carrier, trackingNumber }, getToken());
}

// Auto-book the shipment via EasyParcel (generates the carrier + tracking number).
export function bookStandardParcel(deliveryId) {
  return apiPost(`/supplier/deliveries/${deliveryId}/ship`, { auto: true }, getToken());
}

// Auto-book & ship ALL of this supplier's pending Standard parcels in one go.
// Resolves with { total, booked, failed }.
export function shipAllPendingStandard() {
  return apiPost('/supplier/deliveries/ship-all-pending', {}, getToken());
}

// Turn the standing auto-ship preference on/off.
export function setAutoShip(enabled) {
  return apiPatch('/supplier/auto-ship', { enabled }, getToken());
}

// Mark a shipped Standard parcel as delivered.
export function markStandardDelivered(deliveryId) {
  return apiPost(`/supplier/deliveries/${deliveryId}/delivered`, {}, getToken());
}

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
