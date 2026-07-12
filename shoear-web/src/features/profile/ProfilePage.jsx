import { useEffect, useState } from 'react';
import { getMe, updateMe, changePassword, updateBankAccount } from '../auth/authService';
import { useAuth } from '../auth/AuthContext';
import Avatar from '../../components/Avatar';
import Toast from '../../components/Toast';
import ConfirmDialog from '../../components/ConfirmDialog';
import EyeIcon from '../../components/EyeIcon';
import ClearableInput from '../../components/ClearableInput';
import BusinessDetailsCard from './BusinessDetailsCard';
import StoreNameCard from './StoreNameCard';

const EMPTY_PW = { currentPassword: '', newPassword: '', confirmPassword: '' };
const EMPTY_BANK = { bankName: '', bankAccountName: '', bankAccountNumber: '' };

// Malaysian phone format the backend enforces (0xxxxxxxxx or +60xxxxxxxxx).
const MY_PHONE = /^(0\d{8,10}|\+?60\d{8,10})$/;
const PHONE_ERROR = 'Enter a valid Malaysian phone number, e.g. 0123456789.';

// Show only the last 4 digits of an account number, e.g. ••••5678.
function maskAccount(no) {
  if (!no) return '';
  return '••••' + String(no).slice(-4);
}

// Mirrors the backend password policy so we can flag problems before submitting.
function passwordPolicyError(pw) {
  if (pw.length < 8) return 'Password must be at least 8 characters.';
  if (!/[a-z]/.test(pw)) return 'Password must include a lowercase letter.';
  if (!/[A-Z]/.test(pw)) return 'Password must include an uppercase letter.';
  if (!/[0-9]/.test(pw)) return 'Password must include a number.';
  if (!/[^a-zA-Z0-9]/.test(pw)) return 'Password must include a special character.';
  return null;
}

const STATUS_COLORS = {
  Active: 'success', Pending: 'warning', Suspended: 'secondary',
  Rejected: 'danger', Deleted: 'dark',
};
const roleLabel = (r) => (r === 'DeliveryPersonnel' ? 'Delivery' : r);

