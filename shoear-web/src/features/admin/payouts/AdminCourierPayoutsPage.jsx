import { useEffect, useState } from 'react';
import { getCourierPayouts, payCourier, getCourierPayoutHistory, remindCourierPayout } from '../adminService';
import SortableTh from '../../../components/SortableTh';
import Toast from '../../../components/Toast';
import { useTableSort } from '../../../hooks/useTableSort';

// Courier payouts — each active courier's accrued per-delivery earnings, with a
// one-click Stripe payout of their pending balance. A courier must have finished
// connecting their Stripe payout account before they can be paid.
function AdminCourierPayoutsPage() {
  const [couriers, setCouriers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busyId, setBusyId] = useState('');
  const [openId, setOpenId] = useState('');          // courier whose history is expanded
  const [history, setHistory] = useState({});        // { [deliveryPersonnelId]: payouts[] | 'loading' }

  function load() {
    setLoading(true);
    getCourierPayouts()
      .then((data) => setCouriers(data.couriers))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, []);

  async function pay(courier) {
    if (!window.confirm(`Pay ${courier.fullName} RM ${courier.pendingBalance.toFixed(2)} now?`)) return;
    setBusyId(courier.deliveryPersonnelId);
    setError('');
    try {
      const res = await payCourier(courier.deliveryPersonnelId);
      setNotice(`Paid ${courier.fullName} RM ${Number(res.amount).toFixed(2)} (${res.deliveryCount} deliveries).`);
      // drop any cached history for this courier so it reflects the new payout
      setHistory((h) => { const next = { ...h }; delete next[courier.deliveryPersonnelId]; return next; });
      if (openId === courier.deliveryPersonnelId) setOpenId('');
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId('');
    }
  }

  async function remind(courier) {
    setBusyId(courier.deliveryPersonnelId);
    setError('');
    try {
      const res = await remindCourierPayout(courier.deliveryPersonnelId);
      setNotice(res.message || `Reminder sent to ${courier.fullName}.`);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId('');
    }
  }

  const fmt = (n) => `RM ${Number(n || 0).toFixed(2)}`;
  const notSetUp = couriers.filter((c) => !(c.connected && c.payoutsEnabled));

  async function toggleHistory(courierId) {
    if (openId === courierId) { setOpenId(''); return; }
    setOpenId(courierId);
    if (!history[courierId]) {
      setHistory((h) => ({ ...h, [courierId]: 'loading' }));
      try {
        const data = await getCourierPayoutHistory(courierId);
        setHistory((h) => ({ ...h, [courierId]: data.payouts }));
      } catch (err) {
        setHistory((h) => ({ ...h, [courierId]: [] }));
        setError(err.message);
      }
    }
  }

  function statusBadge(s) {
    const cls = s === 'Paid' ? 'bg-success' : s === 'Failed' ? 'bg-danger' : 'bg-secondary';
    return <span className={`badge ${cls}`}>{s}</span>;
  }

  // Click a header to sort; default = who is owed the most first.
  const sort = useTableSort(couriers, {
    initialKey: 'pendingBalance',
    initialDir: 'desc',
    getValue: (c, k) =>
      (k === 'pendingBalance' || k === 'pendingDeliveries') ? Number(c[k]) : (c[k] ?? ''),
  });

  return (
    <div className="container py-4">
      <h1 className="mb-1">💸 Courier Payouts</h1>
      <p className="text-muted">
        Couriers earn a flat fee per delivered parcel. Pay out their accrued balance via Stripe.
      </p>

      {/* success confirmations are transient → toast (errors stay inline below) */}
      <Toast message={notice} onClose={() => setNotice('')} />
      {error && <div className="alert alert-danger py-2">{error}</div>}

      {!loading && notSetUp.length > 0 && (
        <div className="alert alert-warning py-2">
          <strong>{notSetUp.length}</strong> approved courier{notSetUp.length > 1 ? 's have' : ' has'} not
          set up a bank account yet, so they can't be paid. Use <em>Remind</em> to nudge them.
        </div>
      )}

      {loading ? (
        <p className="text-muted">Loading…</p>
      ) : couriers.length === 0 ? (
        <div className="card card-body text-center text-muted">No active couriers yet.</div>
      ) : (
        <div className="table-responsive">
          <table className="table align-middle">
            <thead>
              <tr>
                <SortableTh label="Courier" columnKey="fullName" sort={sort} />
                <SortableTh label="Payout account" columnKey="payoutsEnabled" sort={sort} />
                <SortableTh label="Pending" columnKey="pendingBalance" sort={sort} className="text-end" />
                <SortableTh label="Deliveries" columnKey="pendingDeliveries" sort={sort} className="text-end" />
                <th className="text-end">Action</th>
              </tr>
            </thead>
            <tbody>
              {sort.sorted.map((c) => {
                const ready = c.connected && c.payoutsEnabled;
                const canPay = ready && c.pendingBalance > 0;
                return (
                  <tr key={c.deliveryPersonnelId}>
                    <td>
                      <div className="fw-semibold">{c.fullName}</div>
                      <div className="text-muted small">{c.email}</div>
                    </td>
                    <td className="small">
                      {ready
                        ? <span className="text-success">✓ Connected</span>
                        : c.connected
                          ? <span className="text-warning">Onboarding incomplete</span>
                          : <span className="text-muted">Not connected</span>}
                    </td>
                    <td className="text-end fw-semibold">{fmt(c.pendingBalance)}</td>
                    <td className="text-end">{c.pendingDeliveries}</td>
                    <td className="text-end text-nowrap">
                      <button
                        className="btn btn-outline-secondary btn-sm me-2"
                        onClick={() => toggleHistory(c.deliveryPersonnelId)}
                      >
                        {openId === c.deliveryPersonnelId ? 'Hide' : 'History'}
                      </button>
                      {!ready && (
                        <button
                          className="btn btn-outline-warning btn-sm me-2"
                          disabled={busyId === c.deliveryPersonnelId}
                          title="Send a reminder to set up their bank account"
                          onClick={() => remind(c)}
                        >
                          {busyId === c.deliveryPersonnelId ? '…' : 'Remind'}
                        </button>
                      )}
                      <button
                        className="btn btn-primary btn-sm"
                        disabled={!canPay || busyId === c.deliveryPersonnelId}
                        title={!c.connected ? 'Courier must connect Stripe first'
                          : !c.payoutsEnabled ? 'Courier must finish Stripe onboarding'
                          : c.pendingBalance <= 0 ? 'Nothing to pay' : 'Pay this courier'}
                        onClick={() => pay(c)}
                      >
                        {busyId === c.deliveryPersonnelId ? '…' : 'Pay out'}
                      </button>
                    </td>
                  </tr>
                );
              }).flatMap((row, i) => {
                const c = sort.sorted[i];
                const out = [row];
                if (openId === c.deliveryPersonnelId) {
                  const h = history[c.deliveryPersonnelId];
                  out.push(
                    <tr key={`${c.deliveryPersonnelId}-history`}>
                      <td colSpan={5} className="bg-light">
                        <div className="px-2 py-1">
                          <div className="fw-semibold small mb-2">Payout history — {c.fullName}</div>
                          {h === 'loading' ? (
                            <div className="text-muted small">Loading…</div>
                          ) : !h || h.length === 0 ? (
                            <div className="text-muted small">No payouts yet.</div>
                          ) : (
                            <table className="table table-sm mb-0">
                              <thead>
                                <tr>
                                  <th>Date</th>
                                  <th className="text-end">Amount</th>
                                  <th className="text-end">Deliveries</th>
                                  <th>Type</th>
                                  <th>Status</th>
                                  <th>Stripe transfer</th>
                                </tr>
                              </thead>
                              <tbody>
                                {h.map((p) => (
                                  <tr key={p.payoutId}>
                                    <td className="small">{new Date(p.created_at).toLocaleString()}</td>
                                    <td className="text-end">{fmt(p.amount)}</td>
                                    <td className="text-end">{p.deliveryCount}</td>
                                    <td><span className="badge bg-light text-dark border">{p.isAuto ? 'Auto' : 'Manual'}</span></td>
                                    <td>{statusBadge(p.payoutStatus)}</td>
                                    <td className="small text-muted">{p.stripeTransferId || '—'}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                }
                return out;
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default AdminCourierPayoutsPage;
