import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { setPasswordWithToken } from '../authService';
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

// Public "set your password" page reached from the one-time link in a staff
// invite email (/set-password?email=…&token=…). No login required — the email +
// token in the URL authorise setting the password. On success we send them to
// the staff login. This is how an admin-provisioned AR Specialist activates
// their account; no credential is ever emailed.
function SetPasswordPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const email = params.get('email') || '';
  const token = params.get('token') || '';

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [shown, setShown] = useState({ password: false, confirm: false });
  const toggleShown = (name) => setShown((p) => ({ ...p, [name]: !p[name] }));
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);

  // A link that's missing its parameters can't work — say so plainly.
  if (!email || !token) {
    return (
      <div className="login-shell">
        <div className="login-box">
          <div className="login-brand">
            <div className="login-badge"><img src="/shoear-shoe-v2.png" alt="ShoeAR" /></div>
            <h1 className="login-title">Shoe<span style={{ color: '#4f46e5' }}>AR</span></h1>
            <p className="login-sub">Set your password</p>
          </div>
          <div className="card card-body login-card text-start">
            <div className="alert alert-danger mb-0">
              This set-password link is invalid or incomplete. Please use the link from your
              welcome email, or ask your administrator to resend it.
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Validate one field against the latest values (same rules as submit).
  function pwFieldError(name, pw, cf) {
    if (name === 'password') return validatePassword(pw);
    if (name === 'confirm') {
      if (cf === '') return 'Please confirm your password.';
      if (pw !== cf) return 'Passwords do not match.';
    }
    return '';
  }

  // Live validation on every keystroke: an empty field doesn't show "required"
  // while typing (that's only enforced on submit); password & confirm are linked
  // so confirm re-checks when the password changes.
  function handleChange(name, val) {
    const nextPw = name === 'password' ? val : password;
    const nextCf = name === 'confirm' ? val : confirm;
    if (name === 'password') setPassword(val); else setConfirm(val);
    setFormError('');
    setErrors((prev) => {
      const next = { ...prev };
      const msg = val === '' ? '' : pwFieldError(name, nextPw, nextCf);
      if (msg) next[name] = msg; else delete next[name];
      if (name === 'password' && nextCf !== '') {
        const cm = pwFieldError('confirm', nextPw, nextCf);
        if (cm) next.confirm = cm; else delete next.confirm;
      }
      return next;
    });
  }

  // Validate a field when the user leaves it (catches the empty case too).
  function handleBlur(name) {
    setErrors((prev) => {
      const next = { ...prev };
      const msg = pwFieldError(name, password, confirm);
      if (msg) next[name] = msg; else delete next[name];
      return next;
    });
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setFormError('');
    const errs = {};
    const pwMsg = pwFieldError('password', password, confirm);
    if (pwMsg) errs.password = pwMsg;
    const cfMsg = pwFieldError('confirm', password, confirm);
    if (cfMsg) errs.confirm = cfMsg;
    if (Object.keys(errs).length) { setErrors(errs); return; }
    setErrors({});

    setSaving(true);
    try {
      await setPasswordWithToken(email, token, password);
      navigate('/admin/login', { state: { toast: 'Your password is set — please sign in.' } });
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
            Welcome to ShoeAR! Choose a password for your account (<strong>{email}</strong>), then
            sign in at the staff login.
          </p>
          {formError && <div className="alert alert-danger py-2">{formError}</div>}

          <div className="mb-3">
            <label className="form-label">New password</label>
            <div className="input-group has-validation">
              <input type={shown.password ? 'text' : 'password'}
                className={`form-control ${errors.password ? 'is-invalid' : ''}`}
                value={password} onChange={(e) => handleChange('password', e.target.value)}
                onBlur={() => handleBlur('password')}
                autoComplete="new-password" style={{ backgroundImage: 'none' }} />
              <button type="button" className="btn btn-outline-secondary d-flex align-items-center"
                onClick={() => toggleShown('password')} tabIndex={-1}
                aria-label={shown.password ? 'Hide password' : 'Show password'}>
                <EyeIcon off={shown.password} />
              </button>
              {errors.password && <div className="invalid-feedback">{errors.password}</div>}
            </div>
          </div>

          <div className="mb-3">
            <label className="form-label">Confirm new password</label>
            <div className="input-group has-validation">
              <input type={shown.confirm ? 'text' : 'password'}
                className={`form-control ${errors.confirm ? 'is-invalid' : ''}`}
                value={confirm} onChange={(e) => handleChange('confirm', e.target.value)}
                onBlur={() => handleBlur('confirm')}
                autoComplete="new-password" style={{ backgroundImage: 'none' }} />
              <button type="button" className="btn btn-outline-secondary d-flex align-items-center"
                onClick={() => toggleShown('confirm')} tabIndex={-1}
                aria-label={shown.confirm ? 'Hide password' : 'Show password'}>
                <EyeIcon off={shown.confirm} />
              </button>
              {errors.confirm && <div className="invalid-feedback">{errors.confirm}</div>}
            </div>
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
