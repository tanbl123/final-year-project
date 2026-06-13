import { useEffect, useMemo, useState } from 'react';
import {
  getCategoriesAdmin, createCategory, renameCategory, deleteCategory,
} from '../adminService';
import ConfirmDialog from '../../../components/ConfirmDialog';
import Toast from '../../../components/Toast';

const PAGE_SIZE = 5;

function AdminCategoriesPage() {
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');

  const [newName, setNewName] = useState('');     // add form
  const [adding, setAdding] = useState(false);

  const [editingId, setEditingId] = useState(''); // inline rename
  const [editName, setEditName] = useState('');
  const [savingId, setSavingId] = useState('');

  const [deleting, setDeleting] = useState(null); // category pending delete confirm

  const [sortKey, setSortKey] = useState('name'); // 'name' | 'productCount'
  const [sortDir, setSortDir] = useState('asc');  // 'asc' | 'desc'
  const [page, setPage] = useState(1);

  useEffect(() => {
    let active = true;
    getCategoriesAdmin()
      .then((data) => { if (active) setCategories(data); })
      .catch((err) => { if (active) setError(err.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  // click a column header to sort by it; click again to flip the direction
  function toggleSort(key) {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  }
  const sortArrow = (key) => (sortKey === key ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ' ⇅');

  const sorted = useMemo(() => {
    const list = [...categories];
    list.sort((a, b) => {
      let cmp;
      if (sortKey === 'productCount') cmp = a.productCount - b.productCount;
      else cmp = a.name.localeCompare(b.name);
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return list;
  }, [categories, sortKey, sortDir]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  // keep the page in range when the list shrinks (e.g. after a delete)
  useEffect(() => { if (page > totalPages) setPage(totalPages); }, [page, totalPages]);
  const pageItems = sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  async function handleAdd(event) {
    event.preventDefault();
    const name = newName.trim();
    if (name === '') return;
    setError('');
    setAdding(true);
    try {
      const created = await createCategory(name);
      setCategories((prev) => [...prev, created]);
      setNewName('');
      setToast(`Category “${created.name}” added.`);
    } catch (err) {
      setError(err.message);
    } finally {
      setAdding(false);
    }
  }

  function startEdit(cat) {
    setEditingId(cat.id);
    setEditName(cat.name);
    setError('');
  }
  function cancelEdit() {
    setEditingId('');
    setEditName('');
  }
  async function saveEdit(cat) {
    const name = editName.trim();
    if (name === '' || name === cat.name) { cancelEdit(); return; }
    setError('');
    setSavingId(cat.id);
    try {
      const updated = await renameCategory(cat.id, name);
      setCategories((prev) =>
        prev.map((c) => (c.id === cat.id ? { ...c, name: updated.name } : c)));
      setToast(`Renamed to “${updated.name}”.`);
      cancelEdit();
    } catch (err) {
      setError(err.message);
    } finally {
      setSavingId('');
    }
  }

  async function confirmDelete(cat) {
    setError('');
    try {
      await deleteCategory(cat.id);
      setCategories((prev) => prev.filter((c) => c.id !== cat.id));
      setToast(`Category “${cat.name}” deleted.`);
    } catch (err) {
      setError(err.message);   // e.g. "Cannot delete: 3 product(s) still use this category."
    }
  }

  return (
    <div className="container py-4 text-start">
      <h1 className="mb-1">🗂️ Manage Categories</h1>
      <p className="text-muted">Create, rename or remove the shoe categories suppliers can pick from.</p>

      {error && (
        <div className="alert alert-danger py-2 d-flex justify-content-between align-items-center">
          <span>{error}</span>
          <button type="button" className="btn-close" onClick={() => setError('')}></button>
        </div>
      )}

      {/* add form */}
      <form onSubmit={handleAdd} className="card card-body mb-4">
        <label className="form-label fw-semibold">Add a category</label>
        <div className="d-flex gap-2">
          <input type="text" className="form-control" maxLength="80" placeholder="e.g. Tennis"
            value={newName} onChange={(e) => setNewName(e.target.value)} />
          <button type="submit" className="btn btn-primary text-nowrap"
            disabled={adding || newName.trim() === ''}>
            {adding ? 'Adding…' : '+ Add'}
          </button>
        </div>
      </form>

      {loading ? (
        <p className="text-muted">Loading…</p>
      ) : categories.length === 0 ? (
        <div className="card card-body text-center text-muted">No categories yet. Add one above.</div>
      ) : (
        <div className="table-responsive">
          <table className="table align-middle">
            <thead>
              <tr>
                <th role="button" onClick={() => toggleSort('name')} style={{ cursor: 'pointer', userSelect: 'none' }}>
                  Category<span className="text-muted small">{sortArrow('name')}</span>
                </th>
                <th role="button" className="text-center" onClick={() => toggleSort('productCount')}
                  style={{ cursor: 'pointer', userSelect: 'none' }}>
                  Products<span className="text-muted small">{sortArrow('productCount')}</span>
                </th>
                <th className="text-center">Actions</th>
              </tr>
            </thead>
            <tbody>
              {pageItems.map((cat) => (
                <tr key={cat.id}>
                  <td style={{ maxWidth: 360 }}>
                    {editingId === cat.id ? (
                      <input type="text" className="form-control" maxLength="80" autoFocus
                        value={editName} onChange={(e) => setEditName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') saveEdit(cat);
                          if (e.key === 'Escape') cancelEdit();
                        }} />
                    ) : (
                      <span className="fw-semibold">{cat.name}</span>
                    )}
                  </td>
                  <td className="text-center">
                    <span className="badge text-bg-light">{cat.productCount}</span>
                  </td>
                  <td className="text-center text-nowrap">
                    {editingId === cat.id ? (
                      <>
                        <button className="btn btn-success btn-sm me-2"
                          disabled={savingId === cat.id} onClick={() => saveEdit(cat)}>
                          {savingId === cat.id ? '…' : 'Save'}
                        </button>
                        <button className="btn btn-outline-secondary btn-sm" onClick={cancelEdit}>
                          Cancel
                        </button>
                      </>
                    ) : (
                      <>
                        <button className="btn btn-outline-primary btn-sm me-2" onClick={() => startEdit(cat)}>
                          Rename
                        </button>
                        <button className="btn btn-outline-danger btn-sm"
                          disabled={cat.productCount > 0}
                          title={cat.productCount > 0 ? 'In use by products — cannot delete' : 'Delete'}
                          onClick={() => setDeleting(cat)}>
                          Delete
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {totalPages > 1 && (
            <nav className="d-flex justify-content-between align-items-center">
              <span className="text-muted small">
                Page {page} of {totalPages} · {sorted.length} categories
              </span>
              <ul className="pagination mb-0">
                <li className={'page-item' + (page === 1 ? ' disabled' : '')}>
                  <button className="page-link" onClick={() => setPage((p) => Math.max(1, p - 1))}>
                    Prev
                  </button>
                </li>
                {Array.from({ length: totalPages }, (_, i) => i + 1).map((n) => (
                  <li key={n} className={'page-item' + (n === page ? ' active' : '')}>
                    <button className="page-link" onClick={() => setPage(n)}>{n}</button>
                  </li>
                ))}
                <li className={'page-item' + (page === totalPages ? ' disabled' : '')}>
                  <button className="page-link" onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>
                    Next
                  </button>
                </li>
              </ul>
            </nav>
          )}
        </div>
      )}

      <ConfirmDialog
        isOpen={!!deleting}
        title="Delete category?"
        message={deleting ? `Delete “${deleting.name}”? This can't be undone.` : ''}
        confirmText="Delete"
        confirmColor="danger"
        onCancel={() => setDeleting(null)}
        onConfirm={() => { const c = deleting; setDeleting(null); confirmDelete(c); }}
      />

      <Toast message={toast} onClose={() => setToast('')} />
    </div>
  );
}

export default AdminCategoriesPage;
