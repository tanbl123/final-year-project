import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { register, sendRegisterCode, uploadRegistrationDoc, checkUsername } from '../authService';
import EyeIcon from '../../../components/EyeIcon';
import ClearableInput from '../../../components/ClearableInput';
import BackButton from '../../../components/BackButton';

// Reduce free text (e.g. a company name) to a valid username body:
// lowercase, only letters/numbers/underscore, max 20 chars.
const usernameSlug = (s) => s.toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 20);
const USERNAME_RE = /^[A-Za-z0-9_]{3,20}$/;

// Password policy: 8+ chars with at least one lowercase, uppercase, digit
// and special character. Returns an error string, or '' when it's valid.
function validatePassword(pw) {
  if (pw.length < 8) return 'Password must be at least 8 characters.';
  if (!/[a-z]/.test(pw)) return 'Password must include a lowercase letter.';
  if (!/[A-Z]/.test(pw)) return 'Password must include an uppercase letter.';
  if (!/[0-9]/.test(pw)) return 'Password must include a number.';
  if (!/[^a-zA-Z0-9]/.test(pw)) return 'Password must include a special character.';
  return '';
}

// SSM business registration number — accepts both formats in use in Malaysia:
//   * new (2019+) 12-digit number, e.g. 202301012345
//   * old format: 6–8 digits + a check letter, e.g. 1234567-A
function validateSsm(value) {
  return /^(\d{12}|\d{6,8}-?[A-Za-z])$/.test(value.trim());
}

// SST registration number (RMCD), e.g. W10-1808-32000001. The exact pattern
// has variants, so this is a structural check: a letter/digit start, then
// 8–20 letters/digits/hyphens — enough to reject obvious typos like "234fa".
function validateSst(value) {
  return /^[A-Za-z0-9][A-Za-z0-9-]{6,18}[A-Za-z0-9]$/.test(value.trim());
}

// Validate the whole form, returning a { field: message } object.
// An empty object means everything passed.
function validateForm(form) {
  const errors = {};

  if (form.companyName.trim() === '') errors.companyName = 'Company name is required.';

  if (form.username.trim() === '') {
    errors.username = 'Username is required.';
  } else if (!USERNAME_RE.test(form.username.trim())) {
    errors.username = 'Username must be 3–20 letters, numbers or underscores.';
  }

  if (form.email.trim() === '') {
    errors.email = 'Email is required.';
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) {
    errors.email = 'Please enter a valid email.';
  }

  // E.164: optional leading +, country code, up to 15 digits total
  if (form.phoneNumber.trim() === '') {
    errors.phoneNumber = 'Phone number is required.';
  } else if (!/^\+?[1-9]\d{7,14}$/.test(form.phoneNumber.trim())) {
    errors.phoneNumber = 'Enter a valid phone number in international format, e.g. +60123456789.';
  }

  if (form.companyAddress.trim() === '') errors.companyAddress = 'Company address is required.';

  // business verification
  if (form.businessRegNo.trim() === '') {
    errors.businessRegNo = 'Business registration number is required.';
  } else if (!validateSsm(form.businessRegNo)) {
    errors.businessRegNo = 'Enter a valid SSM number, e.g. 202301012345 or 1234567-A.';
  }
  if (form.businessLicenseUrl.trim() === '') errors.businessLicenseUrl = 'Please upload your business registration document.';
  // taxNumber is optional, but if given it must look like a real SST number
  if (form.taxNumber.trim() !== '' && !validateSst(form.taxNumber)) {
    errors.taxNumber = 'Enter a valid SST number, e.g. W10-1808-32000001.';
  }

  const pwError = validatePassword(form.password);
  if (pwError) errors.password = pwError;

  if (form.confirm === '') {
    errors.confirm = 'Please confirm your password.';
  } else if (form.password !== form.confirm) {
    errors.confirm = 'Passwords do not match.';
  }

  return errors;
}

// Set or clear a single field's error on an errors object (mutates it),
// reusing the same rules as the full-form validation.
function applyFieldError(errors, name, form) {
  const msg = validateForm(form)[name];
  if (msg) errors[name] = msg;
  else delete errors[name];
}

