import { useEffect, useState } from 'react';
import Toast from '../../../components/Toast';
import ConfirmDialog from '../../../components/ConfirmDialog';
import StarRating from '../../../components/StarRating';
import Pagination from '../../../components/Pagination';
import UserDetailModal from '../users/UserDetailModal';
import { usePagination } from '../../../hooks/usePagination';
import { getFlags, getUser, resolveFlag, refreshBadges } from '../adminService';

const PAGE_SIZE = 10;

// Reactive moderation queue: customer-reported reviews/avatars. The admin views
// the reported user's avatar and can remove it, suspend the user, or dismiss.
function AdminFlagsPage() {
  const [flags, setFlags] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busyId, setBusyId] = useState('');
  const [confirm, setConfirm] = useState(null);   // { flag, action, title, message, color }
  const [detail, setDetail] = useState(null);     // user shown in the in-place detail popup
  const [detailLoading, setDetailLoading] = useState(false);
  const [warn, setWarn] = useState(null);         // { flag, message } for the "ask to edit" popup

  // View a user's details WITHOUT leaving the moderation queue — open the shared
  // detail modal right here so the admin can decide on the flag afterwards.
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
    getFlags()
      .then((data) => { if (active) setFlags(data.flags); })
      .catch((err) => { if (active) setError(err.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  async function act(flag, action, note) {
    setBusyId(flag.flagId);
    setError('');
    try {
      await resolveFlag(flag.flagId, action, note);
      // dismiss clears one flag; remove_review/warn clear flags on that review;
      // remove_avatar/suspend clear every open flag for that user.
      setFlags((prev) => prev.filter((f) => {
        if (action === 'dismiss') return f.flagId !== flag.flagId;
        if (action === 'remove_review' || action === 'warn') {
          return flag.reviewId ? f.reviewId !== flag.reviewId : f.flagId !== flag.flagId;
        }
        return f.targetUserId !== flag.targetUserId;
      }));
      setNotice(
        action === 'remove_avatar' ? `Removed ${flag.targetName}'s avatar.`
        : action === 'remove_review' ? 'Review removed.'
        : action === 'warn'        ? `Asked ${flag.targetName} to edit their review.`
        : action === 'suspend'     ? `${flag.targetName} suspended.`
        : 'Report dismissed.');
      refreshBadges();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId('');
    }
  }

  const { page, setPage, totalPages, pageItems } = usePagination(flags, PAGE_SIZE);

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
          {pageItems.map((f) => (
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
                    {f.targetUserId
                      ? <button type="button" className="btn btn-link p-0 fw-semibold align-baseline text-decoration-none"
                          onClick={() => viewUser(f.targetUserId)} title="View user details">{f.targetName}</button>
                      : f.targetName}
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
                    Reported by{' '}
                    {f.reporterUserId
                      ? <button type="button" className="btn btn-link p-0 fw-semibold align-baseline text-decoration-none"
                          onClick={() => viewUser(f.reporterUserId)} title="View user details">{f.reporterName}</button>
                      : <strong>{f.reporterName}</strong>}
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
                  {/* Soft option: ask the reviewer to edit/remove it themselves. */}
                  {f.reviewId && f.reviewStatus === 'Published' && (
                    <button className="btn btn-outline-primary btn-sm" disabled={busyId === f.flagId}
                      onClick={() => setWarn({ flag: f,
                        message: `Your review${f.productName ? ` of “${f.productName}”` : ''} was reported. Please make sure it follows our community guidelines — you can edit or remove it from the product page.` })}>
                      Ask to edit
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
          <Pagination page={page} totalPages={totalPages} onChange={setPage}
            summary={`Page ${page} of ${totalPages} · ${flags.length} report${flags.length === 1 ? '' : 's'}`} />
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

      {/* "Ask to edit" — send the reviewer a message (editable) instead of a
          strict take-down. The customer gets it in-app + push, deep-linked to
          their review so they can fix it. */}
      {warn && (
        <div className="modal show d-block" tabIndex="-1" style={{ background: 'rgba(0,0,0,.5)' }}
          onClick={() => setWarn(null)}>
          <div className="modal-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title">Ask {warn.flag.targetName} to edit</h5>
                <button type="button" className="btn-close" onClick={() => setWarn(null)}></button>
              </div>
              <div className="modal-body">
                <label className="form-label small text-muted">Message to the customer (they'll get it in-app, linked to their review)</label>
                <textarea className="form-control" rows={4} maxLength={200}
                  value={warn.message}
                  onChange={(e) => setWarn((w) => ({ ...w, message: e.target.value }))} />
                <div className="text-muted small mt-1">The review stays visible — this just asks them to revise it.</div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-outline-secondary" onClick={() => setWarn(null)}>Cancel</button>
                <button type="button" className="btn btn-primary"
                  disabled={!warn.message.trim() || busyId === warn.flag.flagId}
                  onClick={() => { const w = warn; setWarn(null); act(w.flag, 'warn', w.message.trim()); }}>
                  Send request
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* in-place user detail — keeps the admin in the moderation queue */}
      <UserDetailModal detail={detail} loading={detailLoading} onClose={() => setDetail(null)} />
    </div>
  );
}

export default AdminFlagsPage;
