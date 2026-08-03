import { useEffect, useState } from 'react';
import Toast from '../../../components/Toast';
import ConfirmDialog from '../../../components/ConfirmDialog';
import { getFlags, resolveFlag, refreshBadges } from '../adminService';

// Reactive moderation queue: customer-reported reviews/avatars. The admin views
// the reported user's avatar and can remove it, suspend the user, or dismiss.
function AdminFlagsPage() {
  const [flags, setFlags] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busyId, setBusyId] = useState('');
  const [confirm, setConfirm] = useState(null);   // { flag, action, title, message, color }

  useEffect(() => {
    let active = true;
    getFlags()
      .then((data) => { if (active) setFlags(data.flags); })
      .catch((err) => { if (active) setError(err.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  async function act(flag, action) {
    setBusyId(flag.flagId);
    setError('');
    try {
      await resolveFlag(flag.flagId, action);
      // remove_avatar/suspend clear every open flag for that user; dismiss clears one
      setFlags((prev) => prev.filter((f) =>
        action === 'dismiss' ? f.flagId !== flag.flagId : f.targetUserId !== flag.targetUserId));
      setNotice(
        action === 'remove_avatar' ? `Removed ${flag.targetName}'s avatar.`
        : action === 'suspend'     ? `${flag.targetName} suspended.`
        : 'Report dismissed.');
      refreshBadges();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId('');
    }
  }

  return (
    <div className="container py-4">
      <h1 className="mb-1">🚩 Flagged Content</h1>
      <p className="text-muted">Customer-reported reviews / profile photos awaiting moderation.</p>

      <Toast message={notice} onClose={() => setNotice('')} />
      {error && <div className="alert alert-danger py-2">{error}</div>}

      {loading ? (
        <p className="text-muted">Loading…</p>
      ) : flags.length === 0 ? (
        <div className="card card-body text-center text-muted">🎉 No open reports.</div>
      ) : (
        <div className="d-flex flex-column gap-3">
          {flags.map((f) => (
            <div key={f.flagId} className="card">
              <div className="card-body d-flex align-items-start gap-3 flex-wrap">
                <div className="text-center flex-shrink-0">
                  {f.targetAvatar
                    ? <a href={f.targetAvatar} target="_blank" rel="noreferrer">
                        <img src={f.targetAvatar} alt="Reported avatar" className="border rounded-circle"
                          style={{ width: 72, height: 72, objectFit: 'cover' }} /></a>
                    : <div className="border rounded-circle bg-light d-flex align-items-center justify-content-center text-muted small"
                        style={{ width: 72, height: 72 }}>no avatar</div>}
                </div>
                <div className="flex-grow-1" style={{ minWidth: 240 }}>
                  <div className="fw-semibold">
                    {f.targetName}
                    <span className={`badge ms-2 text-bg-${f.targetStatus === 'Suspended' ? 'secondary' : 'success'}`}>{f.targetStatus}</span>
                  </div>
                  <div className="small"><span className="text-muted">Reason:</span> {f.reason}</div>
                  {f.reviewComment && (
                    <div className="small text-muted fst-italic mt-1">“{f.reviewComment}”</div>
                  )}
                  <div className="text-muted small mt-1">Reported by {f.reporterName} · {new Date(f.created_at).toLocaleDateString()}</div>
                </div>
                <div className="text-nowrap">
                  <button className="btn btn-outline-danger btn-sm me-2" disabled={busyId === f.flagId}
                    onClick={() => setConfirm({ flag: f, action: 'remove_avatar', title: 'Remove avatar?',
                      message: `Remove ${f.targetName}'s profile photo? Their reviews will fall back to initials.`, color: 'danger' })}>
                    Remove avatar
                  </button>
                  <button className="btn btn-danger btn-sm me-2" disabled={busyId === f.flagId || f.targetStatus === 'Suspended'}
                    onClick={() => setConfirm({ flag: f, action: 'suspend', title: 'Suspend user?',
                      message: `Suspend ${f.targetName}? They won't be able to sign in until reactivated.`, color: 'danger' })}>
                    Suspend
                  </button>
                  <button className="btn btn-outline-secondary btn-sm" disabled={busyId === f.flagId}
                    onClick={() => act(f, 'dismiss')}>Dismiss</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <ConfirmDialog
        isOpen={!!confirm}
        title={confirm?.title || ''}
        message={confirm?.message || ''}
        confirmText={confirm?.action === 'suspend' ? 'Suspend' : 'Remove'}
        confirmColor={confirm?.color || 'danger'}
        onCancel={() => setConfirm(null)}
        onConfirm={() => { const c = confirm; setConfirm(null); if (c) act(c.flag, c.action); }}
      />
    </div>
  );
}

export default AdminFlagsPage;
