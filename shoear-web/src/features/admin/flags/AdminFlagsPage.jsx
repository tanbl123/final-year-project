import { useEffect, useState } from 'react';
import Toast from '../../../components/Toast';
import ConfirmDialog from '../../../components/ConfirmDialog';
import StarRating from '../../../components/StarRating';
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
      // dismiss clears one flag; remove_review clears flags on that review;
      // remove_avatar/suspend clear every open flag for that user.
      setFlags((prev) => prev.filter((f) => {
        if (action === 'dismiss') return f.flagId !== flag.flagId;
        if (action === 'remove_review') return f.reviewId !== flag.reviewId;
        return f.targetUserId !== flag.targetUserId;
      }));
      setNotice(
        action === 'remove_avatar' ? `Removed ${flag.targetName}'s avatar.`
        : action === 'remove_review' ? 'Review removed.'
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
                    // No uploaded photo → show the same generated initials the app
                    // shows, not a bare "no avatar" label.
                    : <div className="border rounded-circle bg-secondary-subtle d-flex align-items-center justify-content-center fw-semibold text-secondary"
                        style={{ width: 72, height: 72, fontSize: 28 }}>
                        {(f.targetName || '?').trim().charAt(0).toUpperCase()}
                      </div>}
                  <div className="text-muted mt-1" style={{ fontSize: 11 }}>
                    {f.targetAvatar ? 'uploaded photo' : 'default (initials)'}
                  </div>
                </div>
                <div className="flex-grow-1" style={{ minWidth: 260 }}>
                  {/* reported user */}
                  <div className="text-muted small text-uppercase" style={{ letterSpacing: '.03em' }}>Reported user</div>
                  <div className="fw-semibold">
                    {f.targetName}
                    {f.targetRole && <span className="text-muted small ms-2">{f.targetRole}</span>}
                    <span className={`badge ms-2 text-bg-${f.targetStatus === 'Suspended' ? 'secondary' : 'success'}`}>{f.targetStatus}</span>
                  </div>
                  {f.targetEmail && <div className="text-muted small">{f.targetEmail}</div>}

                  {/* the flagged review, in context */}
                  {(f.productName || f.reviewComment || f.ratingScore) && (
                    <div className="mt-2 p-2 rounded bg-light">
                      <div className="text-muted small text-uppercase" style={{ letterSpacing: '.03em' }}>Flagged review</div>
                      {f.productName && <div className="small">on <strong>{f.productName}</strong></div>}
                      <div className="d-flex align-items-center gap-2">
                        {f.ratingScore != null && <StarRating score={Number(f.ratingScore)} />}
                        {f.reviewStatus && (
                          <span className={`badge text-bg-${f.reviewStatus === 'Published' ? 'success' : 'secondary'}`}>{f.reviewStatus}</span>
                        )}
                      </div>
                      {f.reviewComment && <div className="small fst-italic mt-1">“{f.reviewComment}”</div>}
                    </div>
                  )}

                  <div className="small mt-2"><span className="text-muted">Reason:</span> {f.reason}</div>

                  {/* reporter */}
                  <div className="text-muted small mt-2">
                    Reported by <strong>{f.reporterName}</strong>
                    {f.reporterEmail && <> · {f.reporterEmail}</>}
                    {f.reporterRole && <> · {f.reporterRole}</>}
                    {' · '}{new Date(f.created_at).toLocaleDateString()}
                  </div>
                </div>
                <div className="d-flex flex-column gap-2" style={{ minWidth: 130 }}>
                  {/* Remove the review itself — the proportionate action for a
                      content report. Only when a still-published review is linked. */}
                  {f.reviewId && f.reviewStatus === 'Published' && (
                    <button className="btn btn-outline-danger btn-sm" disabled={busyId === f.flagId}
                      onClick={() => setConfirm({ flag: f, action: 'remove_review', title: 'Remove review?',
                        message: `Remove this review${f.productName ? ` of “${f.productName}”` : ''}? It won't be shown to customers.`, color: 'danger' })}>
                      Remove review
                    </button>
                  )}
                  {/* Only offer avatar removal when there's an uploaded photo. */}
                  {f.targetAvatar && (
                    <button className="btn btn-outline-danger btn-sm" disabled={busyId === f.flagId}
                      onClick={() => setConfirm({ flag: f, action: 'remove_avatar', title: 'Remove avatar?',
                        message: `Remove ${f.targetName}'s profile photo? Their reviews will fall back to initials.`, color: 'danger' })}>
                      Remove avatar
                    </button>
                  )}
                  <button className="btn btn-danger btn-sm" disabled={busyId === f.flagId || f.targetStatus === 'Suspended'}
                    onClick={() => setConfirm({ flag: f, action: 'suspend', title: 'Suspend user?',
                      message: `Suspend ${f.targetName}? They won't be able to sign in until reactivated. This is for repeat or serious abuse — to just take down this review, use “Remove review”.`, color: 'danger' })}>
                    Suspend user
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
