import { useEffect, useState } from 'react';
import { getPendingCouriers, approveCourier, rejectCourier } from '../adminService';
import Pagination from '../../../components/Pagination';
import { usePagination } from '../../../hooks/usePagination';

const PAGE_SIZE = 10;

// Courier approval queue — delivery personnel who self-applied via the delivery
// app start as Pending and appear here. Mirrors the supplier approval flow.
function AdminCouriersPage() {
  const [couriers, setCouriers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');       // transient success message
  const [busyId, setBusyId] = useState('');        // userId currently being actioned

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
      setNotice(`${courier.fullName} approved.`);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId('');
    }
  }

  function openReject(courier) {
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
                <tr key={c.userId}>
                  <td>
                    <div className="fw-semibold">{c.fullName}</div>
                    <div className="text-muted small">@{c.username}</div>
                  </td>
                  <td>
                    <div>{c.email}</div>
                    <div className="text-muted small">{c.phoneNumber}</div>
                  </td>
                  <td className="small">
                    {c.vehicleType && c.vehicleBrand ? `${c.vehicleType} • ${c.vehicleBrand} ${c.vehicleModel} — ${c.vehiclePlate}` : '—'}
                  </td>
                  <td className="text-muted small">{new Date(c.created_at).toLocaleDateString()}</td>
                  <td className="text-end text-nowrap">
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
