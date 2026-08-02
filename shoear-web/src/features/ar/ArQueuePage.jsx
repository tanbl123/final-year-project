import { useEffect, useState } from 'react';
import { getArQueue } from '../admin/adminService';
import ProductReviewModal from '../admin/products/ProductReviewModal';
import SortableTh from '../../components/SortableTh';
import Pagination from '../../components/Pagination';
import ClearableInput from '../../components/ClearableInput';
import Toast from '../../components/Toast';
import { useTableSort } from '../../hooks/useTableSort';
import { usePagination } from '../../hooks/usePagination';

const PAGE_SIZE = 10;

// Whole days a product has been waiting since it was submitted for review, and
// how that reads.
function waitInfo(since) {
  const days = Math.max(0, Math.floor((Date.now() - new Date(since).getTime()) / 86400000));
  const label = days === 0 ? 'today' : days === 1 ? '1 day' : `${days} days`;
  // amber after a few days, red after a week — a gentle SLA nudge
  const tone = days >= 7 ? 'danger' : days >= 3 ? 'warning' : 'muted';
  return { days, label, tone };
}

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
  const [search, setSearch] = useState('');
  const [notice, setNotice] = useState('');       // transient feedback (e.g. after reporting a model issue)

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

  // filter (product / brand / category) → sort → paginate
  const q = search.trim().toLowerCase();
  const filtered = q === '' ? products : products.filter((p) =>
    [p.productName, p.productBrand, p.categoryName].some((v) => (v || '').toLowerCase().includes(q)));
  // default: longest-waiting first (oldest submission)
  const sort = useTableSort(filtered, {
    initialKey: 'submittedAt',
    initialDir: 'asc',
    getValue: (p, k) => (k === 'submittedAt' ? new Date(p.submittedAt).getTime() : p[k]),
  });
  const { page, setPage, totalPages, pageItems } = usePagination(sort.sorted, PAGE_SIZE, q);

  return (
    <div className="container py-4 text-start">
      <h1 className="mb-1">🕶️ AR Queue</h1>
      <p className="text-muted">
        Try-on products awaiting AR preparation. Open one to run the auto-fit and record its
        Camera Kit lens — saving the lens marks it AR-ready and an admin can then approve it.
      </p>

      {!loading && products.length > 0 && (
        <div className="mb-3">
          <span className="badge text-bg-warning">{products.length} awaiting</span>
        </div>
      )}

      {/* success feedback as a toast (consistent with the admin/supplier pages);
          errors stay inline below */}
      <Toast message={notice} onClose={() => setNotice('')} />

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
        <>
          <div className="mb-3" style={{ maxWidth: 360 }}>
            <ClearableInput type="text" placeholder="Search product, brand or category"
              value={search} onChange={(e) => setSearch(e.target.value)}
              onClear={() => setSearch('')} />
          </div>

          {filtered.length === 0 ? (
            <div className="card card-body text-center text-muted">No products match “{search}”.</div>
          ) : (
            <div className="table-responsive">
              <table className="table align-middle">
                <thead>
                  <tr>
                    <SortableTh label="Product" columnKey="productName" sort={sort} />
                    <SortableTh label="Category" columnKey="categoryName" sort={sort} style={{ width: 150 }} />
                    <SortableTh label="Listing" columnKey="productStatus" sort={sort} className="text-center" style={{ width: 110 }} />
                    <SortableTh label="Waiting" columnKey="submittedAt" sort={sort} className="text-center" style={{ width: 140 }} />
                    <th className="text-center" style={{ width: 120 }}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {pageItems.map((p) => {
                    const w = waitInfo(p.submittedAt);
                    return (
                      <tr key={p.productId}>
                        <td style={{ overflowWrap: 'anywhere' }}>
                          <div className="fw-semibold">{p.productName}</div>
                          <div className="text-muted small">{p.productBrand}</div>
                          {p.arFlagged && (
                            <span className="badge text-bg-warning mt-1" title={p.arFlagNote || ''}>⚠ Issue reported</span>
                          )}
                        </td>
                        <td><span className="badge text-bg-light border">{p.categoryName}</span></td>
                        <td className="text-center">
                          <span className={`badge text-bg-${p.productStatus === 'Approved' ? 'success' : 'warning'}`}>
                            {p.productStatus}
                          </span>
                        </td>
                        <td className="text-center">
                          <span className={w.tone === 'muted' ? 'text-muted small' : `text-${w.tone} small fw-semibold`}
                            title={`Submitted for review ${new Date(p.submittedAt).toLocaleDateString()}`}>
                            {w.label}
                            {w.days >= 7 && ' ⚠'}
                          </span>
                        </td>
                        <td className="text-center">
                          <button className={`btn btn-sm ${p.arFlagged ? 'btn-outline-secondary' : 'btn-primary'}`}
                            onClick={() => setReviewId(p.productId)}>
                            {p.arFlagged ? 'View' : 'Prepare AR'}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>

              <Pagination page={page} totalPages={totalPages} onChange={setPage}
                summary={`Page ${page} of ${totalPages} · ${sort.sorted.length} awaiting`} />
            </div>
          )}
        </>
      )}

      {reviewId && (
        <ProductReviewModal
          productId={reviewId}
          mode="ar"
          title="Prepare AR try-on"
          onClose={closeReview}
          onFlagged={() => setNotice('Model issue reported — the admin will reject it so the supplier can fix & resubmit.')}
        />
      )}
    </div>
  );
}

export default ArQueuePage;
