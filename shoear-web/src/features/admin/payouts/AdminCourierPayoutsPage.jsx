import { useEffect, useMemo, useState } from 'react';
import { getCourierPayouts, payCourier, getCourierPayoutHistory, remindCourierPayout, getCourierFee, setCourierFee } from '../adminService';
import SortableTh from '../../../components/SortableTh';
import Toast from '../../../components/Toast';
import ConfirmDialog from '../../../components/ConfirmDialog';
import Pagination from '../../../components/Pagination';
import ClearableInput from '../../../components/ClearableInput';
import { useTableSort } from '../../../hooks/useTableSort';
import { usePagination } from '../../../hooks/usePagination';

const PAGE_SIZE = 10;

// Courier payouts — each active courier's accrued per-delivery earnings, with a
// one-click Stripe payout of their pending balance. A courier must have finished
// connecting their Stripe payout account before they can be paid.
function AdminCourierPayoutsPage() {
  const [couriers, setCouriers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busyId, setBusyId] = useState('');
  const [historyFor, setHistoryFor] = useState(null); // courier whose history modal is open (null = closed)
  const [history, setHistory] = useState({});         // { [deliveryPersonnelId]: payouts[] | 'loading' } cache

  // in-house courier fee configuration (the flat per-delivery fee)
  const [courierFee, setCourierFeeState] = useState(null);   // { current, active, default, history }
  const [newFee, setNewFee] = useState('');
  const [savingFee, setSavingFee] = useState(false);
  const [confirmFee, setConfirmFee] = useState(false);

  function load() {
    setLoading(true);
    Promise.all([getCourierPayouts(), getCourierFee()])
      .then(([data, fee]) => {
        setCouriers(data.couriers);
        setCourierFeeState(fee);
        if (fee?.active != null) setNewFee(String(Number(fee.active)));
      })
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

  const activeFee = courierFee?.active != null ? Number(courierFee.active) : null;
  const feeIsConfigDefault = !courierFee?.current;   // no DB row yet → showing config default
  const feeError = (() => {
    if (newFee === '') return '';
    const n = Number(newFee);
    if (Number.isNaN(n)) return 'Enter a number.';
    if (n < 0 || n > 1000) return 'Fee must be between 0 and 1000.';
    return '';
  })();

  async function applyFee() {
    setSavingFee(true);
    setError('');
    try {
      await setCourierFee(Number(newFee));
      setNotice(`In-house courier fee set to ${fmt(Number(newFee))} per delivery.`);
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSavingFee(false);
    }
  }

  async function openHistory(courier) {
    setHistoryFor(courier);
    const courierId = courier.deliveryPersonnelId;
    if (!history[courierId]) {
      setHistory((h) => ({ ...h, [courierId]: 'loading' }));
      try {
        const data = await getCourierPayoutHistory(courierId);
        setHistory((h) => ({ ...h, [courierId]: data.payouts || [] }));
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

  // search by courier name or email, then paginate the sorted+filtered list
  const [search, setSearch] = useState('');
  const q = search.trim().toLowerCase();
  const filtered = useMemo(
    () => (q ? sort.sorted.filter((c) => `${c.fullName || ''} ${c.email || ''}`.toLowerCase().includes(q)) : sort.sorted),
    [sort.sorted, q]);
  const { page, setPage, totalPages, pageItems } = usePagination(filtered, PAGE_SIZE, q);

  return (
    <div className="container py-4">
      <h1 className="mb-1">💸 Courier Payouts</h1>
      <p className="text-muted">
        Couriers earn a flat fee per delivered parcel. Pay out their accrued balance via Stripe.
      </p>

      {/* success confirmations are transient → toast (errors stay inline below) */}
      <Toast message={notice} onClose={() => setNotice('')} />
      {error && <div className="alert alert-danger py-2">{error}</div>}

      {/* in-house courier fee configuration */}
      {!loading && (
        <div className="card mb-4">
          <div className="card-header bg-white fw-semibold">In-house courier fee</div>
          <div className="card-body">
            <div className="row g-3 align-items-end">
              <div className="col-auto">
                <div className="text-muted small text-uppercase">Current fee</div>
                <div className="fs-3 fw-bold text-success">
                  {activeFee != null ? fmt(activeFee) : <span className="text-muted fs-5">none set</span>}
                  <span className="fs-6 fw-normal text-muted"> / delivery</span>
                </div>
                {feeIsConfigDefault && activeFee != null && (
                  <div className="text-muted small">default — not yet set in-app</div>
                )}
              </div>
              <div className="col-sm-4">
                <label className="form-label small text-muted mb-1">New fee (RM per delivery)</label>
                <input type="number" min="0" max="1000" step="0.01" placeholder="e.g. 5.00"
                  className={'form-control' + (feeError ? ' is-invalid' : '')}
                  value={newFee} onChange={(e) => setNewFee(e.target.value)} />
                {feeError && <div className="invalid-feedback">{feeError}</div>}
              </div>
              <div className="col-auto">
                <button className="btn btn-primary"
                  disabled={savingFee || newFee === '' || !!feeError || (Number(newFee) === activeFee && !feeIsConfigDefault)}
                  onClick={() => setConfirmFee(true)}>
                  {savingFee ? 'Saving…' : 'Update fee'}
                </button>
              </div>
            </div>
            <p className="text-muted small mb-0 mt-2">
              Charged per completed in-house delivery — paid to the courier (their per-delivery
              earning) and recovered from the supplier. The fee is snapshotted on each delivery, so
              changing it never rewrites past earnings. The previous fee is kept as history.
            </p>

            {courierFee?.history?.length > 0 && (
              <>
                <hr />
                <h6 className="text-muted">Fee history</h6>
                <table className="table table-sm w-auto mb-0">
                  <thead>
                    <tr>
                      <th style={{ width: 110 }}>Fee</th>
                      <th style={{ width: 180 }}>Effective</th>
                      <th style={{ width: 100 }}>Status</th>
                      <th>Set by</th>
                    </tr>
                  </thead>
                  <tbody>
                    {courierFee.history.map((h) => (
                      <tr key={h.courierFeeId}>
                        <td className="fw-semibold">{fmt(h.feeValue)}</td>
                        <td>{new Date(h.effectiveDate).toLocaleDateString()}</td>
                        <td>
                          <span className={`badge text-bg-${h.feeStatus === 'Active' ? 'success' : 'secondary'}`}>
                            {h.feeStatus}
                          </span>
                        </td>
                        <td>{h.setBy || <span className="text-muted">—</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
          </div>
        </div>
      )}

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
        <>
        <div className="row g-2 mb-3">
          <div className="col-md-5">
            <ClearableInput type="text" placeholder="Search courier or email"
              value={search} onChange={(e) => setSearch(e.target.value)} onClear={() => setSearch('')} />
          </div>
        </div>
        {filtered.length === 0 ? (
          <div className="card card-body text-center text-muted">No couriers match your search.</div>
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
              {pageItems.map((c) => {
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
                        onClick={() => openHistory(c)}
                      >
                        History
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
              })}
            </tbody>
          </table>
          <Pagination page={page} totalPages={totalPages} onChange={setPage}
            summary={`Page ${page} of ${totalPages} · ${filtered.length} courier${filtered.length === 1 ? '' : 's'}`} />
        </div>
        )}
        </>
      )}

      {/* payout history (modal — keeps the table clean as history grows) */}
      {historyFor && (() => {
        const h = history[historyFor.deliveryPersonnelId];
        return (
          <div className="modal show d-block" tabIndex="-1" style={{ background: 'rgba(0,0,0,.5)' }}
            onClick={() => setHistoryFor(null)}>
            <div className="modal-dialog modal-lg modal-dialog-scrollable" onClick={(e) => e.stopPropagation()}>
              <div className="modal-content">
                <div className="modal-header">
                  <h5 className="modal-title">Payout history — {historyFor.fullName}</h5>
                  <button type="button" className="btn-close" onClick={() => setHistoryFor(null)}></button>
                </div>
                <div className="modal-body">
                  {h === 'loading' || !h ? (
                    <p className="text-muted mb-0">Loading…</p>
                  ) : h.length === 0 ? (
                    <p className="text-muted mb-0">No payouts yet.</p>
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
                <div className="modal-footer">
                  <button type="button" className="btn btn-secondary" onClick={() => setHistoryFor(null)}>Close</button>
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      <ConfirmDialog
        isOpen={confirmFee}
        title="Update in-house courier fee?"
        message={`Set the in-house courier fee to ${fmt(Number(newFee || 0))} per delivery? It applies to deliveries completed from now on.`}
        confirmText="Update"
        confirmColor="primary"
        onCancel={() => setConfirmFee(false)}
        onConfirm={() => { setConfirmFee(false); applyFee(); }}
      />
    </div>
  );
}

export default AdminCourierPayoutsPage;
