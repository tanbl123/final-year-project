import { useEffect, useState } from 'react';
import Pagination from '../../../components/Pagination';
import { usePagination } from '../../../hooks/usePagination';
import {
  getSupplierChangeRequests, approveChangeRequest, rejectChangeRequest,
} from '../adminService';

// One field's current → proposed value. Highlights when it actually changed.
function DiffRow({ label, from, to, isDoc }) {
  const changed = (from || '') !== (to || '');
  return (
    <div className="row g-2 small py-1">
      <div className="col-4 text-muted">{label}</div>
      <div className="col-4">{isDoc
        ? (from ? <a href={from} target="_blank" rel="noreferrer">📄 current</a> : '—')
        : (from || '—')}</div>
      <div className={`col-4 ${changed ? 'fw-semibold text-success' : 'text-muted'}`}>
        {changed && '→ '}
        {isDoc
          ? (to ? <a href={to} target="_blank" rel="noreferrer">📄 new</a> : '—')
          : (to || '—')}
      </div>
    </div>
  );
}

function AdminBusinessChangesPage() {
  const [requests, setRequests] = useState([]);
  const { page, setPage, totalPages, pageItems } = usePagination(requests, 8);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busyId, setBusyId] = useState('');

  // reject modal
  const [rejecting, setRejecting] = useState(null);
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState('');

  useEffect(() => {
    let active = true;
    getSupplierChangeRequests()
      .then((data) => { if (active) setRequests(data.requests); })
      .catch((err) => { if (active) setError(err.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  async function approve(r) {
    setBusyId(r.requestId);
    setError('');
    try {
      await approveChangeRequest(r.requestId);
      setRequests((prev) => prev.filter((x) => x.requestId !== r.requestId));
      setNotice(`Changes for ${r.newCompanyName} approved and applied.`);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId('');
    }
  }

  function openReject(r) { setRejecting(r); setReason(''); setReasonError(''); }
  async function confirmReject() {
    if (reason.trim() === '') { setReasonError('Please give a reason — the supplier sees this.'); return; }
    const r = rejecting;
    setBusyId(r.requestId);
    setRejecting(null);
    setError('');
    try {
      await rejectChangeRequest(r.requestId, reason.trim());
      setRequests((prev) => prev.filter((x) => x.requestId !== r.requestId));
      setNotice(`Changes for ${r.curCompanyName} rejected.`);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId('');
    }
  }

  return (
    <div className="container py-4">
      <h1 className="mb-1">📝 Business Detail Changes</h1>
      <p className="text-muted">Approved suppliers requesting changes to their verified business details.</p>

      {notice && (
        <div className="alert alert-success py-2 d-flex justify-content-between align-items-center">
          <span>{notice}</span>
          <button type="button" className="btn-close" onClick={() => setNotice('')}></button>
        </div>
      )}
      {error && <div className="alert alert-danger py-2">{error}</div>}

      {loading ? (
        <p className="text-muted">Loading…</p>
      ) : requests.length === 0 ? (
        <div className="card card-body text-center text-muted">
          🎉 No pending change requests.
        </div>
      ) : (
        <div className="d-flex flex-column gap-3">
          {pageItems.map((r) => (
            <div key={r.requestId} className="card">
              <div className="card-body">
                <div className="d-flex justify-content-between align-items-start mb-2">
                  <div>
                    <div className="fw-semibold">{r.curCompanyName} <span className="text-muted small">@{r.username}</span></div>
                    <div className="text-muted small">{r.email} · submitted {new Date(r.created_at).toLocaleDateString()}</div>
                  </div>
                  <div className="text-nowrap">
                    <button className="btn btn-success btn-sm me-2" disabled={busyId === r.requestId}
                      onClick={() => approve(r)}>{busyId === r.requestId ? '…' : 'Approve'}</button>
                    <button className="btn btn-outline-danger btn-sm" disabled={busyId === r.requestId}
                      onClick={() => openReject(r)}>Reject</button>
                  </div>
                </div>

                <div className="row g-2 small text-muted fw-semibold border-bottom pb-1">
                  <div className="col-4">Field</div>
                  <div className="col-4">Current</div>
                  <div className="col-4">Proposed</div>
                </div>
                <DiffRow label="Company name" from={r.curCompanyName} to={r.newCompanyName} />
                <DiffRow label="Business address" from={r.curCompanyAddress} to={r.newCompanyAddress} />
                <DiffRow label="SSM no." from={r.curBusinessRegNo} to={r.newBusinessRegNo} />
                <DiffRow label="SST no." from={r.curTaxNumber} to={r.newTaxNumber} />
                <DiffRow label="Document" from={r.curBusinessLicenseUrl} to={r.newBusinessLicenseUrl} isDoc />
              </div>
            </div>
          ))}
          <Pagination page={page} totalPages={totalPages} onChange={setPage}
            summary={`Page ${page} of ${totalPages} · ${requests.length} requests`} />
        </div>
      )}

      {rejecting && (
        <>
          <div className="modal d-block" tabIndex="-1" role="dialog">
            <div className="modal-dialog modal-dialog-centered" role="document">
              <div className="modal-content">
                <div className="modal-header">
                  <h5 className="modal-title">Reject changes for {rejecting.curCompanyName}</h5>
                  <button type="button" className="btn-close" onClick={() => setRejecting(null)}></button>
                </div>
                <div className="modal-body text-start">
                  <label className="form-label">Reason (shown to the supplier)</label>
                  <textarea
                    className={`form-control ${reasonError ? 'is-invalid' : ''}`}
                    rows={3}
                    value={reason}
                    placeholder="e.g. The new SSM number doesn't match the uploaded document."
                    onChange={(e) => { setReason(e.target.value); setReasonError(''); }}
                  />
                  {reasonError && <div className="invalid-feedback">{reasonError}</div>}
                  <p className="text-muted small mt-2 mb-0">The supplier's current details stay unchanged; they can submit a corrected request.</p>
                </div>
                <div className="modal-footer">
                  <button type="button" className="btn btn-outline-secondary" onClick={() => setRejecting(null)}>Cancel</button>
                  <button type="button" className="btn btn-warning" onClick={confirmReject}>Reject</button>
                </div>
              </div>
            </div>
          </div>
          <div className="modal-backdrop show"></div>
        </>
      )}
    </div>
  );
}

export default AdminBusinessChangesPage;
