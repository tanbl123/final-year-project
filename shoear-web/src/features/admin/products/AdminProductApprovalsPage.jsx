import { useEffect, useMemo, useState } from 'react';
import { getPendingProducts, approveProduct, rejectProduct, refreshBadges } from '../adminService';
import ConfirmDialog from '../../../components/ConfirmDialog';
import Pagination from '../../../components/Pagination';
import Toast from '../../../components/Toast';
import ClearableInput from '../../../components/ClearableInput';
import SortableTh from '../../../components/SortableTh';
import { usePagination } from '../../../hooks/usePagination';
import { useTableSort } from '../../../hooks/useTableSort';
import ProductReviewModal from './ProductReviewModal';

const PAGE_SIZE = 10;

function AdminProductApprovalsPage() {
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');        // transient success message
  const [busyId, setBusyId] = useState('');         // productId currently being actioned
  const [approving, setApproving] = useState(null); // product pending approve confirmation
  const [rejecting, setRejecting] = useState(null); // product pending reject confirmation
  const [rejectReason, setRejectReason] = useState(''); // reason typed in the reject dialog
  const [reviewId, setReviewId] = useState('');     // product being previewed in the modal
  const [search, setSearch] = useState('');

  // client-side search across name / brand / supplier / category
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return products;
    return products.filter((p) =>
      [p.productName, p.productBrand, p.companyName, p.categoryName]
        .some((v) => String(v ?? '').toLowerCase().includes(q)));
  }, [products, search]);

  // click a header to sort; Price numeric, Submitted by date
  const sort = useTableSort(filtered, {
    initialKey: 'created_at',
    initialDir: 'desc',
    getValue: (p, k) => {
      if (k === 'productPrice') return Number(p.productPrice);
      if (k === 'created_at') return new Date(p.created_at).getTime();
      return p[k] ?? '';
    },
  });

  const { page, setPage, totalPages, pageItems } = usePagination(sort.sorted, PAGE_SIZE);

  // load the pending queue on mount
  useEffect(() => {
    let active = true;
    getPendingProducts()
      .then((data) => { if (active) setProducts(data.products); })
      .catch((err) => { if (active) setError(err.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  // approve / reject share the same shape: call the API, drop the row, notify
  async function act(product, action, reason) {
    setBusyId(product.productId);
    setError('');
    try {
      if (action === 'approve') await approveProduct(product.productId);
      else await rejectProduct(product.productId, reason);

      setProducts((prev) => prev.filter((p) => p.productId !== product.productId));
      setNotice(`${product.productName} ${action === 'approve' ? 'approved' : 'rejected'}.`);
      refreshBadges();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId('');
    }
  }

  return (
    <div className="container py-4">
      <h1 className="mb-1">📦 Product Approvals</h1>
      <p className="text-muted">Review products submitted by suppliers.</p>

      {/* success confirmations are transient → toast (errors stay inline below) */}
      <Toast message={notice} onClose={() => setNotice('')} />
      {error && <div className="alert alert-danger py-2">{error}</div>}

      {!loading && products.length > 0 && (
        <div className="card card-body mb-4">
          <label className="form-label small text-muted mb-1">Search</label>
          <ClearableInput type="text" placeholder="Product, brand, supplier or category"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            onClear={() => { setSearch(''); setPage(1); }} />
        </div>
      )}

      {loading ? (
        <p className="text-muted">Loading…</p>
      ) : products.length === 0 ? (
        <div className="card card-body text-center text-muted">
          🎉 No pending products. You're all caught up.
        </div>
      ) : filtered.length === 0 ? (
        <div className="card card-body text-center text-muted">No pending products match your search.</div>
      ) : (
        <div className="table-responsive">
          <table className="table align-middle">
            <thead>
              <tr>
                <SortableTh label="Product" columnKey="productName" sort={sort} />
                <SortableTh label="Supplier" columnKey="companyName" sort={sort} />
                <SortableTh label="Category" columnKey="categoryName" sort={sort} className="text-center" style={{ width: 130 }} />
                <SortableTh label="Price" columnKey="productPrice" sort={sort} className="text-end" style={{ width: 120 }} />
                <SortableTh label="Submitted" columnKey="created_at" sort={sort} className="text-center" style={{ width: 120 }} />
                <th className="text-center" style={{ width: 230 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {pageItems.map((p) => (
                <tr key={p.productId}>
                  <td>
                    <button type="button" className="btn btn-link p-0 fw-semibold text-start text-decoration-none"
                      onClick={() => setReviewId(p.productId)}>
                      {p.productName}
                    </button>
                    <div className="text-muted small">{p.productBrand}</div>
                  </td>
                  <td>{p.companyName}</td>
                  <td className="text-center"><span className="badge text-bg-light">{p.categoryName}</span></td>
                  <td className="text-end">RM {p.productPrice.toFixed(2)}</td>
                  <td className="text-center text-muted small">{new Date(p.created_at).toLocaleDateString()}</td>
                  <td className="text-center text-nowrap">
                    <button
                      className="btn btn-outline-secondary btn-sm me-2"
                      onClick={() => setReviewId(p.productId)}
                    >
                      View
                    </button>
                    <button
                      className="btn btn-success btn-sm me-2"
                      disabled={busyId === p.productId}
                      onClick={() => setApproving(p)}
                    >
                      {busyId === p.productId ? '…' : 'Approve'}
                    </button>
                    <button
                      className="btn btn-outline-danger btn-sm"
                      disabled={busyId === p.productId}
                      onClick={() => { setRejectReason(''); setRejecting(p); }}
                    >
                      Reject
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <Pagination page={page} totalPages={totalPages} onChange={setPage}
            summary={`Page ${page} of ${totalPages} · ${filtered.length} pending`} />
        </div>
      )}

      <ProductReviewModal
        productId={reviewId}
        busy={busyId === reviewId}
        onClose={() => setReviewId('')}
        onApprove={(prod) => { setReviewId(''); setApproving({ productId: prod.id, productName: prod.name }); }}
        onReject={(prod) => { setReviewId(''); setRejectReason(''); setRejecting({ productId: prod.id, productName: prod.name }); }}
      />

      {/* Approve is now behind a confirm — it makes the product publicly visible. */}
      <ConfirmDialog
        isOpen={!!approving}
        title="Approve product?"
        message={approving ? `Approve "${approving.productName}"? It will be published and visible to customers.` : ''}
        confirmText="Approve"
        confirmColor="success"
        onCancel={() => setApproving(null)}
        onConfirm={() => { const p = approving; setApproving(null); act(p, 'approve'); }}
      />

      {/* Reject requires a reason — shown to the supplier in-app and emailed. */}
      <ConfirmDialog
        isOpen={!!rejecting}
        title="Reject product?"
        message={rejecting ? `Reject "${rejecting.productName}"? It won't be listed, and the supplier will be told why.` : ''}
        confirmText="Reject"
        confirmColor="danger"
        confirmDisabled={!rejectReason.trim()}
        onCancel={() => { setRejecting(null); setRejectReason(''); }}
        onConfirm={() => { const p = rejecting; const r = rejectReason.trim(); setRejecting(null); setRejectReason(''); act(p, 'reject', r); }}
      >
        <label className="form-label small fw-semibold mt-2 mb-1">Reason for rejection <span className="text-danger">*</span></label>
        <textarea
          className="form-control"
          rows={3}
          maxLength={255}
          placeholder="e.g. The 3D model is low quality / doesn't match the product photos."
          value={rejectReason}
          onChange={(e) => setRejectReason(e.target.value)}
        />
        <div className="form-text">{rejectReason.length}/255 · the supplier sees this and can fix it, then resubmit.</div>
      </ConfirmDialog>
    </div>
  );
}

export default AdminProductApprovalsPage;
