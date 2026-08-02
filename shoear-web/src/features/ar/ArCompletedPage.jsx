import { useEffect, useState } from 'react';
import { getArCompleted } from '../admin/adminService';
import ProductReviewModal from '../admin/products/ProductReviewModal';

// AR "Completed" history: products that have been made AR-ready, newest first,
// with when and which staff member prepared them. Opening one reuses the slim
// AR review modal (read-only-ish: view the model + the saved lens; the lens can
// still be updated here if a re-prep is needed).
function ArCompletedPage() {
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reviewId, setReviewId] = useState('');

  function load() {
    setLoading(true);
    getArCompleted()
      .then((data) => setProducts(data.products || []))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, []);

  function closeReview() {
    setReviewId('');
    load();   // a re-prep here may change what's shown
  }

  const fmt = (d) => (d ? new Date(d).toLocaleString() : '—');

  return (
    <div className="container py-4 text-start">
      <h1 className="mb-1">✅ Completed</h1>
      <p className="text-muted">
        Products you and the team have made AR-ready. Open one to review its model or update the lens.
      </p>

      {error && (
        <div className="alert alert-danger py-2 d-flex justify-content-between align-items-center">
          <span>{error}</span>
          <button type="button" className="btn-close" onClick={() => setError('')}></button>
        </div>
      )}

      {loading ? (
        <p className="text-muted">Loading…</p>
      ) : products.length === 0 ? (
        <div className="card card-body text-center text-muted">Nothing prepared yet.</div>
      ) : (
        <div className="table-responsive">
          <table className="table align-middle">
            <thead>
              <tr>
                <th>Product</th>
                <th style={{ width: 150 }}>Category</th>
                <th style={{ width: 180 }}>Prepared by</th>
                <th style={{ width: 180 }}>Prepared at</th>
                <th className="text-center" style={{ width: 110 }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {products.map((p) => (
                <tr key={p.productId}>
                  <td style={{ overflowWrap: 'anywhere' }}>
                    <div className="fw-semibold">{p.productName}</div>
                    <div className="text-muted small">{p.productBrand}</div>
                  </td>
                  <td><span className="badge text-bg-light border">{p.categoryName}</span></td>
                  <td>{p.preparedBy || <span className="text-muted">—</span>}</td>
                  <td className="text-muted small">{fmt(p.arReadyAt)}</td>
                  <td className="text-center">
                    <button className="btn btn-outline-primary btn-sm" onClick={() => setReviewId(p.productId)}>
                      View
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {reviewId && (
        <ProductReviewModal
          productId={reviewId}
          mode="ar"
          title="AR review"
          onClose={closeReview}
        />
      )}
    </div>
  );
}

export default ArCompletedPage;
