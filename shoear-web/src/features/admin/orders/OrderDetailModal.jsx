import { useEffect, useState } from 'react';
import { getAdminOrder } from '../adminService';

const STATUS_COLORS = {
  Placed: 'secondary', Paid: 'info', Processing: 'primary', Shipped: 'primary',
  OutForDelivery: 'primary', Delivered: 'success', Completed: 'success', Cancelled: 'danger',
};
const PAY_COLORS = { Successful: 'success', Pending: 'warning', Failed: 'danger', Refunded: 'secondary' };
const REFUND_COLORS = { Pending: 'warning', Approved: 'info', Rejected: 'danger', Completed: 'success' };
const DELIV_COLORS = { Pending: 'warning', Assigned: 'info', PickedUp: 'primary', OutForDelivery: 'primary', Delivered: 'success', Failed: 'danger' };
const label = (s) => (s ? s.replace(/([a-z])([A-Z])/g, '$1 $2') : s);
const money = (n) => `RM ${Number(n).toFixed(2)}`;

// The full order detail (customer, payment, delivery, items, refunds) as a
// reusable block — rendered both as a standalone page and inside a popup.
export function OrderDetailBody({ order }) {
  return (
    <div className="text-start">
      <div className="d-flex flex-wrap justify-content-between align-items-start gap-2 mb-4">
        <div>
          <h2 className="mb-1">Order {order.orderId}</h2>
          <div className="text-muted">{new Date(order.orderDate).toLocaleString()}</div>
        </div>
        <div className="d-flex gap-2 flex-wrap">
          {order.partiallyDelivered
            ? <span className="badge fs-6" style={{ backgroundColor: '#4f46e5', color: '#fff' }}>Partially delivered</span>
            : <span className={`badge text-bg-${STATUS_COLORS[order.orderStatus] || 'secondary'} fs-6`}>{label(order.orderStatus)}</span>}
          {order.paymentStatus && <span className={`badge text-bg-${PAY_COLORS[order.paymentStatus] || 'secondary'} fs-6`}>{order.paymentStatus}</span>}
        </div>
      </div>

      <div className="row g-4">
        <div className="col-lg-5">
          <div className="card mb-4">
            <div className="card-header bg-white fw-semibold">Customer</div>
            <div className="card-body">
              <dl className="row mb-0">
                <dt className="col-4">Name</dt><dd className="col-8">{order.customerName}</dd>
                <dt className="col-4">Email</dt><dd className="col-8" style={{ overflowWrap: 'anywhere' }}>{order.customerEmail}</dd>
                <dt className="col-4">Phone</dt><dd className="col-8">{order.customerPhone}</dd>
                <dt className="col-4">Deliver to</dt><dd className="col-8" style={{ overflowWrap: 'anywhere' }}>{order.orderDeliveryAddress}</dd>
              </dl>
            </div>
          </div>

          <div className="card mb-4">
            <div className="card-header bg-white fw-semibold">Payment</div>
            <div className="card-body">
              {order.paymentMethod ? (
                <dl className="row mb-0">
                  <dt className="col-4">Method</dt><dd className="col-8">{order.paymentMethod}</dd>
                  <dt className="col-4">Amount</dt><dd className="col-8">{money(order.paymentAmount)}</dd>
                  <dt className="col-4">Status</dt>
                  <dd className="col-8"><span className={`badge text-bg-${PAY_COLORS[order.paymentStatus] || 'secondary'}`}>{order.paymentStatus}</span></dd>
                  <dt className="col-4">Txn</dt><dd className="col-8" style={{ overflowWrap: 'anywhere' }}>{order.transactionId || '—'}</dd>
                  <dt className="col-4">Date</dt><dd className="col-8">{order.paymentDate ? new Date(order.paymentDate).toLocaleString() : '—'}</dd>
                </dl>
              ) : <p className="text-muted mb-0">No payment recorded.</p>}
            </div>
          </div>

          <div className="card">
            <div className="card-header bg-white fw-semibold">
              Delivery
              {order.deliveries?.length > 1 && (
                <span className="text-muted small fw-normal"> · {order.deliveries.length} parcels (one per supplier)</span>
              )}
            </div>
            <div className="card-body">
              {order.deliveries?.length > 0 ? (
                order.deliveries.map((d, i) => (
                  <div key={d.deliveryId} className={i > 0 ? 'border-top pt-3 mt-3' : undefined}>
                    <dl className="row mb-0">
                      <dt className="col-4">Supplier</dt><dd className="col-8">{d.supplierName}</dd>
                      <dt className="col-4">Pickup</dt>
                      <dd className="col-8" style={{ overflowWrap: 'anywhere' }}>{d.pickupAddress}</dd>
                      <dt className="col-4">Status</dt>
                      <dd className="col-8"><span className={`badge text-bg-${DELIV_COLORS[d.deliveryStatus] || 'secondary'}`}>{label(d.deliveryStatus)}</span></dd>
                      <dt className="col-4">Courier</dt><dd className="col-8">{d.courierName || <span className="text-muted">Unassigned</span>}</dd>
                      {d.proofOfDelivery && (
                        <>
                          <dt className="col-4">Proof</dt>
                          <dd className="col-8">
                            <a href={d.proofOfDelivery} target="_blank" rel="noreferrer" title="Open full size">
                              <img src={d.proofOfDelivery} alt="Proof of delivery"
                                style={{ width: 96, height: 96, objectFit: 'cover', borderRadius: 8, border: '1px solid #dee2e6' }} />
                            </a>
                          </dd>
                        </>
                      )}
                    </dl>
                  </div>
                ))
              ) : <p className="text-muted mb-0">No delivery record.</p>}
            </div>
          </div>
        </div>

        <div className="col-lg-7">
          <div className="card">
            <div className="card-header bg-white fw-semibold">Items</div>
            <div className="card-body">
              <table className="table table-sm align-middle mb-0">
                <thead>
                  <tr>
                    <th>Product / Supplier</th>
                    <th style={{ width: 60 }}>Size</th>
                    <th className="text-end" style={{ width: 50 }}>Qty</th>
                    <th className="text-end" style={{ width: 100 }}>Unit</th>
                    <th className="text-end" style={{ width: 100 }}>Subtotal</th>
                  </tr>
                </thead>
                <tbody>
                  {order.items.map((it) => (
                    <tr key={it.orderItemId}>
                      <td>
                        <div className="fw-semibold">{it.productName}</div>
                        <div className="text-muted small">{it.brand} · {it.supplierName}</div>
                      </td>
                      <td>{it.size}</td>
                      <td className="text-end">{it.qty}</td>
                      <td className="text-end">{money(it.unitPrice)}</td>
                      <td className="text-end">{money(it.subtotal)}</td>
                    </tr>
                  ))}
                  <tr className="fw-bold border-top">
                    <td colSpan="4" className="text-end">Order total</td>
                    <td className="text-end">{money(order.orderTotalAmount)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

      {order.refunds?.length > 0 && (
        <div className="card mt-4">
          <div className="card-header bg-white fw-semibold">Refund requests</div>
          <div className="card-body">
            <table className="table table-sm align-middle mb-0">
              <thead>
                <tr>
                  <th>Reason</th>
                  <th className="text-end" style={{ width: 110 }}>Amount</th>
                  <th className="text-center" style={{ width: 120 }}>Status</th>
                  <th style={{ width: 120 }}>Requested</th>
                </tr>
              </thead>
              <tbody>
                {order.refunds.map((rf) => (
                  <tr key={rf.refundId}>
                    <td style={{ overflowWrap: 'anywhere' }}>{rf.refundReason}</td>
                    <td className="text-end">{money(rf.refundAmount)}</td>
                    <td className="text-center"><span className={`badge text-bg-${REFUND_COLORS[rf.refundStatus] || 'secondary'}`}>{rf.refundStatus}</span></td>
                    <td className="text-muted small">{new Date(rf.requestDate).toLocaleDateString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// Self-fetching popup wrapper around OrderDetailBody: pass an orderId to open,
// null to close. Lets a page (e.g. Delivery Dispatch) show a full order without
// navigating away.
function OrderDetailModal({ orderId, onClose }) {
  const [order, setOrder] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!orderId) { setOrder(null); setError(''); return; }
    setLoading(true);
    setError('');
    getAdminOrder(orderId)
      .then(setOrder)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [orderId]);

  if (!orderId) return null;
  return (
    <div className="modal show d-block" tabIndex="-1" style={{ background: 'rgba(0,0,0,.5)' }} onClick={onClose}>
      <div className="modal-dialog modal-xl modal-dialog-scrollable" onClick={(e) => e.stopPropagation()}>
        <div className="modal-content">
          <div className="modal-header">
            <h5 className="modal-title">Order detail</h5>
            <button type="button" className="btn-close" onClick={onClose}></button>
          </div>
          <div className="modal-body">
            {loading || (!order && !error) ? (
              <p className="text-muted mb-0">Loading…</p>
            ) : error ? (
              <div className="alert alert-danger mb-0">{error}</div>
            ) : (
              <OrderDetailBody order={order} />
            )}
          </div>
          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={onClose}>Close</button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default OrderDetailModal;
