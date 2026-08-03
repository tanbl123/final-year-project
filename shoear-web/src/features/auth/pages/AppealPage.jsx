import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { getAppealContext, submitAppeal } from '../appealService';

// Defined at module scope (NOT inside the component) so its identity is stable
// across renders — otherwise React remounts the subtree on every keystroke and
// the textarea loses focus after one character.
function Shell({ children }) {
  return (
    <div className="login-shell">
      <div className="login-box">
        <div className="login-brand">
          <div className="login-badge"><img src="/shoear-shoe-v2.png" alt="ShoeAR" /></div>
          <h1 className="login-title">Shoe<span style={{ color: '#4f46e5' }}>AR</span></h1>
          <p className="login-sub">Appeal a suspension</p>
        </div>
        <div className="card card-body login-card text-start">{children}</div>
      </div>
    </div>
  );
}

// Public appeal page reached from the token-secured link in a suspension email
// (/appeal?uid=…&token=…). No login (the user is suspended). Shows why they were
// suspended and lets them submit one appeal, which lands in the admin queue.
function AppealPage() {
  const [params] = useSearchParams();
  const uid = params.get('uid') || '';
  const token = params.get('token') || '';

  const [ctx, setCtx] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!uid || !token) { setLoading(false); return; }
    getAppealContext(uid, token)
      .then(setCtx)
      .catch((err) => setLoadError(err.message))
      .finally(() => setLoading(false));
  }, [uid, token]);

  async function onSubmit(e) {
    e.preventDefault();
    const trimmed = message.trim();
    if (trimmed === '') { setSubmitError('Please explain your appeal.'); return; }
    if (trimmed.length < 10) { setSubmitError('Please give a bit more detail (at least 10 characters).'); return; }
    setSubmitting(true); setSubmitError('');
    try {
      await submitAppeal(uid, token, message.trim());
      setDone(true);
    } catch (err) {
      setSubmitError(err.message || 'Could not submit your appeal.');
    } finally {
      setSubmitting(false);
    }
  }

  if (!uid || !token) {
    return <Shell><div className="alert alert-danger mb-0">This appeal link is invalid or incomplete. Please use the link from your suspension email.</div></Shell>;
  }
  if (loading) return <Shell><p className="text-muted mb-0">Loading…</p></Shell>;
  if (loadError) return <Shell><div className="alert alert-danger mb-0">{loadError}</div></Shell>;
  if (done) {
    return <Shell><div className="alert alert-success mb-0">Thanks — your appeal has been submitted. Our team will review it and email you the outcome.</div></Shell>;
  }
  if (ctx && ctx.status !== 'Suspended') {
    return <Shell><div className="alert alert-info mb-0">This account is not currently suspended, so there's nothing to appeal.</div></Shell>;
  }
  if (ctx && ctx.openAppeal) {
    return <Shell><div className="alert alert-info mb-0">You already have an appeal under review. We'll email you once it's been decided.</div></Shell>;
  }

  return (
    <Shell>
      <p className="text-muted small">
        Your account was suspended{ctx?.fullName ? `, ${ctx.fullName}` : ''}. If you believe this was a
        mistake, explain below and our team will review it.
      </p>
      {ctx?.reason && (
        <div className="mb-3 p-2 rounded bg-light">
          <div className="text-muted small text-uppercase" style={{ letterSpacing: '.03em' }}>Reason given</div>
          <div className="small">{ctx.reason}</div>
        </div>
      )}
      <form onSubmit={onSubmit} noValidate>
        {submitError && <div className="alert alert-danger py-2">{submitError}</div>}
        <label className="form-label small mb-1">Your appeal</label>
        <textarea className="form-control" rows={5} maxLength={1000}
          value={message}
          placeholder="Explain why your account should be reinstated…"
          onChange={(e) => { setMessage(e.target.value); if (submitError) setSubmitError(''); }} />
        <div className="text-muted small mt-1 text-end">{message.length}/1000</div>
        <button type="submit" className="btn btn-primary w-100 mt-3" disabled={submitting}>
          {submitting ? 'Submitting…' : 'Submit appeal'}
        </button>
      </form>
    </Shell>
  );
}

export default AppealPage;
