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

// Per-variant config so one component serves both the supplier and admin
// login pages (same form, different branding + which role may sign in here).
const VARIANTS = {
  supplier: {
    title: '👟 Supplier Login',
    allowedRole: 'Supplier',
    wrongRole: 'This is the supplier login. Please use the admin login page.',
  },
  admin: {
    title: '🛡️ Admin Login',
    allowedRole: 'Admin',
    wrongRole: 'This is the admin login. Please use the supplier login page.',
  },
};

function LoginPage({ variant = 'supplier' }) {
  const config = VARIANTS[variant];
  const [form, setForm] = useState({ identifier: '', password: '' });
  const [errors, setErrors] = useState({});       // per-field messages
  const [formError, setFormError] = useState(''); // server/auth error (not field-specific)
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

    const found = validateForm(form);
    if (Object.keys(found).length > 0) {
      setErrors(found);
      return;
    }
    setErrors({});

    setIsSubmitting(true);
    try {
      const result = await login(form.identifier.trim(), form.password);

      // each login page only accepts its own role — bounce the wrong one
      if (result.user.role !== config.allowedRole) {
        logout();   // undo the session login() just established
        setFormError(config.wrongRole);
        return;
      }

      navigate(homePathFor(result.user));   // success → admin or supplier home
    } catch (err) {
      // auth failures aren't tied to one field — show a general message
      setFormError(err.message || 'Could not log in. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="container py-5" style={{ maxWidth: '420px' }}>
      <Toast message={toast} onClose={() => setToast('')} />
      <h1 className="mb-4 text-center">{config.title}</h1>

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

      <form onSubmit={handleSubmit} className="card card-body shadow-sm text-start" noValidate>
        <div className="mb-3">
          <label className="form-label">Email or username</label>
          <ClearableInput
            type="text"
            name="identifier"
            autoComplete="username"
            className={errors.identifier ? 'is-invalid' : ''}
            value={form.identifier}
            onChange={handleChange}
            onBlur={handleBlur}
            onClear={() => { setForm((f) => ({ ...f, identifier: '' })); setErrors((p) => { const n = { ...p }; delete n.identifier; return n; }); setFormError(''); }}
          />
          {errors.identifier && <div className="invalid-feedback d-block">{errors.identifier}</div>}
        </div>

        <div className="mb-3">
          <label className="form-label">Password</label>
          <div className="input-group has-validation">
            <input
              type={showPw ? 'text' : 'password'}
              name="password"
              className={`form-control ${errors.password ? 'is-invalid' : ''}`}
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

        {formError && <div className="text-danger small mb-3">{formError}</div>}

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
  );
}

export default LoginPage;
