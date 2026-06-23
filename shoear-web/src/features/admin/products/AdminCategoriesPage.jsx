import { useEffect, useState } from 'react';
import {
  getCategoriesAdmin, createCategory, renameCategory, deleteCategory,
} from '../adminService';
import ConfirmDialog from '../../../components/ConfirmDialog';
import Toast from '../../../components/Toast';
import Pagination from '../../../components/Pagination';
import SortableTh from '../../../components/SortableTh';
import { usePagination } from '../../../hooks/usePagination';
import { useTableSort } from '../../../hooks/useTableSort';

const PAGE_SIZE = 5;

function AdminCategoriesPage() {
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');

  const [newName, setNewName] = useState('');     // add form
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState('');   // inline error under the add input

  const [editingId, setEditingId] = useState(''); // inline rename
  const [editName, setEditName] = useState('');
  const [savingId, setSavingId] = useState('');
  const [editError, setEditError] = useState(''); // inline error under the rename input

  const [deleting, setDeleting] = useState(null); // category pending delete confirm

  useEffect(() => {
    let active = true;
    getCategoriesAdmin()
      .then((data) => { if (active) setCategories(data); })
      .catch((err) => { if (active) setError(err.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  const sort = useTableSort(categories, { initialKey: 'name', initialDir: 'asc' });
  const { page, setPage, totalPages, pageItems } = usePagination(sort.sorted, PAGE_SIZE);

  async function handleAdd(event) {
    event.preventDefault();
    const name = newName.trim();
    if (name === '') return;
    setAddError('');
    setAdding(true);
    try {
      const created = await createCategory(name);
      setCategories((prev) => [...prev, created]);
      setNewName('');
      setToast(`Category “${created.name}” added.`);
    } catch (err) {
      setAddError(err.message);
    } finally {
      setAdding(false);
    }
  }

  function startEdit(cat) {
    setEditingId(cat.id);
    setEditName(cat.name);
    setEditError('');
  }
  function cancelEdit() {
    setEditingId('');
    setEditName('');
    setEditError('');
  }
  async function saveEdit(cat) {
    const name = editName.trim();
    if (name === '' || name === cat.name) { cancelEdit(); return; }
    setEditError('');
    setSavingId(cat.id);
    try {
      const updated = await renameCategory(cat.id, name);
      setCategories((prev) =>
        prev.map((c) => (c.id === cat.id ? { ...c, name: updated.name } : c)));
      setToast(`Renamed to “${updated.name}”.`);
      cancelEdit();
    } catch (err) {
      setEditError(err.message);
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
        <div className="d-flex gap-2 align-items-start">
          <div className="flex-grow-1">
            <input type="text" className={`form-control ${addError ? 'is-invalid' : ''}`} maxLength="80" placeholder="e.g. Tennis"
              value={newName} onChange={(e) => { setNewName(e.target.value); if (addError) setAddError(''); }} />
            {addError && <div className="invalid-feedback d-block">{addError}</div>}
          </div>
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
          <table className="table align-middle" style={{ tableLayout: 'fixed' }}>
            <thead>
              <tr>
                <SortableTh label="Category" columnKey="name" sort={sort} />
                <SortableTh label="Products" columnKey="productCount" sort={sort} className="text-center" style={{ width: 160 }} />
                <th className="text-center" style={{ width: 240 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {pageItems.map((cat) => (
                <tr key={cat.id}>
                  <td style={{ overflowWrap: 'anywhere' }}>
                    {editingId === cat.id ? (
                      <>
                        <input type="text" className={`form-control ${editError ? 'is-invalid' : ''}`} maxLength="80" autoFocus
                          value={editName} onChange={(e) => { setEditName(e.target.value); if (editError) setEditError(''); }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') saveEdit(cat);
                            if (e.key === 'Escape') cancelEdit();
                          }} />
                        {editError && <div className="invalid-feedback d-block">{editError}</div>}
                      </>
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
                          disabled={savingId === cat.id ||
                            editName.trim() === '' || editName.trim() === cat.name}
                          onClick={() => saveEdit(cat)}>
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

          <Pagination page={page} totalPages={totalPages} onChange={setPage}
            summary={`Page ${page} of ${totalPages} · ${sort.sorted.length} categories`} />
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
