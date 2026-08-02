import { useEffect, useState } from 'react';
import { getUsers, getUser, setUserStatus, createStaff } from '../adminService';
import ConfirmDialog from '../../../components/ConfirmDialog';
import Toast from '../../../components/Toast';
import Pagination from '../../../components/Pagination';
import ClearableInput from '../../../components/ClearableInput';
import SortableTh from '../../../components/SortableTh';
import { usePagination } from '../../../hooks/usePagination';
import { useTableSort } from '../../../hooks/useTableSort';

const PAGE_SIZE = 10;
const ROLES = ['Admin', 'ArSpecialist', 'Supplier', 'Customer', 'DeliveryPersonnel'];
const STATUSES = ['Pending', 'Active', 'Suspended', 'Rejected', 'Deleted'];

const STATUS_COLORS = {
  Active: 'success', Pending: 'warning', Suspended: 'secondary',
  Rejected: 'danger', Deleted: 'dark',
};
const roleLabel = (r) => (r === 'DeliveryPersonnel' ? 'Delivery' : r === 'ArSpecialist' ? 'AR Specialist' : r);

const EMPTY_STAFF = { fullName: '', email: '' };  // username auto-generated; password set by the staff member via link
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const NAME_MAX = 120;                       // user.fullName VARCHAR(120)

// Inline per-field validation for the Add-AR-Specialist form: a name (non-empty,
// max length) and a well-formed email. Returns an error string, or '' when valid.
function staffFieldError(name, value) {
  const v = (value || '').trim();
  if (name === 'fullName') {
    if (v === '') return 'Full name is required.';
    if (v.length > NAME_MAX) return `Full name must be ${NAME_MAX} characters or fewer.`;
    return '';
  }
  if (name === 'email') {
    if (v === '') return 'Email is required.';
    return EMAIL_RE.test(v) ? '' : 'Please enter a valid email address.';
  }
  return '';
}
function validateStaff(form) {
  const errs = {};
  ['fullName', 'email'].forEach((k) => {
    const msg = staffFieldError(k, form[k]);
    if (msg) errs[k] = msg;
  });
  return errs;
}

