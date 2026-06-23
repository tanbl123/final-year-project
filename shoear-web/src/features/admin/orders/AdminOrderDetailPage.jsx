import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { getAdminOrder } from '../adminService';
import BackButton from '../../../components/BackButton';

const STATUS_COLORS = {
  Placed: 'secondary', Paid: 'info', Processing: 'primary', Shipped: 'primary',
  OutForDelivery: 'primary', Delivered: 'success', Completed: 'success', Cancelled: 'danger',
};
const PAY_COLORS = { Successful: 'success', Pending: 'warning', Failed: 'danger', Refunded: 'secondary' };
const REFUND_COLORS = { Pending: 'warning', Approved: 'info', Rejected: 'danger', Completed: 'success' };
const DELIV_COLORS = { Pending: 'warning', Assigned: 'info', PickedUp: 'primary', OutForDelivery: 'primary', Delivered: 'success', Failed: 'danger' };
const label = (s) => (s ? s.replace(/([a-z])([A-Z])/g, '$1 $2') : s);
const money = (n) => `RM ${Number(n).toFixed(2)}`;

function AdminOrderDetailPage() {
  const { orderId } = useParams();
  const [order, setOrder] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    getAdminOrder(orderId)
      .then((data) => setOrder(data))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [orderId]);

  if (loading) return <div className="container py-4"><p className="text-muted">Loading…</p></div>;
  if (error) {
    return (
      <div className="container py-4 text-start">
        <BackButton to="/admin/orders" />
        <div className="alert alert-danger mt-3">{error}</div>
      </div>
    );
  }

  return (
    <div className="container py-4 text-start">
      <BackButton to="/admin/orders" />

      <div className="d-flex flex-wrap justify-content-between align-items-start gap-2 mt-2 mb-4">
        <div>
          <h2 className="mb-1">Order {order.orderId}</h2>
          <div className="text-muted">{new Date(order.orderDate).toLocaleString()}</div>
        </div>
        <div className="d-flex gap-2 flex-wrap">
          <span className={`badge text-bg-${STATUS_COLORS[order.orderStatus] || 'secondary'} fs-6`}>{label(order.orderStatus)}</span>
          {order.paymentStatus && <span className={`badge text-bg-${PAY_COLORS[order.paymentStatus] || 'secondary'} fs-6`}>{order.paymentStatus}</span>}
        </div>
      </div>

      <div className="row g-4">
        {/* customer + payment + delivery */}
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
                    </dl>
                  </div>
                ))
              ) : <p className="text-muted mb-0">No delivery record.</p>}
            </div>
          </div>
        </div>

        {/* items */}
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

export default AdminOrderDetailPage;
