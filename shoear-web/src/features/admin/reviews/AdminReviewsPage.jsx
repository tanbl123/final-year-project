import { useEffect, useState } from 'react';
import { getAdminReviews, setReviewStatus } from '../reviewService';
import StarRating from '../../../components/StarRating';
import ConfirmDialog from '../../../components/ConfirmDialog';
import Toast from '../../../components/Toast';
import Pagination from '../../../components/Pagination';
import ClearableInput from '../../../components/ClearableInput';
import { usePagination } from '../../../hooks/usePagination';

const PAGE_SIZE = 10;

function AdminReviewsPage() {
  const [reviews, setReviews] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const [busyId, setBusyId] = useState('');
  const [removing, setRemoving] = useState(null);     // review pending remove confirm

  const [filters, setFilters] = useState({ status: '', rating: '', search: '' });
  const [debouncedSearch, setDebouncedSearch] = useState('');

  const { page, setPage, totalPages, pageItems } = usePagination(reviews, PAGE_SIZE);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(filters.search), 300);
    return () => clearTimeout(t);
  }, [filters.search]);

  function load() {
    setLoading(true);
    getAdminReviews({ status: filters.status, rating: filters.rating, search: debouncedSearch })
      .then((data) => setReviews(data.reviews))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    setPage(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.status, filters.rating, debouncedSearch]);

  async function moderate(review, status) {
    setBusyId(review.reviewId);
    setError('');
    try {
      await setReviewStatus(review.reviewId, status);
      setToast(`Review ${status === 'Removed' ? 'removed' : 'restored'}.`);
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId('');
    }
  }

  return (
    <div className="container py-4 text-start">
      <h1 className="mb-1">⭐ Review Moderation</h1>
      <p className="text-muted">View product reviews and remove inappropriate ones.</p>

      {error && (
        <div className="alert alert-danger py-2 d-flex justify-content-between align-items-center">
          <span>{error}</span>
          <button type="button" className="btn-close" onClick={() => setError('')}></button>
        </div>
      )}

      {/* filters */}
      <div className="card card-body mb-4">
        <div className="row g-2 align-items-end">
          <div className="col-md-5">
            <label className="form-label small text-muted mb-1">Search</label>
            <ClearableInput type="text" placeholder="Product, comment or customer"
              value={filters.search}
              onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value }))}
              onClear={() => setFilters((f) => ({ ...f, search: '' }))} />
          </div>
          <div className="col-md-4">
            <label className="form-label small text-muted mb-1">Rating</label>
            <select className="form-select" value={filters.rating}
              onChange={(e) => setFilters((f) => ({ ...f, rating: e.target.value }))}>
              <option value="">All ratings</option>
              {[5, 4, 3, 2, 1].map((n) => <option key={n} value={n}>{n} star{n === 1 ? '' : 's'}</option>)}
            </select>
          </div>
          <div className="col-md-3">
            <label className="form-label small text-muted mb-1">Status</label>
            <select className="form-select" value={filters.status}
              onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))}>
              <option value="">All</option>
              <option value="Published">Published</option>
              <option value="Removed">Removed</option>
            </select>
          </div>
        </div>
      </div>

      {loading ? (
        <p className="text-muted">Loading…</p>
      ) : reviews.length === 0 ? (
        <div className="card card-body text-center text-muted">No reviews match these filters.</div>
      ) : (
        <div className="table-responsive">
          <table className="table align-middle">
            <thead>
              <tr>
                <th>Product / Supplier</th>
                <th style={{ width: 120 }}>Rating</th>
                <th>Review</th>
                <th style={{ width: 140 }}>Customer</th>
                <th className="text-center" style={{ width: 110 }}>Status</th>
                <th className="text-center" style={{ width: 130 }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {pageItems.map((r) => (
                <tr key={r.reviewId} className={r.reviewStatus === 'Removed' ? 'table-secondary' : undefined}>
                  <td>
                    <div className="fw-semibold">{r.productName}</div>
                    <div className="text-muted small">{r.supplierName}</div>
                  </td>
                  <td><StarRating score={r.ratingScore} /></td>
                  <td style={{ overflowWrap: 'anywhere' }}>
                    {r.reviewComment || <span className="text-muted">—</span>}
                  </td>
                  <td>
                    <div>{r.customerName}</div>
                    <div className="text-muted small">{new Date(r.reviewDate).toLocaleDateString()}</div>
                  </td>
                  <td className="text-center">
                    <span className={`badge text-bg-${r.reviewStatus === 'Published' ? 'success' : 'secondary'}`}>
                      {r.reviewStatus}
                    </span>
                  </td>
                  <td className="text-center">
                    {r.reviewStatus === 'Published' ? (
                      <button className="btn btn-outline-danger btn-sm" disabled={busyId === r.reviewId}
                        onClick={() => setRemoving(r)}>
                        Remove
                      </button>
                    ) : (
                      <button className="btn btn-outline-success btn-sm" disabled={busyId === r.reviewId}
                        onClick={() => moderate(r, 'Published')}>
                        Restore
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <Pagination page={page} totalPages={totalPages} onChange={setPage}
            summary={`Page ${page} of ${totalPages} · ${reviews.length} reviews`} />
        </div>
      )}

      <ConfirmDialog
        isOpen={!!removing}
        title="Remove review?"
        message={removing ? `Remove this review of “${removing.productName}”? It won't be shown to customers.` : ''}
        confirmText="Remove"
        confirmColor="danger"
        onCancel={() => setRemoving(null)}
        onConfirm={() => { const r = removing; setRemoving(null); moderate(r, 'Removed'); }}
      />

      <Toast message={toast} onClose={() => setToast('')} />
    </div>
  );
}

export default AdminReviewsPage;
