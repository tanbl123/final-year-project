import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { getSupplierOrder } from '../orderService';
import BackButton from '../../../components/BackButton';

const STATUS_COLORS = {
  Placed: 'secondary', Paid: 'info', Processing: 'primary', Shipped: 'primary',
  OutForDelivery: 'primary', Delivered: 'success', Completed: 'success', Cancelled: 'danger',
};
const PAY_COLORS = { Successful: 'success', Pending: 'warning', Failed: 'danger', Refunded: 'secondary' };
const REFUND_COLORS = { Pending: 'warning', Approved: 'info', Rejected: 'danger', Completed: 'success' };
const label = (s) => s.replace(/([a-z])([A-Z])/g, '$1 $2');
const money = (n) => `RM ${Number(n).toFixed(2)}`;

function SupplierOrderDetailPage() {
  const { orderId } = useParams();
  const [order, setOrder] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    getSupplierOrder(orderId)
      .then((data) => setOrder(data))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [orderId]);

  if (loading) {
    return <div className="container py-4"><p className="text-muted">Loading…</p></div>;
  }
  if (error) {
    return (
      <div className="container py-4 text-start">
        <BackButton to="/orders" />
        <div className="alert alert-danger mt-3">{error}</div>
      </div>
    );
  }

  return (
    <div className="container py-4 text-start">
      <BackButton to="/orders" />

      {/* header */}
      <div className="d-flex flex-wrap justify-content-between align-items-start gap-2 mt-2 mb-4">
        <div>
          <h2 className="mb-1">Order {order.orderId}</h2>
          <div className="text-muted">{new Date(order.orderDate).toLocaleString()}</div>
        </div>
        <div className="d-flex gap-2">
          <span className={`badge text-bg-${STATUS_COLORS[order.orderStatus] || 'secondary'} fs-6`}>
            {label(order.orderStatus)}
          </span>
          {order.paymentStatus && (
            <span className={`badge text-bg-${PAY_COLORS[order.paymentStatus] || 'secondary'} fs-6`}>
              {order.paymentStatus}
            </span>
          )}
        </div>
      </div>

      {/* summary tiles */}
      <div className="row g-3 mb-4">
        <div className="col-6 col-md-3">
          <div className="card card-body py-3">
            <div className="text-muted small text-uppercase">Your items</div>
            <div className="fs-4 fw-bold">{order.itemCount}</div>
          </div>
        </div>
        <div className="col-6 col-md-3">
          <div className="card card-body py-3">
            <div className="text-muted small text-uppercase">Your subtotal</div>
            <div className="fs-4 fw-bold text-primary">{money(order.supplierSubtotal)}</div>
          </div>
        </div>
      </div>

      <div className="row g-4">
        {/* customer & payment (no delivery address — PDPA: the supplier doesn't
            deliver, so they don't receive the customer's address/contact) */}
        <div className="col-lg-5">
          <div className="card h-100">
            <div className="card-header bg-white fw-semibold">Customer &amp; payment</div>
            <div className="card-body">
              <dl className="row mb-0">
                <dt className="col-4">Customer</dt>
                <dd className="col-8">{order.customerName}</dd>
                <dt className="col-4">Payment</dt>
                <dd className="col-8">
                  {order.paymentStatus
                    ? <span className={`badge text-bg-${PAY_COLORS[order.paymentStatus] || 'secondary'}`}>{order.paymentStatus}</span>
                    : <span className="text-muted">—</span>}
                </dd>
              </dl>
            </div>
          </div>
        </div>

        {/* items */}
        <div className="col-lg-7">
          <div className="card h-100">
            <div className="card-header bg-white fw-semibold">Your items in this order</div>
            <div className="card-body">
              <table className="table table-sm align-middle mb-2">
                <thead>
                  <tr>
                    <th>Product</th>
                    <th style={{ width: 70 }}>Size</th>
                    <th className="text-end" style={{ width: 55 }}>Qty</th>
                    <th className="text-end" style={{ width: 110 }}>Unit price</th>
                    <th className="text-end" style={{ width: 110 }}>Subtotal</th>
                  </tr>
                </thead>
                <tbody>
                  {order.items.map((it) => (
                    <tr key={it.orderItemId}>
                      <td>
                        <div className="fw-semibold">{it.productName}</div>
                        <div className="text-muted small">{it.brand}</div>
                      </td>
                      <td>{it.size}</td>
                      <td className="text-end">{it.qty}</td>
                      <td className="text-end">{money(it.unitPrice)}</td>
                      <td className="text-end">{money(it.subtotal)}</td>
                    </tr>
                  ))}
                  <tr className="fw-bold border-top">
                    <td colSpan="4" className="text-end">Your subtotal</td>
                    <td className="text-end">{money(order.supplierSubtotal)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

      {/* refunds on this order (read-only — the admin processes them) */}
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
                    <td className="text-center">
                      <span className={`badge text-bg-${REFUND_COLORS[rf.refundStatus] || 'secondary'}`}>{rf.refundStatus}</span>
                    </td>
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

export default SupplierOrderDetailPage;
