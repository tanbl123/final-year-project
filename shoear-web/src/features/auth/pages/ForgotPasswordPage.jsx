import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { forgotPassword, verifyResetCode, resetPassword } from '../authService';
import EyeIcon from '../../../components/EyeIcon';
import BackButton from '../../../components/BackButton';

// Same password policy as registration: 8+ chars with a lowercase, uppercase,
// digit and special character. Returns an error string, or '' when valid.
function validatePassword(pw) {
  if (pw.length < 8) return 'Password must be at least 8 characters.';
  if (!/[a-z]/.test(pw)) return 'Password must include a lowercase letter.';
  if (!/[A-Z]/.test(pw)) return 'Password must include an uppercase letter.';
  if (!/[0-9]/.test(pw)) return 'Password must include a number.';
  if (!/[^a-zA-Z0-9]/.test(pw)) return 'Password must include a special character.';
  return '';
}

// "Forgot password" — three distinct steps:
//   1. 'request' → enter email; we email a 6-digit code
//   2. 'verify'  → enter the code; it's checked on its own (not consumed)
//   3. 'reset'   → only now enter a new password
function ForgotPasswordPage() {
  const navigate = useNavigate();
  const [step, setStep] = useState('request');   // 'request' → 'verify' → 'reset'

  const [email, setEmail] = useState('');
  const [emailError, setEmailError] = useState('');
  const [sending, setSending] = useState(false);

  const [code, setCode] = useState('');
  const [codeError, setCodeError] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [resending, setResending] = useState(false);
  const [resendIn, setResendIn] = useState(0);
  const [info, setInfo] = useState('');

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [shown, setShown] = useState({ password: false, confirm: false });
  const [pwErrors, setPwErrors] = useState({});   // per-field inline errors
  const [resetError, setResetError] = useState(''); // server-side errors only
  const [resetting, setResetting] = useState(false);

  // tick the resend cooldown down to zero
  useEffect(() => {
    if (resendIn <= 0) return undefined;
    const t = setTimeout(() => setResendIn((n) => n - 1), 1000);
    return () => clearTimeout(t);
  }, [resendIn]);

  function toggleShown(name) {
    setShown((prev) => ({ ...prev, [name]: !prev[name] }));
  }

  // Validate one password field against the latest values (same rules as the
  // register form). Returns an error string, or '' when valid.
  function pwFieldError(name, pw, cf) {
    if (name === 'password') return validatePassword(pw);
    if (name === 'confirm') {
      if (cf === '') return 'Please confirm your password.';
      if (pw !== cf) return 'Passwords do not match.';
    }
    return '';
  }

  // live re-check (only once a field already shows an error), like register/login
  function handlePwChange(name, val) {
    const nextPw = name === 'password' ? val : password;
    const nextCf = name === 'confirm' ? val : confirm;
    if (name === 'password') setPassword(val); else setConfirm(val);
    setResetError('');
    setPwErrors((prev) => {
      const next = { ...prev };
      if (name in prev) {
        const msg = pwFieldError(name, nextPw, nextCf);
        if (msg) next[name] = msg; else delete next[name];
      }
      // password & confirm are linked — keep the confirm error in sync
      if (name === 'password' && 'confirm' in prev) {
        const msg = pwFieldError('confirm', nextPw, nextCf);
        if (msg) next.confirm = msg; else delete next.confirm;
      }
      return next;
    });
  }

  // validate a field when the user leaves it (on blur)
  function handlePwBlur(name) {
    setPwErrors((prev) => {
      const next = { ...prev };
      const msg = pwFieldError(name, password, confirm);
      if (msg) next[name] = msg; else delete next[name];
      return next;
    });
  }

  // Step 1 → email a code, then move to the verify step.
  async function handleRequest(event) {
    event.preventDefault();
    setEmailError('');
    if (email.trim() === '' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setEmailError('Please enter a valid email.');
      return;
    }
    setSending(true);
    try {
      await forgotPassword(email.trim());
      // the verify-step paragraph already carries the "(if an account exists)"
      // caveat, so we don't repeat it in a banner here — the banner is only for
      // the resend confirmation.
      setInfo('');
      setCode('');
      setCodeError('');
      setStep('verify');
      setResendIn(60);
    } catch (err) {
      setEmailError(err.message || 'Something went wrong. Please try again.');
    } finally {
      setSending(false);
    }
  }

  // Step 2 → verify the code on its own (it is NOT consumed here).
  async function handleVerify(event) {
    event.preventDefault();
    setCodeError('');
    if (!/^\d{6}$/.test(code.trim())) {
      setCodeError('Enter the 6-digit code from your email.');
      return;
    }
    setVerifying(true);
    try {
      await verifyResetCode(email.trim(), code.trim());
      setResetError('');
      setPassword('');
      setConfirm('');
      setInfo('');
      setStep('reset');
    } catch (err) {
      setCodeError(err.message || 'Something went wrong. Please try again.');
    } finally {
      setVerifying(false);
    }
  }

  // Step 3 → set the new password (re-sends the verified code with it).
  async function handleReset(event) {
    event.preventDefault();
    setResetError('');
    const errs = {};
    const pwMsg = pwFieldError('password', password, confirm);
    if (pwMsg) errs.password = pwMsg;
    const cfMsg = pwFieldError('confirm', password, confirm);
    if (cfMsg) errs.confirm = cfMsg;
    if (Object.keys(errs).length > 0) { setPwErrors(errs); return; }
    setPwErrors({});

    setResetting(true);
    try {
      await resetPassword(email.trim(), code.trim(), password);
      // standard e-commerce pattern: send them to login with a success notice
      navigate('/login', { state: { notice: 'Your password has been reset — please log in.' } });
    } catch (err) {
      const msg = err.message || 'Something went wrong. Please try again.';
      setResetError(msg);
      // if the code expired/was exhausted between steps, send them back to re-enter
      if (/code/i.test(msg) && /(expired|request|incorrect|attempts)/i.test(msg)) {
        setCodeError(msg);
        setStep('verify');
      }
    } finally {
      setResetting(false);
    }
  }

  // Resend a fresh code (respecting the cooldown).
  async function handleResend() {
    if (resendIn > 0 || resending) return;
    setCodeError('');
    setInfo('');
    setResending(true);
    try {
      await forgotPassword(email.trim());
      setResendIn(60);
      setInfo('A new code has been sent to your email.');
    } catch (err) {
      setCodeError(err.message || 'Could not resend the code. Please try again.');
    } finally {
      setResending(false);
    }
  }

  // a password field with a Show/Hide toggle (same pattern as the other forms)
  function passwordField(name, label, value) {
    const isShown = shown[name];
    return (
      <div className="mb-3">
        <label className="form-label">{label}</label>
        <div className="input-group has-validation">
          <input
            type={isShown ? 'text' : 'password'}
            className={`form-control ${pwErrors[name] ? 'is-invalid' : ''}`}
            value={value}
            onChange={(e) => handlePwChange(name, e.target.value)}
            onBlur={() => handlePwBlur(name)}
            style={{ backgroundImage: 'none' }}
          />
          <button
            type="button"
            className="btn btn-outline-secondary d-flex align-items-center"
            onClick={() => toggleShown(name)}
            tabIndex={-1}
            aria-label={isShown ? 'Hide password' : 'Show password'}
          >
            <EyeIcon off={isShown} />
          </button>
          {pwErrors[name] && <div className="invalid-feedback">{pwErrors[name]}</div>}
        </div>
      </div>
    );
  }

  // ── Step 1: request a code ──
  if (step === 'request') {
    return (
      <div className="container py-5" style={{ maxWidth: '420px' }}>
        <BackButton to="/login" />
        <h1 className="mb-4 text-center">🔑 Forgot password</h1>
        <form onSubmit={handleRequest} className="card card-body shadow-sm text-start" noValidate>
          <p className="text-muted">
            Enter your account email and we'll send you a 6-digit code to reset your password.
          </p>
          <div className="mb-3">
            <label className="form-label">Email</label>
            <input
              type="email"
              autoComplete="email"
              autoFocus
              className={`form-control ${emailError ? 'is-invalid' : ''}`}
              value={email}
              onChange={(e) => { setEmail(e.target.value); setEmailError(''); }}
            />
            {emailError && <div className="invalid-feedback d-block">{emailError}</div>}
          </div>
          <button type="submit" className="btn btn-primary w-100 text-center" disabled={sending}>
            {sending ? 'Sending code...' : 'Send reset code'}
          </button>
        </form>
      </div>
    );
  }

  // ── Step 2: enter the code (verified on its own) ──
  if (step === 'verify') {
    return (
      <div className="container py-5" style={{ maxWidth: '420px' }}>
        <BackButton onClick={() => { setStep('request'); setCodeError(''); setInfo(''); }} />
        <h1 className="mb-3 text-center">📧 Enter code</h1>
        <form onSubmit={handleVerify} className="card card-body shadow-sm text-start" noValidate>
          <p className="text-muted">
            We've sent a 6-digit code to <strong>{email.trim()}</strong> (if an account exists).
            Enter it below to continue.
          </p>
          {info && <div className="alert alert-success py-2">{info}</div>}
          {codeError && <div className="alert alert-danger py-2">{codeError}</div>}

          <div className="mb-3">
            <label className="form-label">Verification code</label>
            <input
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              autoFocus
              className={`form-control text-center ${codeError ? 'is-invalid' : ''}`}
              style={{ letterSpacing: '0.5em', fontSize: '1.4rem' }}
              value={code}
              onChange={(e) => { setCode(e.target.value.replace(/\D/g, '').slice(0, 6)); setCodeError(''); }}
            />
          </div>

          <button type="submit" className="btn btn-primary w-100 text-center" disabled={verifying || code.length !== 6}>
            {verifying ? 'Verifying…' : 'Verify code'}
          </button>

          <button type="button" className="btn btn-outline-secondary w-100 mt-2 text-center"
            onClick={handleResend} disabled={resendIn > 0 || resending}>
            {resending ? 'Sending…' : resendIn > 0 ? `Resend code (${resendIn}s)` : 'Resend code'}
          </button>
        </form>
      </div>
    );
  }

  // ── Step 3: set the new password ──
  return (
    <div className="container py-5" style={{ maxWidth: '440px' }}>
      <BackButton onClick={() => { setStep('verify'); setResetError(''); }} />
      <h1 className="mb-3 text-center">🔑 New password</h1>
      <form onSubmit={handleReset} className="card card-body shadow-sm text-start" noValidate>
        <p className="text-muted">
          Code verified. Choose a new password for <strong>{email.trim()}</strong>.
        </p>
        {resetError && <div className="alert alert-danger py-2">{resetError}</div>}

        {passwordField('password', 'New password', password)}
        {passwordField('confirm', 'Confirm new password', confirm)}

        <button type="submit" className="btn btn-primary w-100 text-center" disabled={resetting}>
          {resetting ? 'Resetting...' : 'Reset password'}
        </button>
      </form>
    </div>
  );
}

export default ForgotPasswordPage;
