import { useEffect, useState } from 'react';
import { getDeliveries, getCouriers, assignDelivery } from '../adminService';
import Toast from '../../../components/Toast';
import Pagination from '../../../components/Pagination';
import { usePagination } from '../../../hooks/usePagination';

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

  const { page, setPage, totalPages, pageItems } = usePagination(deliveries, PAGE_SIZE);
  const queueCount = deliveries.filter((d) => !d.deliveryPersonnelId).length;

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
    getCouriers()
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
                <th>Order</th>
                <th>Customer</th>
                <th>Pickup → Deliver to</th>
                <th className="text-end" style={{ width: 110 }}>Amount</th>
                <th className="text-center" style={{ width: 140 }}>Status</th>
                <th style={{ width: 180 }}>Courier</th>
                <th className="text-center" style={{ width: 130 }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {pageItems.map((d) => (
                <tr key={d.deliveryId} className={!d.deliveryPersonnelId ? 'table-warning' : undefined}>
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
                    {d.deliveryPersonnelId ? (
                      <>
                        <div>{d.courierName}</div>
                        <div className="text-muted small">{d.deliveryPersonnelId}</div>
                      </>
                    ) : (
                      <span className="text-muted fst-italic">Unassigned</span>
                    )}
                  </td>
                  <td className="text-center">
                    {isClosed(d.deliveryStatus) ? (
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
                  Couriers are ranked by current workload (fewest in-progress deliveries first) —
                  the same scoring the system uses to auto-assign.
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
                        </span>
                        {i === 0 && c.deliveryPersonnelId !== assignTarget.deliveryPersonnelId && (
                          <span className="badge text-bg-success">Suggested</span>
                        )}
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
