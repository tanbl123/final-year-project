import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../AuthContext';
import { homePathFor } from '../ProtectedRoute';
import { changePassword } from '../authService';
import EyeIcon from '../../../components/EyeIcon';

// Same password policy as registration / reset.
function validatePassword(pw) {
  if (pw.length < 8) return 'Password must be at least 8 characters.';
  if (!/[a-z]/.test(pw)) return 'Password must include a lowercase letter.';
  if (!/[A-Z]/.test(pw)) return 'Password must include an uppercase letter.';
  if (!/[0-9]/.test(pw)) return 'Password must include a number.';
  if (!/[^a-zA-Z0-9]/.test(pw)) return 'Password must include a special character.';
  return '';
}

// Forced first-login password change. Shown when the signed-in user has
// mustChangePassword set (e.g. staff provisioned with their phone number as a
// temporary password). They can't reach the rest of the app until they set
// their own password (the Layout guard redirects here). "Current password" is
// their temporary one (their phone number for a freshly provisioned specialist).
function SetPasswordPage() {
  const navigate = useNavigate();
  const { user, updateUser } = useAuth();

  const [current, setCurrent] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [shown, setShown] = useState(false);
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setFormError('');
    const errs = {};
    if (current === '') errs.current = 'Enter your current (temporary) password.';
    const pwMsg = validatePassword(password);
    if (pwMsg) errs.password = pwMsg;
    if (confirm !== password) errs.confirm = 'Passwords do not match.';
    if (Object.keys(errs).length) { setErrors(errs); return; }
    setErrors({});

    setSaving(true);
    try {
      await changePassword(current, password);
      updateUser({ mustChangePassword: false });
      navigate(homePathFor({ ...user, mustChangePassword: false }), { replace: true });
    } catch (err) {
      setFormError(err.message || 'Could not set your password. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="login-shell">
      <div className="login-box">
        <div className="login-brand">
          <div className="login-badge"><img src="/shoear-shoe-v2.png" alt="ShoeAR" /></div>
          <h1 className="login-title">Shoe<span style={{ color: '#4f46e5' }}>AR</span></h1>
          <p className="login-sub">Set your password</p>
        </div>

        <form onSubmit={handleSubmit} className="card card-body login-card text-start" noValidate>
          <p className="text-muted small mb-3">
            Welcome{user?.fullName ? `, ${user.fullName}` : ''}! For your security, please set your own
            password before continuing. Your current (temporary) password is the phone number your
            administrator registered for you.
          </p>
          {formError && <div className="alert alert-danger py-2">{formError}</div>}

          <div className="mb-3">
            <label className="form-label">Current (temporary) password</label>
            <input type={shown ? 'text' : 'password'}
              className={`form-control ${errors.current ? 'is-invalid' : ''}`}
              value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" />
            {errors.current && <div className="invalid-feedback d-block">{errors.current}</div>}
          </div>

          <div className="mb-3">
            <label className="form-label">New password</label>
            <div className="input-group has-validation">
              <input type={shown ? 'text' : 'password'}
                className={`form-control ${errors.password ? 'is-invalid' : ''}`}
                value={password} onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password" style={{ backgroundImage: 'none' }} />
              <button type="button" className="btn btn-outline-secondary d-flex align-items-center"
                onClick={() => setShown((v) => !v)} tabIndex={-1}
                aria-label={shown ? 'Hide password' : 'Show password'}>
                <EyeIcon off={shown} />
              </button>
              {errors.password && <div className="invalid-feedback">{errors.password}</div>}
            </div>
          </div>

          <div className="mb-3">
            <label className="form-label">Confirm new password</label>
            <input type={shown ? 'text' : 'password'}
              className={`form-control ${errors.confirm ? 'is-invalid' : ''}`}
              value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" />
            {errors.confirm && <div className="invalid-feedback d-block">{errors.confirm}</div>}
          </div>

          <button type="submit" className="btn btn-primary w-100 text-center" disabled={saving}>
            {saving ? 'Saving…' : 'Set password & continue'}
          </button>
        </form>
      </div>
    </div>
  );
}

export default SetPasswordPage;
