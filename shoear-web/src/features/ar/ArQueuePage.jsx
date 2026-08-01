import { useEffect, useState } from 'react';
import { getArQueue } from '../admin/adminService';
import ProductReviewModal from '../admin/products/ProductReviewModal';

// AR Specialist workspace: the queue of virtual-try-on products still needing AR
// preparation (no Camera Kit lens recorded yet). Opening one launches the slim
// AR review modal (auto-fit + lens) — no pricing, supplier or stock, and no
// approve/reject (that stays with the admin). Saving a lens marks the product
// AR-ready, which drops it out of this queue.
function ArQueuePage() {
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reviewId, setReviewId] = useState('');   // product open in the modal

  function load() {
    setLoading(true);
    getArQueue()
      .then((data) => setProducts(data.products || []))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, []);

  // When the modal closes, refresh the list: a product that just had its lens
  // saved is now AR-ready and should disappear from the queue.
  function closeReview() {
    setReviewId('');
    load();
  }

  return (
    <div className="container py-4 text-start">
      <h1 className="mb-1">🕶️ AR Queue</h1>
      <p className="text-muted">
        Try-on products awaiting AR preparation. Open one to run the auto-fit and record its
        Camera Kit lens — saving the lens marks it AR-ready and an admin can then approve it.
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
        <div className="card card-body text-center text-muted">
          Nothing to prepare right now — every try-on product has its AR lens set. 🎉
        </div>
      ) : (
        <div className="table-responsive">
          <table className="table align-middle">
            <thead>
              <tr>
                <th>Product</th>
                <th style={{ width: 160 }}>Category</th>
                <th className="text-center" style={{ width: 120 }}>Listing</th>
                <th className="text-center" style={{ width: 120 }}>Added</th>
                <th className="text-center" style={{ width: 120 }}>Action</th>
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
                  <td className="text-center">
                    <span className={`badge text-bg-${p.productStatus === 'Approved' ? 'success' : 'warning'}`}>
                      {p.productStatus}
                    </span>
                  </td>
                  <td className="text-center text-muted small">
                    {new Date(p.created_at).toLocaleDateString()}
                  </td>
                  <td className="text-center">
                    <button className="btn btn-primary btn-sm" onClick={() => setReviewId(p.productId)}>
                      Prepare AR
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
          title="Prepare AR try-on"
          onClose={closeReview}
        />
      )}
    </div>
  );
}

export default ArQueuePage;
