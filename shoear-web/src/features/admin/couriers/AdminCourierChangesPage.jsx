import { useEffect, useState } from 'react';
import Pagination from '../../../components/Pagination';
import Toast from '../../../components/Toast';
import { usePagination } from '../../../hooks/usePagination';
import {
  getCourierChangeRequests, approveCourierChangeRequest, rejectCourierChangeRequest, refreshBadges,
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

// A courier's plate + driving-licence changes (post-approval re-verification).
// The account stays Active and keeps delivering; approving copies the proposed
// values onto the live courier row, rejecting leaves it unchanged.
function AdminCourierChangesPage() {
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
    getCourierChangeRequests()
      .then((data) => { if (active) setRequests(data.requests); })
      .catch((err) => { if (active) setError(err.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  async function approve(r) {
    setBusyId(r.requestId);
    setError('');
    try {
      await approveCourierChangeRequest(r.requestId);
      setRequests((prev) => prev.filter((x) => x.requestId !== r.requestId));
      setNotice(`Changes for ${r.fullName} approved and applied.`);
      refreshBadges();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId('');
    }
  }

  function openReject(r) { setRejecting(r); setReason(''); setReasonError(''); }
  async function confirmReject() {
    if (reason.trim() === '') { setReasonError('Please give a reason — the courier sees this.'); return; }
    const r = rejecting;
    setBusyId(r.requestId);
    setRejecting(null);
    setError('');
    try {
      await rejectCourierChangeRequest(r.requestId, reason.trim());
      setRequests((prev) => prev.filter((x) => x.requestId !== r.requestId));
      setNotice(`Changes for ${r.fullName} rejected.`);
      refreshBadges();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId('');
    }
  }

  // licence expiry comes back as a date string (or null) — show just the day
  const fmtDate = (d) => (d ? String(d).slice(0, 10) : '—');

  return (
    <div className="container py-4">
      <h1 className="mb-1">🛵 Courier Vehicle &amp; Licence Changes</h1>
      <p className="text-muted">Approved couriers requesting changes to their plate number or driving licence.</p>

      {/* success confirmations are transient → toast (errors stay inline below) */}
      <Toast message={notice} onClose={() => setNotice('')} />
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
                    <div className="fw-semibold">{r.fullName} <span className="text-muted small">@{r.username}</span></div>
                    <div className="text-muted small">{r.email} · submitted {new Date(r.created_at).toLocaleDateString()}</div>
                  </div>
                  <div className="text-nowrap">
                    <button className="btn btn-success btn-sm me-2" disabled={busyId === r.requestId}
                      onClick={() => approve(r)}>{busyId === r.requestId ? '…' : 'Approve'}</button>
                    <button className="btn btn-outline-danger btn-sm" disabled={busyId === r.requestId}
                      onClick={() => openReject(r)}>Reject</button>
                  </div>
                </div>

                {r.newLicensePhotoUrl && r.newLicensePhotoUrl !== r.curLicensePhotoUrl && (
                  <div className="alert alert-info py-2 small mb-2">
                    📄 <strong>Licence photo updated</strong> — confirm the document matches the licence number
                    and the holder, and that it hasn&apos;t expired.
                  </div>
                )}

                <div className="row g-2 small text-muted fw-semibold border-bottom pb-1">
                  <div className="col-4">Field</div>
                  <div className="col-4">Current</div>
                  <div className="col-4">Proposed</div>
                </div>
                <DiffRow label="Plate number" from={r.curPlate} to={r.newPlate} />
                <DiffRow label="Licence no." from={r.curLicenseNumber} to={r.newLicenseNumber} />
                <DiffRow label="Licence class" from={r.curLicenseClass} to={r.newLicenseClass} />
                <DiffRow label="Licence expiry" from={fmtDate(r.curLicenseExpiry)} to={fmtDate(r.newLicenseExpiry)} />
                <DiffRow label="Licence photo" from={r.curLicensePhotoUrl} to={r.newLicensePhotoUrl} isDoc />
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
                  <h5 className="modal-title">Reject changes for {rejecting.fullName}</h5>
                  <button type="button" className="btn-close" onClick={() => setRejecting(null)}></button>
                </div>
                <div className="modal-body text-start">
                  <label className="form-label">Reason (shown to the courier)</label>
                  <textarea
                    className={`form-control ${reasonError ? 'is-invalid' : ''}`}
                    rows={3}
                    value={reason}
                    placeholder="e.g. The licence photo is blurry and the number can't be read."
                    onChange={(e) => { setReason(e.target.value); setReasonError(''); }}
                  />
                  {reasonError && <div className="invalid-feedback">{reasonError}</div>}
                  <p className="text-muted small mt-2 mb-0">The courier&apos;s current details stay unchanged; they can submit a corrected request.</p>
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

export default AdminCourierChangesPage;
