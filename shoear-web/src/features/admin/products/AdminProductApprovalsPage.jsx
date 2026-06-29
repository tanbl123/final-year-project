import { useEffect, useState } from 'react';
import { getPendingProducts, approveProduct, rejectProduct, refreshBadges } from '../adminService';
import ConfirmDialog from '../../../components/ConfirmDialog';
import Pagination from '../../../components/Pagination';
import Toast from '../../../components/Toast';
import { usePagination } from '../../../hooks/usePagination';

const PAGE_SIZE = 10;

function AdminProductApprovalsPage() {
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');        // transient success message
  const [busyId, setBusyId] = useState('');         // productId currently being actioned
  const [rejecting, setRejecting] = useState(null); // product pending reject confirmation

  const { page, setPage, totalPages, pageItems } = usePagination(products, PAGE_SIZE);

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
  async function act(product, action) {
    setBusyId(product.productId);
    setError('');
    try {
      if (action === 'approve') await approveProduct(product.productId);
      else await rejectProduct(product.productId);

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

      {loading ? (
        <p className="text-muted">Loading…</p>
      ) : products.length === 0 ? (
        <div className="card card-body text-center text-muted">
          🎉 No pending products. You're all caught up.
        </div>
      ) : (
        <div className="table-responsive">
          <table className="table align-middle">
            <thead>
              <tr>
                <th>Product</th>
                <th>Supplier</th>
                <th>Category</th>
                <th className="text-end">Price</th>
                <th>Submitted</th>
                <th className="text-end">Actions</th>
              </tr>
            </thead>
            <tbody>
              {pageItems.map((p) => (
                <tr key={p.productId}>
                  <td>
                    <div className="fw-semibold">{p.productName}</div>
                    <div className="text-muted small">{p.productBrand}</div>
                  </td>
                  <td>{p.companyName}</td>
                  <td><span className="badge text-bg-light">{p.categoryName}</span></td>
                  <td className="text-end">RM {p.productPrice.toFixed(2)}</td>
                  <td className="text-muted small">{new Date(p.created_at).toLocaleDateString()}</td>
                  <td className="text-end text-nowrap">
                    <button
                      className="btn btn-success btn-sm me-2"
                      disabled={busyId === p.productId}
                      onClick={() => act(p, 'approve')}
                    >
                      {busyId === p.productId ? '…' : 'Approve'}
                    </button>
                    <button
                      className="btn btn-outline-danger btn-sm"
                      disabled={busyId === p.productId}
                      onClick={() => setRejecting(p)}
                    >
                      Reject
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <Pagination page={page} totalPages={totalPages} onChange={setPage}
            summary={`Page ${page} of ${totalPages} · ${products.length} pending`} />
        </div>
      )}

      <ConfirmDialog
        isOpen={!!rejecting}
        title="Reject product?"
        message={rejecting ? `Reject "${rejecting.productName}"? It won't be listed on the platform.` : ''}
        confirmText="Reject"
        confirmColor="danger"
        onCancel={() => setRejecting(null)}
        onConfirm={() => { const p = rejecting; setRejecting(null); act(p, 'reject'); }}
      />
    </div>
  );
}

export default AdminProductApprovalsPage;
