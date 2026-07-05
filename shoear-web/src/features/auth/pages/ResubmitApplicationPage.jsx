import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getMyApplication, resubmitApplication, uploadRegistrationDoc } from '../authService';
import { useAuth } from '../AuthContext';
import ClearableInput from '../../../components/ClearableInput';
import AddressFields from '../../../components/AddressFields';
import { emptyAddress, validateAddress } from '../../../components/addressUtils';

// Shown to a supplier whose registration was rejected (a curable rejection).
// They see why it was rejected, fix the flagged details on a prefilled form,
// and resubmit — which sends the application back to Pending for re-review.
// A Pending account (already resubmitted / awaiting first review) just sees a
// "waiting" message; Active accounts are bounced to their dashboard.
function ResubmitApplicationPage() {
  const navigate = useNavigate();
  const { user, logout, updateUser } = useAuth();

  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState('');
  const [reason, setReason] = useState('');
  const [readonly, setReadonly] = useState({ email: '' });
  const [form, setForm] = useState({
    companyName: '', phoneNumber: '',
    businessRegNo: '', taxNumber: '', businessLicenseUrl: '',
  });
  const [company, setCompany] = useState(emptyAddress());        // structured business address
  const [companyErrors, setCompanyErrors] = useState({});
  const [operational, setOperational] = useState(emptyAddress()); // structured pickup address
  const [operationalErrors, setOperationalErrors] = useState({});
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [uploadingDoc, setUploadingDoc] = useState(false);
  const [licenseName, setLicenseName] = useState('');
  const [doneStatus, setDoneStatus] = useState(''); // set after a successful resubmit

  // load the supplier's own application to prefill the form
  useEffect(() => {
    let active = true;
    getMyApplication()
      .then((a) => {
        if (!active) return;
        setStatus(a.status);
        setReason(a.rejectionReason || '');
        setReadonly({ email: a.email });
        setForm({
          companyName: a.companyName || '',
          phoneNumber: a.phoneNumber || '',
          businessRegNo: a.businessRegNo || '',
          taxNumber: a.taxNumber || '',
          businessLicenseUrl: a.businessLicenseUrl || '',
        });
        setCompany({
          line1: a.companyLine1 || '',
          postcode: a.companyPostcode || '',
          city: a.companyCity || '',
          state: a.companyState || '',
        });
        setOperational({
          line1: a.operationalLine1 || '',
          postcode: a.operationalPostcode || '',
          city: a.operationalCity || '',
          state: a.operationalState || '',
        });
        if (a.businessLicenseUrl) setLicenseName('Current document');
        if (a.status === 'Active') navigate('/products', { replace: true });
      })
      .catch((err) => { if (active) setFormError(err.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function validate(f) {
    const e = {};
    if (f.companyName.trim() === '') e.companyName = 'Company name is required.';
    if (f.phoneNumber.trim() === '') e.phoneNumber = 'Phone number is required.';
    else if (!/^(0\d{8,10}|\+?60\d{8,10})$/.test(f.phoneNumber.trim())) {
      e.phoneNumber = 'Enter a valid Malaysian phone number, e.g. 0123456789.';
    }
    if (f.businessRegNo.trim() === '') {
      e.businessRegNo = 'Business registration number is required.';
    } else if (!/^(\d{12}|\d{6,8}-?[A-Za-z])$/.test(f.businessRegNo.trim())) {
      e.businessRegNo = 'Enter a valid SSM number, e.g. 202301012345 or 1234567-A.';
    }
    if (f.businessLicenseUrl.trim() === '') e.businessLicenseUrl = 'Please upload your business registration document.';
    // SST number is optional, but if given it must look like a real one
    if (f.taxNumber.trim() !== '' && !/^[A-Za-z0-9][A-Za-z0-9-]{6,18}[A-Za-z0-9]$/.test(f.taxNumber.trim())) {
      e.taxNumber = 'Enter a valid SST number, e.g. W10-1808-32000001.';
    }
    return e;
  }

  function handleChange(event) {
    const { name, value } = event.target;
    setForm((f) => ({ ...f, [name]: value }));
    setFormError('');
    setErrors((prev) => (name in prev ? { ...prev, [name]: undefined } : prev));
  }

  // clear a field via its ✕ button
  function clearField(name) {
    setForm((f) => ({ ...f, [name]: '' }));
    setFormError('');
    setErrors((prev) => (name in prev ? { ...prev, [name]: undefined } : prev));
  }

  async function handleLicenseFile(event) {
    const file = event.target.files[0];
    event.target.value = '';
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

  async function handleSubmit(event) {
    event.preventDefault();
    setFormError('');
    const found = validate(form);
    const cleaned = Object.fromEntries(Object.entries(found).filter(([, v]) => v));
    const coFound = validateAddress(company);
    const opFound = validateAddress(operational);
    if (Object.keys(cleaned).length > 0 || Object.keys(coFound).length > 0 || Object.keys(opFound).length > 0) {
      setErrors(cleaned);
      setCompanyErrors(coFound);
      setOperationalErrors(opFound);
      return;
    }

    setSubmitting(true);
    try {
      const res = await resubmitApplication({
        companyName: form.companyName.trim(),
        companyLine1: company.line1.trim(),
        companyPostcode: company.postcode.trim(),
        companyCity: company.city.trim(),
        companyState: company.state,
        operationalLine1: operational.line1.trim(),
        operationalPostcode: operational.postcode.trim(),
        operationalCity: operational.city.trim(),
        operationalState: operational.state,
        phoneNumber: form.phoneNumber.trim(),
        businessRegNo: form.businessRegNo.trim(),
        taxNumber: form.taxNumber.trim(),
        businessLicenseUrl: form.businessLicenseUrl,
      });
      // keep the cached session in sync so nav/redirects reflect Pending
      updateUser({ status: res.status, fullName: form.companyName.trim() });
      setDoneStatus(res.status);
    } catch (err) {
      setFormError(err.message || 'Could not resubmit. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  function handleLogout() {
    logout();
    navigate('/login');
  }

  if (loading) {
    return <div className="container py-5 text-center text-muted">Loading…</div>;
  }

  // after a successful resubmit, or if the account is already awaiting review
  const awaiting = doneStatus === 'Pending' || (!doneStatus && status === 'Pending');
  if (awaiting) {
    return (
      <div className="container py-5 text-center" style={{ maxWidth: 520 }}>
        <h1 className="mb-3">⏳ Awaiting review</h1>
        <p className="text-muted">
          Your application has been submitted and is <strong>pending admin approval</strong>.
          You'll be able to access your dashboard once an admin approves it.
        </p>
        <button className="btn btn-outline-secondary mt-2" onClick={handleLogout}>Log out</button>
      </div>
    );
  }

  return (
    <div className="container py-5" style={{ maxWidth: 560 }}>
      <h1 className="mb-3">📝 Fix &amp; resubmit</h1>
      <p className="text-muted">
        Hi {user?.fullName}. Your supplier registration was rejected — update the details
        below and resubmit for review. Your previous information has been kept, so you only
        need to correct what's wrong.
      </p>

      {reason && (
        <div className="alert alert-warning">
          <strong>Reason for rejection:</strong> {reason}
        </div>
      )}
      {formError && <div className="alert alert-danger py-2">{formError}</div>}

      <form onSubmit={handleSubmit} className="card card-body shadow-sm text-start" noValidate>
        <h6 className="text-muted text-uppercase small fw-bold">Account (cannot be changed)</h6>
        <div className="mb-3">
          <label className="form-label">Email</label>
          <input className="form-control" value={readonly.email} disabled />
        </div>

        <hr className="my-3" />
        <h6 className="text-muted text-uppercase small fw-bold">Company</h6>
        {field('companyName', 'Company name')}
        <div className="mb-3">
          <label className="form-label">Business address</label>
          <AddressFields value={company} idPrefix="co"
            onChange={(next) => {
              setCompany(next);
              setCompanyErrors((prev) => (Object.keys(prev).length ? validateAddress(next) : prev));
            }}
            errors={companyErrors} />
        </div>
        <div className="mb-3">
          <label className="form-label">Operational (pickup) address</label>
          <AddressFields value={operational} idPrefix="op"
            onChange={(next) => {
              setOperational(next);
              setOperationalErrors((prev) => (Object.keys(prev).length ? validateAddress(next) : prev));
            }}
            errors={operationalErrors} />
        </div>
        {field('phoneNumber', 'Phone number', 'tel')}

        <hr className="my-3" />
        <h6 className="text-muted text-uppercase small fw-bold">Business verification</h6>
        {field('businessRegNo', 'Business registration no. (SSM)')}
        {field('taxNumber', 'Tax / SST number (optional)')}

        <div className="mb-3">
          <label className="form-label">Business registration document</label>
          {form.businessLicenseUrl ? (
            <div className="d-flex align-items-center gap-2 flex-wrap">
              <span className="badge text-bg-success text-truncate" style={{ minWidth: 0 }} title={licenseName || 'Document uploaded'}>📄 {licenseName || 'Document uploaded'}</span>
              <a href={form.businessLicenseUrl} target="_blank" rel="noreferrer"
                className="btn btn-outline-secondary btn-sm flex-shrink-0">Preview</a>
              <button type="button" className="btn btn-outline-danger btn-sm flex-shrink-0"
                onClick={() => { setForm((f) => ({ ...f, businessLicenseUrl: '' })); setLicenseName(''); }}>
                Replace
              </button>
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

        <button type="submit" className="btn btn-primary w-100" disabled={submitting || uploadingDoc}>
          {submitting ? 'Resubmitting…' : 'Resubmit for review'}
        </button>
      </form>
    </div>
  );

  // small helper so every text field renders the same way (input + inline error)
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
          onClear={() => clearField(name)}
        />
        {errors[name] && <div className="invalid-feedback d-block">{errors[name]}</div>}
      </div>
    );
  }
}

export default ResubmitApplicationPage;
