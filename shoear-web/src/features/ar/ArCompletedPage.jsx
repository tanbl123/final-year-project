import { useEffect, useState } from 'react';
import { getArCompleted } from '../admin/adminService';
import { useAuth } from '../auth/AuthContext';
import ProductReviewModal from '../admin/products/ProductReviewModal';
import SortableTh from '../../components/SortableTh';
import Pagination from '../../components/Pagination';
import { useTableSort } from '../../hooks/useTableSort';
import { usePagination } from '../../hooks/usePagination';

const PAGE_SIZE = 10;

// AR "Completed" history: products that have been made AR-ready, newest first,
// with when and which staff member prepared them. Opening one reuses the slim
// AR review modal (read-only-ish: view the model + the saved lens; the lens can
// still be updated here if a re-prep is needed).
function ArCompletedPage() {
  const { user } = useAuth();
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reviewId, setReviewId] = useState('');
  const [scope, setScope] = useState('all');   // 'all' (team) | 'mine'

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
  const shown = scope === 'mine'
    ? products.filter((p) => p.preparedById && p.preparedById === user?.userId)
    : products;

  // Sortable + paginated like the admin approvals page; default is chronological
  // (most recently prepared first).
  const sort = useTableSort(shown, {
    initialKey: 'arReadyAt',
    initialDir: 'desc',
    getValue: (p, k) => (k === 'arReadyAt' ? new Date(p.arReadyAt).getTime() : p[k]),
  });
  const { page, setPage, totalPages, pageItems } = usePagination(sort.sorted, PAGE_SIZE);

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

      {/* team-wide vs my own work */}
      <div className="btn-group btn-group-sm mb-3" role="group">
        <button type="button" className={`btn btn-outline-secondary${scope === 'all' ? ' active' : ''}`}
          onClick={() => { setScope('all'); setPage(1); }}>All completed</button>
        <button type="button" className={`btn btn-outline-secondary${scope === 'mine' ? ' active' : ''}`}
          onClick={() => { setScope('mine'); setPage(1); }}>Prepared by me</button>
      </div>

      {loading ? (
        <p className="text-muted">Loading…</p>
      ) : shown.length === 0 ? (
        <div className="card card-body text-center text-muted">
          {scope === 'mine' ? "You haven't prepared any products yet." : 'Nothing prepared yet.'}
        </div>
      ) : (
        <div className="table-responsive">
          <table className="table align-middle">
            <thead>
              <tr>
                <SortableTh label="Product" columnKey="productName" sort={sort} />
                <SortableTh label="Category" columnKey="categoryName" sort={sort} style={{ width: 150 }} />
                <SortableTh label="Prepared by" columnKey="preparedBy" sort={sort} style={{ width: 180 }} />
                <SortableTh label="Prepared at" columnKey="arReadyAt" sort={sort} style={{ width: 180 }} />
                <th className="text-center" style={{ width: 110 }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {pageItems.map((p) => (
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

          <Pagination page={page} totalPages={totalPages} onChange={setPage}
            summary={`Page ${page} of ${totalPages} · ${sort.sorted.length} prepared`} />
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
