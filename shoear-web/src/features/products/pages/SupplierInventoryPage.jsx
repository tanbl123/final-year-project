import { useEffect, useState, useMemo } from 'react';
import { Link, useBlocker } from 'react-router-dom';
import { getInventory, updateInventory } from '../productService';
import { useUnsavedChangesWarning } from '../../../hooks/useUnsavedChangesWarning';
import ConfirmDialog from '../../../components/ConfirmDialog';
import Toast from '../../../components/Toast';
import Pagination from '../../../components/Pagination';
import { usePagination } from '../../../hooks/usePagination';

const ROWS_PER_PAGE = 15;

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
  const [savingIds, setSavingIds] = useState([]); // variantIds being written
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');

  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');

  const saving = savingIds.length > 0;

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
  const hasUnsaved = rows.some((r) => isDirty(r));

  // warn on refresh / tab-close / URL change while there are unsaved edits
  useUnsavedChangesWarning(hasUnsaved);

  // block in-app navigation (clicking a nav link) while there are unsaved edits,
  // and show our own confirm dialog instead of the browser's plain one
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) => hasUnsaved && currentLocation.pathname !== nextLocation.pathname
  );

  const counts = useMemo(() => ({
    sizes: rows.length,
    low: rows.filter((r) => r.stock > 0 && r.stock <= LOW_STOCK).length,
    out: rows.filter((r) => r.stock === 0).length,
  }), [rows]);

  // search + stock-level filter (uses SAVED stock so rows don't jump while typing)
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (q && !(`${r.productName} ${r.brand}`.toLowerCase().includes(q))) return false;
      if (filter === 'low') return r.stock > 0 && r.stock <= LOW_STOCK;
      if (filter === 'out') return r.stock === 0;
      return true;
    });
  }, [rows, search, filter]);

  const { page, setPage, totalPages, pageItems } = usePagination(visible, ROWS_PER_PAGE);
  // back to page 1 when the search/filter changes
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPage(1);
  }, [search, filter, setPage]);

  function setQty(variantId, value) {
    setDraft((d) => ({ ...d, [variantId]: value }));
  }
  // +/- stepper, clamped at 0
  function bump(r, delta) {
    const cur = Number(valueOf(r));
    const base = Number.isFinite(cur) ? cur : r.stock;
    setQty(r.variantId, String(Math.max(0, base + delta)));
  }
  function revert(r) {
    setDraft((d) => { const n = { ...d }; delete n[r.variantId]; return n; });
  }

  // Save just the given rows; apply the result locally so OTHER in-progress
  // edits are preserved (no full refetch that would wipe them).
  async function saveRows(targets) {
    const updates = targets
      .filter((r) => isDirty(r) && !rowError(r))
      .map((r) => ({ variantId: r.variantId, stock: Number(draft[r.variantId]) }));
    if (updates.length === 0) return;

    setSavingIds(updates.map((u) => u.variantId));
    setError('');
    try {
      await updateInventory(updates);
      const saved = Object.fromEntries(updates.map((u) => [u.variantId, u.stock]));
      setRows((prev) => prev.map((r) => (saved[r.variantId] !== undefined ? { ...r, stock: saved[r.variantId] } : r)));
      setDraft((d) => { const n = { ...d }; updates.forEach((u) => delete n[u.variantId]); return n; });
      setToast(`Stock updated for ${updates.length} ${updates.length === 1 ? 'size' : 'sizes'}.`);
    } catch (err) {
      setError(err.message);
    } finally {
      setSavingIds([]);
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
          <p className="text-muted mb-0">Adjust stock for every size — changes apply instantly, no re-approval.</p>
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
        <div className="card">
          <div className="table-responsive">
            <table className="table table-hover align-middle mb-0">
              <thead className="table-light">
                <tr>
                  <th>Product</th>
                  <th style={{ width: 80 }}>Size</th>
                  <th className="text-end text-nowrap" style={{ width: 90 }}>In stock</th>
                  <th className="text-center" style={{ width: 170 }}>New quantity</th>
                  <th className="text-center" style={{ width: 100 }}>Status</th>
                  <th className="text-center" style={{ width: 150 }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {pageItems.map((r, i) => {
                  const firstOfProduct = i === 0 || pageItems[i - 1].productId !== r.productId;
                  const err = rowError(r);
                  const dirty = isDirty(r);
                  const rowSaving = savingIds.includes(r.variantId);
                  return (
                    <tr key={r.variantId} className={dirty ? 'table-warning' : undefined}>
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
                          <span className="text-muted small ps-5">↳ same product</span>
                        )}
                      </td>
                      <td className="fw-semibold">{r.size}</td>
                      <td className="text-end">{r.stock}</td>
                      <td>
                        <div className="input-group input-group-sm mx-auto" style={{ width: 150 }}>
                          <button type="button" className="btn btn-outline-secondary" disabled={saving}
                            onClick={() => bump(r, -1)} title="Decrease">−</button>
                          <input type="number" min="0" step="1"
                            className={'form-control text-center' + (err ? ' is-invalid' : '')}
                            value={valueOf(r)} disabled={saving}
                            onChange={(e) => setQty(r.variantId, e.target.value)} />
                          <button type="button" className="btn btn-outline-secondary" disabled={saving}
                            onClick={() => bump(r, 1)} title="Increase">+</button>
                        </div>
                        {err && <div className="text-danger small text-center mt-1">{err}</div>}
                      </td>
                      <td className="text-center">{stockBadge(effectiveStock(r))}</td>
                      <td className="text-center">
                        <div className="d-inline-flex gap-1">
                          <button className="btn btn-success btn-sm" disabled={!dirty || saving || !!err}
                            onClick={() => saveRows([r])}>
                            {rowSaving ? 'Saving…' : 'Save'}
                          </button>
                          <button className="btn btn-outline-secondary btn-sm" disabled={!dirty || saving}
                            onClick={() => revert(r)} title="Undo change">↶</button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="card-body pt-0">
            <Pagination page={page} totalPages={totalPages} onChange={setPage}
              summary={`Page ${page} of ${totalPages} · ${visible.length} sizes`} />
          </div>
        </div>
      )}

      {/* sticky save bar — only appears when there are unsaved changes */}
      {dirtyValid.length > 0 && (
        <div className="position-sticky bottom-0 mt-3">
          <div className="card card-body shadow border-primary-subtle d-flex flex-row align-items-center justify-content-between flex-wrap gap-2">
            <span className="fw-semibold">
              {dirtyValid.length} unsaved {dirtyValid.length === 1 ? 'change' : 'changes'}
              {anyInvalid && <span className="text-danger ms-2 fw-normal">— fix the highlighted quantities</span>}
            </span>
            <div className="d-flex gap-2">
              <button className="btn btn-outline-secondary" disabled={saving} onClick={() => setDraft({})}>
                Discard all
              </button>
              <button className="btn btn-primary" disabled={saving || anyInvalid} onClick={() => saveRows(dirtyValid)}>
                {saving ? 'Saving…' : `Save all (${dirtyValid.length})`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* in-app navigation guard (only when there are unsaved edits) */}
      <ConfirmDialog
        isOpen={blocker.state === 'blocked'}
        title="Leave without saving?"
        message="You have unsaved stock changes. If you leave this page now, they’ll be lost."
        confirmText="Leave"
        confirmColor="danger"
        onConfirm={() => blocker.proceed?.()}
        onCancel={() => blocker.reset?.()}
      />

      <Toast message={toast} onClose={() => setToast('')} />
    </div>
  );
}

export default SupplierInventoryPage;
