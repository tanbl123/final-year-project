import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { getSupplierOrders, shipAllPendingStandard } from './orderService';
import Pagination from '../../../components/Pagination';
import SortableTh from '../../../components/SortableTh';
import Toast from '../../../components/Toast';
import { usePagination } from '../../../hooks/usePagination';
import { useTableSort } from '../../../hooks/useTableSort';

const PAGE_SIZE = 10;
const STATUSES = ['Placed', 'Paid', 'Processing', 'Shipped', 'OutForDelivery', 'Delivered', 'Completed', 'Cancelled'];

const STATUS_COLORS = {
  Placed: 'secondary', Paid: 'info', Processing: 'primary', Shipped: 'primary',
  OutForDelivery: 'primary', Delivered: 'success', Completed: 'success', Cancelled: 'danger',
};
// the supplier's own parcel (delivery) statuses
const DELIV_COLORS = {
  Pending: 'warning', Assigned: 'info', PickedUp: 'primary',
  OutForDelivery: 'primary', Delivered: 'success', Failed: 'danger',
};
const label = (s) => s.replace(/([a-z])([A-Z])/g, '$1 $2');   // OutForDelivery → Out For Delivery
const money = (n) => `RM ${Number(n).toFixed(2)}`;

function SupplierOrdersPage() {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [needsActionOnly, setNeedsActionOnly] = useState(false);
  const [toast, setToast] = useState('');
  const [bulkBusy, setBulkBusy] = useState(false);

  // pending Standard (3PL) parcels the supplier still has to ship — the bulk
  // "book & ship all" action targets exactly these
  const pendingStandardCount = orders.filter(
    (o) => o.myDeliveryMethod === 'Standard' && o.myDeliveryStatus === 'Pending').length;

  // "Needs my action" = a Standard (3PL) parcel still Pending → the supplier
  // has to ship it. In-house parcels are handled by a courier, so they're excluded.
  const visibleOrders = needsActionOnly
    ? orders.filter((o) => o.myDeliveryMethod === 'Standard' && o.myDeliveryStatus === 'Pending')
    : orders;

  // Click any column header to sort; Your items/Your subtotal compare numerically.
  const sort = useTableSort(visibleOrders, {
    initialKey: 'orderId',
    initialDir: 'desc',
    getValue: (o, k) => {
      if (k === 'itemCount') return Number(o.itemCount);
      if (k === 'supplierSubtotal') return Number(o.supplierSubtotal);
      return o[k] ?? '';
    },
  });

  // page lives in the URL; resets to 1 when the status/needs-action filter changes
  const location = useLocation();
  const { page, setPage, totalPages, pageItems } = usePagination(
    sort.sorted, PAGE_SIZE, JSON.stringify([status, needsActionOnly]));

  function load() {
    setLoading(true);
    getSupplierOrders({ status })
      .then((data) => setOrders(data.orders))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }

  // one-click: auto-book & ship every pending Standard parcel via EasyParcel
  async function bulkShip() {
    setBulkBusy(true); setError('');
    try {
      const res = await shipAllPendingStandard();
      if (res.total === 0) setToast('No pending standard parcels to ship.');
      else if (res.failed === 0) setToast(`Booked & shipped ${res.booked} parcel${res.booked === 1 ? '' : 's'}.`);
      else setToast(`Booked ${res.booked} of ${res.total} — ${res.failed} couldn't be booked, ship those manually.`);
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBulkBusy(false);
    }
  }
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  return (
    <div className="container py-4 text-start">
      <div className="d-flex justify-content-between align-items-start flex-wrap gap-2">
        <div>
          <h1 className="mb-1">🧾 Orders</h1>
          <p className="text-muted">Orders that include your products — showing your items and your share only.</p>
        </div>
        {pendingStandardCount > 0 && (
          <button className="btn btn-success" onClick={bulkShip} disabled={bulkBusy}
            title="Auto-book a courier + tracking number for every pending standard parcel (via EasyParcel).">
            {bulkBusy ? 'Booking…' : `📦 Book & ship all pending (${pendingStandardCount})`}
          </button>
        )}
      </div>

      <Toast message={toast} onClose={() => setToast('')} />

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
          <div className="col-md-auto">
            <div className="form-check">
              <input className="form-check-input" type="checkbox" id="needsActionOnly"
                checked={needsActionOnly}
                onChange={(e) => setNeedsActionOnly(e.target.checked)} />
              <label className="form-check-label" htmlFor="needsActionOnly">
                🚚 Needs my action only <span className="text-muted">(parcels to ship)</span>
              </label>
            </div>
          </div>
        </div>
      </div>

      {loading ? (
        <p className="text-muted">Loading…</p>
      ) : orders.length === 0 ? (
        <div className="card card-body text-center text-muted">No orders yet for your products.</div>
      ) : visibleOrders.length === 0 ? (
        <div className="card card-body text-center text-muted">🎉 No parcels need your action right now.</div>
      ) : (
        <div className="table-responsive">
          <table className="table align-middle">
            <thead>
              <tr>
                <SortableTh label="Order" columnKey="orderId" sort={sort} />
                <SortableTh label="Customer" columnKey="customerName" sort={sort} />
                <SortableTh label="Status" columnKey="orderStatus" sort={sort} className="text-center" style={{ width: 150 }} />
                <SortableTh label="Your items" columnKey="itemCount" sort={sort} className="text-center" style={{ width: 90 }} />
                <SortableTh label="Your subtotal" columnKey="supplierSubtotal" sort={sort} className="text-end" style={{ width: 130 }} />
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
                    {/* The supplier only fulfils their OWN parcel, so the headline
                        status is that parcel's status — not the order-level
                        "Partially delivered" (which is about other suppliers'
                        parcels the seller can't see or act on). Order-level
                        Cancelled/Completed still win, as they affect payout. */}
                    {(() => {
                      const orderLevel = o.orderStatus === 'Cancelled' || o.orderStatus === 'Completed';
                      const s = orderLevel ? o.orderStatus : (o.myDeliveryStatus || o.orderStatus);
                      const color = orderLevel
                        ? (STATUS_COLORS[o.orderStatus] || 'secondary')
                        : (o.myDeliveryStatus ? (DELIV_COLORS[o.myDeliveryStatus] || 'secondary')
                                              : (STATUS_COLORS[o.orderStatus] || 'secondary'));
                      return <span className={`badge text-bg-${color}`}>{label(s)}</span>;
                    })()}
                    {o.myDeliveryMethod === 'Standard' && o.myDeliveryStatus === 'Pending' && (
                      <div className="mt-1">
                        <span className="badge text-bg-warning" title="This parcel ships via standard (3PL) shipping — book a courier or enter a tracking number to ship it.">
                          🚚 Action needed: ship this parcel
                        </span>
                      </div>
                    )}
                    {o.myDeliveryMethod === 'Standard' && o.myDeliveryStatus === 'OutForDelivery' && (
                      <div className="mt-1">
                        <span className="badge text-bg-light border" title="Shipped via standard (3PL) shipping. Mark delivered once it arrives, or the customer can confirm receipt.">
                          📦 Standard shipping — in transit
                        </span>
                      </div>
                    )}
                    {o.myDeliveryMethod === 'Standard' && !['Pending', 'OutForDelivery'].includes(o.myDeliveryStatus) && (
                      <div className="mt-1">
                        <span className="badge text-bg-light border">📦 Standard shipping</span>
                      </div>
                    )}
                    {o.refundStatus && (
                      <div className="mt-1">
                        <span className="badge text-bg-light border">Refund: {o.refundStatus}</span>
                      </div>
                    )}
                  </td>
                  <td className="text-center">{o.itemCount}</td>
                  <td className="text-end fw-semibold">{money(o.supplierSubtotal)}</td>
                  <td className="text-center">
                    <Link to={`/orders/${o.orderId}`} state={{ from: `/orders${location.search}` }}
                      className="btn btn-outline-primary btn-sm">
                      View
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <Pagination page={page} totalPages={totalPages} onChange={setPage}
            summary={`Page ${page} of ${totalPages} · ${visibleOrders.length} order${visibleOrders.length === 1 ? '' : 's'}`} />
        </div>
      )}
    </div>
  );
}

export default SupplierOrdersPage;
