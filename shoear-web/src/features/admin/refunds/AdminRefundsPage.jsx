import { useEffect, useState } from 'react';
import { getRefunds, setRefundStatus } from '../../supplier/refunds/refundService';
import ConfirmDialog from '../../../components/ConfirmDialog';
import Toast from '../../../components/Toast';
import Pagination from '../../../components/Pagination';
import { usePagination } from '../../../hooks/usePagination';

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
  const [confirm, setConfirm] = useState(null);   // { refund, status, title, message, color }

  const [status, setStatus] = useState('');

  const { page, setPage, totalPages, pageItems } = usePagination(refunds, PAGE_SIZE);

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

  async function act(refund, newStatus) {
    setBusyId(refund.refundId);
    setError('');
    try {
      await setRefundStatus(refund.refundId, newStatus);
      setToast(`${refund.refundId} → ${newStatus}.`);
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId('');
    }
  }

  function renderActions(r) {
    const busy = busyId === r.refundId;
    if (r.refundStatus === 'Pending') {
      return (
        <div className="d-flex gap-2 justify-content-center">
          <button className="btn btn-success btn-sm" disabled={busy} onClick={() => act(r, 'Approved')}>Approve</button>
          <button className="btn btn-outline-danger btn-sm" disabled={busy}
            onClick={() => setConfirm({
              refund: r, status: 'Rejected', title: 'Reject refund?',
              message: `Reject the refund of ${money(r.refundAmount)} for ${r.orderId}?`, color: 'danger',
            })}>Reject</button>
        </div>
      );
    }
    if (r.refundStatus === 'Approved') {
      return (
        <button className="btn btn-primary btn-sm" disabled={busy}
          onClick={() => setConfirm({
            refund: r, status: 'Completed', title: 'Mark as refunded?',
            message: `Confirm ${money(r.refundAmount)} has been refunded for ${r.orderId}. This marks the payment as Refunded.`, color: 'primary',
          })}>Mark refunded</button>
      );
    }
    return <span className="text-muted">—</span>;
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
                <th>Order</th>
                <th>Customer</th>
                <th>Reason</th>
                <th className="text-end" style={{ width: 110 }}>Amount</th>
                <th className="text-center" style={{ width: 110 }}>Status</th>
                <th style={{ width: 70 }}>Proof</th>
                <th className="text-center" style={{ width: 180 }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {pageItems.map((r) => (
                <tr key={r.refundId}>
                  <td>
                    <div className="fw-semibold">{r.orderId}</div>
                    <div className="text-muted small">{new Date(r.requestDate).toLocaleDateString()} · order {money(r.orderTotalAmount)}</div>
                  </td>
                  <td>{r.customerName}</td>
                  <td style={{ overflowWrap: 'anywhere' }}>{r.refundReason}</td>
                  <td className="text-end fw-semibold">{money(r.refundAmount)}</td>
                  <td className="text-center">
                    <span className={`badge text-bg-${STATUS_COLORS[r.refundStatus] || 'secondary'}`}>{r.refundStatus}</span>
                  </td>
                  <td>
                    {r.refundProof
                      ? <a href={r.refundProof} target="_blank" rel="noreferrer">View</a>
                      : <span className="text-muted">—</span>}
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

      <Toast message={toast} onClose={() => setToast('')} />
    </div>
  );
}

export default AdminRefundsPage;
