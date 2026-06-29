import { useEffect, useState } from 'react';
import { getPendingCouriers, approveCourier, rejectCourier } from '../adminService';
import Pagination from '../../../components/Pagination';
import { usePagination } from '../../../hooks/usePagination';

const PAGE_SIZE = 10;

// Small date helpers for the KYC display (dates arrive as 'YYYY-MM-DD').
function isExpired(dateStr) {
  const d = new Date(dateStr);
  return !Number.isNaN(d.getTime()) && d < new Date(new Date().toDateString());
}
function ageFrom(dateStr) {
  const dob = new Date(dateStr);
  if (Number.isNaN(dob.getTime())) return '?';
  const now = new Date();
  let age = now.getFullYear() - dob.getFullYear();
  const m = now.getMonth() - dob.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < dob.getDate())) age--;
  return age;
}

// A labelled photo that opens full-size in a new tab when clicked.
function Photo({ label, url }) {
  return (
    <div>
      <div className="text-muted small mb-1">{label}</div>
      {url ? (
        <a href={url} target="_blank" rel="noreferrer" title="Open full size">
          <img src={url} alt={label}
            style={{ width: '100%', height: 140, objectFit: 'cover' }}
            className="border rounded" />
        </a>
      ) : (
        <div className="border rounded bg-light d-flex align-items-center justify-content-center text-muted small"
          style={{ height: 140 }}>not provided</div>
      )}
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div className="mb-2">
      <span className="text-muted small">{label}: </span>{children}
    </div>
  );
}

