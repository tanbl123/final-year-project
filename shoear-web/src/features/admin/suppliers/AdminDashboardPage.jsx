import { useEffect, useState } from 'react';
import { getPendingSuppliers, approveSupplier, rejectSupplier, refreshBadges } from '../adminService';
import Pagination from '../../../components/Pagination';
import Toast from '../../../components/Toast';
import { usePagination } from '../../../hooks/usePagination';

const PAGE_SIZE = 10;

// A labelled field row for the detail modal (mirrors the courier page).
function Field({ label, children }) {
  return (
    <div className="mb-2">
      <span className="text-muted small">{label}: </span>{children}
    </div>
  );
}

function AdminDashboardPage() {
  const [suppliers, setSuppliers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');       // transient success message
  const [busyId, setBusyId] = useState('');        // userId currently being actioned
  const [viewing, setViewing] = useState(null);    // supplier whose full application is open

  const { page, setPage, totalPages, pageItems } = usePagination(suppliers, PAGE_SIZE);

  // reject modal state
  const [rejecting, setRejecting] = useState(null); // supplier being rejected
  const [reason, setReason] = useState('');
  const [terminal, setTerminal] = useState(false);  // false = can resubmit, true = ban
  const [reasonError, setReasonError] = useState('');

  // load the pending queue on mount
  useEffect(() => {
    let active = true;
    getPendingSuppliers()
      .then((data) => { if (active) setSuppliers(data.suppliers); })
      .catch((err) => { if (active) setError(err.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  async function approve(supplier) {
    setBusyId(supplier.userId);
    setError('');
    try {
      await approveSupplier(supplier.userId);
      setSuppliers((prev) => prev.filter((s) => s.userId !== supplier.userId));
      setViewing(null);
      setNotice(`${supplier.companyName} approved.`);
      refreshBadges();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId('');
    }
  }

  function openReject(supplier) {
    setViewing(null);
    setRejecting(supplier);
    setReason('');
    setTerminal(false);
    setReasonError('');
  }

  async function confirmReject() {
    if (reason.trim() === '') { setReasonError('Please give a reason — the supplier sees this.'); return; }
    const supplier = rejecting;
    setBusyId(supplier.userId);
    setRejecting(null);
    setError('');
    try {
      await rejectSupplier(supplier.userId, { reason: reason.trim(), terminal });
      setSuppliers((prev) => prev.filter((s) => s.userId !== supplier.userId));
      setNotice(`${supplier.companyName} ${terminal ? 'banned' : 'rejected'}.`);
      refreshBadges();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId('');
    }
  }

  return (
    <div className="container py-4">
      <h1 className="mb-1">🛡️ Supplier Approvals</h1>
      <p className="text-muted">Review supplier accounts awaiting approval.</p>

      {/* success confirmations are transient → toast (errors stay inline below) */}
      <Toast message={notice} onClose={() => setNotice('')} />
      {error && <div className="alert alert-danger py-2">{error}</div>}

      {loading ? (
        <p className="text-muted">Loading…</p>
      ) : suppliers.length === 0 ? (
        <div className="card card-body text-center text-muted">
          🎉 No pending suppliers. You're all caught up.
        </div>
      ) : (
        <div className="table-responsive">
          <table className="table align-middle">
            <thead>
              <tr>
                <th>Company</th>
                <th>Contact</th>
                <th>Business verification</th>
                <th>Submitted</th>
                <th className="text-end">Actions</th>
              </tr>
            </thead>
            <tbody>
              {pageItems.map((s) => (
                <tr key={s.userId} style={{ cursor: 'pointer' }} onClick={() => setViewing(s)}>
                  <td>
                    <div className="fw-semibold">{s.companyName}</div>
                    <div className="text-muted small">@{s.username}</div>
                    <div className="text-muted small">{s.companyAddress}</div>
                    {s.operationalAddress && s.operationalAddress !== s.companyAddress && (
                      <div className="text-muted small">Pickup: {s.operationalAddress}</div>
                    )}
                  </td>
                  <td>
                    <div>{s.email}</div>
                    <div className="text-muted small">{s.phoneNumber}</div>
                  </td>
                  <td className="small">
                    <div>Reg: {s.businessRegNo || '—'}</div>
                    {s.taxNumber && <div className="text-muted">Tax: {s.taxNumber}</div>}
                    {s.businessLicenseUrl ? (
                      <a href={s.businessLicenseUrl} target="_blank" rel="noreferrer"
                         onClick={(e) => e.stopPropagation()}>📄 View document</a>
                    ) : (
                      <span className="text-muted">No document</span>
                    )}
                  </td>
                  <td className="text-muted small">{new Date(s.created_at).toLocaleDateString()}</td>
                  <td className="text-end text-nowrap" onClick={(e) => e.stopPropagation()}>
                    <button className="btn btn-outline-primary btn-sm me-2" onClick={() => setViewing(s)}>
                      Details
                    </button>
                    <button
                      className="btn btn-success btn-sm me-2"
                      disabled={busyId === s.userId}
                      onClick={() => approve(s)}
                    >
                      {busyId === s.userId ? '…' : 'Approve'}
                    </button>
                    <button
                      className="btn btn-outline-danger btn-sm"
                      disabled={busyId === s.userId}
                      onClick={() => openReject(s)}
                    >
                      Reject
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <Pagination page={page} totalPages={totalPages} onChange={setPage}
            summary={`Page ${page} of ${totalPages} · ${suppliers.length} pending`} />
        </div>
      )}

      {/* ── Full application detail modal ── */}
      {viewing && (
        <>
          <div className="modal d-block" tabIndex="-1" role="dialog">
            <div className="modal-dialog modal-lg modal-dialog-centered modal-dialog-scrollable" role="document">
              <div className="modal-content">
                <div className="modal-header">
                  <h5 className="modal-title">Supplier application — {viewing.companyName}</h5>
                  <button type="button" className="btn-close" onClick={() => setViewing(null)}></button>
                </div>
                <div className="modal-body text-start">
                  <h6 className="text-uppercase text-muted small">Company</h6>
                  <Field label="Legal company name"><strong>{viewing.companyName}</strong></Field>
                  <Field label="Store display name">{viewing.displayName || <span className="text-muted">— (falls back to company name)</span>}</Field>
                  <Field label="Username">@{viewing.username}</Field>

                  <h6 className="text-uppercase text-muted small mt-3">Registered business address</h6>
                  <Field label="Address">
                    {[viewing.companyLine1, viewing.companyPostcode, viewing.companyCity, viewing.companyState]
                      .filter(Boolean).join(', ') || viewing.companyAddress || '—'}
                  </Field>

                  <h6 className="text-uppercase text-muted small mt-3">Operational (pickup) address</h6>
                  <Field label="Address">
                    {[viewing.operationalLine1, viewing.operationalPostcode, viewing.operationalCity, viewing.operationalState]
                      .filter(Boolean).join(', ') || viewing.operationalAddress || '—'}
                  </Field>
                  <Field label="Pickup state">
                    {viewing.operationalState
                      ? <span className="badge bg-info-subtle text-dark border">{viewing.operationalState}</span>
                      : '—'}
                    <span className="text-muted small ms-2">(decides in-house vs standard shipping)</span>
                  </Field>

                  <h6 className="text-uppercase text-muted small mt-3">Business verification</h6>
                  <Field label="Registration no. (SSM)">{viewing.businessRegNo || '—'}</Field>
                  <Field label="Tax / SST number">{viewing.taxNumber || <span className="text-muted">— (not provided)</span>}</Field>
                  <Field label="Document">
                    {viewing.businessLicenseUrl
                      ? <a href={viewing.businessLicenseUrl} target="_blank" rel="noreferrer">📄 View document</a>
                      : <span className="text-muted">No document</span>}
                  </Field>

                  <h6 className="text-uppercase text-muted small mt-3">Bank / payout</h6>
                  <Field label="Bank">{viewing.bankName || <span className="text-muted">— (not provided)</span>}</Field>
                  <Field label="Account name">{viewing.bankAccountName || '—'}</Field>
                  <Field label="Account number">{viewing.bankAccountNumber || '—'}</Field>

                  <h6 className="text-uppercase text-muted small mt-3">Contact</h6>
                  <Field label="Email">{viewing.email}</Field>
                  <Field label="Phone">{viewing.phoneNumber || '—'}</Field>
                  <Field label="Submitted">{new Date(viewing.created_at).toLocaleString()}</Field>
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
                  <h5 className="modal-title">Reject {rejecting.companyName}</h5>
                  <button type="button" className="btn-close" onClick={() => setRejecting(null)}></button>
                </div>
                <div className="modal-body text-start">
                  <label className="form-label">Reason (shown to the supplier)</label>
                  <textarea
                    className={`form-control ${reasonError ? 'is-invalid' : ''}`}
                    rows={3}
                    value={reason}
                    placeholder="e.g. The business registration document is blurry — please upload a clearer scan."
                    onChange={(e) => { setReason(e.target.value); setReasonError(''); }}
                  />
                  {reasonError && <div className="invalid-feedback">{reasonError}</div>}

                  <div className="form-check mt-3">
                    <input className="form-check-input" type="radio" id="rej-fixable"
                      checked={!terminal} onChange={() => setTerminal(false)} />
                    <label className="form-check-label" htmlFor="rej-fixable">
                      <strong>Reject — can resubmit.</strong> The supplier can fix the issue and
                      resubmit. Their details are kept.
                    </label>
                  </div>
                  <div className="form-check mt-2">
                    <input className="form-check-input" type="radio" id="rej-ban"
                      checked={terminal} onChange={() => setTerminal(true)} />
                    <label className="form-check-label" htmlFor="rej-ban">
                      <strong>Ban — permanent.</strong> For fraud or policy violations. The
                      applicant cannot log in or resubmit.
                    </label>
                  </div>
                </div>
                <div className="modal-footer">
                  <button type="button" className="btn btn-outline-secondary" onClick={() => setRejecting(null)}>
                    Cancel
                  </button>
                  <button type="button" className={`btn btn-${terminal ? 'danger' : 'warning'}`} onClick={confirmReject}>
                    {terminal ? 'Ban permanently' : 'Reject (can resubmit)'}
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

export default AdminDashboardPage;
