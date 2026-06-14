import { useState } from 'react';
import { Link } from 'react-router-dom';
import { register, uploadRegistrationDoc } from '../authService';
import EyeIcon from '../../../components/EyeIcon';

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
  if (form.username.trim() === '') errors.username = 'Username is required.';

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
    companyAddress: '', password: '', confirm: '',
    businessRegNo: '', taxNumber: '', businessLicenseUrl: '',
  });
  const [errors, setErrors] = useState({});       // per-field messages
  const [formError, setFormError] = useState(''); // general/server fallback
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [done, setDone] = useState(false);        // show the "pending approval" screen
  const [shown, setShown] = useState({ password: false, confirm: false }); // show/hide toggles
  const [licenseName, setLicenseName] = useState('');   // uploaded document filename
  const [uploadingDoc, setUploadingDoc] = useState(false);

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
    setForm(nextForm);

    setErrors((prev) => {
      const next = { ...prev };
      if (name in prev) applyFieldError(next, name, nextForm);
      // password & confirm are linked — keep the confirm error in sync
      if (name === 'password' && 'confirm' in prev) applyFieldError(next, 'confirm', nextForm);
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
      // send everything the backend needs (not the confirm field)
      await register({
        username: form.username.trim(),
        email: form.email.trim(),
        phoneNumber: form.phoneNumber.trim(),
        companyName: form.companyName.trim(),
        companyAddress: form.companyAddress.trim(),
        businessRegNo: form.businessRegNo.trim(),
        businessLicenseUrl: form.businessLicenseUrl,
        taxNumber: form.taxNumber.trim(),
        password: form.password,
      });
      setDone(true);   // success → show pending-approval message
    } catch (err) {
      // map known duplicate errors back onto the offending field
      const msg = err.message || 'Something went wrong. Please try again.';
      if (/email/i.test(msg)) setErrors({ email: msg });
      else if (/username/i.test(msg)) setErrors({ username: msg });
      else setFormError(msg);
    } finally {
      setIsSubmitting(false);
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

  // small helper so every field renders the same way (input + inline error)
  function field(name, label, type = 'text') {
    return (
      <div className="mb-3">
        <label className="form-label">{label}</label>
        <input
          type={type}
          name={name}
          className={`form-control ${errors[name] ? 'is-invalid' : ''}`}
          value={form[name]}
          onChange={handleChange}
          onBlur={handleBlur}
        />
        {errors[name] && <div className="invalid-feedback">{errors[name]}</div>}
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
            <span className="badge text-bg-success">📄 {licenseName || 'Document uploaded'}</span>
            <button type="button" className="btn btn-outline-danger btn-sm" onClick={removeLicense}>Remove</button>
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
      <h1 className="mb-4 text-center">👟 Supplier Registration</h1>
      <form onSubmit={handleSubmit} className="card card-body shadow-sm text-start" noValidate>
        {formError && <div className="alert alert-danger py-2">{formError}</div>}

        <h6 className="text-muted text-uppercase small fw-bold">Company</h6>
        {field('companyName', 'Company name')}
        {field('companyAddress', 'Company address')}

        <hr className="my-3" />
        <h6 className="text-muted text-uppercase small fw-bold">Business verification</h6>
        {field('businessRegNo', 'Business registration no. (SSM)')}
        {field('taxNumber', 'Tax / SST number (optional)')}
        {licenseField()}

        <hr className="my-3" />
        <h6 className="text-muted text-uppercase small fw-bold">Account login</h6>
        {field('username', 'Username')}
        {field('email', 'Email', 'email')}
        {field('phoneNumber', 'Phone number', 'tel')}
        {passwordField('password', 'Password')}
        {passwordField('confirm', 'Confirm password')}

        <button type="submit" className="btn btn-primary w-100 text-center" disabled={isSubmitting || uploadingDoc}>
          {isSubmitting ? 'Registering...' : 'Register'}
        </button>
      </form>
      <p className="text-center mt-3">
        Already have an account? <Link to="/login">Login</Link>
      </p>
    </div>
  );
}

export default RegisterPage;
