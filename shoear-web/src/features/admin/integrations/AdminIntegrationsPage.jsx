import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { getEasyParcelStatus, getEasyParcelAuthorizeUrl, disconnectEasyParcel } from './easyparcelService';
import Toast from '../../../components/Toast';
import ConfirmDialog from '../../../components/ConfirmDialog';

// Friendly one-liners for the ?easyparcel=… result the OAuth callback bounces
// the browser back with after the consent screen.
const CALLBACK_MESSAGES = {
  connected: { variant: 'success', text: 'EasyParcel connected. Standard parcels can now be auto-booked.' },
  denied:    { variant: 'danger',  text: 'Connection cancelled — you did not approve access on EasyParcel.' },
  badstate:  { variant: 'danger',  text: 'Connection expired or was tampered with. Please click Connect again.' },
  failed:    { variant: 'danger',  text: 'Could not complete the connection. Check the app credentials and try again.' },
};

const fmtDate = (s) => (s ? new Date(s.replace(' ', 'T')).toLocaleDateString('en-MY', {
  day: 'numeric', month: 'short', year: 'numeric',
}) : '—');

function AdminIntegrationsPage() {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [toast, setToast] = useState(null);          // { variant, text }
  const [connecting, setConnecting] = useState(false);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [params, setParams] = useSearchParams();

  function load() {
    setLoading(true);
    getEasyParcelStatus()
      .then(setStatus)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    // surface the OAuth callback result, then strip the query param so a refresh
    // doesn't re-toast it
    const result = params.get('easyparcel');
    if (result && CALLBACK_MESSAGES[result]) {
      setToast(CALLBACK_MESSAGES[result]);
      params.delete('easyparcel');
      setParams(params, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function connect() {
    setConnecting(true);
    setError('');
    try {
      const { authorizeUrl } = await getEasyParcelAuthorizeUrl();
      window.location.href = authorizeUrl;   // off to EasyParcel's consent screen
    } catch (err) {
      setError(err.message);
      setConnecting(false);
    }
  }

  async function disconnect() {
    setDisconnecting(true);
    try {
      await disconnectEasyParcel();
      setConfirmDisconnect(false);
      setToast({ variant: 'success', text: 'EasyParcel disconnected.' });
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setDisconnecting(false);
    }
  }

  return (
    <div className="container py-4 text-start">
      <h1 className="mb-1">🔌 Integrations</h1>
      <p className="text-muted">Connect the external services ShoeAR uses for shipping and logistics.</p>

      {error && (
        <div className="alert alert-danger py-2 d-flex justify-content-between align-items-center">
          <span>{error}</span>
          <button type="button" className="btn-close" onClick={() => setError('')}></button>
        </div>
      )}

      {loading ? (
        <p className="text-muted">Loading…</p>
      ) : (
        <div className="card mb-4" style={{ maxWidth: 720 }}>
          <div className="card-header bg-white d-flex align-items-center justify-content-between">
            <span className="fw-semibold">📦 EasyParcel (Malaysia)</span>
            {status?.connected ? (
              <span className="badge text-bg-success">Connected</span>
            ) : status?.configured ? (
              <span className="badge text-bg-secondary">Not connected</span>
            ) : (
              <span className="badge text-bg-warning">Not configured</span>
            )}
          </div>
          <div className="card-body">
            <p className="text-muted">
              Auto-books a carrier and tracking number for <strong>Standard</strong> (long-distance)
              parcels, so suppliers don&apos;t have to arrange the courier themselves. In-house local
              deliveries are unaffected.
            </p>

            {!status?.configured && (
              <div className="alert alert-warning py-2 mb-3">
                <div className="fw-semibold mb-1">App credentials not set</div>
                Add <code>easyparcel_client_id</code> and <code>easyparcel_client_secret</code> to
                <code> backend/config.local.php</code>, then reload this page. Get them from the
                EasyParcel Developer Hub by registering an app, and set the app&apos;s callback URL to:
                <div className="mt-2"><code>{status?.redirectUri}</code></div>
              </div>
            )}

            {status?.connected && (
              <dl className="row mb-3 small">
                <dt className="col-sm-4 text-muted fw-normal">Connected since</dt>
                <dd className="col-sm-8">{fmtDate(status.connectedAt)}</dd>
                <dt className="col-sm-4 text-muted fw-normal">Reconnect needed by</dt>
                <dd className="col-sm-8">{fmtDate(status.refreshExpiresAt)}</dd>
                {status.accountId && (
                  <>
                    <dt className="col-sm-4 text-muted fw-normal">Account</dt>
                    <dd className="col-sm-8">{status.accountId}</dd>
                  </>
                )}
              </dl>
            )}

            <div className="d-flex gap-2">
              {status?.configured && !status?.connected && (
                <button type="button" className="btn btn-primary" onClick={connect} disabled={connecting}>
                  {connecting ? 'Redirecting…' : 'Connect EasyParcel'}
                </button>
              )}
              {status?.connected && (
                <>
                  <button type="button" className="btn btn-outline-primary" onClick={connect} disabled={connecting}>
                    {connecting ? 'Redirecting…' : 'Reconnect'}
                  </button>
                  <button type="button" className="btn btn-outline-danger" onClick={() => setConfirmDisconnect(true)}>
                    Disconnect
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        isOpen={confirmDisconnect}
        title="Disconnect EasyParcel?"
        message="Suppliers will no longer be able to auto-book Standard parcels — they'll fall back to entering the carrier and tracking number manually. You can reconnect any time."
        confirmText={disconnecting ? 'Disconnecting…' : 'Disconnect'}
        confirmColor="danger"
        cancelText="Keep connected"
        onConfirm={disconnect}
        onCancel={() => setConfirmDisconnect(false)}
      />

      <Toast message={toast?.text} variant={toast?.variant} onClose={() => setToast(null)} />
    </div>
  );
}

export default AdminIntegrationsPage;
