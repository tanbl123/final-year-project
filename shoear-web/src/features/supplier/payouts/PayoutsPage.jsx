import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { getPayoutStatus, startStripeOnboarding, openStripeDashboard } from './payoutService';

function PayoutsPage() {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [working, setWorking] = useState(false);
  const [params, setParams] = useSearchParams();

  // fetch status on mount. Returning from Stripe-hosted onboarding is a full
  // page load back to /payouts?done=1, so this also picks up the new status;
  // we just tidy the query string away afterwards.
  useEffect(() => {
    let active = true;
    getPayoutStatus()
      .then((data) => { if (active) setStatus(data); })
      .catch((err) => { if (active) setError(err.message); })
      .finally(() => {
        if (!active) return;
        setLoading(false);
        if (params.get('done') || params.get('refresh')) setParams({}, { replace: true });
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
    <div className="container py-4 text-start" style={{ maxWidth: 640 }}>
      <h1 className="mb-1">💳 Payouts</h1>
      <p className="text-muted">Connect a Stripe account to receive your sales income.</p>

      {error && (
        <div className="alert alert-danger py-2 d-flex justify-content-between align-items-center">
          <span>{error}</span>
          <button type="button" className="btn-close" onClick={() => setError('')}></button>
        </div>
      )}

      {loading ? (
        <p className="text-muted">Loading…</p>
      ) : !status?.configured ? (
        <div className="card card-body">
          <h5>Payouts not available yet</h5>
          <p className="text-muted mb-0">
            Stripe isn't configured on this environment. Once it's set up you'll be able to
            connect your account here to receive payouts.
          </p>
        </div>
      ) : status.payoutsEnabled ? (
        <div className="card card-body border-success">
          <h5 className="text-success mb-1">✅ Payouts enabled</h5>
          <p className="text-muted">
            Your Stripe account is verified and ready to receive payouts. Sales
            income is paid into the bank account on file.
          </p>
          <div>
            <button className="btn btn-outline-secondary btn-sm" onClick={manage} disabled={working}>
              {working ? 'Opening Stripe…' : 'Manage / change bank account'}
            </button>
          </div>
        </div>
      ) : status.connected ? (
        <div className="card card-body border-warning">
          <h5 className="mb-1">⏳ Onboarding incomplete</h5>
          <p className="text-muted">
            You've started connecting Stripe but a few details are still pending verification.
            Continue where you left off to enable payouts.
          </p>
          <button className="btn btn-primary" onClick={connect} disabled={working}>
            {working ? 'Opening Stripe…' : 'Continue onboarding'}
          </button>
        </div>
      ) : (
        <div className="card card-body">
          <h5 className="mb-1">Connect your payout account</h5>
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
  );
}

export default PayoutsPage;
