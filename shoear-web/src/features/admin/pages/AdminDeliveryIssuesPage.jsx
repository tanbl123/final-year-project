import { useEffect, useState } from 'react';
import { getDeliveryIssues, resolveDeliveryIssue } from '../adminService';
import Toast from '../../../components/Toast';
import Pagination from '../../../components/Pagination';
import { usePagination } from '../../../hooks/usePagination';

const PAGE_SIZE = 10;

// reason code → friendly label (mirrors the courier app's list)
const REASON_LABELS = {
  customer_unreachable: 'Customer unreachable',
  customer_unavailable: 'Customer not available',
  customer_refused: 'Customer refused delivery',
  wrong_address: 'Wrong / incomplete address',
  package_damaged: 'Package damaged or missing',
  vehicle_emergency: 'Vehicle breakdown / emergency',
  other: 'Other',
};

const DELIVERY_STATUS_COLORS = {
  Pending: 'warning', Assigned: 'info', PickedUp: 'primary',
  OutForDelivery: 'primary', Delivered: 'success', Failed: 'danger',
};
const statusLabel = (s) => s.replace(/([a-z])([A-Z])/g, '$1 $2');

function AdminDeliveryIssuesPage() {
  const [issues, setIssues] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const [status, setStatus] = useState('Open');   // default to the work queue
  const [resolving, setResolving] = useState('');  // issueId being resolved
  const [photo, setPhoto] = useState('');          // photo URL shown in the lightbox

  const { page, setPage, totalPages, pageItems } = usePagination(issues, PAGE_SIZE);
  const openCount = issues.filter((i) => i.issueStatus === 'Open').length;

  function load() {
    setLoading(true);
    getDeliveryIssues({ status })
      .then((data) => setIssues(data.issues))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    setPage(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  async function resolve(issueId) {
    setResolving(issueId);
    setError('');
    try {
      await resolveDeliveryIssue(issueId);
      setToast('Issue marked resolved.');
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setResolving('');
    }
  }

  return (
    <div className="container py-4 text-start">
      <h1 className="mb-1">⚠️ Delivery Issues</h1>
      <p className="text-muted">
        Problems reported by couriers from the field. Failed parcels can be
        reassigned from the Deliveries page; mark an issue resolved once handled.
      </p>

      {error && (
        <div className="alert alert-danger py-2 d-flex justify-content-between align-items-center">
          <span>{error}</span>
          <button type="button" className="btn-close" onClick={() => setError('')}></button>
        </div>
      )}

      {status === 'Open' && openCount > 0 && (
        <div className="alert alert-warning py-2">
          <strong>{openCount}</strong> open {openCount === 1 ? 'issue' : 'issues'} needing attention.
        </div>
      )}

      {/* filter */}
      <div className="card card-body mb-4">
        <div className="row g-2 align-items-end">
          <div className="col-md-4">
            <label className="form-label small text-muted mb-1">Status</label>
            <select className="form-select" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="Open">Open</option>
              <option value="Resolved">Resolved</option>
              <option value="">All</option>
            </select>
          </div>
        </div>
      </div>

      {loading ? (
        <p className="text-muted">Loading…</p>
      ) : issues.length === 0 ? (
        <div className="card card-body text-center text-muted">No issues to show.</div>
      ) : (
        <div className="table-responsive">
          <table className="table align-middle">
            <thead>
              <tr>
                <th>Order</th>
                <th>Customer / Supplier</th>
                <th>Issue</th>
                <th className="text-center" style={{ width: 80 }}>Photo</th>
                <th>Courier</th>
                <th className="text-center" style={{ width: 130 }}>Delivery</th>
                <th>Reported</th>
                <th className="text-center" style={{ width: 120 }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {pageItems.map((i) => (
                <tr key={i.issueId} className={i.issueStatus === 'Open' ? 'table-warning' : undefined}>
                  <td className="fw-semibold">{i.orderId}</td>
                  <td className="small">
                    <div>{i.customerName}</div>
                    <div className="text-muted">📦 {i.supplierName}</div>
                  </td>
                  <td style={{ maxWidth: 260 }}>
                    <div className="fw-semibold">{REASON_LABELS[i.reason] || i.reason}</div>
                    {i.note && <div className="text-muted small" style={{ overflowWrap: 'anywhere' }}>{i.note}</div>}
                  </td>
                  <td className="text-center">
                    {i.photoUrl ? (
                      <img src={i.photoUrl} alt="evidence" role="button" onClick={() => setPhoto(i.photoUrl)}
                        className="rounded border" style={{ width: 44, height: 44, objectFit: 'cover' }} />
                    ) : <span className="text-muted">—</span>}
                  </td>
                  <td className="small">{i.courierName || <span className="text-muted fst-italic">—</span>}</td>
                  <td className="text-center">
                    <span className={`badge text-bg-${DELIVERY_STATUS_COLORS[i.deliveryStatus] || 'secondary'}`}>
                      {statusLabel(i.deliveryStatus)}
                    </span>
                  </td>
                  <td className="small text-muted">{new Date(i.createdAt).toLocaleString()}</td>
                  <td className="text-center">
                    {i.issueStatus === 'Open' ? (
                      <button className="btn btn-sm btn-outline-success" disabled={resolving === i.issueId}
                        onClick={() => resolve(i.issueId)}>
                        {resolving === i.issueId ? '…' : 'Resolve'}
                      </button>
                    ) : (
                      <span className="badge text-bg-success">Resolved</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <Pagination page={page} totalPages={totalPages} onChange={setPage}
            summary={`Page ${page} of ${totalPages} · ${issues.length} issues`} />
        </div>
      )}

      {/* photo lightbox */}
      {photo && (
        <div className="modal show d-block" tabIndex="-1" style={{ background: 'rgba(0,0,0,.6)' }}
          onClick={() => setPhoto('')}>
          <div className="modal-dialog modal-dialog-centered" onClick={(e) => e.stopPropagation()}>
            <div className="modal-content">
              <div className="modal-body text-center p-2">
                <img src={photo} alt="evidence" className="img-fluid rounded" />
              </div>
              <div className="modal-footer py-2">
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => setPhoto('')}>Close</button>
              </div>
            </div>
          </div>
        </div>
      )}

      <Toast message={toast} onClose={() => setToast('')} />
    </div>
  );
}

export default AdminDeliveryIssuesPage;
