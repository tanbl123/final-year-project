import { useEffect, useState } from 'react';
import Pagination from '../../../components/Pagination';
import Toast from '../../../components/Toast';
import { usePagination } from '../../../hooks/usePagination';
import {
  getSupplierChangeRequests, approveChangeRequest, rejectChangeRequest, refreshBadges,
  getPendingCompanyPhotos, reviewCompanyPhoto,
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

  // company-logo moderation
  const [photos, setPhotos] = useState([]);
  const [photoBusy, setPhotoBusy] = useState('');
  const [photoRejecting, setPhotoRejecting] = useState(null);
  const [photoReason, setPhotoReason] = useState('');
  const [photoReasonError, setPhotoReasonError] = useState('');
  const [tab, setTab] = useState('details');   // 'details' | 'logos'

  useEffect(() => {
    let active = true;
    Promise.all([getSupplierChangeRequests(), getPendingCompanyPhotos()])
      .then(([chg, ph]) => { if (active) { setRequests(chg.requests); setPhotos(ph.photos); } })
      .catch((err) => { if (active) setError(err.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  async function approvePhoto(p) {
    setPhotoBusy(p.supplierId);
    setError('');
    try {
      await reviewCompanyPhoto(p.supplierId, 'approve');
      setPhotos((prev) => prev.filter((x) => x.supplierId !== p.supplierId));
      setNotice(`Company logo for ${p.companyName} approved.`);
      refreshBadges();
    } catch (err) {
      setError(err.message);
    } finally {
      setPhotoBusy('');
    }
  }

  async function confirmPhotoReject() {
    if (photoReason.trim() === '') { setPhotoReasonError('Please give a reason — the supplier sees this.'); return; }
    const p = photoRejecting;
    setPhotoBusy(p.supplierId);
    setPhotoRejecting(null);
    setError('');
    try {
      await reviewCompanyPhoto(p.supplierId, 'reject', photoReason.trim());
      setPhotos((prev) => prev.filter((x) => x.supplierId !== p.supplierId));
      setNotice(`Company logo for ${p.companyName} rejected.`);
      refreshBadges();
    } catch (err) {
      setError(err.message);
    } finally {
      setPhotoBusy('');
    }
  }

  async function approve(r) {
    setBusyId(r.requestId);
    setError('');
    try {
      await approveChangeRequest(r.requestId);
      setRequests((prev) => prev.filter((x) => x.requestId !== r.requestId));
      setNotice(`Changes for ${r.newCompanyName} approved and applied.`);
      refreshBadges();
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
      refreshBadges();
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

      {/* success confirmations are transient → toast (errors stay inline below) */}
      <Toast message={notice} onClose={() => setNotice('')} />
      {error && <div className="alert alert-danger py-2">{error}</div>}

      <ul className="nav nav-tabs mb-3">
        <li className="nav-item">
          <button className={`nav-link ${tab === 'details' ? 'active' : ''}`} onClick={() => setTab('details')}>
            Business details {requests.length > 0 && <span className="badge text-bg-secondary ms-1">{requests.length}</span>}
          </button>
        </li>
        <li className="nav-item">
          <button className={`nav-link ${tab === 'logos' ? 'active' : ''}`} onClick={() => setTab('logos')}>
            Company logos {photos.length > 0 && <span className="badge text-bg-secondary ms-1">{photos.length}</span>}
          </button>
        </li>
      </ul>

      {/* company logos awaiting moderation */}
      {tab === 'logos' && (loading ? (
        <p className="text-muted">Loading…</p>
      ) : photos.length === 0 ? (
        <div className="card card-body text-center text-muted">🎉 No company logos awaiting review.</div>
      ) : (
        <div className="d-flex flex-column gap-3">
            {photos.map((p) => (
              <div key={p.supplierId} className="card">
                <div className="card-body d-flex align-items-center gap-3 flex-wrap">
                  <div className="text-center">
                    <div className="text-muted small mb-1">New</div>
                    <a href={p.pendingUrl} target="_blank" rel="noreferrer">
                      <img src={p.pendingUrl} alt="Proposed logo" className="border rounded-circle"
                        style={{ width: 80, height: 80, objectFit: 'cover' }} />
                    </a>
                  </div>
                  <div className="text-center">
                    <div className="text-muted small mb-1">Current</div>
                    {p.currentUrl
                      ? <a href={p.currentUrl} target="_blank" rel="noreferrer">
                          <img src={p.currentUrl} alt="Current logo" className="border rounded-circle"
                            style={{ width: 80, height: 80, objectFit: 'cover' }} /></a>
                      : <div className="border rounded-circle bg-light d-flex align-items-center justify-content-center text-muted small"
                          style={{ width: 80, height: 80 }}>none</div>}
                  </div>
                  <div className="flex-grow-1">
                    <div className="fw-semibold">{p.companyName}</div>
                    <div className="text-muted small">{p.email}</div>
                  </div>
                  <div className="text-nowrap">
                    <button className="btn btn-success btn-sm me-2" disabled={photoBusy === p.supplierId}
                      onClick={() => approvePhoto(p)}>{photoBusy === p.supplierId ? '…' : 'Approve'}</button>
                    <button className="btn btn-outline-danger btn-sm" disabled={photoBusy === p.supplierId}
                      onClick={() => { setPhotoRejecting(p); setPhotoReason(''); setPhotoReasonError(''); }}>Reject</button>
                  </div>
                </div>
              </div>
            ))}
        </div>
      ))}

      {tab === 'details' && (loading ? (
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

                {r.newCompanyName && r.newCompanyName !== r.curCompanyName && (
                  <div className="alert alert-warning py-2 small mb-2">
                    ⚠️ <strong>Legal-identity change:</strong> company name “{r.curCompanyName}” → “{r.newCompanyName}”.
                    The SSM number is unchanged — confirm this is a genuine rebrand of the same registered company, not a different business.
                  </div>
                )}
                {r.newBusinessLicenseUrl && r.newBusinessLicenseUrl !== r.curBusinessLicenseUrl && (
                  <div className="alert alert-info py-2 small mb-2">
                    📄 <strong>Document updated</strong> — confirm it&apos;s a valid certificate for SSM <strong>{r.curBusinessRegNo}</strong> (the locked registration number), not a different company&apos;s.
                  </div>
                )}

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
      ))}

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

      {photoRejecting && (
        <>
          <div className="modal d-block" tabIndex="-1" role="dialog">
            <div className="modal-dialog modal-dialog-centered" role="document">
              <div className="modal-content">
                <div className="modal-header">
                  <h5 className="modal-title">Reject logo for {photoRejecting.companyName}</h5>
                  <button type="button" className="btn-close" onClick={() => setPhotoRejecting(null)}></button>
                </div>
                <div className="modal-body text-start">
                  <label className="form-label">Reason (shown to the supplier)</label>
                  <textarea
                    className={`form-control ${photoReasonError ? 'is-invalid' : ''}`}
                    rows={3}
                    value={photoReason}
                    placeholder="e.g. The image is blurry / contains text or content that isn't a company logo."
                    onChange={(e) => { setPhotoReason(e.target.value); setPhotoReasonError(''); }}
                  />
                  {photoReasonError && <div className="invalid-feedback">{photoReasonError}</div>}
                  <p className="text-muted small mt-2 mb-0">Their current logo (if any) stays live; they can upload a new one.</p>
                </div>
                <div className="modal-footer">
                  <button type="button" className="btn btn-outline-secondary" onClick={() => setPhotoRejecting(null)}>Cancel</button>
                  <button type="button" className="btn btn-warning" onClick={confirmPhotoReject}>Reject</button>
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