function AdminUsersPage() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');

  const [filters, setFilters] = useState({ role: '', status: '', search: '' });
  const [debouncedSearch, setDebouncedSearch] = useState('');

  const [busyId, setBusyId] = useState('');         // user being actioned
  const [confirm, setConfirm] = useState(null);     // { user, status, title, message, color }
  const [detail, setDetail] = useState(null);       // fetched user for the modal
  const [detailLoading, setDetailLoading] = useState(false);

  const [createForm, setCreateForm] = useState(null); // AR-specialist create form (null = closed)
  const [creating, setCreating] = useState(false);
  const [createErr, setCreateErr] = useState('');
  const [staffErrors, setStaffErrors] = useState({}); // per-field inline errors

  // open/close the create form, clearing any previous input + errors
  function openCreate() { setCreateErr(''); setStaffErrors({}); setCreateForm({ ...EMPTY_STAFF }); }
  function closeCreate() { setCreateForm(null); setStaffErrors({}); setCreateErr(''); }

  // update a field; re-check it live once it's already showing an error
  function setStaffField(name, value) {
    setCreateForm((f) => ({ ...f, [name]: value }));
    setStaffErrors((prev) => {
      if (!(name in prev)) return prev;
      const next = { ...prev };
      const msg = staffFieldError(name, value);
      if (msg) next[name] = msg; else delete next[name];
      return next;
    });
  }
  // validate a field when the admin leaves it
  function blurStaffField(name) {
    setStaffErrors((prev) => {
      const next = { ...prev };
      const msg = staffFieldError(name, createForm?.[name]);
      if (msg) next[name] = msg; else delete next[name];
      return next;
    });
  }

  const sort = useTableSort(users, {
    initialKey: 'created_at',
    initialDir: 'desc',
    getValue: (u, k) => (k === 'created_at' ? new Date(u.created_at).getTime() : u[k]),
  });
  const { page, setPage, totalPages, pageItems } = usePagination(sort.sorted, PAGE_SIZE);

  // debounce the free-text search so we don't hit the API on every keystroke
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(filters.search), 300);
    return () => clearTimeout(t);
  }, [filters.search]);

  function load() {
    setLoading(true);
    getUsers({ role: filters.role, status: filters.status, search: debouncedSearch })
      .then((data) => setUsers(data.users))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }
  // refetch whenever a filter changes (the search is already debounced above)
  useEffect(() => {
    // intentional fetch-on-change; load() owns its own loading state
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.role, filters.status, debouncedSearch]);

  // update a filter and jump back to the first page of results
  function setFilter(patch) {
    setFilters((f) => ({ ...f, ...patch }));
    setPage(1);
  }

  async function changeStatus(user, status) {
    setBusyId(user.userId);
    setError('');
    try {
      await setUserStatus(user.userId, status);
      setToast(`${user.fullName} → ${status}.`);
      load();   // refresh so the row reflects (or leaves) the active filter
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId('');
    }
  }

  // reversible actions act immediately; destructive ones confirm first
  function askConfirm(user, status, verb) {
    setConfirm({
      user, status,
      title: `${verb} user?`,
      message: `${verb} “${user.fullName}” (${user.email})?`,
      color: status === 'Deleted' ? 'danger' : 'warning',
    });
  }

  async function submitCreate(e) {
    e.preventDefault();
    const v = validateStaff(createForm);
    if (Object.keys(v).length) { setStaffErrors(v); return; }
    setStaffErrors({});
    setCreating(true);
    setCreateErr('');
    try {
      const created = await createStaff(createForm);
      setCreateForm(null);
      setToast(created.inviteEmailSent === false
        ? `AR Specialist “${created.fullName}” created, but the invite email failed to send — the set-password link couldn't be delivered. Check email settings and try again.`
        : `AR Specialist “${created.fullName}” created — a set-password link was emailed to ${created.email}.`);
      load();
    } catch (err) {
      setCreateErr(err.message || 'Could not create the account.');
    } finally {
      setCreating(false);
    }
  }

  async function openDetail(userId) {
    setDetailLoading(true);
    setDetail({});                       // open the modal in a loading state
    try {
      const data = await getUser(userId);
      setDetail(data);
    } catch (err) {
      setError(err.message);
      setDetail(null);
    } finally {
      setDetailLoading(false);
    }
  }

  // contextual actions per current status
  function renderActions(u) {
    if (u.role === 'Admin') return <span className="text-muted">—</span>;
    const busy = busyId === u.userId;
    const btns = [];
    if (u.status === 'Pending') {
      btns.push(<button key="ap" className="btn btn-success btn-sm" disabled={busy}
        onClick={() => changeStatus(u, 'Active')}>Approve</button>);
      btns.push(<button key="rj" className="btn btn-outline-danger btn-sm" disabled={busy}
        onClick={() => askConfirm(u, 'Rejected', 'Reject')}>Reject</button>);
    } else if (u.status === 'Active') {
      btns.push(<button key="sp" className="btn btn-outline-secondary btn-sm" disabled={busy}
        onClick={() => askConfirm(u, 'Suspended', 'Suspend')}>Suspend</button>);
    } else if (u.status === 'Suspended' || u.status === 'Rejected') {
      btns.push(<button key="re" className="btn btn-success btn-sm" disabled={busy}
        onClick={() => changeStatus(u, 'Active')}>Reactivate</button>);
    }
    if (u.status !== 'Deleted') {
      btns.push(<button key="del" className="btn btn-outline-danger btn-sm" disabled={busy}
        onClick={() => askConfirm(u, 'Deleted', 'Delete')}>Delete</button>);
    }
    return <div className="d-flex gap-2 justify-content-center flex-wrap">{btns}</div>;
  }

  return (
    <div className="container py-4 text-start">
      <div className="d-flex justify-content-between align-items-start flex-wrap gap-2">
        <div>
          <h1 className="mb-1">👥 User Management</h1>
          <p className="text-muted">View and manage every account on the platform.</p>
        </div>
        {/* Staff have no public sign-up, so an admin provisions them here.
            Currently the only provisionable staff role is AR Specialist. */}
        <button className="btn btn-primary" onClick={openCreate}>
          + Add AR Specialist
        </button>
      </div>

      {error && (
        <div className="alert alert-danger py-2 d-flex justify-content-between align-items-center">
          <span>{error}</span>
          <button type="button" className="btn-close" onClick={() => setError('')}></button>
        </div>
      )}

      {/* filters */}
      <div className="card card-body mb-4">
        <div className="row g-2 align-items-end">
          <div className="col-md-5">
            <label className="form-label small text-muted mb-1">Search</label>
            <ClearableInput type="text" placeholder="Name, username or email"
              value={filters.search} onChange={(e) => setFilter({ search: e.target.value })}
              onClear={() => setFilter({ search: '' })} />
          </div>
          <div className="col-md-4">
            <label className="form-label small text-muted mb-1">Role</label>
            <select className="form-select" value={filters.role}
              onChange={(e) => setFilter({ role: e.target.value })}>
              <option value="">All roles</option>
              {ROLES.map((r) => <option key={r} value={r}>{roleLabel(r)}</option>)}
            </select>
          </div>
          <div className="col-md-3">
            <label className="form-label small text-muted mb-1">Status</label>
            <select className="form-select" value={filters.status}
              onChange={(e) => setFilter({ status: e.target.value })}>
              <option value="">All statuses</option>
              {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
        </div>
      </div>

      {loading ? (
        <p className="text-muted">Loading…</p>
      ) : users.length === 0 ? (
        <div className="card card-body text-center text-muted">No users match these filters.</div>
      ) : (
        <div className="table-responsive">
          <table className="table align-middle" style={{ tableLayout: 'fixed' }}>
            <thead>
              <tr>
                <SortableTh label="User" columnKey="fullName" sort={sort} />
                <SortableTh label="Role" columnKey="role" sort={sort} style={{ width: 130 }} />
                <SortableTh label="Status" columnKey="status" sort={sort} className="text-center" style={{ width: 110 }} />
                <SortableTh label="Joined" columnKey="created_at" sort={sort} style={{ width: 110 }} />
                <th className="text-center" style={{ width: 260 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {pageItems.map((u) => (
                <tr key={u.userId}>
                  <td style={{ overflowWrap: 'anywhere' }}>
                    <div className="fw-semibold">{u.fullName}</div>
                    <div className="text-muted small">@{u.username} · {u.email}</div>
                  </td>
                  <td><span className="badge text-bg-light">{roleLabel(u.role)}</span></td>
                  <td className="text-center">
                    <span className={`badge text-bg-${STATUS_COLORS[u.status] || 'secondary'}`}>{u.status}</span>
                  </td>
                  <td className="text-muted small">{new Date(u.created_at).toLocaleDateString()}</td>
                  <td className="text-center">
                    <div className="d-flex gap-2 justify-content-center flex-wrap">
                      <button className="btn btn-outline-primary btn-sm" onClick={() => openDetail(u.userId)}>
                        View
                      </button>
                      {renderActions(u)}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <Pagination page={page} totalPages={totalPages} onChange={setPage}
            summary={`Page ${page} of ${totalPages} · ${sort.sorted.length} users`} />
        </div>
      )}

      {/* detail modal */}
      {detail && (
        <div className="modal show d-block" tabIndex="-1" style={{ background: 'rgba(0,0,0,.5)' }}
          onClick={() => setDetail(null)}>
          <div className="modal-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title">User detail</h5>
                <button type="button" className="btn-close" onClick={() => setDetail(null)}></button>
              </div>
              <div className="modal-body">
                {detailLoading || !detail.userId ? (
                  <p className="text-muted mb-0">Loading…</p>
                ) : (
                  <dl className="row mb-0">
                    <dt className="col-4">Name</dt><dd className="col-8">{detail.fullName}</dd>
                    <dt className="col-4">Username</dt><dd className="col-8">@{detail.username}</dd>
                    <dt className="col-4">Email</dt><dd className="col-8" style={{ overflowWrap: 'anywhere' }}>{detail.email}</dd>
                    <dt className="col-4">Phone</dt><dd className="col-8">{detail.phoneNumber}</dd>
                    <dt className="col-4">Role</dt><dd className="col-8">{roleLabel(detail.role)}</dd>
                    <dt className="col-4">Status</dt>
                    <dd className="col-8">
                      <span className={`badge text-bg-${STATUS_COLORS[detail.status] || 'secondary'}`}>{detail.status}</span>
                    </dd>
                    {detail.role === 'Supplier' && detail.profile && (
                      <>
                        <dt className="col-4">Company (legal)</dt><dd className="col-8">{detail.profile.companyName}</dd>
                        {detail.profile.displayName && detail.profile.displayName !== detail.profile.companyName && (
                          <><dt className="col-4">Store name</dt><dd className="col-8">{detail.profile.displayName}</dd></>
                        )}
                        <dt className="col-4">Business address</dt><dd className="col-8">{detail.profile.companyAddress}</dd>
                        <dt className="col-4">Pickup address</dt><dd className="col-8">{detail.profile.operationalAddress || detail.profile.companyAddress}</dd>
                      </>
                    )}
                    {detail.role === 'Customer' && detail.profile && (
                      <>
                        <dt className="col-4">Shipping</dt>
                        <dd className="col-8">{detail.profile.shippingAddress || <span className="text-muted">—</span>}</dd>
                      </>
                    )}
                    {detail.role === 'DeliveryPersonnel' && detail.profile && (
                      <>
                        <dt className="col-4">Vehicle</dt>
                        <dd className="col-8">
                          {detail.profile.vehicleType && detail.profile.vehicleBrand
                            ? `${detail.profile.vehicleType} • ${detail.profile.vehicleBrand} ${detail.profile.vehicleModel} — ${detail.profile.vehiclePlate}`
                            : <span className="text-muted">—</span>}
                        </dd>
                      </>
                    )}
                    {detail.role === 'ArSpecialist' && detail.profile && (
                      <>
                        <dt className="col-4">Staff ID</dt>
                        <dd className="col-8">{detail.profile.arSpecialistId}</dd>
                      </>
                    )}
                    <dt className="col-4">Joined</dt>
                    <dd className="col-8">{new Date(detail.created_at).toLocaleString()}</dd>
                  </dl>
                )}
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setDetail(null)}>Close</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* create AR Specialist */}
      {createForm && (
        <div className="modal show d-block" tabIndex="-1" style={{ background: 'rgba(0,0,0,.5)' }}
          onClick={() => !creating && closeCreate()}>
          <div className="modal-dialog" onClick={(e) => e.stopPropagation()}>
            <form className="modal-content" onSubmit={submitCreate} noValidate>
              <div className="modal-header">
                <h5 className="modal-title">Add AR Specialist</h5>
                <button type="button" className="btn-close" onClick={closeCreate} disabled={creating}></button>
              </div>
              <div className="modal-body">
                <p className="text-muted small">
                  Creates an active internal-staff account. The system generates their username, and
                  a secure one-time link to set their own password is emailed to the address below.
                  They then sign in with their email.
                </p>
                {createErr && <div className="alert alert-danger py-2">{createErr}</div>}
                <div className="mb-2">
                  <label className="form-label small mb-1">Full name</label>
                  <input className={`form-control ${staffErrors.fullName ? 'is-invalid' : ''}`}
                    value={createForm.fullName}
                    onChange={(e) => setStaffField('fullName', e.target.value)}
                    onBlur={() => blurStaffField('fullName')} />
                  {staffErrors.fullName && <div className="invalid-feedback d-block">{staffErrors.fullName}</div>}
                </div>
                <div className="mb-1">
                  <label className="form-label small mb-1">Email</label>
                  <input type="email" className={`form-control ${staffErrors.email ? 'is-invalid' : ''}`}
                    value={createForm.email}
                    onChange={(e) => setStaffField('email', e.target.value)}
                    onBlur={() => blurStaffField('email')} />
                  {staffErrors.email && <div className="invalid-feedback d-block">{staffErrors.email}</div>}
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-light" onClick={closeCreate} disabled={creating}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={creating}>
                  {creating ? 'Creating…' : 'Create account'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <ConfirmDialog
        isOpen={!!confirm}
        title={confirm?.title || ''}
        message={confirm?.message || ''}
        confirmText={confirm ? confirm.title.replace(' user?', '') : 'Confirm'}
        confirmColor={confirm?.color || 'primary'}
        onCancel={() => setConfirm(null)}
        onConfirm={() => { const c = confirm; setConfirm(null); changeStatus(c.user, c.status); }}
      />

      <Toast message={toast} onClose={() => setToast('')} />
    </div>
  );
}

export default AdminUsersPage;
