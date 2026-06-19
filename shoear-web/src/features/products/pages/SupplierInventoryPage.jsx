import { useEffect, useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { getInventory, updateInventory } from '../productService';
import Toast from '../../../components/Toast';

const LOW_STOCK = 10;   // at or below this (but > 0) counts as "low"
const STATUS_COLORS = { Approved: 'success', Pending: 'warning', Rejected: 'danger', Removed: 'secondary' };

// quick worklist filters by the *saved* stock level
const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'low', label: 'Low stock' },
  { key: 'out', label: 'Out of stock' },
];

function SupplierInventoryPage() {
  const [rows, setRows] = useState([]);          // server truth
  const [draft, setDraft] = useState({});        // variantId -> edited string value
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');

  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');

  function load() {
    setLoading(true);
    getInventory()
      .then((data) => { setRows(data.inventory); setDraft({}); })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, []);

  // the value shown in a row's input (edited draft, else the saved stock)
  const valueOf = (r) => (draft[r.variantId] ?? String(r.stock));
  const isDirty = (r) => draft[r.variantId] !== undefined && draft[r.variantId] !== String(r.stock);
  function rowError(r) {
    const v = draft[r.variantId];
    if (v === undefined) return '';
    if (v.trim() === '') return 'Required';
    const n = Number(v);
    if (!Number.isInteger(n) || n < 0) return 'Whole number ≥ 0';
    return '';
  }
  // status badge reflects what's typed (live), falling back to saved stock
  function effectiveStock(r) {
    const n = Number(draft[r.variantId]);
    return draft[r.variantId] !== undefined && Number.isInteger(n) && n >= 0 ? n : r.stock;
  }

  const dirtyValid = rows.filter((r) => isDirty(r) && !rowError(r));
  const anyInvalid = rows.some((r) => rowError(r) !== '');

  const counts = useMemo(() => ({
    sizes: rows.length,
    low: rows.filter((r) => r.stock > 0 && r.stock <= LOW_STOCK).length,
    out: rows.filter((r) => r.stock === 0).length,
  }), [rows]);

  // search + stock-level filter (filtering uses the SAVED stock so rows don't
  // jump around while you type)
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (q && !(`${r.productName} ${r.brand}`.toLowerCase().includes(q))) return false;
      if (filter === 'low') return r.stock > 0 && r.stock <= LOW_STOCK;
      if (filter === 'out') return r.stock === 0;
      return true;
    });
  }, [rows, search, filter]);

  function setQty(variantId, value) {
    setDraft((d) => ({ ...d, [variantId]: value }));
  }

  async function save() {
    if (dirtyValid.length === 0 || anyInvalid) return;
    setSaving(true);
    setError('');
    try {
      const updates = dirtyValid.map((r) => ({ variantId: r.variantId, stock: Number(draft[r.variantId]) }));
      await updateInventory(updates);
      setToast(`Stock updated for ${updates.length} ${updates.length === 1 ? 'size' : 'sizes'}.`);
      load();   // refetch resets the draft
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  function stockBadge(n) {
    if (n === 0) return <span className="badge text-bg-danger">Out</span>;
    if (n <= LOW_STOCK) return <span className="badge text-bg-warning">Low</span>;
    return <span className="badge text-bg-success">In stock</span>;
  }

  return (
    <div className="container py-4 text-start">
      <div className="d-flex justify-content-between align-items-start flex-wrap gap-2 mb-4">
        <div>
          <h1 className="mb-1">📦 Inventory</h1>
          <p className="text-muted mb-0">Update stock for every size in one place — changes apply instantly, no re-approval.</p>
        </div>
        <Link to="/products" className="btn btn-outline-secondary">← Products</Link>
      </div>

      {error && (
        <div className="alert alert-danger py-2 d-flex justify-content-between align-items-center">
          <span>{error}</span>
          <button type="button" className="btn-close" onClick={() => setError('')}></button>
        </div>
      )}

      {/* stat tiles */}
      {!loading && rows.length > 0 && (
        <div className="row g-3 mb-4">
          <div className="col-4">
            <div className="card card-body py-3">
              <div className="text-muted small text-uppercase">Sizes</div>
              <div className="fs-4 fw-bold">{counts.sizes}</div>
            </div>
          </div>
          <div className="col-4">
            <div className="card card-body py-3">
              <div className="text-muted small text-uppercase">Low stock</div>
              <div className={`fs-4 fw-bold ${counts.low ? 'text-warning' : ''}`}>{counts.low}</div>
            </div>
          </div>
          <div className="col-4">
            <div className="card card-body py-3">
              <div className="text-muted small text-uppercase">Out of stock</div>
              <div className={`fs-4 fw-bold ${counts.out ? 'text-danger' : ''}`}>{counts.out}</div>
            </div>
          </div>
        </div>
      )}

      {/* controls */}
      <div className="card card-body mb-3">
        <div className="row g-2 align-items-end">
          <div className="col-md-6">
            <label className="form-label small text-muted mb-1">Search</label>
            <input type="text" className="form-control" placeholder="Product name or brand"
              value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <div className="col-md-6">
            <label className="form-label small text-muted mb-1 d-block">Show</label>
            <div className="btn-group">
              {FILTERS.map((f) => (
                <button key={f.key} type="button"
                  className={'btn btn-sm ' + (filter === f.key ? 'btn-primary' : 'btn-outline-primary')}
                  onClick={() => setFilter(f.key)}>
                  {f.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {loading ? (
        <p className="text-muted">Loading…</p>
      ) : rows.length === 0 ? (
        <div className="card card-body text-center text-muted">
          No products yet. <Link to="/products/new">Add a product</Link> to manage its stock.
        </div>
      ) : visible.length === 0 ? (
        <div className="card card-body text-center text-muted">No sizes match these filters.</div>
      ) : (
        <div className="table-responsive">
          <table className="table align-middle">
            <thead>
              <tr>
                <th>Product</th>
                <th style={{ width: 90 }}>Size</th>
                <th className="text-end" style={{ width: 90 }}>In stock</th>
                <th style={{ width: 150 }}>New qty</th>
                <th className="text-center" style={{ width: 110 }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((r, i) => {
                // show the product cell only on the first size of each product
                const firstOfProduct = i === 0 || visible[i - 1].productId !== r.productId;
                const err = rowError(r);
                return (
                  <tr key={r.variantId} className={isDirty(r) ? 'table-warning' : undefined}>
                    <td>
                      {firstOfProduct ? (
                        <div className="d-flex align-items-center gap-2">
                          {r.imageUrl
                            ? <img src={r.imageUrl} alt="" style={{ width: 36, height: 36, objectFit: 'cover' }} className="rounded border" />
                            : <span className="fs-5">👟</span>}
                          <div>
                            <Link to={`/products/${r.productId}`} className="fw-semibold text-decoration-none">
                              {r.productName}
                            </Link>
                            <div className="text-muted small">
                              {r.brand}
                              <span className={`badge text-bg-${STATUS_COLORS[r.status] || 'secondary'} ms-2`}>{r.status}</span>
                            </div>
                          </div>
                        </div>
                      ) : (
                        <span className="text-muted small ps-5">↳</span>
                      )}
                    </td>
                    <td className="fw-semibold">{r.size}</td>
                    <td className="text-end">{r.stock}</td>
                    <td>
                      <input type="number" min="0" step="1"
                        className={'form-control form-control-sm' + (err ? ' is-invalid' : '')}
                        value={valueOf(r)} onChange={(e) => setQty(r.variantId, e.target.value)} />
                      {err && <div className="invalid-feedback">{err}</div>}
                    </td>
                    <td className="text-center">{stockBadge(effectiveStock(r))}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* sticky-ish save bar */}
      {rows.length > 0 && (
        <div className="d-flex align-items-center gap-3 mt-3">
          <button className="btn btn-primary" disabled={saving || dirtyValid.length === 0 || anyInvalid} onClick={save}>
            {saving ? 'Saving…' : `Save changes${dirtyValid.length ? ` (${dirtyValid.length})` : ''}`}
          </button>
          {dirtyValid.length > 0 && !saving && (
            <button className="btn btn-outline-secondary" onClick={() => setDraft({})}>Reset</button>
          )}
          {anyInvalid && <span className="text-danger small">Fix the highlighted quantities first.</span>}
        </div>
      )}

      <Toast message={toast} onClose={() => setToast('')} />
    </div>
  );
}

export default SupplierInventoryPage;