// Courier approval queue — delivery personnel who self-applied via the delivery
// app start as Pending and appear here. Mirrors the supplier approval flow.
function AdminCouriersPage() {
  const [couriers, setCouriers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');       // transient success message
  const [busyId, setBusyId] = useState('');        // userId currently being actioned
  const [viewing, setViewing] = useState(null);    // courier whose full form is open

  const { page, setPage, totalPages, pageItems } = usePagination(couriers, PAGE_SIZE);

  // reject modal state
  const [rejecting, setRejecting] = useState(null); // courier being rejected
  const [reason, setReason] = useState('');
  const [terminal, setTerminal] = useState(false);  // false = rejected, true = ban
  const [reasonError, setReasonError] = useState('');

  useEffect(() => {
    let active = true;
    getPendingCouriers()
      .then((data) => { if (active) setCouriers(data.couriers); })
      .catch((err) => { if (active) setError(err.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  async function approve(courier) {
    setBusyId(courier.userId);
    setError('');
    try {
      await approveCourier(courier.userId);
      setCouriers((prev) => prev.filter((c) => c.userId !== courier.userId));
      setViewing(null);
      setNotice(`${courier.fullName} approved.`);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId('');
    }
  }

  function openReject(courier) {
    setViewing(null);
    setRejecting(courier);
    setReason('');
    setTerminal(false);
    setReasonError('');
  }

  async function confirmReject() {
    if (reason.trim() === '') { setReasonError('Please give a reason — the courier sees this.'); return; }
    const courier = rejecting;
    setBusyId(courier.userId);
    setRejecting(null);
    setError('');
    try {
      await rejectCourier(courier.userId, { reason: reason.trim(), terminal });
      setCouriers((prev) => prev.filter((c) => c.userId !== courier.userId));
      setNotice(`${courier.fullName} ${terminal ? 'banned' : 'rejected'}.`);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId('');
    }
  }

  return (
    <div className="container py-4">
      <h1 className="mb-1">🛵 Courier Approvals</h1>
      <p className="text-muted">Review delivery personnel accounts awaiting approval.</p>

      {notice && (
        <div className="alert alert-success py-2 d-flex justify-content-between align-items-center">
          <span>{notice}</span>
          <button type="button" className="btn-close" onClick={() => setNotice('')}></button>
        </div>
      )}
      {error && <div className="alert alert-danger py-2">{error}</div>}

      {loading ? (
        <p className="text-muted">Loading…</p>
      ) : couriers.length === 0 ? (
        <div className="card card-body text-center text-muted">
          🎉 No pending couriers. You're all caught up.
        </div>
      ) : (
        <div className="table-responsive">
          <table className="table align-middle">
            <thead>
              <tr>
                <th>Courier</th>
                <th>Contact</th>
                <th>Vehicle</th>
                <th>Submitted</th>
                <th className="text-end">Actions</th>
              </tr>
            </thead>
            <tbody>
              {pageItems.map((c) => (
                <tr key={c.userId} style={{ cursor: 'pointer' }} onClick={() => setViewing(c)}>
                  <td>
                    <div className="d-flex align-items-center gap-2">
                      {c.avatarUrl ? (
                        <img src={c.avatarUrl} alt={c.fullName}
                          style={{ width: 40, height: 40, objectFit: 'cover' }}
                          className="rounded-circle border" />
                      ) : (
                        <div className="rounded-circle border bg-light d-flex align-items-center justify-content-center text-muted"
                          style={{ width: 40, height: 40, fontSize: 18 }}>🛵</div>
                      )}
                      <div>
                        <div className="fw-semibold">{c.fullName}</div>
                        <div className="text-muted small">@{c.username}</div>
                      </div>
                    </div>
                  </td>
                  <td>
                    <div>{c.email}</div>
                    <div className="text-muted small">{c.phoneNumber}</div>
                  </td>
                  <td className="small">
                    {c.vehicleType && c.vehicleBrand ? `${c.vehicleType} • ${c.vehicleBrand} ${c.vehicleModel} — ${c.vehiclePlate}` : '—'}
                  </td>
                  <td className="text-muted small">{new Date(c.created_at).toLocaleDateString()}</td>
                  <td className="text-end text-nowrap" onClick={(e) => e.stopPropagation()}>
                    <button className="btn btn-outline-primary btn-sm me-2" onClick={() => setViewing(c)}>
                      Details
                    </button>
                    <button
                      className="btn btn-success btn-sm me-2"
                      disabled={busyId === c.userId}
                      onClick={() => approve(c)}
                    >
                      {busyId === c.userId ? '…' : 'Approve'}
                    </button>
                    <button
                      className="btn btn-outline-danger btn-sm"
                      disabled={busyId === c.userId}
                      onClick={() => openReject(c)}
                    >
                      Reject
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <Pagination page={page} totalPages={totalPages} onChange={setPage}
            summary={`Page ${page} of ${totalPages} · ${couriers.length} pending`} />
        </div>
      )}

      {/* ── Full application detail modal ── */}
      {viewing && (
        <>
          <div className="modal d-block" tabIndex="-1" role="dialog">
            <div className="modal-dialog modal-lg modal-dialog-centered modal-dialog-scrollable" role="document">
              <div className="modal-content">
                <div className="modal-header">
                  <h5 className="modal-title">Courier application — {viewing.fullName}</h5>
                  <button type="button" className="btn-close" onClick={() => setViewing(null)}></button>
                </div>
                <div className="modal-body text-start">
                  <div className="row g-4">
                    {/* Left: details */}
                    <div className="col-md-7">
                      <h6 className="text-uppercase text-muted small">Personal</h6>
                      <Field label="Full name"><strong>{viewing.fullName}</strong></Field>
                      <Field label="Username">@{viewing.username}</Field>
                      <Field label="Email">{viewing.email}</Field>
                      <Field label="Phone">{viewing.phoneNumber}</Field>
                      <Field label="Date of birth">
                        {viewing.dateOfBirth
                          ? `${viewing.dateOfBirth} (${ageFrom(viewing.dateOfBirth)} yrs)`
                          : '—'}
                      </Field>

                      <h6 className="text-uppercase text-muted small mt-3">Identity & licence</h6>
                      <Field label="IC / identity no.">{viewing.icNumber || '—'}</Field>
                      <Field label="Licence no.">{viewing.licenseNumber || '—'}</Field>
                      <Field label="Licence class">
                        {viewing.licenseClass
                          ? viewing.licenseClass.split(',').filter(Boolean).map((lc) => (
                              <span key={lc} className="badge bg-light text-dark border me-1">{lc}</span>
                            ))
                          : '—'}
                      </Field>
                      <Field label="Licence expiry">
                        {viewing.licenseExpiry
                          ? <span className={isExpired(viewing.licenseExpiry) ? 'text-danger fw-semibold' : ''}>
                              {viewing.licenseExpiry}{isExpired(viewing.licenseExpiry) ? ' (expired)' : ''}
                            </span>
                          : '—'}
                      </Field>

                      <h6 className="text-uppercase text-muted small mt-3">Vehicle</h6>
                      <Field label="Vehicle">
                        {viewing.vehicleType && viewing.vehicleBrand
                          ? `${viewing.vehicleType} • ${viewing.vehicleBrand} ${viewing.vehicleModel} — ${viewing.vehiclePlate}`
                          : '—'}
                      </Field>

                      <h6 className="text-uppercase text-muted small mt-3">Coverage & consent</h6>
                      <Field label="Delivers to">
                        {viewing.coverageZones
                          ? viewing.coverageZones.split(',').filter(Boolean).map((z) => (
                              <span key={z} className="badge bg-info-subtle text-dark border me-1">{z}</span>
                            ))
                          : '—'}
                      </Field>
                      <Field label="Terms / PDPA">
                        {viewing.termsAcceptedAt
                          ? <span className="text-success">✓ Agreed</span>
                          : <span className="text-danger">Not agreed</span>}
                      </Field>
                      <Field label="Submitted">{new Date(viewing.created_at).toLocaleString()}</Field>
                    </div>

                    {/* Right: photos */}
                    <div className="col-md-5">
                      <h6 className="text-uppercase text-muted small">Documents</h6>
                      <div className="d-flex flex-column gap-3">
                        <Photo label="Profile photo" url={viewing.avatarUrl} />
                        <Photo label="IC photo" url={viewing.icPhotoUrl} />
                        <Photo label="Driving licence photo" url={viewing.licensePhotoUrl} />
                      </div>
                      <div className="form-text mt-1">Click a photo to open it full size.</div>
                    </div>
                  </div>
                </div>
                <div className="modal-footer">
                  <button type="button" className="btn btn-outline-secondary" onClick={() => setViewing(null)}>
                    Close
                  </button>
                  <button type="button" className="btn btn-outline-danger"
                    disabled={busyId === viewing.userId} onClick={() => openReject(viewing)}>
                    Reject
                  </button>
                  <button type="button" className="btn btn-success"
                    disabled={busyId === viewing.userId} onClick={() => approve(viewing)}>
                    {busyId === viewing.userId ? '…' : 'Approve'}
                  </button>
                </div>
              </div>
            </div>
          </div>
          <div className="modal-backdrop show"></div>
        </>
      )}

      {rejecting && (
        <>
          <div className="modal d-block" tabIndex="-1" role="dialog">
            <div className="modal-dialog modal-dialog-centered" role="document">
              <div className="modal-content">
                <div className="modal-header">
                  <h5 className="modal-title">Reject {rejecting.fullName}</h5>
                  <button type="button" className="btn-close" onClick={() => setRejecting(null)}></button>
                </div>
                <div className="modal-body text-start">
                  <label className="form-label">Reason (shown to the courier)</label>
                  <textarea
                    className={`form-control ${reasonError ? 'is-invalid' : ''}`}
                    rows={3}
                    value={reason}
                    placeholder="e.g. We couldn't verify your vehicle details — please re-apply with accurate information."
                    onChange={(e) => { setReason(e.target.value); setReasonError(''); }}
                  />
                  {reasonError && <div className="invalid-feedback">{reasonError}</div>}

                  <div className="form-check mt-3">
                    <input className="form-check-input" type="radio" id="rej-fixable"
                      checked={!terminal} onChange={() => setTerminal(false)} />
                    <label className="form-check-label" htmlFor="rej-fixable">
                      <strong>Reject.</strong> The courier sees the reason at login and can apply again.
                    </label>
                  </div>
                  <div className="form-check mt-2">
                    <input className="form-check-input" type="radio" id="rej-ban"
                      checked={terminal} onChange={() => setTerminal(true)} />
                    <label className="form-check-label" htmlFor="rej-ban">
                      <strong>Ban — permanent.</strong> For fraud or policy violations. The
                      applicant cannot log in or re-apply.
                    </label>
                  </div>
                </div>
                <div className="modal-footer">
                  <button type="button" className="btn btn-outline-secondary" onClick={() => setRejecting(null)}>
                    Cancel
                  </button>
                  <button type="button" className={`btn btn-${terminal ? 'danger' : 'warning'}`} onClick={confirmReject}>
                    {terminal ? 'Ban permanently' : 'Reject'}
                  </button>
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

export default AdminCouriersPage;
