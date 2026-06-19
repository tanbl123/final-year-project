import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getSupplierOrders } from '../orderService';
import Pagination from '../../../components/Pagination';
import { usePagination } from '../../../hooks/usePagination';

const PAGE_SIZE = 10;
const STATUSES = ['Placed', 'Paid', 'Processing', 'Shipped', 'OutForDelivery', 'Delivered', 'Completed', 'Cancelled'];

const STATUS_COLORS = {
  Placed: 'secondary', Paid: 'info', Processing: 'primary', Shipped: 'primary',
  OutForDelivery: 'primary', Delivered: 'success', Completed: 'success', Cancelled: 'danger',
};
const label = (s) => s.replace(/([a-z])([A-Z])/g, '$1 $2');   // OutForDelivery → Out For Delivery
const money = (n) => `RM ${Number(n).toFixed(2)}`;

function SupplierOrdersPage() {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');

  const { page, setPage, totalPages, pageItems } = usePagination(orders, PAGE_SIZE);

  function load() {
    setLoading(true);
    getSupplierOrders({ status })
      .then((data) => setOrders(data.orders))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    setPage(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  return (
    <div className="container py-4 text-start">
      <h1 className="mb-1">🧾 Orders</h1>
      <p className="text-muted">Orders that include your products — showing your items and your share only.</p>

      {error && (
        <div className="alert alert-danger py-2 d-flex justify-content-between align-items-center">
          <span>{error}</span>
          <button type="button" className="btn-close" onClick={() => setError('')}></button>
        </div>
      )}

      {/* filter */}
      <div className="card card-body mb-4">
        <div className="row g-2 align-items-end">
          <div className="col-md-4">
            <label className="form-label small text-muted mb-1">Status</label>
            <select className="form-select" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">All statuses</option>
              {STATUSES.map((s) => <option key={s} value={s}>{label(s)}</option>)}
            </select>
          </div>
        </div>
      </div>

      {loading ? (
        <p className="text-muted">Loading…</p>
      ) : orders.length === 0 ? (
        <div className="card card-body text-center text-muted">No orders yet for your products.</div>
      ) : (
        <div className="table-responsive">
          <table className="table align-middle">
            <thead>
              <tr>
                <th>Order</th>
                <th>Customer</th>
                <th className="text-center" style={{ width: 150 }}>Status</th>
                <th className="text-center" style={{ width: 90 }}>Your items</th>
                <th className="text-end" style={{ width: 130 }}>Your subtotal</th>
                <th className="text-center" style={{ width: 90 }}>Detail</th>
              </tr>
            </thead>
            <tbody>
              {pageItems.map((o) => (
                <tr key={o.orderId}>
                  <td>
                    <div className="fw-semibold">{o.orderId}</div>
                    <div className="text-muted small">{new Date(o.orderDate).toLocaleDateString()}</div>
                  </td>
                  <td>{o.customerName}</td>
                  <td className="text-center">
                    <span className={`badge text-bg-${STATUS_COLORS[o.orderStatus] || 'secondary'}`}>
                      {label(o.orderStatus)}
                    </span>
                    {o.refundStatus && (
                      <div className="mt-1">
                        <span className="badge text-bg-light border">Refund: {o.refundStatus}</span>
                      </div>
                    )}
                  </td>
                  <td className="text-center">{o.itemCount}</td>
                  <td className="text-end fw-semibold">{money(o.supplierSubtotal)}</td>
                  <td className="text-center">
                    <Link to={`/orders/${o.orderId}`} className="btn btn-outline-primary btn-sm">
                      View
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <Pagination page={page} totalPages={totalPages} onChange={setPage}
            summary={`Page ${page} of ${totalPages} · ${orders.length} orders`} />
        </div>
      )}
    </div>
  );
}

export default SupplierOrdersPage;
