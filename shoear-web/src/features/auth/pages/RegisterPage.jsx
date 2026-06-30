import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { register, sendRegisterCode, uploadRegistrationDoc } from '../authService';
import EyeIcon from '../../../components/EyeIcon';
import ClearableInput from '../../../components/ClearableInput';
import BackButton from '../../../components/BackButton';
import AddressFields from '../../../components/AddressFields';
import { emptyAddress, validateAddress } from '../../../components/addressUtils';

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

  if (form.email.trim() === '') {
    errors.email = 'Email is required.';
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) {
    errors.email = 'Please enter a valid email.';
  }

  // E.164: optional leading +, country code, up to 15 digits total
  if (form.phoneNumber.trim() === '') {
    errors.phoneNumber = 'Phone number is required.';
  } else if (!/^(0\d{8,10}|\+?60\d{8,10})$/.test(form.phoneNumber.trim())) {
    errors.phoneNumber = 'Enter a valid Malaysian phone number, e.g. 0123456789.';
  }

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
    companyName: '', email: '', phoneNumber: '',
    password: '', confirm: '',
    businessRegNo: '', taxNumber: '', businessLicenseUrl: '',
  });
  // structured business (registered/SSM) address
  const [company, setCompany] = useState(emptyAddress());
  const [companyErrors, setCompanyErrors] = useState({});
  // structured operational (pickup) address — drives delivery routing, so it's
  // collected as proper Malaysian address parts (its own required block).
  const [operational, setOperational] = useState(emptyAddress());
  const [opErrors, setOpErrors] = useState({});    // operational-address field errors
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

  // update the changed field and validate it live (on every keystroke), so the
  // error appears/updates as you type. Empty fields aren't nagged here — the
  // full required check runs on submit.
  function handleChange(event) {
    const { name, value } = event.target;
    const nextForm = { ...form, [name]: value };
    setForm(nextForm);

    setErrors((prev) => {
      const next = { ...prev };
      // validate the changed field live, but don't show "required" while the
      // field is still empty (mid-typing) — submit handles the empty case
      if (value.trim() !== '') applyFieldError(next, name, nextForm);
      else delete next[name];
      // password & confirm are linked — re-check confirm once it has content
      if (name === 'password' && nextForm.confirm !== '') applyFieldError(next, 'confirm', nextForm);
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

  // update the structured operational address and clear any of its errors live
  function handleOperationalChange(next) {
    setOperational(next);
    setOpErrors((prev) => (Object.keys(prev).length ? validateAddress(next) : prev));
  }

  // same, for the structured business (registered) address
  function handleCompanyChange(next) {
    setCompany(next);
    setCompanyErrors((prev) => (Object.keys(prev).length ? validateAddress(next) : prev));
  }

  // clear a field via its ✕ button (mirrors handleChange's live re-validation)
  function clearField(name) {
    const nextForm = { ...form, [name]: '' };
    setForm(nextForm);
    setErrors((prev) => {
      const next = { ...prev };
      if (name in prev) applyFieldError(next, name, nextForm);
      return next;
    });
  }

  // everything the register endpoint needs (not the confirm field, no code)
  function buildPayload() {
    return {
      email: form.email.trim(),
      phoneNumber: form.phoneNumber.trim(),
      companyName: form.companyName.trim(),
      companyLine1: company.line1.trim(),
      companyPostcode: company.postcode.trim(),
      companyCity: company.city.trim(),
      companyState: company.state,
      operationalLine1: operational.line1.trim(),
      operationalPostcode: operational.postcode.trim(),
      operationalCity: operational.city.trim(),
      operationalState: operational.state,
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
    const coFound = validateAddress(company);
    const opFound = validateAddress(operational);
    if (Object.keys(found).length > 0 || Object.keys(coFound).length > 0 || Object.keys(opFound).length > 0) {
      setErrors(found);
      setCompanyErrors(coFound);
      setOpErrors(opFound);
      return;
    }
    setErrors({});
    setCompanyErrors({});
    setOpErrors({});

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
      // a form-level clash (e.g. email taken since step 1) sends them back to fix it
      if (/already registered/i.test(msg)) {
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

  // business document upload (replaces the file input with a badge once done)
  function licenseField() {
    return (
      <div className="mb-3">
        <label className="form-label">Business registration document</label>
        {form.businessLicenseUrl ? (
          <div className="d-flex align-items-center gap-2 flex-wrap">
            <span className="badge text-bg-success text-truncate" style={{ minWidth: 0 }} title={licenseName || 'Document uploaded'}>📄 {licenseName || 'Document uploaded'}</span>
            <a href={form.businessLicenseUrl} target="_blank" rel="noreferrer"
              className="btn btn-outline-secondary btn-sm flex-shrink-0">Preview</a>
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

        <div className="mb-1 mt-2">
          <label className="form-label mb-1">Business address</label>
          <div className="form-text mt-0 mb-2">Your registered business address (matches your SSM document).</div>
          <AddressFields value={company} onChange={handleCompanyChange}
            errors={companyErrors} idPrefix="co" />
        </div>

        <div className="mb-1 mt-3">
          <label className="form-label mb-1">Operational (pickup) address</label>
          <div className="form-text mt-0 mb-2">
            Where couriers collect your orders. The state decides whether an order ships
            with our in-house courier (same state) or via standard shipping.
          </div>
          <AddressFields value={operational} onChange={handleOperationalChange}
            errors={opErrors} idPrefix="op" />
        </div>

        <hr className="my-3" />
        <h6 className="text-muted text-uppercase small fw-bold">Business verification</h6>
        {field('businessRegNo', 'Business registration no. (SSM)')}
        {field('taxNumber', 'Tax / SST number (optional)')}
        {licenseField()}

        <hr className="my-3" />
        <h6 className="text-muted text-uppercase small fw-bold">Account login</h6>
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
