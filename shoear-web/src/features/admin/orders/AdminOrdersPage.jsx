import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { getAdminOrders } from '../adminService';
import Pagination from '../../../components/Pagination';
import ClearableInput from '../../../components/ClearableInput';
import SortableTh from '../../../components/SortableTh';
import { usePagination } from '../../../hooks/usePagination';
import { useTableSort } from '../../../hooks/useTableSort';

const PAGE_SIZE = 10;
const STATUSES = ['Placed', 'Paid', 'Processing', 'Shipped', 'OutForDelivery', 'Delivered', 'Completed', 'Cancelled'];
const STATUS_COLORS = {
  Placed: 'secondary', Paid: 'info', Processing: 'primary', Shipped: 'primary',
  OutForDelivery: 'primary', Delivered: 'success', Completed: 'success', Cancelled: 'danger',
};
const PAY_COLORS = { Successful: 'success', Pending: 'warning', Failed: 'danger', Refunded: 'secondary' };
const label = (s) => s.replace(/([a-z])([A-Z])/g, '$1 $2');
const money = (n) => `RM ${Number(n).toFixed(2)}`;

function AdminOrdersPage() {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filters, setFilters] = useState({ status: '', search: '' });
  const [debouncedSearch, setDebouncedSearch] = useState('');

  // Click any column header to sort; Total/Items compare numerically.
  const sort = useTableSort(orders, {
    initialKey: 'orderId',
    initialDir: 'desc',
    getValue: (o, k) => {
      if (k === 'orderTotalAmount') return Number(o.orderTotalAmount);
      if (k === 'itemCount') return Number(o.itemCount);
      return o[k] ?? '';
    },
  });

  // page lives in the URL and resets to 1 when the filters change (resetKey)
  const location = useLocation();
  const { page, setPage, totalPages, pageItems } = usePagination(
    sort.sorted, PAGE_SIZE, JSON.stringify([filters.status, debouncedSearch]));

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(filters.search), 300);
    return () => clearTimeout(t);
  }, [filters.search]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    getAdminOrders({ status: filters.status, search: debouncedSearch })
      .then((data) => setOrders(data.orders))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [filters.status, debouncedSearch]);

  return (
    <div className="container py-4 text-start">
      <h1 className="mb-1">🧾 Orders</h1>
      <p className="text-muted">Monitor every order on the platform.</p>

      {error && (
        <div className="alert alert-danger py-2 d-flex justify-content-between align-items-center">
          <span>{error}</span>
          <button type="button" className="btn-close" onClick={() => setError('')}></button>
        </div>
      )}

      <div className="card card-body mb-4">
        <div className="row g-2 align-items-end">
          <div className="col-md-7">
            <label className="form-label small text-muted mb-1">Search</label>
            <ClearableInput type="text" placeholder="Order ID or customer"
              value={filters.search}
              onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value }))}
              onClear={() => setFilters((f) => ({ ...f, search: '' }))} />
          </div>
          <div className="col-md-5">
            <label className="form-label small text-muted mb-1">Status</label>
            <select className="form-select" value={filters.status}
              onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))}>
              <option value="">All statuses</option>
              {STATUSES.map((s) => <option key={s} value={s}>{label(s)}</option>)}
            </select>
          </div>
        </div>
      </div>

      {loading ? (
        <p className="text-muted">Loading…</p>
      ) : orders.length === 0 ? (
        <div className="card card-body text-center text-muted">No orders match these filters.</div>
      ) : (
        <div className="table-responsive">
          <table className="table align-middle">
            <thead>
              <tr>
                <SortableTh label="Order" columnKey="orderId" sort={sort} />
                <SortableTh label="Customer" columnKey="customerName" sort={sort} />
                <SortableTh label="Total" columnKey="orderTotalAmount" sort={sort} className="text-end" style={{ width: 110 }} />
                <SortableTh label="Items" columnKey="itemCount" sort={sort} className="text-center" style={{ width: 70 }} />
                <SortableTh label="Status" columnKey="orderStatus" sort={sort} className="text-center" style={{ width: 130 }} />
                <SortableTh label="Payment" columnKey="paymentStatus" sort={sort} className="text-center" style={{ width: 110 }} />
                <th className="text-center" style={{ width: 80 }}>Detail</th>
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
                  <td className="text-end fw-semibold">{money(o.orderTotalAmount)}</td>
                  <td className="text-center">{o.itemCount}</td>
                  <td className="text-center">
                    <span className={`badge text-bg-${STATUS_COLORS[o.orderStatus] || 'secondary'}`}>{label(o.orderStatus)}</span>
                  </td>
                  <td className="text-center">
                    {o.paymentStatus
                      ? <span className={`badge text-bg-${PAY_COLORS[o.paymentStatus] || 'secondary'}`}>{o.paymentStatus}</span>
                      : <span className="text-muted">—</span>}
                  </td>
                  <td className="text-center">
                    <Link to={`/admin/orders/${o.orderId}`} state={{ from: `/admin/orders${location.search}` }}
                      className="btn btn-outline-primary btn-sm">View</Link>
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

export default AdminOrdersPage;
