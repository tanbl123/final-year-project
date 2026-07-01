import { useEffect, useState } from 'react';
import { getDeliveries, getCouriers, assignDelivery, refreshBadges } from '../adminService';
import Toast from '../../../components/Toast';
import Pagination from '../../../components/Pagination';
import SortableTh from '../../../components/SortableTh';
import { usePagination } from '../../../hooks/usePagination';
import { useTableSort } from '../../../hooks/useTableSort';

const PAGE_SIZE = 10;
const STATUSES = ['Pending', 'Assigned', 'PickedUp', 'OutForDelivery', 'Delivered', 'Failed'];

const STATUS_COLORS = {
  Pending: 'warning', Assigned: 'info', PickedUp: 'primary',
  OutForDelivery: 'primary', Delivered: 'success', Failed: 'danger',
};
const statusLabel = (s) => s.replace(/([a-z])([A-Z])/g, '$1 $2');   // OutForDelivery → Out For Delivery
const isClosed = (s) => s === 'Delivered' || s === 'Failed';

function AdminDeliveriesPage() {
  const [deliveries, setDeliveries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');

  const [filters, setFilters] = useState({ status: '', unassigned: false });

  // assign modal state
  const [assignTarget, setAssignTarget] = useState(null);   // the delivery row
  const [couriers, setCouriers] = useState([]);
  const [couriersLoading, setCouriersLoading] = useState(false);
  const [chosenCourier, setChosenCourier] = useState('');
  const [saving, setSaving] = useState(false);

  // Click any column header to sort; Amount compares numerically.
  const sort = useTableSort(deliveries, {
    initialKey: 'orderId',
    initialDir: 'desc',
    getValue: (d, k) => {
      if (k === 'orderTotalAmount') return Number(d.orderTotalAmount);
      return d[k] ?? '';
    },
  });

  const { page, setPage, totalPages, pageItems } = usePagination(sort.sorted, PAGE_SIZE);
  // Only IN-HOUSE parcels wait for a courier. Standard (3PL) parcels never get
  // one, so they must NOT count toward the assignment queue.
  const queueCount = deliveries.filter((d) => !d.deliveryPersonnelId && d.deliveryMethod === 'InHouse').length;

  function load() {
    setLoading(true);
    getDeliveries({ status: filters.status, unassigned: filters.unassigned })
      .then((data) => setDeliveries(data.deliveries))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    setPage(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.status, filters.unassigned]);

  function setFilter(patch) {
    setFilters((f) => ({ ...f, ...patch }));
  }

  // open the assign/reassign modal and fetch the ranked courier roster
  function openAssign(delivery) {
    setAssignTarget(delivery);
    setChosenCourier(delivery.deliveryPersonnelId || '');
    setCouriersLoading(true);
    // pass the parcel's delivery state so couriers covering that area rank first
    getCouriers(delivery.deliveryState)
      .then((data) => setCouriers(data.couriers))
      .catch((err) => setError(err.message))
      .finally(() => setCouriersLoading(false));
  }

  function closeAssign() {
    setAssignTarget(null);
    setCouriers([]);
    setChosenCourier('');
  }

  async function confirmAssign() {
    if (!chosenCourier) return;
    setSaving(true);
    setError('');
    try {
      await assignDelivery(assignTarget.deliveryId, chosenCourier);
      setToast(`${assignTarget.orderId} (${assignTarget.supplierName}) → ${chosenCourier}.`);
      closeAssign();
      load();
      refreshBadges();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="container py-4 text-start">
      <h1 className="mb-1">🚚 Delivery Dispatch</h1>
      <p className="text-muted">
        Paid orders are auto-assigned to the least-loaded courier on payment.
        Anything without a courier waits here for manual assignment.
      </p>

      {error && (
        <div className="alert alert-danger py-2 d-flex justify-content-between align-items-center">
          <span>{error}</span>
          <button type="button" className="btn-close" onClick={() => setError('')}></button>
        </div>
      )}

      {queueCount > 0 && (
        <div className="alert alert-warning py-2">
          <strong>{queueCount}</strong> {queueCount === 1 ? 'delivery is' : 'deliveries are'} waiting
          for a courier — no one was free when the order was paid.
        </div>
      )}

      {/* filters */}
      <div className="card card-body mb-4">
        <div className="row g-2 align-items-end">
          <div className="col-md-4">
            <label className="form-label small text-muted mb-1">Status</label>
            <select className="form-select" value={filters.status}
              onChange={(e) => setFilter({ status: e.target.value })}>
              <option value="">All statuses</option>
              {STATUSES.map((s) => <option key={s} value={s}>{statusLabel(s)}</option>)}
            </select>
          </div>
          <div className="col-md-4">
            <div className="form-check mt-4">
              <input className="form-check-input" type="checkbox" id="unassignedOnly"
                checked={filters.unassigned}
                onChange={(e) => setFilter({ unassigned: e.target.checked })} />
              <label className="form-check-label" htmlFor="unassignedOnly">
                Needs assignment only
              </label>
            </div>
          </div>
        </div>
      </div>

      {loading ? (
        <p className="text-muted">Loading…</p>
      ) : deliveries.length === 0 ? (
        <div className="card card-body text-center text-muted">No deliveries match these filters.</div>
      ) : (
        <div className="table-responsive">
          <table className="table align-middle">
            <thead>
              <tr>
                <SortableTh label="Order" columnKey="orderId" sort={sort} />
                <SortableTh label="Customer" columnKey="customerName" sort={sort} />
                <th>Pickup → Deliver to</th>
                <SortableTh label="Amount" columnKey="orderTotalAmount" sort={sort} className="text-end" style={{ width: 110 }} />
                <SortableTh label="Status" columnKey="deliveryStatus" sort={sort} className="text-center" style={{ width: 140 }} />
                <SortableTh label="Courier" columnKey="courierName" sort={sort} style={{ width: 180 }} />
                <th className="text-center" style={{ width: 130 }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {pageItems.map((d) => (
                <tr key={d.deliveryId} className={(!d.deliveryPersonnelId && d.deliveryMethod === 'InHouse') ? 'table-warning' : undefined}>
                  <td>
                    <div className="fw-semibold">{d.orderId}</div>
                    <div className="text-muted small">{new Date(d.orderDate).toLocaleDateString()}</div>
                  </td>
                  <td>{d.customerName}</td>
                  <td className="small" style={{ overflowWrap: 'anywhere' }}>
                    <div>
                      <span className="text-success">📦 {d.supplierName}</span>
                      <div className="text-muted">{d.pickupAddress}</div>
                    </div>
                    <div className="mt-1">
                      <span className="text-primary">📍 Deliver to</span>
                      <div className="text-muted">{d.orderDeliveryAddress}</div>
                    </div>
                  </td>
                  <td className="text-end">RM {d.orderTotalAmount.toFixed(2)}</td>
                  <td className="text-center">
                    <span className={`badge text-bg-${STATUS_COLORS[d.deliveryStatus] || 'secondary'}`}>
                      {statusLabel(d.deliveryStatus)}
                    </span>
                  </td>
                  <td>
                    {d.deliveryMethod === 'Standard' ? (
                      <>
                        <span className="badge text-bg-light border">📦 Standard (3PL)</span>
                        {d.trackingCarrier && <div className="text-muted small mt-1">{d.trackingCarrier}</div>}
                        {d.trackingNumber && <div className="text-muted small">{d.trackingNumber}</div>}
                      </>
                    ) : d.deliveryPersonnelId ? (
                      <>
                        <div>{d.courierName}</div>
                        <div className="text-muted small">{d.deliveryPersonnelId}</div>
                      </>
                    ) : (
                      <span className="text-muted fst-italic">Unassigned</span>
                    )}
                  </td>
                  <td className="text-center">
                    {/* Standard parcels are handled by a 3PL — no courier to assign */}
                    {d.deliveryMethod === 'Standard' || isClosed(d.deliveryStatus) ? (
                      <span className="text-muted">—</span>
                    ) : (
                      <button
                        className={`btn btn-sm ${d.deliveryPersonnelId ? 'btn-outline-secondary' : 'btn-primary'}`}
                        onClick={() => openAssign(d)}>
                        {d.deliveryPersonnelId ? 'Reassign' : 'Assign'}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <Pagination page={page} totalPages={totalPages} onChange={setPage}
            summary={`Page ${page} of ${totalPages} · ${deliveries.length} deliveries`} />
        </div>
      )}

      {/* assign / reassign modal */}
      {assignTarget && (
        <div className="modal show d-block" tabIndex="-1" style={{ background: 'rgba(0,0,0,.5)' }}
          onClick={closeAssign}>
          <div className="modal-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title">
                  {assignTarget.deliveryPersonnelId ? 'Reassign' : 'Assign'} courier · {assignTarget.orderId} · {assignTarget.supplierName}
                </h5>
                <button type="button" className="btn-close" onClick={closeAssign}></button>
              </div>
              <div className="modal-body">
                <p className="text-muted small mb-2">
                  {assignTarget.deliveryState
                    ? <>Couriers who <strong>cover {assignTarget.deliveryState}</strong> are listed first, then by lightest workload. You can still assign anyone.</>
                    : 'Couriers are ranked by current workload (fewest in-progress deliveries first) — the same scoring the system uses to auto-assign.'}
                </p>
                {couriersLoading ? (
                  <p className="text-muted mb-0">Loading couriers…</p>
                ) : couriers.length === 0 ? (
                  <p className="text-danger mb-0">No active couriers exist yet.</p>
                ) : (
                  <div className="list-group">
                    {couriers.map((c, i) => (
                      <label key={c.deliveryPersonnelId}
                        className="list-group-item d-flex align-items-center gap-2">
                        <input className="form-check-input m-0" type="radio" name="courier"
                          value={c.deliveryPersonnelId}
                          checked={chosenCourier === c.deliveryPersonnelId}
                          onChange={() => setChosenCourier(c.deliveryPersonnelId)} />
                        <span className="flex-grow-1">
                          <span className="fw-semibold">{c.fullName}</span>
                          <span className="text-muted small"> · {c.deliveryPersonnelId}</span>
                          {c.vehicleType && c.vehicleBrand && <div className="text-muted small">{`${c.vehicleType} • ${c.vehicleBrand} ${c.vehicleModel} — ${c.vehiclePlate}`}</div>}
                          <div className="text-muted small">
                            Covers: {c.coverageZones?.length ? c.coverageZones.join(', ') : <span className="fst-italic">no areas set</span>}
                          </div>
                        </span>
                        {assignTarget.deliveryState && (
                          c.coversZone
                            ? <span className="badge text-bg-success">✓ Covers {assignTarget.deliveryState}</span>
                            : <span className="badge text-bg-light border text-muted">Outside area</span>
                        )}
                        {i === 0 && c.available && c.coversZone && c.deliveryPersonnelId !== assignTarget.deliveryPersonnelId && (
                          <span className="badge text-bg-primary">Suggested</span>
                        )}
                        <span className={`badge ${c.available ? 'text-bg-success' : 'text-bg-secondary'}`}
                          title={c.available ? 'On duty — auto-assignable' : 'Off duty — auto-assign skips them (you can still assign manually)'}>
                          {c.available ? '🟢 Online' : '⚪ Offline'}
                        </span>
                        <span className="badge text-bg-light">
                          {c.activeLoad} active
                        </span>
                      </label>
                    ))}
                  </div>
                )}
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={closeAssign}>Cancel</button>
                <button type="button" className="btn btn-primary"
                  disabled={saving || !chosenCourier || chosenCourier === assignTarget.deliveryPersonnelId}
                  onClick={confirmAssign}>
                  {saving ? 'Saving…' : 'Confirm'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <Toast message={toast} onClose={() => setToast('')} />
    </div>
  );
}

export default AdminDeliveriesPage;
