import { useEffect, useState } from 'react';
import {
  getBusinessDetails, updateCompanyAddress, updateOperationalAddress,
  submitBusinessChangeRequest, uploadRegistrationDoc,
} from '../auth/authService';
import ClearableInput from '../../components/ClearableInput';

const SSM_RE = /^(\d{12}|\d{6,8}-?[A-Za-z])$/;
const SST_RE = /^[A-Za-z0-9][A-Za-z0-9-]{6,18}[A-Za-z0-9]$/;
const EMPTY_REQ = { companyName: '', businessRegNo: '', taxNumber: '', businessLicenseUrl: '' };

// Supplier-only card on the profile page. Company address is editable freely;
// the verified fields (company name, SSM, SST, document) can only be CHANGED by
// submitting a request that an admin re-approves — the account stays Active.
function BusinessDetailsCard({ onToast }) {
  const [data, setData] = useState(null);        // { current, latestRequest }
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // free address edit (company / registered address)
  const [addrEditing, setAddrEditing] = useState(false);
  const [addr, setAddr] = useState('');
  const [addrError, setAddrError] = useState('');
  const [addrSaving, setAddrSaving] = useState(false);

  // free address edit (operational / pickup address)
  const [opEditing, setOpEditing] = useState(false);
  const [opAddr, setOpAddr] = useState('');
  const [opError, setOpError] = useState('');
  const [opSaving, setOpSaving] = useState(false);

  // change request form (verified fields)
  const [reqOpen, setReqOpen] = useState(false);
  const [req, setReq] = useState(EMPTY_REQ);
  const [reqErrors, setReqErrors] = useState({});
  const [reqSubmitting, setReqSubmitting] = useState(false);
  const [licenseName, setLicenseName] = useState('');
  const [uploadingDoc, setUploadingDoc] = useState(false);

  function load() {
    setLoading(true);
    getBusinessDetails()
      .then(setData)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }
  useEffect(() => { load(); }, []);

  if (loading) return <div className="card mt-4"><div className="card-body text-muted">Loading business details…</div></div>;
  if (!data?.current) {
    return <div className="card mt-4"><div className="card-body">
      <div className="alert alert-danger py-2 mb-0">{error || 'Could not load business details.'}</div>
    </div></div>;
  }

  const cur = data.current;
  const last = data.latestRequest;
  const pending = last && last.requestStatus === 'Pending';

  // ── company address (free edit) ───────────────────────────────────
  function startAddr() { setAddr(cur.companyAddress || ''); setAddrError(''); setAddrEditing(true); }
  async function saveAddr(e) {
    e.preventDefault();
    if (!addr.trim()) { setAddrError('Company address is required.'); return; }
    if (addr.trim() === (cur.companyAddress || '')) { setAddrEditing(false); return; }
    setAddrSaving(true);
    try {
      const saved = await updateCompanyAddress(addr.trim());
      setData((d) => ({ ...d, current: { ...d.current, ...saved } }));
      setAddrEditing(false);
      onToast?.('Company address updated.');
    } catch (err) {
      setAddrError(err.message);
    } finally {
      setAddrSaving(false);
    }
  }

  // ── operational (pickup) address (free edit) ──────────────────────
  function startOp() { setOpAddr(cur.operationalAddress || cur.companyAddress || ''); setOpError(''); setOpEditing(true); }
  async function saveOp(e) {
    e.preventDefault();
    if (!opAddr.trim()) { setOpError('Operational address is required.'); return; }
    if (opAddr.trim() === (cur.operationalAddress || '')) { setOpEditing(false); return; }
    setOpSaving(true);
    try {
      const saved = await updateOperationalAddress(opAddr.trim());
      setData((d) => ({ ...d, current: { ...d.current, ...saved } }));
      setOpEditing(false);
      onToast?.('Operational address updated.');
    } catch (err) {
      setOpError(err.message);
    } finally {
      setOpSaving(false);
    }
  }

  // ── change request (verified fields) ──────────────────────────────
  function openRequest() {
    setReq({
      companyName: cur.companyName || '',
      businessRegNo: cur.businessRegNo || '',
      taxNumber: cur.taxNumber || '',
      businessLicenseUrl: cur.businessLicenseUrl || '',
    });
    setLicenseName(cur.businessLicenseUrl ? 'Current document' : '');
    setReqErrors({});
    setReqOpen(true);
  }
  function setReqField(name, value) {
    setReq((r) => ({ ...r, [name]: value }));
    setReqErrors((er) => { if (!er[name]) return er; const n = { ...er }; delete n[name]; return n; });
  }
  async function handleDoc(event) {
    const file = event.target.files[0];
    event.target.value = '';
    if (!file) return;
    setUploadingDoc(true);
    setReqErrors((er) => { const n = { ...er }; delete n.businessLicenseUrl; return n; });
    try {
      const { url } = await uploadRegistrationDoc(file);
      setReq((r) => ({ ...r, businessLicenseUrl: url }));
      setLicenseName(file.name);
    } catch (err) {
      setReqErrors((er) => ({ ...er, businessLicenseUrl: err.message }));
    } finally {
      setUploadingDoc(false);
    }
  }
  function validateReq() {
    const e = {};
    if (!req.companyName.trim()) e.companyName = 'Company name is required.';
    if (!req.businessRegNo.trim()) e.businessRegNo = 'SSM number is required.';
    else if (!SSM_RE.test(req.businessRegNo.trim())) e.businessRegNo = 'Enter a valid SSM number, e.g. 202301012345 or 1234567-A.';
    if (req.taxNumber.trim() && !SST_RE.test(req.taxNumber.trim())) e.taxNumber = 'Enter a valid SST number, e.g. W10-1808-32000001.';
    if (!req.businessLicenseUrl) e.businessLicenseUrl = 'Please upload your business registration document.';
    return e;
  }
  // has anything actually changed vs the current verified values?
  const reqDirty = reqOpen && (
    req.companyName.trim() !== (cur.companyName || '') ||
    req.businessRegNo.trim() !== (cur.businessRegNo || '') ||
    req.taxNumber.trim() !== (cur.taxNumber || '') ||
    req.businessLicenseUrl !== (cur.businessLicenseUrl || '')
  );

  async function submitReq(e) {
    e.preventDefault();
    const errs = validateReq();
    if (Object.keys(errs).length) { setReqErrors(errs); return; }
    if (!reqDirty) { setReqErrors({ companyName: 'Change at least one detail before submitting.' }); return; }
    setReqSubmitting(true);
    try {
      await submitBusinessChangeRequest({
        companyName: req.companyName.trim(),
        businessRegNo: req.businessRegNo.trim(),
        taxNumber: req.taxNumber.trim(),
        businessLicenseUrl: req.businessLicenseUrl,
      });
      setReqOpen(false);
      onToast?.('Changes submitted for admin review.');
      load();                       // refresh to show the pending banner
    } catch (err) {
      setReqErrors({ companyName: err.message });
    } finally {
      setReqSubmitting(false);
    }
  }

  return (
    <div className="card mt-4">
      <div className="card-body">
        <div className="d-flex justify-content-between align-items-start">
          <div>
            <h5 className="mb-0">Business details</h5>
            <small className="text-muted">Your verified company identity. Changes are reviewed by an admin.</small>
          </div>
          {!pending && !reqOpen && (
            <button className="btn btn-outline-primary" onClick={openRequest}>Request changes</button>
          )}
        </div>

        {/* pending banner */}
        {pending && (
          <div className="alert alert-warning mt-3 mb-0">
            <div className="fw-semibold">⏳ Changes pending admin review</div>
            <div className="small mt-1">Your account stays active while we review these proposed changes:</div>
            <ul className="small mb-0 mt-1">
              {last.companyName !== cur.companyName && <li>Company name → <strong>{last.companyName}</strong></li>}
              {last.businessRegNo !== cur.businessRegNo && <li>SSM no. → <strong>{last.businessRegNo}</strong></li>}
              {(last.taxNumber || '') !== (cur.taxNumber || '') && <li>SST no. → <strong>{last.taxNumber || '—'}</strong></li>}
              {last.businessLicenseUrl !== cur.businessLicenseUrl && <li>New registration document uploaded</li>}
            </ul>
          </div>
        )}

        {/* last request was rejected — show why */}
        {!pending && last && last.requestStatus === 'Rejected' && last.reviewNote && (
          <div className="alert alert-danger mt-3 mb-0">
            <span className="fw-semibold">Your last change request was rejected:</span> {last.reviewNote}
          </div>
        )}

        {/* current verified values */}
        <dl className="row mb-0 mt-3">
          <dt className="col-sm-4">Company name</dt>
          <dd className="col-sm-8">{cur.companyName}</dd>
          <dt className="col-sm-4">SSM reg. no.</dt>
          <dd className="col-sm-8">{cur.businessRegNo || <span className="text-muted">—</span>}</dd>
          <dt className="col-sm-4">SST / tax no.</dt>
          <dd className="col-sm-8">{cur.taxNumber || <span className="text-muted">—</span>}</dd>
          <dt className="col-sm-4">Registration doc</dt>
          <dd className="col-sm-8">
            {cur.businessLicenseUrl
              ? <a href={cur.businessLicenseUrl} target="_blank" rel="noreferrer">📄 View document</a>
              : <span className="text-muted">—</span>}
          </dd>

          {/* business / registered address — free edit */}
          <dt className="col-sm-4">Business address</dt>
          <dd className="col-sm-8">
            {addrEditing ? (
              <form onSubmit={saveAddr} className="d-flex flex-column gap-2">
                <ClearableInput type="text" maxLength="255"
                  className={addrError ? 'is-invalid' : ''}
                  value={addr}
                  onChange={(e) => { setAddr(e.target.value); if (addrError) setAddrError(''); }}
                  onClear={() => setAddr('')} />
                {addrError && <div className="invalid-feedback d-block">{addrError}</div>}
                <div className="d-flex gap-2">
                  <button type="submit" className="btn btn-primary btn-sm" disabled={addrSaving}>
                    {addrSaving ? 'Saving…' : 'Save'}
                  </button>
                  <button type="button" className="btn btn-outline-secondary btn-sm"
                    onClick={() => setAddrEditing(false)} disabled={addrSaving}>Cancel</button>
                </div>
              </form>
            ) : (
              <div className="d-flex justify-content-between align-items-start gap-2">
                <span>{cur.companyAddress || <span className="text-muted">—</span>}</span>
                <button className="btn btn-link btn-sm p-0" onClick={startAddr}>Edit</button>
              </div>
            )}
          </dd>

          {/* operational / pickup address — free edit */}
          <dt className="col-sm-4">Operational (pickup) address</dt>
          <dd className="col-sm-8">
            {opEditing ? (
              <form onSubmit={saveOp} className="d-flex flex-column gap-2">
                <ClearableInput type="text" maxLength="255"
                  className={opError ? 'is-invalid' : ''}
                  value={opAddr}
                  onChange={(e) => { setOpAddr(e.target.value); if (opError) setOpError(''); }}
                  onClear={() => setOpAddr('')} />
                {opError && <div className="invalid-feedback d-block">{opError}</div>}
                <div className="d-flex gap-2">
                  <button type="submit" className="btn btn-primary btn-sm" disabled={opSaving}>
                    {opSaving ? 'Saving…' : 'Save'}
                  </button>
                  <button type="button" className="btn btn-outline-secondary btn-sm"
                    onClick={() => setOpEditing(false)} disabled={opSaving}>Cancel</button>
                </div>
              </form>
            ) : (
              <div className="d-flex justify-content-between align-items-start gap-2">
                <span>
                  {cur.operationalAddress || cur.companyAddress || <span className="text-muted">—</span>}
                  <div className="text-muted small">Where couriers collect your orders.</div>
                </span>
                <button className="btn btn-link btn-sm p-0" onClick={startOp}>Edit</button>
              </div>
            )}
          </dd>
        </dl>

        {/* change request form */}
        {reqOpen && (
          <form onSubmit={submitReq} className="border-top mt-3 pt-3">
            <h6 className="fw-semibold">Request changes to verified details</h6>
            <p className="text-muted small">
              These changes need admin re-approval. Your account keeps working while we review.
            </p>
            <div className="mb-3">
              <label className="form-label">Company name</label>
              <ClearableInput type="text" maxLength="150"
                className={reqErrors.companyName ? 'is-invalid' : ''}
                value={req.companyName}
                onChange={(e) => setReqField('companyName', e.target.value)}
                onClear={() => setReqField('companyName', '')} />
              {reqErrors.companyName && <div className="invalid-feedback d-block">{reqErrors.companyName}</div>}
            </div>
            <div className="mb-3">
              <label className="form-label">Business registration no. (SSM)</label>
              <ClearableInput type="text" maxLength="50"
                className={reqErrors.businessRegNo ? 'is-invalid' : ''}
                value={req.businessRegNo}
                onChange={(e) => setReqField('businessRegNo', e.target.value)}
                onClear={() => setReqField('businessRegNo', '')} />
              {reqErrors.businessRegNo && <div className="invalid-feedback d-block">{reqErrors.businessRegNo}</div>}
            </div>
            <div className="mb-3">
              <label className="form-label">Tax / SST number (optional)</label>
              <ClearableInput type="text" maxLength="50"
                className={reqErrors.taxNumber ? 'is-invalid' : ''}
                value={req.taxNumber}
                onChange={(e) => setReqField('taxNumber', e.target.value)}
                onClear={() => setReqField('taxNumber', '')} />
              {reqErrors.taxNumber && <div className="invalid-feedback d-block">{reqErrors.taxNumber}</div>}
            </div>
            <div className="mb-3">
              <label className="form-label">Business registration document</label>
              {req.businessLicenseUrl ? (
                <div className="d-flex align-items-center gap-2">
                  <span className="badge text-bg-success text-truncate" style={{ minWidth: 0 }} title={licenseName || 'Document uploaded'}>📄 {licenseName || 'Document uploaded'}</span>
                  <button type="button" className="btn btn-outline-danger btn-sm flex-shrink-0"
                    onClick={() => { setReq((r) => ({ ...r, businessLicenseUrl: '' })); setLicenseName(''); }}>
                    Replace
                  </button>
                </div>
              ) : (
                <input type="file" accept=".pdf,image/png,image/jpeg,image/webp"
                  className={`form-control ${reqErrors.businessLicenseUrl ? 'is-invalid' : ''}`}
                  onChange={handleDoc} disabled={uploadingDoc} />
              )}
              {uploadingDoc && <div className="form-text">Uploading…</div>}
              {reqErrors.businessLicenseUrl && <div className="invalid-feedback d-block">{reqErrors.businessLicenseUrl}</div>}
            </div>
            <div className="d-flex gap-2">
              <button type="submit" className="btn btn-primary" disabled={reqSubmitting || uploadingDoc}>
                {reqSubmitting ? 'Submitting…' : 'Submit for review'}
              </button>
              <button type="button" className="btn btn-outline-secondary"
                onClick={() => setReqOpen(false)} disabled={reqSubmitting}>Cancel</button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

export default BusinessDetailsCard;
