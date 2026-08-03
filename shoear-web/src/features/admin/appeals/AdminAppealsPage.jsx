import { useEffect, useState } from 'react';
import Toast from '../../../components/Toast';
import ConfirmDialog from '../../../components/ConfirmDialog';
import UserDetailModal from '../users/UserDetailModal';
import { getAppeals, getUser, resolveAppeal, refreshBadges } from '../adminService';

const roleLabel = (r) => (r === 'DeliveryPersonnel' ? 'Delivery' : r === 'ArSpecialist' ? 'AR Specialist' : r);

// Suspension-appeal review queue. Each appeal shows who's suspended, WHY (the
// admin's stated reason), and the user's appeal message. The admin reinstates
// the account (Approve) or declines (Reject, with an optional note); either way
// the user is emailed the outcome.
function AdminAppealsPage() {
  const [appeals, setAppeals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busyId, setBusyId] = useState('');
  const [approving, setApproving] = useState(null);   // appeal pending approve-confirm
  const [rejecting, setRejecting] = useState(null);   // { appeal } for the reject-note modal
  const [note, setNote] = useState('');
  const [detail, setDetail] = useState(null);         // user shown in the in-place detail popup
  const [detailLoading, setDetailLoading] = useState(false);

  // View the user's full details without leaving the appeals queue.
  async function viewUser(userId) {
    if (!userId) return;
    setDetailLoading(true);
    setDetail({});
    try {
      setDetail(await getUser(userId));
    } catch (err) {
      setError(err.message);
      setDetail(null);
    } finally {
      setDetailLoading(false);
    }
  }

  useEffect(() => {
    let active = true;
    getAppeals()
      .then((data) => { if (active) setAppeals(data.appeals); })
      .catch((err) => { if (active) setError(err.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  async function decide(appeal, action, noteText) {
    setBusyId(appeal.appealId);
    setError('');
    try {
      await resolveAppeal(appeal.appealId, action, noteText || '');
      setAppeals((prev) => prev.filter((a) => a.appealId !== appeal.appealId));
      setNotice(action === 'approve'
        ? `${appeal.fullName} reinstated.`
        : `Appeal from ${appeal.fullName} declined.`);
      refreshBadges();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId('');
    }
  }

  return (
    <div className="container py-4">
      <h1 className="mb-1">🙋 Suspension Appeals</h1>
      <p className="text-muted">Suspended users appealing their suspension. Reinstate the account or decline.</p>

      <Toast message={notice} onClose={() => setNotice('')} />
      {error && <div className="alert alert-danger py-2">{error}</div>}

      {loading ? (
        <p className="text-muted">Loading…</p>
      ) : appeals.length === 0 ? (
        <div className="card card-body text-center text-muted">🎉 No appeals to review.</div>
      ) : (
        <div className="d-flex flex-column gap-3">
          {appeals.map((a) => (
            <div key={a.appealId} className="card">
              <div className="card-body">
                <div className="d-flex justify-content-between align-items-start flex-wrap gap-2 mb-2">
                  <div>
                    <div className="fw-semibold">
                      <button type="button" className="btn btn-link p-0 fw-semibold align-baseline text-decoration-none"
                        onClick={() => viewUser(a.userId)} title="View user details">{a.fullName}</button>
                      {a.role && <span className="text-muted small ms-2">{roleLabel(a.role)}</span>}
                      <span className="badge text-bg-secondary ms-2">Suspended</span>
                    </div>
                    <div className="text-muted small">{a.email} · appealed {new Date(a.created_at).toLocaleDateString()}</div>
                  </div>
                  <div className="text-nowrap">
                    <button className="btn btn-success btn-sm me-2" disabled={busyId === a.appealId}
                      onClick={() => setApproving(a)}>Reinstate</button>
                    <button className="btn btn-outline-danger btn-sm" disabled={busyId === a.appealId}
                      onClick={() => { setNote(''); setRejecting(a); }}>Decline</button>
                  </div>
                </div>

                <div className="mb-2 p-2 rounded bg-light">
                  <div className="text-muted small text-uppercase" style={{ letterSpacing: '.03em' }}>Suspended for</div>
                  <div className="small">{a.suspensionReason || <span className="text-muted">—</span>}</div>
                </div>
                <div className="p-2 rounded border">
                  <div className="text-muted small text-uppercase" style={{ letterSpacing: '.03em' }}>Their appeal</div>
                  <div className="small" style={{ overflowWrap: 'anywhere', whiteSpace: 'pre-wrap' }}>{a.message}</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <ConfirmDialog
        isOpen={!!approving}
        title="Reinstate account?"
        message={approving ? `Reinstate ${approving.fullName}? They'll be able to sign in again and will be emailed the outcome.` : ''}
        confirmText="Reinstate"
        confirmColor="success"
        onCancel={() => setApproving(null)}
        onConfirm={() => { const a = approving; setApproving(null); decide(a, 'approve'); }}
      />

      {rejecting && (
        <div className="modal show d-block" tabIndex="-1" style={{ background: 'rgba(0,0,0,.5)' }}
          onClick={() => setRejecting(null)}>
          <div className="modal-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title">Decline {rejecting.fullName}'s appeal</h5>
                <button type="button" className="btn-close" onClick={() => setRejecting(null)}></button>
              </div>
              <div className="modal-body">
                <p className="text-muted small">The account stays suspended. Add an optional note — it's included in the email to the user.</p>
                <label className="form-label small mb-1">Note (optional)</label>
                <textarea className="form-control" rows={3} value={note}
                  placeholder="e.g. The violation stands after review."
                  onChange={(e) => setNote(e.target.value)} />
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-light" onClick={() => setRejecting(null)}>Cancel</button>
                <button type="button" className="btn btn-danger"
                  onClick={() => { const a = rejecting; setRejecting(null); decide(a, 'reject', note.trim()); }}>
                  Decline appeal
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* in-place user detail — keeps the admin in the appeals queue */}
      <UserDetailModal detail={detail} loading={detailLoading} onClose={() => setDetail(null)} />
    </div>
  );
}

export default AdminAppealsPage;
