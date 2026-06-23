import { useEffect, useState } from 'react';
import { getPendingSuppliers, approveSupplier, rejectSupplier } from '../adminService';
import Pagination from '../../../components/Pagination';
import { usePagination } from '../../../hooks/usePagination';

const PAGE_SIZE = 10;

function AdminDashboardPage() {
  const [suppliers, setSuppliers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');       // transient success message
  const [busyId, setBusyId] = useState('');        // userId currently being actioned

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
      setNotice(`${supplier.companyName} approved.`);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId('');
    }
  }

  function openReject(supplier) {
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

      {notice && (
        <div className="alert alert-success py-2 d-flex justify-content-between align-items-center">
          <span>{notice}</span>
          <button type="button" className="btn-close" onClick={() => setNotice('')}></button>
        </div>
      )}
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
                <tr key={s.userId}>
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
                      <a href={s.businessLicenseUrl} target="_blank" rel="noreferrer">📄 View document</a>
                    ) : (
                      <span className="text-muted">No document</span>
                    )}
                  </td>
                  <td className="text-muted small">{new Date(s.created_at).toLocaleDateString()}</td>
                  <td className="text-end text-nowrap">
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
