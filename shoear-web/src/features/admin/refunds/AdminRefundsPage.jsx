import { useEffect, useState } from 'react';
import { getRefunds, setRefundStatus, refundProofUrls } from '../../supplier/refunds/refundService';
import { refreshBadges } from '../adminService';
import ConfirmDialog from '../../../components/ConfirmDialog';
import OrderDetailModal from '../orders/OrderDetailModal';
import Toast from '../../../components/Toast';
import Pagination from '../../../components/Pagination';
import SortableTh from '../../../components/SortableTh';
import { usePagination } from '../../../hooks/usePagination';
import { useTableSort } from '../../../hooks/useTableSort';

const PAGE_SIZE = 10;
const STATUSES = ['Pending', 'Approved', 'Rejected', 'Completed'];
const STATUS_COLORS = { Pending: 'warning', Approved: 'info', Rejected: 'danger', Completed: 'success' };
const money = (n) => `RM ${Number(n).toFixed(2)}`;

function AdminRefundsPage() {
  const [refunds, setRefunds] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const [busyId, setBusyId] = useState('');
  const [confirm, setConfirm] = useState(null);   // { refund, status, title, message, color } — Completed only
  const [decision, setDecision] = useState(null); // { refund, status, requireReason } — Approve / Reject
  const [note, setNote] = useState('');
  const [noteError, setNoteError] = useState('');
  const [orderModal, setOrderModal] = useState(null); // orderId of the order detail popup
  const [detail, setDetail] = useState(null);         // the refund row shown in the details popup

  const [status, setStatus] = useState('');

  // Click any column header to sort; Amount compares numerically.
  const sort = useTableSort(refunds, {
    initialKey: 'orderId',
    initialDir: 'desc',
    getValue: (r, k) => {
      if (k === 'refundAmount') return Number(r.refundAmount);
      return r[k] ?? '';
    },
  });

  const { page, setPage, totalPages, pageItems } = usePagination(sort.sorted, PAGE_SIZE);

  function load() {
    setLoading(true);
    getRefunds({ status })
      .then((data) => setRefunds(data.refunds))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    setPage(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  async function act(refund, newStatus, adminNote) {
    setBusyId(refund.refundId);
    setError('');
    try {
      await setRefundStatus(refund.refundId, newStatus, adminNote);
      setToast(`${refund.refundId} → ${newStatus}.`);
      load();
      refreshBadges();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId('');
    }
  }

  // Open/submit the Approve/Reject dialog. Reject requires a reason; the note
  // (required or optional) is sent to the customer with the outcome.
  function openDecision(refund, newStatus) {
    setNote('');
    setNoteError('');
    setDecision({ refund, status: newStatus, requireReason: newStatus === 'Rejected' });
  }
  function submitDecision() {
    const n = note.trim();
    if (decision.requireReason && n === '') {
      setNoteError('A reason is required to reject a refund.');
      return;
    }
    const d = decision;
    setDecision(null);
    act(d.refund, d.status, n);
  }

  // Open the "Mark as refunded" confirm for an approved refund.
  function askComplete(r) {
    setConfirm({
      refund: r, status: 'Completed', title: 'Mark as refunded?',
      message: `Confirm ${money(r.refundAmount)} has been refunded for ${r.orderId}. `
        + (r.refundAmount < r.orderTotalAmount
            ? 'This is a partial refund — only this amount is returned and the payment stays active for the remaining balance.'
            : 'This fully refunds the order and marks the payment as Refunded.'),
      color: 'primary',
    });
  }

  function renderActions(r) {
    const busy = busyId === r.refundId;
    return (
      <div className="d-flex gap-2 justify-content-center flex-wrap">
        <button className="btn btn-outline-secondary btn-sm" onClick={() => setDetail(r)}>Details</button>
        {r.refundStatus === 'Pending' && (
          <>
            <button className="btn btn-success btn-sm" disabled={busy} onClick={() => openDecision(r, 'Approved')}>Approve</button>
            <button className="btn btn-outline-danger btn-sm" disabled={busy} onClick={() => openDecision(r, 'Rejected')}>Reject</button>
          </>
        )}
        {r.refundStatus === 'Approved' && (
          <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => askComplete(r)}>Mark refunded</button>
        )}
      </div>
    );
  }

  return (
    <div className="container py-4 text-start">
      <h1 className="mb-1">💸 Refund Requests</h1>
      <p className="text-muted">Review customer refund requests and process them.</p>

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
              {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
        </div>
      </div>

      {loading ? (
        <p className="text-muted">Loading…</p>
      ) : refunds.length === 0 ? (
        <div className="card card-body text-center text-muted">No refund requests match these filters.</div>
      ) : (
        <div className="table-responsive">
          <table className="table align-middle">
            <thead>
              <tr>
                <SortableTh label="Order" columnKey="orderId" sort={sort} />
                <SortableTh label="Customer" columnKey="customerName" sort={sort} />
                <SortableTh label="Reason" columnKey="refundReason" sort={sort} />
                <SortableTh label="Amount" columnKey="refundAmount" sort={sort} className="text-end" style={{ width: 110 }} />
                <SortableTh label="Status" columnKey="refundStatus" sort={sort} className="text-center" style={{ width: 110 }} />
                <th className="text-center" style={{ width: 260 }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {pageItems.map((r) => (
                <tr key={r.refundId}>
                  <td>
                    <button type="button" className="btn btn-link p-0 fw-semibold text-decoration-none"
                      onClick={() => setOrderModal(r.orderId)} title="View order & products">
                      {r.orderId}
                    </button>
                    <div className="text-muted small">{new Date(r.requestDate).toLocaleDateString()} · order {money(r.orderTotalAmount)}</div>
                  </td>
                  <td>{r.customerName}</td>
                  <td style={{ overflowWrap: 'anywhere' }}>
                    {r.refundReason}
                    {r.adminNote && (
                      <div className="small text-muted mt-1">
                        <span className="fw-semibold">Admin note:</span> {r.adminNote}
                      </div>
                    )}
                  </td>
                  <td className="text-end fw-semibold">
                    {money(r.refundAmount)}
                    {r.refundAmount < r.orderTotalAmount && (
                      <div><span className="badge text-bg-warning">Partial</span></div>
                    )}
                  </td>
                  <td className="text-center">
                    <span className={`badge text-bg-${STATUS_COLORS[r.refundStatus] || 'secondary'}`}>{r.refundStatus}</span>
                  </td>
                  <td className="text-center">{renderActions(r)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <Pagination page={page} totalPages={totalPages} onChange={setPage}
            summary={`Page ${page} of ${totalPages} · ${refunds.length} refunds`} />
        </div>
      )}

      <ConfirmDialog
        isOpen={!!confirm}
        title={confirm?.title || ''}
        message={confirm?.message || ''}
        confirmText={confirm?.status === 'Rejected' ? 'Reject' : 'Confirm'}
        confirmColor={confirm?.color || 'primary'}
        onCancel={() => setConfirm(null)}
        onConfirm={() => { const c = confirm; setConfirm(null); act(c.refund, c.status); }}
      />

      {/* Approve / Reject dialog with a reason (required to reject) */}
      {decision && (
        <div className="modal fade show d-block" tabIndex="-1"
          style={{ background: 'rgba(0,0,0,0.5)' }} onClick={() => setDecision(null)}>
          <div className="modal-dialog modal-dialog-centered" onClick={(e) => e.stopPropagation()}>
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title">
                  {decision.status === 'Rejected' ? 'Reject refund?' : 'Approve refund?'}
                </h5>
                <button type="button" className="btn-close" onClick={() => setDecision(null)}></button>
              </div>
              <div className="modal-body">
                <p className="mb-3">
                  {decision.status === 'Rejected' ? 'Reject' : 'Approve'} the refund of{' '}
                  <strong>{money(decision.refund.refundAmount)}</strong> for {decision.refund.orderId}?
                </p>
                <label className="form-label small mb-1">
                  {decision.requireReason ? 'Reason (sent to the customer)' : 'Note to the customer (optional)'}
                </label>
                <textarea
                  className={'form-control' + (noteError ? ' is-invalid' : '')}
                  rows="3" maxLength="500" autoFocus
                  value={note}
                  onChange={(e) => { setNote(e.target.value); if (noteError) setNoteError(''); }}
                  placeholder={decision.requireReason
                    ? 'e.g. The item shows normal wear and is not defective.'
                    : 'Optional message shown to the customer.'} />
                {noteError && <div className="invalid-feedback d-block">{noteError}</div>}
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setDecision(null)}>Cancel</button>
                <button type="button"
                  className={'btn ' + (decision.status === 'Rejected' ? 'btn-danger' : 'btn-success')}
                  onClick={submitDecision}>
                  {decision.status === 'Rejected' ? 'Reject' : 'Approve'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Full refund details */}
      {detail && (() => {
        const r = detail;
        const proofs = refundProofUrls(r.refundProof);
        return (
          <div className="modal show d-block" tabIndex="-1"
            style={{ background: 'rgba(0,0,0,.5)' }} onClick={() => setDetail(null)}>
            <div className="modal-dialog modal-dialog-centered modal-lg" onClick={(e) => e.stopPropagation()}>
              <div className="modal-content">
                <div className="modal-header">
                  <h5 className="modal-title">
                    Refund details
                    <span className={`badge ms-2 text-bg-${STATUS_COLORS[r.refundStatus] || 'secondary'}`}>{r.refundStatus}</span>
                  </h5>
                  <button type="button" className="btn-close" onClick={() => setDetail(null)}></button>
                </div>
                <div className="modal-body">
                  <dl className="row mb-0">
                    <dt className="col-sm-3">Order</dt>
                    <dd className="col-sm-9">
                      <button type="button" className="btn btn-link p-0 text-decoration-none"
                        onClick={() => { setDetail(null); setOrderModal(r.orderId); }}>
                        {r.orderId} — view order &amp; products
                      </button>
                    </dd>
                    <dt className="col-sm-3">Customer</dt><dd className="col-sm-9">{r.customerName}</dd>
                    <dt className="col-sm-3">Requested</dt><dd className="col-sm-9">{new Date(r.requestDate).toLocaleString()}</dd>
                    <dt className="col-sm-3">Amount</dt>
                    <dd className="col-sm-9">
                      {money(r.refundAmount)}
                      {r.refundAmount < r.orderTotalAmount &&
                        <span className="badge text-bg-warning ms-2">Partial · order {money(r.orderTotalAmount)}</span>}
                    </dd>
                    <dt className="col-sm-3">Reason</dt>
                    <dd className="col-sm-9" style={{ overflowWrap: 'anywhere' }}>{r.refundReason}</dd>
                    {r.adminNote && (<>
                      <dt className="col-sm-3">Admin note</dt>
                      <dd className="col-sm-9" style={{ overflowWrap: 'anywhere' }}>{r.adminNote}</dd>
                    </>)}
                  </dl>

                  <div className="mt-3">
                    <div className="fw-semibold mb-2">Evidence photos {proofs.length > 0 && `(${proofs.length})`}</div>
                    {proofs.length === 0 ? (
                      <p className="text-muted mb-0">No photos were attached.</p>
                    ) : (
                      <div className="d-flex flex-wrap gap-2">
                        {proofs.map((u, i) => (
                          <a key={i} href={u} target="_blank" rel="noreferrer" title="Open full size">
                            <img src={u} alt={`Evidence ${i + 1}`}
                              style={{ width: 110, height: 110, objectFit: 'cover', borderRadius: 8, border: '1px solid #dee2e6' }} />
                          </a>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
                <div className="modal-footer">
                  {r.refundStatus === 'Pending' && (
                    <>
                      <button type="button" className="btn btn-outline-danger"
                        onClick={() => { setDetail(null); openDecision(r, 'Rejected'); }}>Reject</button>
                      <button type="button" className="btn btn-success"
                        onClick={() => { setDetail(null); openDecision(r, 'Approved'); }}>Approve</button>
                    </>
                  )}
                  {r.refundStatus === 'Approved' && (
                    <button type="button" className="btn btn-primary"
                      onClick={() => { setDetail(null); askComplete(r); }}>Mark refunded</button>
                  )}
                  <button type="button" className="btn btn-secondary" onClick={() => setDetail(null)}>Close</button>
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

export default AdminRefundsPage;
