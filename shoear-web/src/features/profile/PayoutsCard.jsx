import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { getPayoutStatus, startStripeOnboarding, openStripeDashboard } from '../supplier/payouts/payoutService';

// Supplier payouts, shown as a card in the profile. A supplier connects a Stripe
// Connect account (Stripe collects + verifies their bank account and identity —
// we never see or store raw bank details) and their sales income is paid there.
// Returning from Stripe-hosted onboarding is a full page load back to
// /profile?done=1, which this card picks up to refresh the status.
function PayoutsCard() {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [working, setWorking] = useState(false);
  const [params, setParams] = useSearchParams();

  useEffect(() => {
    let active = true;
    const cameBack = !!(params.get('done') || params.get('refresh'));
    getPayoutStatus()
      .then((data) => {
        if (!active) return;
        setStatus(data);
        if (cameBack && data.configured && !data.payoutsEnabled) {
          setNotice('Payout setup not detected yet — finish the Stripe steps first.');
        }
      })
      .catch((err) => { if (active) setError(err.message); })
      .finally(() => {
        if (!active) return;
        setLoading(false);
        if (cameBack) setParams({}, { replace: true });
      });
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function connect() {
    setWorking(true);
    setError('');
    try {
      const { url } = await startStripeOnboarding();
      window.location.href = url;        // hand off to Stripe-hosted onboarding
    } catch (err) {
      setError(err.message);
      setWorking(false);
    }
  }

  // Re-poll Stripe (verification can finish a moment after submitting).
  async function recheck() {
    setWorking(true);
    setError('');
    setNotice('');
    try {
      const data = await getPayoutStatus();
      setStatus(data);
      if (data.configured && !data.payoutsEnabled) {
        setNotice('Stripe still hasn’t enabled payouts — see the details below.');
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setWorking(false);
    }
  }

  // Human-friendly label for a Stripe requirement key.
  const reqLabel = (k) => ({
    'individual.verification.document': 'Identity document (upload an ID)',
    'individual.id_number': 'ID / IC number',
    'individual.verification.additional_document': 'Additional ID document',
    'external_account': 'Bank account',
    'business_profile.url': 'Business website',
    'business_profile.mcc': 'Industry',
    'tos_acceptance.date': 'Accept Stripe’s terms',
  }[k] || k);

  // Open the Stripe Express dashboard so the supplier can change their bank.
  async function manage() {
    setWorking(true);
    setError('');
    try {
      const { url } = await openStripeDashboard();
      window.location.href = url;
    } catch (err) {
      setError(err.message);
      setWorking(false);
    }
  }

  return (
    <div className="card mt-4">
      <div className="card-body">
        <h5 className="mb-0">Payouts</h5>
        <small className="text-muted">Connect a Stripe account to receive your sales income.</small>

        {error && (
          <div className="alert alert-danger py-2 mt-3 d-flex justify-content-between align-items-center">
            <span>{error}</span>
            <button type="button" className="btn-close" onClick={() => setError('')}></button>
          </div>
        )}
        {notice && (
          <div className="alert alert-warning py-2 mt-3 d-flex justify-content-between align-items-center">
            <span>{notice}</span>
            <button type="button" className="btn-close" onClick={() => setNotice('')}></button>
          </div>
        )}

        {loading ? (
          <p className="text-muted mb-0 mt-3">Loading…</p>
        ) : !status?.configured ? (
          <div className="mt-3">
            <p className="text-muted mb-0">
              Stripe isn't configured on this environment. Once it's set up you'll be able to
              connect your account here to receive payouts.
            </p>
          </div>
        ) : status.payoutsEnabled ? (
          <div className="mt-3">
            <p className="text-success fw-semibold mb-1">✅ Payouts enabled</p>
            <p className="text-muted">
              Your Stripe account is verified and ready to receive payouts. Sales
              income is paid into the bank account on file.
            </p>
            <button className="btn btn-outline-secondary btn-sm" onClick={manage} disabled={working}>
              {working ? 'Opening Stripe…' : 'Manage bank account on Stripe ↗'}
            </button>
            <div className="form-text">Opens your Stripe dashboard — sign in with your Stripe account to update your bank details.</div>
          </div>
        ) : status.connected ? (
          <div className="mt-3">
            {status.detailsSubmitted && !(status.requirementsDue?.length) ? (
              <>
                <p className="fw-semibold mb-2">⏳ Submitted — under review</p>
                <p className="text-muted mb-2">
                  You've completed onboarding and Stripe is verifying your details. Payouts
                  activate automatically once verified — this can take a moment (and in test
                  mode some account types stay pending). Tap “Check again” to refresh.
                </p>
              </>
            ) : (
              <>
                <p className="fw-semibold mb-1">⏳ A few details still needed</p>
                <p className="text-muted mb-1">Stripe needs a bit more before payouts can be enabled:</p>
                {status.requirementsDue?.length > 0 && (
                  <ul className="small text-muted">
                    {status.requirementsDue.map((k) => <li key={k}>{reqLabel(k)}</li>)}
                  </ul>
                )}
              </>
            )}
            {status.disabledReason && (
              <p className="small text-muted mb-2">Stripe status: {status.disabledReason}</p>
            )}
            <div className="d-flex gap-2">
              <button className="btn btn-primary" onClick={connect} disabled={working}>
                {working ? 'Opening Stripe…' : 'Continue onboarding'}
              </button>
              <button className="btn btn-outline-secondary" onClick={recheck} disabled={working}>
                Check again
              </button>
            </div>
          </div>
        ) : (
          <div className="mt-3">
            <p className="text-muted">
              You'll be taken to Stripe to securely add your bank account and verify your identity.
              We never see or store your bank details.
            </p>
            <button className="btn btn-primary" onClick={connect} disabled={working}>
              {working ? 'Opening Stripe…' : 'Connect with Stripe'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default PayoutsCard;