function RegisterPage() {
  const [form, setForm] = useState({
    companyName: '', username: '', email: '', phoneNumber: '',
    companyAddress: '', operationalAddress: '', password: '', confirm: '',
    businessRegNo: '', taxNumber: '', businessLicenseUrl: '',
  });
  // until the supplier types in the username box, it auto-follows the company
  // name (Instagram-style). usernameStatus drives the live availability hint.
  const [usernameEdited, setUsernameEdited] = useState(false);
  // the operational (pickup) address mirrors the business address until the
  // supplier edits it — same "follow until touched" idea as the username.
  const [operationalEdited, setOperationalEdited] = useState(false);
  const [usernameStatus, setUsernameStatus] = useState({ state: 'idle', suggestion: '' });
  const [errors, setErrors] = useState({});       // per-field messages
  const [formError, setFormError] = useState(''); // general/server fallback
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [done, setDone] = useState(false);        // show the "pending approval" screen
  const [shown, setShown] = useState({ password: false, confirm: false }); // show/hide toggles
  const [licenseName, setLicenseName] = useState('');   // uploaded document filename
  const [uploadingDoc, setUploadingDoc] = useState(false);

  // ── email verification (step 2) ──
  // The form no longer registers directly: first we email a 6-digit code, then
  // the supplier enters it here and the account is only then created.
  const [step, setStep] = useState('form');        // 'form' → 'verify'
  const [code, setCode] = useState('');            // the 6 digits typed in
  const [codeError, setCodeError] = useState('');  // error shown on the verify screen
  const [resendInfo, setResendInfo] = useState(''); // "a new code has been sent"
  const [verifying, setVerifying] = useState(false);
  const [resending, setResending] = useState(false);
  const [resendIn, setResendIn] = useState(0);     // resend cooldown countdown (s)

  // tick the resend cooldown down to zero
  useEffect(() => {
    if (resendIn <= 0) return undefined;
    const t = setTimeout(() => setResendIn((n) => n - 1), 1000);
    return () => clearTimeout(t);
  }, [resendIn]);

  async function handleLicenseFile(event) {
    const file = event.target.files[0];
    event.target.value = '';              // let the same file be re-picked later
    if (!file) return;
    setUploadingDoc(true);
    setErrors((prev) => { const next = { ...prev }; delete next.businessLicenseUrl; return next; });
    try {
      const { url } = await uploadRegistrationDoc(file);
      setForm((f) => ({ ...f, businessLicenseUrl: url }));
      setLicenseName(file.name);
    } catch (err) {
      setErrors((prev) => ({ ...prev, businessLicenseUrl: err.message }));
    } finally {
      setUploadingDoc(false);
    }
  }
  function removeLicense() {
    setForm((f) => ({ ...f, businessLicenseUrl: '' }));
    setLicenseName('');
  }

  function toggleShown(name) {
    setShown((prev) => ({ ...prev, [name]: !prev[name] }));
  }

  // update the changed field; if it (or the linked confirm field) is already
  // showing an error, re-check it live so the message updates as you fix it
  function handleChange(event) {
    const { name, value } = event.target;
    const nextForm = { ...form, [name]: value };
    // while untouched, the username mirrors a slug of the company name
    if (name === 'companyName' && !usernameEdited) {
      nextForm.username = usernameSlug(value);
    }
    // while untouched, the operational address mirrors the business address
    // verbatim (no slug — it's a real address)
    if (name === 'companyAddress' && !operationalEdited) {
      nextForm.operationalAddress = value;
    }
    setForm(nextForm);

    setErrors((prev) => {
      const next = { ...prev };
      if (name in prev) applyFieldError(next, name, nextForm);
      // password & confirm are linked — keep the confirm error in sync
      if (name === 'password' && 'confirm' in prev) applyFieldError(next, 'confirm', nextForm);
      // auto-filling the username from the company name must also refresh its
      // error, so a stale "Username is required" clears once a value flows in
      if (name === 'companyName' && !usernameEdited && 'username' in next) {
        applyFieldError(next, 'username', nextForm);
      }
      return next;
    });
  }

  // validate a single field when the user leaves it (real-time, on blur)
  function handleBlur(event) {
    const { name } = event.target;
    setErrors((prev) => {
      const next = { ...prev };
      applyFieldError(next, name, form);
      return next;
    });
  }

  // typing in the username box detaches it from the company name
  function handleUsernameChange(event) {
    const value = event.target.value;
    setUsernameEdited(true);
    setForm((f) => ({ ...f, username: value }));
    setErrors((prev) => { const next = { ...prev }; delete next.username; return next; });
  }

  function applySuggestion(name) {
    setUsernameEdited(true);
    setForm((f) => ({ ...f, username: name }));
    setErrors((prev) => { const next = { ...prev }; delete next.username; return next; });
  }

  // typing in the operational-address box detaches it from the business address
  function handleOperationalChange(event) {
    setOperationalEdited(true);
    setForm((f) => ({ ...f, operationalAddress: event.target.value }));
  }
  // clearing it re-attaches to the business address (mirrors it again)
  function clearOperational() {
    setOperationalEdited(false);
    setForm((f) => ({ ...f, operationalAddress: f.companyAddress }));
  }

  // clear a field via its ✕ button (mirrors handleChange's live re-validation)
  function clearField(name) {
    const nextForm = { ...form, [name]: '' };
    if (name === 'companyName' && !usernameEdited) nextForm.username = '';
    if (name === 'companyAddress' && !operationalEdited) nextForm.operationalAddress = '';
    setForm(nextForm);
    setErrors((prev) => {
      const next = { ...prev };
      if (name in prev) applyFieldError(next, name, nextForm);
      return next;
    });
  }

  // live availability check (debounced) against the API as the username changes
  useEffect(() => {
    const u = form.username.trim();
    if (u === '') { setUsernameStatus({ state: 'idle', suggestion: '' }); return; }
    if (!USERNAME_RE.test(u)) { setUsernameStatus({ state: 'invalid', suggestion: '' }); return; }
    setUsernameStatus({ state: 'checking', suggestion: '' });
    const timer = setTimeout(async () => {
      try {
        const res = await checkUsername(u);
        if (res.available) setUsernameStatus({ state: 'available', suggestion: '' });
        else setUsernameStatus({ state: 'taken', suggestion: res.suggestion || '' });
      } catch {
        setUsernameStatus({ state: 'idle', suggestion: '' });   // network hiccup → don't block
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [form.username]);

  // everything the register endpoint needs (not the confirm field, no code)
  function buildPayload() {
    return {
      username: form.username.trim(),
      email: form.email.trim(),
      phoneNumber: form.phoneNumber.trim(),
      companyName: form.companyName.trim(),
      companyAddress: form.companyAddress.trim(),
      operationalAddress: form.operationalAddress.trim(),
      businessRegNo: form.businessRegNo.trim(),
      businessLicenseUrl: form.businessLicenseUrl,
      taxNumber: form.taxNumber.trim(),
      password: form.password,
    };
  }

  // Step 1 → validate the whole form, then email a verification code and move
  // to the verify screen. The account is NOT created yet.
  async function handleSubmit(event) {
    event.preventDefault();   // AJAX submit — no page reload
    setFormError('');

    const found = validateForm(form);
    // the live check already knows this handle is taken — surface it as an error
    if (usernameStatus.state === 'taken') {
      found.username = 'That username is already taken.';
    }
    if (Object.keys(found).length > 0) {
      setErrors(found);
      return;
    }
    setErrors({});

    setIsSubmitting(true);
    try {
      await sendRegisterCode(form.email.trim());
      setCode('');
      setCodeError('');
      setResendInfo('');
      setStep('verify');
      setResendIn(60);   // mirror the backend's 60s resend cooldown
    } catch (err) {
      // an already-registered email is the only field-specific error here
      const msg = err.message || 'Something went wrong. Please try again.';
      if (/email/i.test(msg)) setErrors({ email: msg });
      else setFormError(msg);
    } finally {
      setIsSubmitting(false);
    }
  }

  // Step 2 → submit the code together with the form; the backend verifies the
  // code and only then creates the Pending account.
  async function handleVerify(event) {
    event.preventDefault();
    setCodeError('');
    if (!/^\d{6}$/.test(code.trim())) {
      setCodeError('Enter the 6-digit code from your email.');
      return;
    }
    setVerifying(true);
    try {
      await register({ ...buildPayload(), verificationCode: code.trim() });
      setDone(true);   // success → show pending-approval message
    } catch (err) {
      const msg = err.message || 'Something went wrong. Please try again.';
      // a form-level clash (someone took the username/email since step 1) sends
      // them back to fix it; everything else is a code problem shown in place
      if (/username/i.test(msg)) {
        setErrors({ username: msg });
        setStep('form');
      } else if (/already registered/i.test(msg)) {
        setErrors({ email: msg });
        setStep('form');
      } else {
        setCodeError(msg);
      }
    } finally {
      setVerifying(false);
    }
  }

  // Resend a fresh code (respecting the cooldown).
  async function handleResend() {
    if (resendIn > 0 || resending) return;
    setCodeError('');
    setResendInfo('');
    setResending(true);
    try {
      await sendRegisterCode(form.email.trim());
      setResendIn(60);
      setResendInfo('A new code has been sent to your email.');
    } catch (err) {
      setCodeError(err.message || 'Could not resend the code. Please try again.');
    } finally {
      setResending(false);
    }
  }

  // after a successful registration, the account is Pending — they can't log
  // in yet, so show a clear "wait for approval" message instead of the form.
  if (done) {
    return (
      <div className="container py-5 text-center" style={{ maxWidth: '480px' }}>
        <h1 className="mb-3">✅ Registration submitted</h1>
        <p className="text-muted">
          Your supplier account is <strong>pending admin approval</strong>. You'll be
          able to log in once an admin approves it.
        </p>
        <Link to="/login" className="btn btn-primary mt-2">Back to Login</Link>
      </div>
    );
  }

  // step 2: the supplier entered valid details and we emailed a 6-digit code.
  // The account is created only when they enter that code here.
  if (step === 'verify') {
    return (
      <div className="container py-5" style={{ maxWidth: '480px' }}>
        <BackButton onClick={() => { setStep('form'); setCodeError(''); setResendInfo(''); }} />
        <h1 className="mb-3 text-center">📧 Verify your email</h1>
        <form onSubmit={handleVerify} className="card card-body shadow-sm" noValidate>
          <p className="text-muted">
            We've sent a 6-digit code to <strong>{form.email.trim()}</strong> (if it can be
            registered). Enter it below to finish creating your account. Already have an
            account? <Link to="/login">Log in</Link>.
          </p>
          {codeError && <div className="alert alert-danger py-2">{codeError}</div>}
          {resendInfo && <div className="alert alert-success py-2">{resendInfo}</div>}

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
            {verifying ? 'Verifying…' : 'Verify & complete registration'}
          </button>

          <button type="button" className="btn btn-outline-secondary w-100 mt-2 text-center"
            onClick={handleResend} disabled={resendIn > 0 || resending}>
            {resending ? 'Sending…' : resendIn > 0 ? `Resend code (${resendIn}s)` : 'Resend code'}
          </button>
        </form>
      </div>
    );
  }

  // small helper so every field renders the same way (input + inline error)
  function field(name, label, type = 'text') {
    return (
      <div className="mb-3">
        <label className="form-label">{label}</label>
        <ClearableInput
          type={type}
          name={name}
          className={errors[name] ? 'is-invalid' : ''}
          value={form[name]}
          onChange={handleChange}
          onBlur={handleBlur}
          onClear={() => clearField(name)}
        />
        {errors[name] && <div className="invalid-feedback d-block">{errors[name]}</div>}
      </div>
    );
  }

  // operational (pickup) address — mirrors the business address until edited,
  // the same "follow until touched" pattern as the username field.
  function operationalAddressField() {
    return (
      <div className="mb-3">
        <label className="form-label">Operational (pickup) address</label>
        <ClearableInput
          type="text"
          name="operationalAddress"
          maxLength="255"
          value={form.operationalAddress}
          onChange={handleOperationalChange}
          onClear={clearOperational}
        />
        <div className="form-text">
          {operationalEdited
            ? 'Where couriers collect your orders. Clear it to use your business address again.'
            : 'Auto-filled from your business address — change it if you ship from elsewhere.'}
        </div>
      </div>
    );
  }

  // username field with an Instagram-style live availability hint underneath
  function usernameField() {
    const s = usernameStatus.state;
    const invalid = !!errors.username || s === 'taken' || s === 'invalid';
    const valid = !errors.username && s === 'available';
    return (
      <div className="mb-3">
        <label className="form-label">Username</label>
        <ClearableInput
          type="text"
          name="username"
          maxLength="20"
          autoComplete="username"
          className={invalid ? 'is-invalid' : valid ? 'is-valid' : ''}
          placeholder="username"
          value={form.username}
          onChange={handleUsernameChange}
          onBlur={handleBlur}
          onClear={() => { setUsernameEdited(false); setForm((f) => ({ ...f, username: '' })); setErrors((p) => { const n = { ...p }; delete n.username; return n; }); }}
        />
        {errors.username && <div className="invalid-feedback d-block">{errors.username}</div>}
        {!errors.username && (
          <div className="form-text">
            {s === 'idle' && 'Auto-filled from your company name — you can change it.'}
            {s === 'checking' && <span className="text-muted">Checking availability…</span>}
            {s === 'invalid' && <span className="text-danger">3–20 letters, numbers or underscores.</span>}
            {s === 'available' && <span className="text-success">✓ {form.username.trim()} is available</span>}
            {s === 'taken' && (
              <span className="text-danger">
                {form.username.trim()} is taken.
                {usernameStatus.suggestion && (
                  <>
                    {' '}Try{' '}
                    <button type="button" className="btn btn-link btn-sm p-0 align-baseline"
                      onClick={() => applySuggestion(usernameStatus.suggestion)}>
                      {usernameStatus.suggestion}
                    </button>
                  </>
                )}
              </span>
            )}
          </div>
        )}
      </div>
    );
  }

  // business document upload (replaces the file input with a badge once done)
  function licenseField() {
    return (
      <div className="mb-3">
        <label className="form-label">Business registration document</label>
        {form.businessLicenseUrl ? (
          <div className="d-flex align-items-center gap-2">
            <span className="badge text-bg-success text-truncate" style={{ minWidth: 0 }} title={licenseName || 'Document uploaded'}>📄 {licenseName || 'Document uploaded'}</span>
            <button type="button" className="btn btn-outline-danger btn-sm flex-shrink-0" onClick={removeLicense}>Remove</button>
          </div>
        ) : (
          <input type="file" accept=".pdf,image/png,image/jpeg,image/webp"
            className={`form-control ${errors.businessLicenseUrl ? 'is-invalid' : ''}`}
            onChange={handleLicenseFile} disabled={uploadingDoc} />
        )}
        {uploadingDoc && <div className="form-text">Uploading…</div>}
        {errors.businessLicenseUrl && <div className="invalid-feedback d-block">{errors.businessLicenseUrl}</div>}
        <div className="form-text">PDF or image (JPG/PNG), up to 10&nbsp;MB — e.g. your SSM certificate.</div>
      </div>
    );
  }

  // password fields get our own Show/Hide toggle (the browser's native reveal
  // icon is inconsistent and clashes with the validation icon). has-validation
  // lets Bootstrap show the inline error correctly inside an input-group.
  function passwordField(name, label) {
    const isShown = shown[name];
    return (
      <div className="mb-3">
        <label className="form-label">{label}</label>
        <div className="input-group has-validation">
          <input
            type={isShown ? 'text' : 'password'}
            name={name}
            className={`form-control ${errors[name] ? 'is-invalid' : ''}`}
            value={form[name]}
            onChange={handleChange}
            onBlur={handleBlur}
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
          {errors[name] && <div className="invalid-feedback">{errors[name]}</div>}
        </div>
      </div>
    );
  }

  return (
    <div className="container py-5" style={{ maxWidth: '540px' }}>
      <BackButton to="/login" />
      <h1 className="mb-4 text-center">👟 Supplier Registration</h1>
      <form onSubmit={handleSubmit} className="card card-body shadow-sm text-start" noValidate>
        {formError && <div className="alert alert-danger py-2">{formError}</div>}

        <h6 className="text-muted text-uppercase small fw-bold">Company</h6>
        {field('companyName', 'Company name')}
        {field('companyAddress', 'Business address')}
        {operationalAddressField()}

        <hr className="my-3" />
        <h6 className="text-muted text-uppercase small fw-bold">Business verification</h6>
        {field('businessRegNo', 'Business registration no. (SSM)')}
        {field('taxNumber', 'Tax / SST number (optional)')}
        {licenseField()}

        <hr className="my-3" />
        <h6 className="text-muted text-uppercase small fw-bold">Account login</h6>
        {usernameField()}
        {field('email', 'Email', 'email')}
        {field('phoneNumber', 'Phone number', 'tel')}
        {passwordField('password', 'Password')}
        {passwordField('confirm', 'Confirm password')}

        <button type="submit" className="btn btn-primary w-100 text-center" disabled={isSubmitting || uploadingDoc}>
          {isSubmitting ? 'Sending code...' : 'Continue'}
        </button>
      </form>
      <p className="text-center mt-3">
        Already have an account? <Link to="/login">Login</Link>
      </p>
    </div>
  );
}

export default RegisterPage;
