import { useEffect, useState } from 'react';
import { getDeliveryIssues, resolveDeliveryIssue, refreshBadges } from '../adminService';
import Toast from '../../../components/Toast';
import Pagination from '../../../components/Pagination';
import { usePagination } from '../../../hooks/usePagination';
import OrderDetailModal from '../orders/OrderDetailModal';

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
  const [orderModal, setOrderModal] = useState(null); // orderId of the order detail popup
  const [act, setAct] = useState(null);            // { issue, action } — the action modal
  const [actNote, setActNote] = useState('');

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

  const ACTION_META = {
    resolve:       { title: 'Close this report', verb: 'Resolve', color: 'success', prompt: 'The parcel was already delivered, so this report is just informational. Closing it clears the flag — it does not change the order.' },
    reassign:      { title: 'Reassign for delivery', verb: 'Reassign', color: 'primary', prompt: 'Send the parcel back to dispatch so another courier can retry the delivery.' },
    cancel_refund: { title: 'Refund undelivered parcel', verb: 'Refund & close', color: 'danger', prompt: 'Refund this failed parcel to the customer and close the issue. If the rest of the order is delivered, the order is completed. If this is the order’s only parcel, the whole order is cancelled & refunded. This cannot be undone.' },
  };

  function openAction(issue, action) {
    setActNote('');
    setError('');
    setAct({ issue, action });
  }

  async function runAction() {
    const { issue, action } = act;
    setResolving(issue.issueId);
    setAct(null);
    setError('');
    try {
      await resolveDeliveryIssue(issue.issueId, { action, note: actNote.trim() });
      setToast(action === 'cancel_refund' ? 'Order cancelled & refunded.'
        : action === 'reassign' ? 'Parcel sent back to dispatch.' : 'Issue marked resolved.');
      load();
      refreshBadges();
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
        Problems reported by couriers from the field. For an undelivered parcel,
        <strong> reassign</strong> it for another attempt or <strong>refund &amp; close</strong> to
        settle the order. If the parcel was delivered anyway, just
        <strong> resolve</strong> the report to clear the flag.
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
                <th className="text-center" style={{ width: 210 }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {pageItems.map((i) => (
                <tr key={i.issueId} className={i.issueStatus === 'Open' ? 'table-warning' : undefined}>
                  <td>
                    <button type="button" className="btn btn-link p-0 fw-semibold text-decoration-none"
                      onClick={() => setOrderModal(i.orderId)} title="View order & products">
                      {i.orderId}
                    </button>
                  </td>
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
                      i.deliveryStatus === 'Delivered' ? (
                        // parcel arrived anyway — the report is just informational
                        <button className="btn btn-sm btn-outline-success" disabled={resolving === i.issueId}
                          onClick={() => openAction(i, 'resolve')}>Resolve</button>
                      ) : (
                        // parcel still undelivered — it needs a retry or a refund
                        <div className="d-flex flex-wrap gap-1 justify-content-center">
                          <button className="btn btn-sm btn-outline-primary" disabled={resolving === i.issueId}
                            onClick={() => openAction(i, 'reassign')}>Reassign</button>
                          <button className="btn btn-sm btn-outline-danger" disabled={resolving === i.issueId}
                            onClick={() => openAction(i, 'cancel_refund')}>Refund &amp; close</button>
                        </div>
                      )
                    ) : (
                      <>
                        <span className="badge text-bg-success">Resolved</span>
                        {i.resolutionNote && (
                          <div className="text-muted small mt-1" style={{ overflowWrap: 'anywhere' }}>{i.resolutionNote}</div>
                        )}
                      </>
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

      {/* action modal (reassign / cancel & refund / resolve) */}
      {act && (() => {
        const meta = ACTION_META[act.action];
        return (
          <div className="modal show d-block" tabIndex="-1" style={{ background: 'rgba(0,0,0,.5)' }}
            onClick={() => setAct(null)}>
            <div className="modal-dialog modal-dialog-centered" onClick={(e) => e.stopPropagation()}>
              <div className="modal-content">
                <div className="modal-header">
                  <h5 className="modal-title">{meta.title}</h5>
                  <button type="button" className="btn-close" onClick={() => setAct(null)}></button>
                </div>
                <div className="modal-body">
                  <p className="mb-2">{meta.prompt}</p>
                  <p className="text-muted small mb-3">Order {act.issue.orderId} · {act.issue.customerName}</p>
                  <label className="form-label small mb-1">Note {act.action === 'cancel_refund' ? '(shown to the customer, optional)' : '(optional)'}</label>
                  <textarea className="form-control" rows="3" maxLength="500"
                    value={actNote} onChange={(e) => setActNote(e.target.value)}
                    placeholder="Add a short note for the record…" />
                </div>
                <div className="modal-footer">
                  <button type="button" className="btn btn-secondary" onClick={() => setAct(null)}>Cancel</button>
                  <button type="button" className={`btn btn-${meta.color}`} onClick={runAction}>{meta.verb}</button>
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      <OrderDetailModal orderId={orderModal} onClose={() => setOrderModal(null)} />

      <Toast message={toast} onClose={() => setToast('')} />
    </div>
  );
}

export default AdminDeliveryIssuesPage;
