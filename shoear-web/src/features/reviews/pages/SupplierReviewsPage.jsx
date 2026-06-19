import { useEffect, useState, useMemo } from 'react';
import { getSupplierReviews } from '../reviewService';
import StarRating from '../../../components/StarRating';

function SupplierReviewsPage() {
  const [reviews, setReviews] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [productId, setProductId] = useState('');
  const [rating, setRating] = useState('');

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    getSupplierReviews()
      .then((data) => setReviews(data.reviews))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  // overall summary + the product list for the filter
  const summary = useMemo(() => {
    const count = reviews.length;
    const avg = count ? reviews.reduce((s, r) => s + r.ratingScore, 0) / count : 0;
    return { count, avg };
  }, [reviews]);

  const products = useMemo(() => {
    const seen = new Map();
    reviews.forEach((r) => { if (!seen.has(r.productId)) seen.set(r.productId, r.productName); });
    return [...seen.entries()].map(([id, name]) => ({ id, name }));
  }, [reviews]);

  const visible = reviews.filter((r) => {
    if (productId && r.productId !== productId) return false;
    if (rating && r.ratingScore !== Number(rating)) return false;
    return true;
  });

  return (
    <div className="container py-4 text-start">
      <h1 className="mb-1">⭐ Reviews</h1>
      <p className="text-muted">What customers say about your products.</p>

      {error && (
        <div className="alert alert-danger py-2 d-flex justify-content-between align-items-center">
          <span>{error}</span>
          <button type="button" className="btn-close" onClick={() => setError('')}></button>
        </div>
      )}

      {/* summary tiles */}
      {!loading && reviews.length > 0 && (
        <div className="row g-3 mb-4">
          <div className="col-6 col-md-3">
            <div className="card card-body py-3">
              <div className="text-muted small text-uppercase">Average rating</div>
              <div className="d-flex align-items-center gap-2">
                <span className="fs-4 fw-bold">{summary.avg.toFixed(1)}</span>
                <StarRating score={summary.avg} />
              </div>
            </div>
          </div>
          <div className="col-6 col-md-3">
            <div className="card card-body py-3">
              <div className="text-muted small text-uppercase">Total reviews</div>
              <div className="fs-4 fw-bold">{summary.count}</div>
            </div>
          </div>
        </div>
      )}

      {/* filters */}
      {!loading && reviews.length > 0 && (
        <div className="card card-body mb-4">
          <div className="row g-2 align-items-end">
            <div className="col-md-6">
              <label className="form-label small text-muted mb-1">Product</label>
              <select className="form-select" value={productId} onChange={(e) => setProductId(e.target.value)}>
                <option value="">All products</option>
                {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <div className="col-md-6">
              <label className="form-label small text-muted mb-1">Rating</label>
              <select className="form-select" value={rating} onChange={(e) => setRating(e.target.value)}>
                <option value="">All ratings</option>
                {[5, 4, 3, 2, 1].map((n) => <option key={n} value={n}>{n} star{n === 1 ? '' : 's'}</option>)}
              </select>
            </div>
          </div>
        </div>
      )}

      {loading ? (
        <p className="text-muted">Loading…</p>
      ) : reviews.length === 0 ? (
        <div className="card card-body text-center text-muted">No reviews yet for your products.</div>
      ) : visible.length === 0 ? (
        <div className="card card-body text-center text-muted">No reviews match these filters.</div>
      ) : (
        <div className="d-flex flex-column gap-3">
          {visible.map((r) => (
            <div className="card" key={r.reviewId}>
              <div className="card-body">
                <div className="d-flex justify-content-between align-items-start flex-wrap gap-2">
                  <div>
                    <div className="fw-semibold">{r.productName}</div>
                    <div className="text-muted small">{r.brand}</div>
                  </div>
                  <StarRating score={r.ratingScore} size="1.1rem" />
                </div>
                {r.reviewComment && <p className="mt-2 mb-1">{r.reviewComment}</p>}
                <div className="text-muted small">
                  {r.customerName} · {new Date(r.reviewDate).toLocaleDateString()}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default SupplierReviewsPage;
