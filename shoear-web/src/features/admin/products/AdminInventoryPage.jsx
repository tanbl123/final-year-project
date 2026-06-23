import { useEffect, useState } from 'react';
import { getAdminInventory } from '../adminService';
import Pagination from '../../../components/Pagination';
import ClearableInput from '../../../components/ClearableInput';
import { usePagination } from '../../../hooks/usePagination';

const PAGE_SIZE = 12;
const LOW_STOCK = 10;
const STATUS_COLORS = { Approved: 'success', Pending: 'warning', Rejected: 'danger' };

function AdminInventoryPage() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filters, setFilters] = useState({ status: '', search: '' });
  const [debouncedSearch, setDebouncedSearch] = useState('');

  const { page, setPage, totalPages, pageItems } = usePagination(rows, PAGE_SIZE);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(filters.search), 300);
    return () => clearTimeout(t);
  }, [filters.search]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    getAdminInventory({ status: filters.status, search: debouncedSearch })
      .then((data) => setRows(data.inventory))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
    setPage(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.status, debouncedSearch]);

  function stockBadge(n) {
    if (n === 0) return <span className="badge text-bg-danger">Out</span>;
    if (n <= LOW_STOCK) return <span className="badge text-bg-warning">Low</span>;
    return <span className="badge text-bg-success">In stock</span>;
  }

  return (
    <div className="container py-4 text-start">
      <h1 className="mb-1">📦 Product Inventory</h1>
      <p className="text-muted">Stock levels across all suppliers (read-only).</p>

      {error && (
        <div className="alert alert-danger py-2 d-flex justify-content-between align-items-center">
          <span>{error}</span>
          <button type="button" className="btn-close" onClick={() => setError('')}></button>
        </div>
      )}

      <div className="card card-body mb-4">
        <div className="row g-2 align-items-end">
          <div className="col-md-7">
            <label className="form-label small text-muted mb-1">Search</label>
            <ClearableInput type="text" placeholder="Product or supplier"
              value={filters.search}
              onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value }))}
              onClear={() => setFilters((f) => ({ ...f, search: '' }))} />
          </div>
          <div className="col-md-5">
            <label className="form-label small text-muted mb-1">Status</label>
            <select className="form-select" value={filters.status}
              onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))}>
              <option value="">All statuses</option>
              {['Approved', 'Pending', 'Rejected'].map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
        </div>
      </div>

      {loading ? (
        <p className="text-muted">Loading…</p>
      ) : rows.length === 0 ? (
        <div className="card card-body text-center text-muted">No products match these filters.</div>
      ) : (
        <div className="table-responsive">
          <table className="table align-middle">
            <thead>
              <tr>
                <th>Product</th>
                <th>Supplier</th>
                <th className="text-center" style={{ width: 90 }}>Sizes</th>
                <th className="text-end" style={{ width: 110 }}>Total stock</th>
                <th className="text-center" style={{ width: 110 }}>Stock</th>
                <th className="text-center" style={{ width: 110 }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {pageItems.map((r) => (
                <tr key={r.productId}>
                  <td>
                    <div className="fw-semibold">{r.productName}</div>
                    <div className="text-muted small">{r.brand}</div>
                  </td>
                  <td>{r.supplierName}</td>
                  <td className="text-center">{r.sizeCount}</td>
                  <td className="text-end fw-semibold">{r.totalStock}</td>
                  <td className="text-center">{stockBadge(r.totalStock)}</td>
                  <td className="text-center">
                    <span className={`badge text-bg-${STATUS_COLORS[r.status] || 'secondary'}`}>{r.status}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <Pagination page={page} totalPages={totalPages} onChange={setPage}
            summary={`Page ${page} of ${totalPages} · ${rows.length} products`} />
        </div>
      )}
    </div>
  );
}

export default AdminInventoryPage;
