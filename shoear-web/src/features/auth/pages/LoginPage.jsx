import { useState } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { useAuth } from '../AuthContext';
import { homePathFor } from '../ProtectedRoute';
import EyeIcon from '../../../components/EyeIcon';
import ClearableInput from '../../../components/ClearableInput';
import Toast from '../../../components/Toast';

// Validate the login fields, returning a { field: message } object.
function validateForm(form) {
  const errors = {};
  if (form.identifier.trim() === '') {
    errors.identifier = 'Email or username is required.';
  }
  if (form.password === '') errors.password = 'Password is required.';
  return errors;
}

// Generic failure message. Used for BOTH wrong credentials and a valid login on
// the wrong portal — so an attacker can't tell "these creds are valid but it's
// an admin account" apart from "wrong password" (no account/role enumeration).
const GENERIC_LOGIN_ERROR = 'Invalid email/username or password.';

// Per-variant config so one component serves both the supplier and admin
// login pages (same form, different branding + which role may sign in here).
const VARIANTS = {
  supplier: { badge: '👟', subtitle: 'Supplier Portal', allowedRole: 'Supplier' },
  admin:    { badge: '🛡️', subtitle: 'Admin Portal',    allowedRole: 'Admin' },
};

function LoginPage({ variant = 'supplier' }) {
  const config = VARIANTS[variant];
  const [form, setForm] = useState({ identifier: '', password: '' });
  const [errors, setErrors] = useState({});       // per-field messages
  const [formError, setFormError] = useState(''); // server/auth error (not field-specific)
  const [credsInvalid, setCredsInvalid] = useState(false); // wrong email/password → red-border both fields
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showPw, setShowPw] = useState(false);

  const { login, logout } = useAuth();
  const navigate = useNavigate();
  // a one-off success message passed via navigation state (e.g. after a
  // password reset), shown as an auto-dismissing toast. Captured once at mount.
  const location = useLocation();
  const [toast, setToast] = useState(() => location.state?.toast || '');

  // update the changed field; re-check it live once it's already erroring
  function handleChange(event) {
    const { name, value } = event.target;
    const nextForm = { ...form, [name]: value };
    setForm(nextForm);
    setFormError('');
    setCredsInvalid(false);   // clear the wrong-credentials highlight as they retype
    setErrors((prev) => {
      if (!(name in prev)) return prev;
      const next = { ...prev };
      const msg = validateForm(nextForm)[name];
      if (msg) next[name] = msg;
      else delete next[name];
      return next;
    });
  }

  // validate a single field when the user leaves it
  function handleBlur(event) {
    const { name } = event.target;
    setErrors((prev) => {
      const next = { ...prev };
      const msg = validateForm(form)[name];
      if (msg) next[name] = msg;
      else delete next[name];
      return next;
    });
  }

  async function handleSubmit(event) {
    event.preventDefault();   // AJAX submit — no page reload
    setFormError('');
    setCredsInvalid(false);

    const found = validateForm(form);
    if (Object.keys(found).length > 0) {
      setErrors(found);
      return;
    }
    setErrors({});

    setIsSubmitting(true);
    try {
      const result = await login(form.identifier.trim(), form.password);

      // each login page only accepts its own role — but bounce the wrong role
      // with the SAME generic error as a bad password, so we never reveal that
      // the credentials were valid or what role the account is.
      if (result.user.role !== config.allowedRole) {
        logout();   // undo the session login() just established
        setCredsInvalid(true);
        setFormError(GENERIC_LOGIN_ERROR);
        return;
      }

      navigate(homePathFor(result.user));   // success → admin or supplier home
    } catch (err) {
      // wrong email/password — show a generic message AND red-border both fields
      // (mirrors the mobile app), since we can't tell which one was wrong.
      setCredsInvalid(true);
      setFormError(err.message || GENERIC_LOGIN_ERROR);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="login-shell">
      <Toast message={toast} onClose={() => setToast('')} />
      <div className="login-box">
        {/* brand lockup */}
        <div className="login-brand">
          <div className="login-badge">
            <img src="/shoear-shoe-v2.png" alt="ShoeAR" />
          </div>
          <h1 className="login-title">Shoe<span style={{ color: '#4f46e5' }}>AR</span></h1>
          <p className="login-sub">{config.subtitle}</p>
        </div>

      {/* portal switch as a tab bar above the card — anchored here so the card's
          differing height (the supplier sign-up block) never shifts it */}
      <ul className="nav nav-pills nav-justified mb-3">
        <li className="nav-item">
          <Link to="/admin/login" className={`nav-link ${variant === 'admin' ? 'active' : ''}`}>
            Admin login
          </Link>
        </li>
        <li className="nav-item">
          <Link to="/login" className={`nav-link ${variant === 'supplier' ? 'active' : ''}`}>
            Supplier login
          </Link>
        </li>
      </ul>

      <form onSubmit={handleSubmit} className="card card-body login-card text-start" noValidate>
        <div className="mb-3">
          <label className="form-label">Email or username</label>
          <ClearableInput
            type="text"
            name="identifier"
            autoComplete="username"
            className={errors.identifier || credsInvalid ? 'is-invalid' : ''}
            value={form.identifier}
            onChange={handleChange}
            onBlur={handleBlur}
            onClear={() => { setForm((f) => ({ ...f, identifier: '' })); setErrors((p) => { const n = { ...p }; delete n.identifier; return n; }); setFormError(''); setCredsInvalid(false); }}
          />
          {errors.identifier && <div className="invalid-feedback d-block">{errors.identifier}</div>}
        </div>

        <div className="mb-3">
          <label className="form-label">Password</label>
          <div className="input-group has-validation">
            <input
              type={showPw ? 'text' : 'password'}
              name="password"
              className={`form-control ${errors.password || credsInvalid ? 'is-invalid' : ''}`}
              value={form.password}
              onChange={handleChange}
              onBlur={handleBlur}
              style={{ backgroundImage: 'none' }}
            />
            <button
              type="button"
              className="btn btn-outline-secondary d-flex align-items-center"
              onClick={() => setShowPw((v) => !v)}
              tabIndex={-1}
              aria-label={showPw ? 'Hide password' : 'Show password'}
            >
              <EyeIcon off={showPw} />
            </button>
            {errors.password && <div className="invalid-feedback">{errors.password}</div>}
          </div>
        </div>

        {formError && <div className="alert alert-danger py-2">{formError}</div>}

        <button type="submit" className="btn btn-primary w-100 text-center" disabled={isSubmitting}>
          {isSubmitting ? 'Logging in...' : 'Login'}
        </button>

        {/* secondary actions as buttons (kept inside the card) */}
        <Link to="/forgot-password" className="btn btn-outline-secondary w-100 mt-2 text-center">
          Forgot password?
        </Link>

        {variant === 'supplier' && (
          <>
            <hr className="my-3" />
            <p className="text-center text-muted small mb-2">New to ShoeAR?</p>
            <Link to="/register" className="btn btn-outline-primary w-100 text-center">
              Create a supplier account
            </Link>
          </>
        )}
      </form>
      </div>
    </div>
  );
}

export default LoginPage;
