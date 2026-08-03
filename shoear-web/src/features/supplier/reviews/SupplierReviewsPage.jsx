import { useEffect, useMemo, useState } from 'react';
import Toast from '../../../components/Toast';
import ConfirmDialog from '../../../components/ConfirmDialog';
import { getSupplierReviews, replyToReview, deleteReviewReply } from '../../admin/reviewService';

function Stars({ n }) {
  return (
    <span style={{ color: '#f59e0b', letterSpacing: 1 }}>
      {'★'.repeat(n)}<span className="text-muted">{'★'.repeat(Math.max(0, 5 - n))}</span>
    </span>
  );
}

// Customer reviews across all the supplier's products, with inline reply. The
// unreplied ones surface first (and drive the sidebar "Reviews" badge).
function SupplierReviewsPage() {
  const [reviews, setReviews] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [filter, setFilter] = useState('all');     // 'all' | 'unreplied'
  const [replyingId, setReplyingId] = useState('');
  const [replyText, setReplyText] = useState('');
  const [busyId, setBusyId] = useState('');
  const [removing, setRemoving] = useState(null);   // review pending reply-delete

  function load() {
    setLoading(true);
    getSupplierReviews()
      .then((data) => setReviews(data.reviews))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, []);

  const isReplied = (r) => !!(r.supplierReply && r.supplierReply.trim());
  const unrepliedCount = reviews.filter((r) => !isReplied(r)).length;
  const shown = useMemo(
    () => (filter === 'unreplied' ? reviews.filter((r) => !isReplied(r)) : reviews),
    [reviews, filter]);

  function startReply(r) { setReplyingId(r.reviewId); setReplyText(r.supplierReply || ''); }

  async function sendReply(r) {
    if (replyText.trim() === '') return;
    setBusyId(r.reviewId); setError('');
    try {
      await replyToReview(r.reviewId, replyText.trim());
      setNotice('Reply posted.');
      setReplyingId(''); setReplyText('');
      load();
    } catch (err) { setError(err.message); }
    finally { setBusyId(''); }
  }

  async function removeReply(r) {
    setBusyId(r.reviewId); setError('');
    try {
      await deleteReviewReply(r.reviewId);
      setNotice('Reply removed.');
      load();
    } catch (err) { setError(err.message); }
    finally { setBusyId(''); }
  }

  return (
    <div className="container py-4">
      <h1 className="mb-1">⭐ Reviews</h1>
      <p className="text-muted">Customer reviews on your products. Reply to build trust — the ones awaiting a reply are shown first.</p>

      <Toast message={notice} onClose={() => setNotice('')} />
      {error && <div className="alert alert-danger py-2">{error}</div>}

      <div className="btn-group mb-3">
        <button className={`btn btn-sm ${filter === 'all' ? 'btn-primary' : 'btn-outline-primary'}`}
          onClick={() => setFilter('all')}>All ({reviews.length})</button>
        <button className={`btn btn-sm ${filter === 'unreplied' ? 'btn-primary' : 'btn-outline-primary'}`}
          onClick={() => setFilter('unreplied')}>Awaiting reply ({unrepliedCount})</button>
      </div>

      {loading ? (
        <p className="text-muted">Loading…</p>
      ) : shown.length === 0 ? (
        <div className="card card-body text-center text-muted">
          {filter === 'unreplied' ? '🎉 All caught up — no reviews awaiting a reply.' : 'No reviews yet.'}
        </div>
      ) : (
        <div className="d-flex flex-column gap-3">
          {shown.map((r) => (
            <div key={r.reviewId} className="card">
              <div className="card-body">
                <div className="d-flex justify-content-between align-items-start flex-wrap gap-2">
                  <div className="d-flex align-items-start gap-2">
                    {r.customerAvatar
                      ? <img src={r.customerAvatar} alt="" className="rounded-circle" style={{ width: 36, height: 36, objectFit: 'cover' }} />
                      : <span className="rounded-circle bg-light border d-flex align-items-center justify-content-center fw-semibold"
                          style={{ width: 36, height: 36 }}>{(r.customerName || '?')[0].toUpperCase()}</span>}
                    <div>
                      <div className="fw-semibold small">{r.customerName}</div>
                      <div><Stars n={r.ratingScore} /></div>
                    </div>
                  </div>
                  <div className="text-end">
                    <div className="text-muted small">{new Date(r.reviewDate).toLocaleDateString()}</div>
                    {!isReplied(r) && <span className="badge text-bg-warning">Awaiting reply</span>}
                  </div>
                </div>
                <div className="text-muted small mt-1">on <span className="fw-semibold">{r.productName}</span></div>
                {r.reviewComment && <p className="mb-2 mt-2">{r.reviewComment}</p>}

                {isReplied(r) && replyingId !== r.reviewId && (
                  <div className="bg-light rounded p-2 small">
                    <span className="fw-semibold">Your reply:</span> {r.supplierReply}
                    <div className="mt-1">
                      <button className="btn btn-link btn-sm p-0 me-3" onClick={() => startReply(r)}>Edit</button>
                      <button className="btn btn-link btn-sm p-0 text-danger" onClick={() => setRemoving(r)}>Remove</button>
                    </div>
                  </div>
                )}

                {replyingId === r.reviewId ? (
                  <div className="mt-2">
                    <textarea className="form-control" rows={2} value={replyText}
                      onChange={(e) => setReplyText(e.target.value)} placeholder="Write a public reply…" />
                    <div className="mt-2">
                      <button className="btn btn-primary btn-sm me-2" disabled={busyId === r.reviewId || replyText.trim() === ''}
                        onClick={() => sendReply(r)}>{busyId === r.reviewId ? 'Posting…' : 'Post reply'}</button>
                      <button className="btn btn-outline-secondary btn-sm"
                        onClick={() => { setReplyingId(''); setReplyText(''); }}>Cancel</button>
                    </div>
                  </div>
                ) : !isReplied(r) ? (
                  <button className="btn btn-outline-primary btn-sm mt-1" onClick={() => startReply(r)}>Reply</button>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      )}

      <ConfirmDialog
        isOpen={!!removing}
        title="Remove your reply?"
        message="This removes your public reply to this review."
        confirmText="Remove"
        confirmColor="danger"
        onCancel={() => setRemoving(null)}
        onConfirm={() => { const r = removing; setRemoving(null); if (r) removeReply(r); }}
      />
    </div>
  );
}

export default SupplierReviewsPage;