function ProfilePage() {
  const { updateUser } = useAuth();
  const [me, setMe] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');

  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ fullName: '', phoneNumber: '', username: '' });
  const [fieldErrors, setFieldErrors] = useState({});   // inline per-field messages
  const [saving, setSaving] = useState(false);

  const [pwOpen, setPwOpen] = useState(false);
  const [pw, setPw] = useState(EMPTY_PW);
  const [currentPwError, setCurrentPwError] = useState('');   // shown under the Current password field
  const [pwSaving, setPwSaving] = useState(false);
  const [pwShown, setPwShown] = useState({ currentPassword: false, newPassword: false, confirmPassword: false });
  const toggleShown = (name) => setPwShown((s) => ({ ...s, [name]: !s[name] }));

  const [bankEditing, setBankEditing] = useState(false);
  const [bankForm, setBankForm] = useState(EMPTY_BANK);
  const [bankErrors, setBankErrors] = useState({});   // inline per-field messages
  const [bankSaving, setBankSaving] = useState(false);

  const [discard, setDiscard] = useState(null);   // 'profile' | 'password' | 'bank' when confirming a discard
  const [storeNameOverride, setStoreNameOverride] = useState(null); // live store name after a save (suppliers)

  useEffect(() => {
    let active = true;
    getMe()
      .then((data) => { if (active) setMe(data); })
      .catch((err) => { if (active) setError(err.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  function startEdit() {
    setForm({ fullName: me.fullName, phoneNumber: me.phoneNumber || '', username: me.username || '' });
    setFieldErrors({});
    setEditing(true);
  }

  // update an edit-form field and validate it live (username format is checked
  // live separately via usernameError)
  function setField(name, value) {
    setForm((f) => ({ ...f, [name]: value }));
    setFieldErrors((fe) => {
      const n = { ...fe };
      if (name === 'fullName') {
        if (!value.trim()) n.fullName = 'Full name is required.'; else delete n.fullName;
      } else {
        // phone format + username format are checked live via derived values
        // below; here we just clear any prior/server error as they retype.
        delete n[name];
      }
      return n;
    });
  }

  // has the user actually changed anything in the edit form?
  const dirty = editing && (
    form.fullName.trim() !== me.fullName ||
    form.phoneNumber.trim() !== (me.phoneNumber || '') ||
    form.username.trim() !== (me.username || '')
  );

  // live username format check (uniqueness is verified by the server on save)
  const usernameError = editing && form.username.trim() !== ''
    && !/^[A-Za-z0-9_]{3,20}$/.test(form.username.trim())
    ? 'Username must be 3–20 letters, numbers or underscores.' : null;

  // live phone format check (matches the backend's Malaysian-number rule)
  const phoneError = editing && form.phoneNumber.trim() !== ''
    && !MY_PHONE.test(form.phoneNumber.trim())
    ? PHONE_ERROR : null;

  async function save(e) {
    e.preventDefault();
    // validate inline, under each field (consistent with the register form)
    const fe = {};
    if (!form.fullName.trim()) fe.fullName = 'Full name is required.';
    if (!form.phoneNumber.trim()) fe.phoneNumber = 'Phone number is required.';
    else if (phoneError) fe.phoneNumber = phoneError;      // invalid format
    if (!form.username.trim()) fe.username = 'Username is required.';
    else if (usernameError) fe.username = usernameError;   // invalid format
    if (Object.keys(fe).length) { setFieldErrors(fe); return; }

    if (!dirty) {                 // nothing changed — don't pretend we saved
      setEditing(false);
      return;
    }
    setSaving(true);
    setError('');
    try {
      const saved = await updateMe({
        fullName: form.fullName.trim(),
        phoneNumber: form.phoneNumber.trim(),
        username: form.username.trim(),
      });
      setMe((m) => ({ ...m, ...saved }));
      updateUser({ fullName: saved.fullName });   // refresh the navbar greeting
      setEditing(false);
      setToast('Profile updated.');
    } catch (err) {
      // server rejections (e.g. "username already taken") land under the field
      if (/username/i.test(err.message || '')) setFieldErrors({ username: err.message });
      else setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  function closePw() {
    setPwOpen(false);
    setPw(EMPTY_PW);
    setCurrentPwError('');
  }

  // ── bank account ──────────────────────────────────────────────────
  function startBankEdit() {
    const p = me.profile || {};
    setBankForm({
      bankName: p.bankName || '',
      bankAccountName: p.bankAccountName || '',
      bankAccountNumber: p.bankAccountNumber || '',
    });
    setBankErrors({});
    setBankEditing(true);
  }

  // update a bank field and clear its inline error as the user fixes it
  function setBankField(name, value) {
    setBankForm((f) => ({ ...f, [name]: value }));
    setBankErrors((be) => { if (!be[name]) return be; const n = { ...be }; delete n[name]; return n; });
  }

  const bankDirty = bankEditing && me.profile && (
    bankForm.bankName.trim() !== (me.profile.bankName || '') ||
    bankForm.bankAccountName.trim() !== (me.profile.bankAccountName || '') ||
    bankForm.bankAccountNumber.trim() !== (me.profile.bankAccountNumber || '')
  );

  // live account-number format check (shown inline as the user types)
  const bankNumberError = bankForm.bankAccountNumber && !/^\d{5,20}$/.test(bankForm.bankAccountNumber.trim())
    ? 'Account number must be 5–20 digits.' : null;

  function cancelBank() {
    if (bankDirty) setDiscard('bank');
    else setBankEditing(false);
  }

  async function saveBank(e) {
    e.preventDefault();
    // validate inline, under each field
    const be = {};
    if (!bankForm.bankName.trim()) be.bankName = 'Bank name is required.';
    if (!bankForm.bankAccountName.trim()) be.bankAccountName = 'Account holder name is required.';
    if (!bankForm.bankAccountNumber.trim()) be.bankAccountNumber = 'Account number is required.';
    else if (bankNumberError) be.bankAccountNumber = bankNumberError;
    if (Object.keys(be).length) { setBankErrors(be); return; }

    if (!bankDirty) { setBankEditing(false); return; }
    setBankSaving(true);
    setError('');
    try {
      const saved = await updateBankAccount({
        bankName: bankForm.bankName.trim(),
        bankAccountName: bankForm.bankAccountName.trim(),
        bankAccountNumber: bankForm.bankAccountNumber.trim(),
      });
      setMe((m) => ({ ...m, profile: { ...m.profile, ...saved } }));
      setBankEditing(false);
      setToast('Bank account updated.');
    } catch (err) {
      // a server account-number complaint lands under that field
      if (/account number/i.test(err.message || '')) setBankErrors({ bankAccountNumber: err.message });
      else setError(err.message);
    } finally {
      setBankSaving(false);
    }
  }

  // cancel: confirm first if there are unsaved edits, otherwise just close
  function cancelEdit() {
    if (dirty) setDiscard('profile');
    else setEditing(false);
  }
  const pwTouched = pw.currentPassword || pw.newPassword || pw.confirmPassword;
  function cancelPw() {
    if (pwTouched) setDiscard('password');
    else closePw();
  }
  function confirmDiscard() {
    if (discard === 'profile') setEditing(false);
    if (discard === 'password') closePw();
    if (discard === 'bank') setBankEditing(false);
    setDiscard(null);
  }

  async function savePassword(e) {
    e.preventDefault();
    setCurrentPwError('');
    // the live field checks below already gate the submit button; the only
    // failure left to handle is the server rejecting the current password
    setPwSaving(true);
    try {
      await changePassword(pw.currentPassword, pw.newPassword);
      closePw();
      setToast('Password changed.');
    } catch (err) {
      setCurrentPwError(err.message);
    } finally {
      setPwSaving(false);
    }
  }

  // live feedback for the password form, shown inline under each field
  const newPwError = pw.newPassword
    ? (passwordPolicyError(pw.newPassword)
        || (pw.newPassword === pw.currentPassword ? 'New password must be different from your current one.' : null))
    : null;
  const confirmMismatch = pw.confirmPassword.length > 0 && pw.confirmPassword !== pw.newPassword;
  const pwReady = pw.currentPassword && !newPwError && !confirmMismatch && pw.confirmPassword;

  if (loading) return <div className="container py-4"><p className="text-muted">Loading…</p></div>;
  if (!me) {
    return (
      <div className="container py-4">
        <div className="alert alert-danger">{error || 'Could not load your profile.'}</div>
      </div>
    );
  }

  // Suppliers are shown their customer-facing store name here; everyone else
  // their personal full name. (The legal company name lives in Business details.)
  const headerName = me.role === 'Supplier'
    ? (storeNameOverride ?? me.profile?.displayName ?? me.fullName)
    : me.fullName;

  return (
    <div className="container py-4 text-start" style={{ maxWidth: 720 }}>
      <h1 className="mb-4">My Profile</h1>

      {error && (
        <div className="alert alert-danger py-2 d-flex justify-content-between align-items-center">
          <span>{error}</span>
          <button type="button" className="btn-close" onClick={() => setError('')}></button>
        </div>
      )}

      <div className="card">
        <div className="card-body">
          {/* header: big avatar + name (suppliers show their customer-facing store name) */}
          <div className="d-flex align-items-center gap-3 mb-4">
            <Avatar name={headerName} size={72} />
            <div>
              <h4 className="mb-0">{headerName}</h4>
              <div className="text-muted">
                @{me.username}
                <span className={`badge ms-2 text-bg-light`}>{roleLabel(me.role)}</span>
                <span className={`badge ms-1 text-bg-${STATUS_COLORS[me.status] || 'secondary'}`}>{me.status}</span>
              </div>
            </div>
          </div>

          {editing ? (
            <form onSubmit={save} noValidate>
              {/* Suppliers have no personal "Full name": their customer-facing name
                  is the Store name (below), and their legal name is in Business
                  details. Everyone else edits their full name here. */}
              {me.role !== 'Supplier' && (
                <div className="mb-3">
                  <label className="form-label">Full name</label>
                  <ClearableInput type="text" maxLength="100" required autoFocus
                    className={fieldErrors.fullName ? 'is-invalid' : ''}
                    value={form.fullName}
                    onChange={(e) => setField('fullName', e.target.value)}
                    onClear={() => setField('fullName', '')} />
                  {fieldErrors.fullName && <div className="invalid-feedback d-block">{fieldErrors.fullName}</div>}
                </div>
              )}
              <div className="mb-3">
                <label className="form-label">Username</label>
                <ClearableInput type="text" maxLength="20"
                  className={(usernameError || fieldErrors.username) ? 'is-invalid' : ''}
                  value={form.username}
                  onChange={(e) => setField('username', e.target.value)}
                  onClear={() => setField('username', '')} />
                {(usernameError || fieldErrors.username)
                  ? <div className="invalid-feedback d-block">{usernameError || fieldErrors.username}</div>
                  : <div className="form-text">Letters, numbers or underscores. You can sign in with this or your email.</div>}
              </div>
              <div className="mb-3">
                <label className="form-label">Phone number</label>
                <ClearableInput type="text" inputMode="tel" maxLength="30" required
                  className={(phoneError || fieldErrors.phoneNumber) ? 'is-invalid' : ''}
                  value={form.phoneNumber}
                  onChange={(e) => setField('phoneNumber', e.target.value)}
                  onClear={() => setField('phoneNumber', '')} />
                {(phoneError || fieldErrors.phoneNumber)
                  ? <div className="invalid-feedback d-block">{phoneError || fieldErrors.phoneNumber}</div>
                  : <div className="form-text">Malaysian number, e.g. 0123456789.</div>}
              </div>
              <div className="d-flex gap-2">
                <button type="submit" className="btn btn-primary" disabled={saving || !dirty || !!usernameError || !!phoneError}>
                  {saving ? 'Saving…' : 'Save changes'}
                </button>
                <button type="button" className="btn btn-outline-secondary"
                  onClick={cancelEdit} disabled={saving}>Cancel</button>
              </div>
            </form>
          ) : (
            <>
              <dl className="row mb-0">
                <dt className="col-sm-4">Email</dt>
                <dd className="col-sm-8" style={{ overflowWrap: 'anywhere' }}>{me.email}</dd>
                <dt className="col-sm-4">Phone</dt>
                <dd className="col-sm-8">{me.phoneNumber || <span className="text-muted">—</span>}</dd>

                {me.role === 'Customer' && me.profile && (
                  <>
                    <dt className="col-sm-4">Shipping address</dt>
                    <dd className="col-sm-8">{me.profile.shippingAddress || <span className="text-muted">—</span>}</dd>
                  </>
                )}
                {me.role === 'DeliveryPersonnel' && me.profile && (
                  <>
                    <dt className="col-sm-4">Vehicle</dt>
                    <dd className="col-sm-8">
                      {me.profile.vehicleType && me.profile.vehicleBrand
                        ? `${me.profile.vehicleType} • ${me.profile.vehicleBrand} ${me.profile.vehicleModel} — ${me.profile.vehiclePlate}`
                        : <span className="text-muted">—</span>}
                    </dd>
                  </>
                )}

                <dt className="col-sm-4">Member since</dt>
                <dd className="col-sm-8">{new Date(me.created_at).toLocaleDateString()}</dd>
              </dl>
              <hr />
              <button className="btn btn-primary" onClick={startEdit}>Edit profile</button>
            </>
          )}
        </div>
      </div>

      {/* store name (suppliers only) — customer-facing shop brand, self-editable w/ cooldown */}
      {me.role === 'Supplier' && (
        <StoreNameCard
          initialName={me.profile?.displayName || me.fullName}
          updatedAt={me.profile?.displayNameUpdatedAt || null}
          onSaved={(nm) => setStoreNameOverride(nm)}
          onToast={setToast}
        />
      )}

      {/* business details (suppliers only) — verified identity + re-approval flow */}
      {me.role === 'Supplier' && <BusinessDetailsCard onToast={setToast} />}

      {/* bank account (suppliers only) — where their sales payouts are sent */}
      {me.role === 'Supplier' && (
        <div className="card mt-4">
          <div className="card-body">
            <div className="d-flex justify-content-between align-items-start">
              <div>
                <h5 className="mb-0">Bank account</h5>
                <small className="text-muted">Where your sales payouts are sent.</small>
              </div>
              {!bankEditing && (
                <button className="btn btn-outline-primary"
                  onClick={startBankEdit}>
                  {me.profile?.bankAccountNumber ? 'Edit' : 'Add bank account'}
                </button>
              )}
            </div>

            {bankEditing ? (
              <form className="mt-3" onSubmit={saveBank} noValidate>
                <div className="mb-3">
                  <label className="form-label">Bank name</label>
                  <ClearableInput type="text" maxLength="100" required autoFocus
                    className={bankErrors.bankName ? 'is-invalid' : ''}
                    value={bankForm.bankName}
                    onChange={(e) => setBankField('bankName', e.target.value)}
                    onClear={() => setBankField('bankName', '')} />
                  {bankErrors.bankName && <div className="invalid-feedback d-block">{bankErrors.bankName}</div>}
                </div>
                <div className="mb-3">
                  <label className="form-label">Account holder name</label>
                  <ClearableInput type="text" maxLength="150" required
                    className={bankErrors.bankAccountName ? 'is-invalid' : ''}
                    value={bankForm.bankAccountName}
                    onChange={(e) => setBankField('bankAccountName', e.target.value)}
                    onClear={() => setBankField('bankAccountName', '')} />
                  {bankErrors.bankAccountName && <div className="invalid-feedback d-block">{bankErrors.bankAccountName}</div>}
                </div>
                <div className="mb-3">
                  <label className="form-label">Account number</label>
                  <ClearableInput type="text" inputMode="numeric" maxLength="34" required
                    className={(bankNumberError || bankErrors.bankAccountNumber) ? 'is-invalid' : ''}
                    value={bankForm.bankAccountNumber}
                    onChange={(e) => setBankField('bankAccountNumber', e.target.value)}
                    onClear={() => setBankField('bankAccountNumber', '')} />
                  {(bankNumberError || bankErrors.bankAccountNumber) &&
                    <div className="invalid-feedback d-block">{bankNumberError || bankErrors.bankAccountNumber}</div>}
                </div>
                <div className="d-flex gap-2">
                  <button type="submit" className="btn btn-primary" disabled={bankSaving || !bankDirty || !!bankNumberError}>
                    {bankSaving ? 'Saving…' : 'Save bank account'}
                  </button>
                  <button type="button" className="btn btn-outline-secondary"
                    onClick={cancelBank} disabled={bankSaving}>Cancel</button>
                </div>
              </form>
            ) : me.profile?.bankAccountNumber ? (
              <dl className="row mb-0 mt-3">
                <dt className="col-sm-4">Bank</dt>
                <dd className="col-sm-8">{me.profile.bankName}</dd>
                <dt className="col-sm-4">Account holder</dt>
                <dd className="col-sm-8">{me.profile.bankAccountName}</dd>
                <dt className="col-sm-4">Account number</dt>
                <dd className="col-sm-8">{maskAccount(me.profile.bankAccountNumber)}</dd>
              </dl>
            ) : (
              <p className="text-muted mb-0 mt-3">No bank account added yet.</p>
            )}
          </div>
        </div>
      )}

      {/* change password */}
      <div className="card mt-4">
        <div className="card-body">
          <div className="d-flex justify-content-between align-items-center">
            <div>
              <h5 className="mb-0">Password</h5>
              <small className="text-muted">Change the password you use to sign in.</small>
            </div>
            {!pwOpen && (
              <button className="btn btn-outline-primary" onClick={() => setPwOpen(true)}>
                Change password
              </button>
            )}
          </div>

          {pwOpen && (
            <form className="mt-3" onSubmit={savePassword} noValidate>
              <div className="mb-3">
                <label className="form-label">Current password</label>
                <div className="input-group has-validation">
                  <input type={pwShown.currentPassword ? 'text' : 'password'} required autoFocus
                    autoComplete="current-password"
                    className={'form-control' + (currentPwError ? ' is-invalid' : '')}
                    style={{ backgroundImage: 'none' }}
                    value={pw.currentPassword}
                    onChange={(e) => {
                      setPw((p) => ({ ...p, currentPassword: e.target.value }));
                      if (currentPwError) setCurrentPwError('');
                    }} />
                  <button type="button" className="btn btn-outline-secondary d-flex align-items-center"
                    onClick={() => toggleShown('currentPassword')} tabIndex={-1}
                    aria-label={pwShown.currentPassword ? 'Hide password' : 'Show password'}>
                    <EyeIcon off={pwShown.currentPassword} />
                  </button>
                  {currentPwError && <div className="invalid-feedback">{currentPwError}</div>}
                </div>
              </div>
              <div className="mb-3">
                <label className="form-label">New password</label>
                <div className="input-group has-validation">
                  <input type={pwShown.newPassword ? 'text' : 'password'} required autoComplete="new-password"
                    className={'form-control' + (newPwError ? ' is-invalid' : '')}
                    style={{ backgroundImage: 'none' }}
                    value={pw.newPassword}
                    onChange={(e) => setPw((p) => ({ ...p, newPassword: e.target.value }))} />
                  <button type="button" className="btn btn-outline-secondary d-flex align-items-center"
                    onClick={() => toggleShown('newPassword')} tabIndex={-1}
                    aria-label={pwShown.newPassword ? 'Hide password' : 'Show password'}>
                    <EyeIcon off={pwShown.newPassword} />
                  </button>
                  {newPwError && <div className="invalid-feedback">{newPwError}</div>}
                </div>
                {!newPwError && (
                  <div className="form-text">
                    At least 8 characters with upper &amp; lower case, a number and a special character.
                  </div>
                )}
              </div>
              <div className="mb-3">
                <label className="form-label">Confirm new password</label>
                <div className="input-group has-validation">
                  <input type={pwShown.confirmPassword ? 'text' : 'password'} required autoComplete="new-password"
                    className={'form-control' + (confirmMismatch ? ' is-invalid' : '')}
                    style={{ backgroundImage: 'none' }}
                    value={pw.confirmPassword}
                    onChange={(e) => setPw((p) => ({ ...p, confirmPassword: e.target.value }))} />
                  <button type="button" className="btn btn-outline-secondary d-flex align-items-center"
                    onClick={() => toggleShown('confirmPassword')} tabIndex={-1}
                    aria-label={pwShown.confirmPassword ? 'Hide password' : 'Show password'}>
                    <EyeIcon off={pwShown.confirmPassword} />
                  </button>
                  {confirmMismatch && <div className="invalid-feedback">Passwords do not match.</div>}
                </div>
              </div>
              <div className="d-flex gap-2">
                <button type="submit" className="btn btn-primary" disabled={pwSaving || !pwReady}>
                  {pwSaving ? 'Saving…' : 'Update password'}
                </button>
                <button type="button" className="btn btn-outline-secondary"
                  onClick={cancelPw} disabled={pwSaving}>Cancel</button>
              </div>
            </form>
          )}
        </div>
      </div>

      <ConfirmDialog
        isOpen={!!discard}
        title="Discard changes?"
        message="You have unsaved changes. Are you sure you want to discard them?"
        confirmText="Discard"
        confirmColor="danger"
        onCancel={() => setDiscard(null)}
        onConfirm={confirmDiscard}
      />

      <Toast message={toast} onClose={() => setToast('')} />
    </div>
  );
}

export default ProfilePage;
