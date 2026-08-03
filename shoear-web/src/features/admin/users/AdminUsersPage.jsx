import { useEffect, useState } from 'react';
import { getUsers, getUser, setUserStatus, createStaff, resendStaffInvite, updateStaff } from '../adminService';
import ConfirmDialog from '../../../components/ConfirmDialog';
import Toast from '../../../components/Toast';
import Pagination from '../../../components/Pagination';
import ClearableInput from '../../../components/ClearableInput';
import SortableTh from '../../../components/SortableTh';
import UserDetailModal from './UserDetailModal';
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

// username auto-generated; password set by the staff member via link. Phone and
// IC / NRIC are optional identity fields.
const EMPTY_STAFF = { fullName: '', email: '', phoneNumber: '', icNumber: '' };
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
  if (name === 'phoneNumber') {
    if (v === '') return 'Phone number is required.';
    if (!/^\+?[0-9\s-]{7,20}$/.test(v)) return 'Enter a valid phone number.';
    return '';
  }
  if (name === 'icNumber') {
    if (v === '') return 'IC / NRIC number is required.';
    if (v.replace(/\D/g, '').length !== 12) return 'IC must be 12 digits (e.g. 990101-14-5678).';
    return '';
  }
  return '';
}
function validateStaff(form, fields = ['fullName', 'email', 'phoneNumber', 'icNumber']) {
  const errs = {};
  fields.forEach((k) => {
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
  const [suspendForm, setSuspendForm] = useState(null); // { user, reason } for the suspend-reason modal
  const [suspendErr, setSuspendErr] = useState('');
  const [detail, setDetail] = useState(null);       // fetched user for the modal
  const [detailLoading, setDetailLoading] = useState(false);

  const [createForm, setCreateForm] = useState(null); // AR-specialist create form (null = closed)
  const [creating, setCreating] = useState(false);
  const [createErr, setCreateErr] = useState('');
  const [staffErrors, setStaffErrors] = useState({}); // per-field inline errors

  const [resendForm, setResendForm] = useState(null); // resend-invite form { userId, fullName, email } (null = closed)
  const [resending, setResending] = useState(false);
  const [resendErr, setResendErr] = useState('');
  const [resendErrors, setResendErrors] = useState({});

  const [editForm, setEditForm] = useState(null);   // edit AR-specialist form (null = closed)
  const [editing, setEditing] = useState(false);
  const [editErr, setEditErr] = useState('');
  const [editErrors, setEditErrors] = useState({});

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

  // ── resend a pending staff invite (with editable name/email/phone/IC) ──
  async function openResend(u) {
    setResendErr(''); setResendErrors({});
    setResendForm({ userId: u.userId, fullName: u.fullName, email: u.email, phoneNumber: '', icNumber: '', loading: true });
    try {
      const d = await getUser(u.userId);   // prefill phone + IC (not in the row)
      setResendForm({ userId: u.userId, fullName: d.fullName || '', email: d.email || u.email,
        phoneNumber: d.phoneNumber || '', icNumber: d.profile?.icNumber || '', loading: false });
    } catch (err) {
      setResendForm((f) => (f ? { ...f, loading: false } : f));
      setResendErr(err.message || 'Could not load the account.');
    }
  }
  function closeResend() { setResendForm(null); setResendErrors({}); setResendErr(''); }
  function setResendField(name, value) {
    setResendForm((f) => ({ ...f, [name]: value }));
    setResendErrors((prev) => {
      if (!(name in prev)) return prev;
      const next = { ...prev };
      const msg = staffFieldError(name, value);
      if (msg) next[name] = msg; else delete next[name];
      return next;
    });
  }
  function blurResendField(name) {
    setResendErrors((prev) => {
      const next = { ...prev };
      const msg = staffFieldError(name, resendForm?.[name]);
      if (msg) next[name] = msg; else delete next[name];
      return next;
    });
  }
  async function submitResend(e) {
    e.preventDefault();
    const v = validateStaff(resendForm);
    if (Object.keys(v).length) { setResendErrors(v); return; }
    setResending(true); setResendErr('');
    try {
      const res = await resendStaffInvite(resendForm.userId, {
        fullName: resendForm.fullName.trim(), email: resendForm.email.trim(),
        phoneNumber: resendForm.phoneNumber.trim(), icNumber: resendForm.icNumber.trim(),
      });
      // reflect any corrected email/name in the row immediately
      setUsers((prev) => prev.map((x) => (x.userId === res.userId
        ? { ...x, email: res.email, fullName: res.fullName } : x)));
      setToast(res.inviteEmailSent === false
        ? `Invite updated, but the email to ${res.email} couldn't be sent — check email settings.`
        : `Invite re-sent to ${res.email}.`);
      closeResend();
    } catch (err) {
      // a duplicate-email rejection belongs under the Email field (consistent
      // with the register/profile forms); anything else is a general banner
      if (err.code === 'DUPLICATE') setResendErrors({ email: err.message });
      else setResendErr(err.message || 'Could not resend the invite.');
    } finally {
      setResending(false);
    }
  }

  // ── edit an AR Specialist's profile (name / phone / IC) ──
  async function openEdit(u) {
    setEditErr(''); setEditErrors({});
    setEditForm({ userId: u.userId, fullName: u.fullName || '', phoneNumber: '', icNumber: '', loading: true });
    try {
      const d = await getUser(u.userId);   // fetch phone + IC (not in the row)
      setEditForm({ userId: u.userId, fullName: d.fullName || '',
        phoneNumber: d.phoneNumber || '', icNumber: d.profile?.icNumber || '', loading: false });
    } catch (err) {
      setEditForm((f) => (f ? { ...f, loading: false } : f));
      setEditErr(err.message || 'Could not load the account.');
    }
  }
  function closeEdit() { setEditForm(null); setEditErrors({}); setEditErr(''); }
  function setEditField(name, value) {
    setEditForm((f) => ({ ...f, [name]: value }));
    setEditErrors((prev) => {
      if (!(name in prev)) return prev;
      const next = { ...prev };
      const msg = staffFieldError(name, value);
      if (msg) next[name] = msg; else delete next[name];
      return next;
    });
  }
  function blurEditField(name) {
    setEditErrors((prev) => {
      const next = { ...prev };
      const msg = staffFieldError(name, editForm?.[name]);
      if (msg) next[name] = msg; else delete next[name];
      return next;
    });
  }
  async function submitEdit(e) {
    e.preventDefault();
    const v = validateStaff(editForm, ['fullName', 'phoneNumber', 'icNumber']);
    if (Object.keys(v).length) { setEditErrors(v); return; }
    setEditing(true); setEditErr('');
    try {
      const res = await updateStaff(editForm.userId, {
        fullName: editForm.fullName.trim(),
        phoneNumber: editForm.phoneNumber.trim(),
        icNumber: editForm.icNumber.trim(),
      });
      setUsers((prev) => prev.map((x) => (x.userId === res.userId ? { ...x, fullName: res.fullName } : x)));
      setToast(`Updated ${res.fullName}.`);
      closeEdit();
    } catch (err) {
      setEditErr(err.message || 'Could not update the account.');
    } finally {
      setEditing(false);
    }
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

  async function changeStatus(user, status, reason = '') {
    setBusyId(user.userId);
    setError('');
    try {
      await setUserStatus(user.userId, status, reason);
      setToast(`${user.fullName} → ${status}.`);
      load();   // refresh so the row reflects (or leaves) the active filter
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId('');
    }
  }

  // Suspending needs a reason (emailed to the user with an appeal link).
  async function submitSuspend(e) {
    e.preventDefault();
    const reason = (suspendForm?.reason || '').trim();
    if (reason === '') { setSuspendErr('A reason is required — the user is told this.'); return; }
    const user = suspendForm.user;
    setSuspendForm(null); setSuspendErr('');
    await changeStatus(user, 'Suspended', reason);
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
      // duplicate email → under the Email field (like register/profile); else banner
      if (err.code === 'DUPLICATE') setStaffErrors({ email: err.message });
      else setCreateErr(err.message || 'Could not create the account.');
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
    if (u.role === 'Admin') return null;   // admins have no row actions — just View
    const busy = busyId === u.userId;
    const btns = [];
    if (u.status === 'Pending') {
      btns.push(<button key="ap" className="btn btn-success btn-sm" disabled={busy}
        onClick={() => changeStatus(u, 'Active')}>Approve</button>);
      btns.push(<button key="rj" className="btn btn-outline-danger btn-sm" disabled={busy}
        onClick={() => askConfirm(u, 'Rejected', 'Reject')}>Reject</button>);
    } else if (u.status === 'Active') {
      btns.push(<button key="sp" className="btn btn-outline-secondary btn-sm" disabled={busy}
        onClick={() => { setSuspendErr(''); setSuspendForm({ user: u, reason: '' }); }}>Suspend</button>);
    } else if (u.status === 'Suspended') {
      // only a suspended account can be reactivated. A Rejected/Banned applicant
      // is a registration-review state — they resubmit (→ Pending) and are
      // re-reviewed on the Couriers/Suppliers page, not force-activated here.
      btns.push(<button key="re" className="btn btn-success btn-sm" disabled={busy}
        onClick={() => changeStatus(u, 'Active')}>Reactivate</button>);
    }
    // Delete stays on the primary line (consistent with every other row); the
    // occasional Resend invite comes last so it wraps to a second line if needed.
    if (u.status !== 'Deleted') {
      btns.push(<button key="del" className="btn btn-outline-danger btn-sm" disabled={busy}
        onClick={() => askConfirm(u, 'Deleted', 'Delete')}>Delete</button>);
    }
    // AR Specialists can have their profile (name/phone/IC) edited by the admin.
    if (u.role === 'ArSpecialist' && u.status !== 'Deleted') {
      btns.push(<button key="ed" className="btn btn-outline-primary btn-sm" disabled={busy}
        onClick={() => openEdit(u)}>Edit</button>);
    }
    if (u.pendingSetup && u.role === 'ArSpecialist' && u.status !== 'Deleted') {
      btns.push(<button key="ri" className="btn btn-outline-primary btn-sm" disabled={busy}
        onClick={() => openResend(u)}>Resend invite</button>);
    }
    // return the buttons as siblings (not a nested flex) so they share the cell's
    // single flex-wrap row with the View button instead of stacking beneath it
    return <>{btns}</>;
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
                <SortableTh label="User" columnKey="fullName" sort={sort} style={{ maxWidth: 320 }} />
                <SortableTh label="Role" columnKey="role" sort={sort} style={{ width: 120 }} />
                <SortableTh label="Status" columnKey="status" sort={sort} className="text-center" style={{ width: 120 }} />
                <SortableTh label="Joined" columnKey="created_at" sort={sort} style={{ width: 100 }} />
                <th className="text-center" style={{ width: 300 }}>Actions</th>
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
                    {u.pendingSetup && (
                      <div className="mt-1">
                        <span className="badge text-bg-warning" title="Invite sent — hasn't set a password yet">Pending set-up</span>
                      </div>
                    )}
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

      {/* detail modal (shared with the Flagged Content page) */}
      <UserDetailModal detail={detail} loading={detailLoading} onClose={() => setDetail(null)} />

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
                  <ClearableInput className={staffErrors.fullName ? 'is-invalid' : ''}
                    value={createForm.fullName}
                    onChange={(e) => setStaffField('fullName', e.target.value)}
                    onBlur={() => blurStaffField('fullName')}
                    onClear={() => setStaffField('fullName', '')} />
                  {staffErrors.fullName && <div className="invalid-feedback d-block">{staffErrors.fullName}</div>}
                </div>
                <div className="mb-2">
                  <label className="form-label small mb-1">Email</label>
                  <ClearableInput type="email" className={staffErrors.email ? 'is-invalid' : ''}
                    value={createForm.email}
                    onChange={(e) => setStaffField('email', e.target.value)}
                    onBlur={() => blurStaffField('email')}
                    onClear={() => setStaffField('email', '')} />
                  {staffErrors.email && <div className="invalid-feedback d-block">{staffErrors.email}</div>}
                </div>

                <p className="text-muted small mb-2 mt-3">
                  Identifies the person behind the account.
                </p>
                <div className="row g-2">
                  <div className="col-sm-6 mb-1">
                    <label className="form-label small mb-1">Phone number</label>
                    <ClearableInput value={createForm.phoneNumber} placeholder="e.g. 012-345 6789"
                      className={staffErrors.phoneNumber ? 'is-invalid' : ''}
                      onChange={(e) => setStaffField('phoneNumber', e.target.value)}
                      onBlur={() => blurStaffField('phoneNumber')}
                      onClear={() => setStaffField('phoneNumber', '')} />
                    {staffErrors.phoneNumber && <div className="invalid-feedback d-block">{staffErrors.phoneNumber}</div>}
                  </div>
                  <div className="col-sm-6 mb-1">
                    <label className="form-label small mb-1">IC / NRIC number</label>
                    <ClearableInput value={createForm.icNumber} placeholder="e.g. 990101-14-5678"
                      className={staffErrors.icNumber ? 'is-invalid' : ''}
                      onChange={(e) => setStaffField('icNumber', e.target.value)}
                      onBlur={() => blurStaffField('icNumber')}
                      onClear={() => setStaffField('icNumber', '')} />
                    {staffErrors.icNumber && <div className="invalid-feedback d-block">{staffErrors.icNumber}</div>}
                  </div>
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

      {/* resend a pending staff invite (fix a wrong email + re-send the link) */}
      {resendForm && (
        <div className="modal show d-block" tabIndex="-1" style={{ background: 'rgba(0,0,0,.5)' }}
          onClick={() => !resending && closeResend()}>
          <div className="modal-dialog" onClick={(e) => e.stopPropagation()}>
            <form className="modal-content" onSubmit={submitResend} noValidate>
              <div className="modal-header">
                <h5 className="modal-title">Resend invite</h5>
                <button type="button" className="btn-close" onClick={closeResend} disabled={resending}></button>
              </div>
              <div className="modal-body">
                <p className="text-muted small">
                  This account hasn't set its password yet. Correct the email if it was mistyped, then
                  re-send a fresh set-password link (any earlier link stops working).
                </p>
                {resendErr && <div className="alert alert-danger py-2">{resendErr}</div>}
                {resendForm.loading ? (
                  <p className="text-muted mb-0">Loading…</p>
                ) : (
                <>
                <div className="mb-2">
                  <label className="form-label small mb-1">Full name</label>
                  <ClearableInput className={resendErrors.fullName ? 'is-invalid' : ''}
                    value={resendForm.fullName}
                    onChange={(e) => setResendField('fullName', e.target.value)}
                    onBlur={() => blurResendField('fullName')}
                    onClear={() => setResendField('fullName', '')} />
                  {resendErrors.fullName && <div className="invalid-feedback d-block">{resendErrors.fullName}</div>}
                </div>
                <div className="mb-2">
                  <label className="form-label small mb-1">Email</label>
                  <ClearableInput type="email" className={resendErrors.email ? 'is-invalid' : ''}
                    value={resendForm.email}
                    onChange={(e) => setResendField('email', e.target.value)}
                    onBlur={() => blurResendField('email')}
                    onClear={() => setResendField('email', '')} />
                  {resendErrors.email && <div className="invalid-feedback d-block">{resendErrors.email}</div>}
                </div>
                <div className="row g-2">
                  <div className="col-sm-6 mb-1">
                    <label className="form-label small mb-1">Phone number</label>
                    <ClearableInput value={resendForm.phoneNumber} placeholder="e.g. 012-345 6789"
                      className={resendErrors.phoneNumber ? 'is-invalid' : ''}
                      onChange={(e) => setResendField('phoneNumber', e.target.value)}
                      onBlur={() => blurResendField('phoneNumber')}
                      onClear={() => setResendField('phoneNumber', '')} />
                    {resendErrors.phoneNumber && <div className="invalid-feedback d-block">{resendErrors.phoneNumber}</div>}
                  </div>
                  <div className="col-sm-6 mb-1">
                    <label className="form-label small mb-1">IC / NRIC number</label>
                    <ClearableInput value={resendForm.icNumber} placeholder="e.g. 990101-14-5678"
                      className={resendErrors.icNumber ? 'is-invalid' : ''}
                      onChange={(e) => setResendField('icNumber', e.target.value)}
                      onBlur={() => blurResendField('icNumber')}
                      onClear={() => setResendField('icNumber', '')} />
                    {resendErrors.icNumber && <div className="invalid-feedback d-block">{resendErrors.icNumber}</div>}
                  </div>
                </div>
                </>
                )}
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-light" onClick={closeResend} disabled={resending}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={resending}>
                  {resending ? 'Sending…' : 'Resend invite'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* edit an AR Specialist's profile (name / phone / IC) */}
      {editForm && (
        <div className="modal show d-block" tabIndex="-1" style={{ background: 'rgba(0,0,0,.5)' }}
          onClick={() => !editing && closeEdit()}>
          <div className="modal-dialog" onClick={(e) => e.stopPropagation()}>
            <form className="modal-content" onSubmit={submitEdit} noValidate>
              <div className="modal-header">
                <h5 className="modal-title">Edit AR Specialist</h5>
                <button type="button" className="btn-close" onClick={closeEdit} disabled={editing}></button>
              </div>
              <div className="modal-body">
                {editErr && <div className="alert alert-danger py-2">{editErr}</div>}
                {editForm.loading ? (
                  <p className="text-muted mb-0">Loading…</p>
                ) : (
                  <>
                    <div className="mb-2">
                      <label className="form-label small mb-1">Full name</label>
                      <ClearableInput className={editErrors.fullName ? 'is-invalid' : ''}
                        value={editForm.fullName}
                        onChange={(e) => setEditField('fullName', e.target.value)}
                        onClear={() => setEditField('fullName', '')} />
                      {editErrors.fullName && <div className="invalid-feedback d-block">{editErrors.fullName}</div>}
                    </div>
                    <div className="mb-2">
                      <label className="form-label small mb-1">Phone number</label>
                      <ClearableInput value={editForm.phoneNumber} placeholder="e.g. 012-345 6789"
                        className={editErrors.phoneNumber ? 'is-invalid' : ''}
                        onChange={(e) => setEditField('phoneNumber', e.target.value)}
                        onBlur={() => blurEditField('phoneNumber')}
                        onClear={() => setEditField('phoneNumber', '')} />
                      {editErrors.phoneNumber && <div className="invalid-feedback d-block">{editErrors.phoneNumber}</div>}
                    </div>
                    <div className="mb-1">
                      <label className="form-label small mb-1">IC / NRIC number</label>
                      <ClearableInput value={editForm.icNumber} placeholder="e.g. 990101-14-5678"
                        className={editErrors.icNumber ? 'is-invalid' : ''}
                        onChange={(e) => setEditField('icNumber', e.target.value)}
                        onBlur={() => blurEditField('icNumber')}
                        onClear={() => setEditField('icNumber', '')} />
                      {editErrors.icNumber && <div className="invalid-feedback d-block">{editErrors.icNumber}</div>}
                    </div>
                    <p className="text-muted small mt-2 mb-0">Email is the sign-in address and can't be changed here.</p>
                  </>
                )}
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-light" onClick={closeEdit} disabled={editing}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={editing || editForm.loading}>
                  {editing ? 'Saving…' : 'Save changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* suspend with a required reason (emailed to the user + appeal link) */}
      {suspendForm && (
        <div className="modal show d-block" tabIndex="-1" style={{ background: 'rgba(0,0,0,.5)' }}
          onClick={() => (busyId ? null : setSuspendForm(null))}>
          <div className="modal-dialog" onClick={(e) => e.stopPropagation()}>
            <form className="modal-content" onSubmit={submitSuspend} noValidate>
              <div className="modal-header">
                <h5 className="modal-title">Suspend {suspendForm.user.fullName}?</h5>
                <button type="button" className="btn-close" onClick={() => setSuspendForm(null)}></button>
              </div>
              <div className="modal-body">
                <p className="text-muted small">
                  They won't be able to sign in. We'll email them this reason and a link to appeal.
                </p>
                <label className="form-label small mb-1">Reason (shown to the user)</label>
                <textarea className={`form-control ${suspendErr ? 'is-invalid' : ''}`} rows={3}
                  value={suspendForm.reason}
                  placeholder="e.g. Repeated policy violations in product reviews."
                  onChange={(e) => { setSuspendForm((f) => ({ ...f, reason: e.target.value })); if (suspendErr) setSuspendErr(''); }} />
                {suspendErr && <div className="invalid-feedback d-block">{suspendErr}</div>}
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-light" onClick={() => setSuspendForm(null)}>Cancel</button>
                <button type="submit" className="btn btn-warning">Suspend &amp; notify</button>
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
