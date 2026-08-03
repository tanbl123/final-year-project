import { useEffect, useState } from 'react';
import { getSupplierPayouts, paySupplier, getSupplierPayoutHistory, remindSupplierPayout, adjustSupplier } from '../adminService';
import SortableTh from '../../../components/SortableTh';
import Toast from '../../../components/Toast';
import ConfirmDialog from '../../../components/ConfirmDialog';
import { useTableSort } from '../../../hooks/useTableSort';

// Supplier payouts — each active supplier's payable balance (delivered orders past
// the refund window, net of commission/SST/delivery/refunds), with a one-click
// Stripe transfer of that balance. A supplier must have finished connecting their
// Stripe payout account before they can be paid.
function AdminSupplierPayoutsPage() {
  const [suppliers, setSuppliers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busyId, setBusyId] = useState('');
  const [historyFor, setHistoryFor] = useState(null); // supplier whose history modal is open (null = closed)
  const [history, setHistory] = useState({});         // { [supplierId]: { payouts, ledger } | 'loading' } cache
  const [confirm, setConfirm] = useState(null);   // { supplier }

  // manual ledger adjustment: { supplier, direction: 'deduct'|'credit', amount, note } (null = closed)
  const [adjustForm, setAdjustForm] = useState(null);
  const [adjusting, setAdjusting] = useState(false);
  const [adjustErr, setAdjustErr] = useState('');

  function load() {
    setLoading(true);
    getSupplierPayouts()
      .then((data) => setSuppliers(data.suppliers))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, []);

  const fmt = (n) => `RM ${Number(n || 0).toFixed(2)}`;
  const notSetUp = suppliers.filter((s) => !(s.connected && s.payoutsEnabled) && s.pendingBalance > 0);

  async function pay(supplier) {
    setBusyId(supplier.supplierId);
    setError('');
    try {
      const res = await paySupplier(supplier.supplierId);
      setNotice(`Paid ${supplier.companyName} ${fmt(res.amount)} (${res.orderCount} order${res.orderCount === 1 ? '' : 's'}).`);
      setHistory((h) => { const next = { ...h }; delete next[supplier.supplierId]; return next; });
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId('');
    }
  }

  async function remind(supplier) {
    setBusyId(supplier.supplierId);
    setError('');
    try {
      const res = await remindSupplierPayout(supplier.supplierId);
      setNotice(res.message || `Reminder emailed to ${supplier.companyName}.`);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId('');
    }
  }

  async function submitAdjust(e) {
    e.preventDefault();
    const amt = Number(adjustForm.amount);
    if (!(amt > 0)) { setAdjustErr('Enter an amount greater than zero.'); return; }
    if (!adjustForm.note.trim()) { setAdjustErr('A note is required so the adjustment is audited.'); return; }
    // signed: deduct = negative (supplier owes), credit = positive (pay extra)
    const signed = adjustForm.direction === 'deduct' ? -amt : amt;
    setAdjusting(true);
    setAdjustErr('');
    try {
      const supplier = adjustForm.supplier;
      await adjustSupplier(supplier.supplierId, signed, adjustForm.note.trim());
      setNotice(`${adjustForm.direction === 'deduct' ? 'Deducted' : 'Credited'} ${fmt(amt)} ${adjustForm.direction === 'deduct' ? 'from' : 'to'} ${supplier.companyName}.`);
      setAdjustForm(null);
      // drop cached history so the new ledger entry shows on next open
      setHistory((h) => { const next = { ...h }; delete next[supplier.supplierId]; return next; });
      load();
    } catch (err) {
      setAdjustErr(err.message || 'Could not post the adjustment.');
    } finally {
      setAdjusting(false);
    }
  }

  async function openHistory(supplier) {
    setHistoryFor(supplier);
    if (!history[supplier.supplierId]) {
      setHistory((h) => ({ ...h, [supplier.supplierId]: 'loading' }));
      try {
        const data = await getSupplierPayoutHistory(supplier.supplierId);
        setHistory((h) => ({ ...h, [supplier.supplierId]: { payouts: data.payouts || [], ledger: data.ledger || [] } }));
      } catch (err) {
        setHistory((h) => ({ ...h, [supplier.supplierId]: { payouts: [], ledger: [] } }));
        setError(err.message);
      }
    }
  }

  function statusBadge(s) {
    const cls = s === 'Paid' ? 'bg-success' : s === 'Failed' ? 'bg-danger' : 'bg-secondary';
    return <span className={`badge ${cls}`}>{s}</span>;
  }

  const sort = useTableSort(suppliers, {
    initialKey: 'pendingBalance',
    initialDir: 'desc',
    getValue: (s, k) =>
      (k === 'pendingBalance' || k === 'pendingOrders' || k === 'lifetimePaid') ? Number(s[k]) : (s[k] ?? ''),
  });

  return (
    <div className="container py-4">
      <h1 className="mb-1">💰 Supplier Payouts</h1>
      <p className="text-muted">
        Suppliers are paid their net earnings (after commission, SST and delivery) once an order is
        delivered and its refund window has closed. Pay a supplier's payable balance via Stripe.
      </p>

      <Toast message={notice} onClose={() => setNotice('')} />
      {error && <div className="alert alert-danger py-2">{error}</div>}

      {!loading && notSetUp.length > 0 && (
        <div className="alert alert-warning py-2">
          <strong>{notSetUp.length}</strong> supplier{notSetUp.length > 1 ? 's have' : ' has'} a payable
          balance but {notSetUp.length > 1 ? 'have' : 'has'} not finished connecting a Stripe payout
          account, so they can't be paid yet. Use <em>Remind</em> to email them.
        </div>
      )}

      {loading ? (
        <p className="text-muted">Loading…</p>
      ) : suppliers.length === 0 ? (
        <div className="card card-body text-center text-muted">No active suppliers yet.</div>
      ) : (
        <div className="table-responsive">
          <table className="table align-middle">
            <thead>
              <tr>
                <SortableTh label="Supplier" columnKey="companyName" sort={sort} />
                <SortableTh label="Payout account" columnKey="payoutsEnabled" sort={sort} />
                <SortableTh label="Payable" columnKey="pendingBalance" sort={sort} className="text-end" />
                <SortableTh label="Orders" columnKey="pendingOrders" sort={sort} className="text-end" />
                <SortableTh label="Lifetime paid" columnKey="lifetimePaid" sort={sort} className="text-end" />
                <th className="text-end">Action</th>
              </tr>
            </thead>
            <tbody>
              {sort.sorted.map((s) => {
                const ready = s.connected && s.payoutsEnabled;
                const canPay = ready && s.pendingBalance > 0;
                return (
                  <tr key={s.supplierId}>
                    <td>
                      <div className="fw-semibold">{s.companyName}</div>
                      <div className="text-muted small">{s.email}</div>
                    </td>
                    <td className="small">
                      {ready
                        ? <span className="text-success">✓ Connected</span>
                        : s.connected
                          ? <span className="text-warning">Onboarding incomplete</span>
                          : <span className="text-muted">Not connected</span>}
                    </td>
                    <td className="text-end fw-semibold">
                      {fmt(s.pendingBalance)}
                      {!!s.adjustments && s.adjustments !== 0 && (
                        <div className={'small ' + (s.adjustments < 0 ? 'text-danger' : 'text-success')}>
                          incl. {fmt(s.adjustments)} adj.
                        </div>
                      )}
                    </td>
                    <td className="text-end">{s.pendingOrders}</td>
                    <td className="text-end text-muted">{fmt(s.lifetimePaid)}</td>
                    <td className="text-end text-nowrap">
                      <button className="btn btn-outline-secondary btn-sm me-2"
                        onClick={() => openHistory(s)}>
                        History
                      </button>
                      <button className="btn btn-outline-secondary btn-sm me-2"
                        title="Post a manual credit or deduction to this supplier's balance"
                        onClick={() => { setAdjustErr(''); setAdjustForm({ supplier: s, direction: 'deduct', amount: '', note: '' }); }}>
                        Adjust
                      </button>
                      {!ready && s.pendingBalance > 0 && (
                        <button className="btn btn-outline-warning btn-sm me-2"
                          disabled={busyId === s.supplierId}
                          title="Email the supplier to finish connecting their payout account"
                          onClick={() => remind(s)}>
                          {busyId === s.supplierId ? '…' : 'Remind'}
                        </button>
                      )}
                      <button className="btn btn-primary btn-sm"
                        disabled={!canPay || busyId === s.supplierId}
                        title={!s.connected ? 'Supplier must connect Stripe first'
                          : !s.payoutsEnabled ? 'Supplier must finish Stripe onboarding'
                          : s.pendingBalance <= 0 ? 'Nothing payable yet' : 'Pay this supplier'}
                        onClick={() => setConfirm({ supplier: s })}>
                        {busyId === s.supplierId ? '…' : 'Pay out'}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* payout history (modal — keeps the table clean as history grows) */}
      {historyFor && (() => {
        const h = history[historyFor.supplierId];
        return (
          <div className="modal show d-block" tabIndex="-1" style={{ background: 'rgba(0,0,0,.5)' }}
            onClick={() => setHistoryFor(null)}>
            <div className="modal-dialog modal-lg modal-dialog-scrollable" onClick={(e) => e.stopPropagation()}>
              <div className="modal-content">
                <div className="modal-header">
                  <h5 className="modal-title">Payout history — {historyFor.companyName}</h5>
                  <button type="button" className="btn-close" onClick={() => setHistoryFor(null)}></button>
                </div>
                <div className="modal-body">
                  {h === 'loading' || !h ? (
                    <p className="text-muted mb-0">Loading…</p>
                  ) : (
                    <>
                      <div className="fw-semibold small mb-2">Payouts</div>
                      {!h.payouts || h.payouts.length === 0 ? (
                        <div className="text-muted small mb-0">No payouts yet.</div>
                      ) : (
                        <table className="table table-sm mb-0">
                          <thead>
                            <tr>
                              <th>Date</th>
                              <th className="text-end">Amount</th>
                              <th className="text-end">Orders</th>
                              <th>Type</th>
                              <th>Status</th>
                              <th>Stripe transfer</th>
                            </tr>
                          </thead>
                          <tbody>
                            {h.payouts.map((p) => (
                              <tr key={p.stripeTransferId || p.created_at}>
                                <td className="small">{new Date(p.created_at).toLocaleString()}</td>
                                <td className="text-end">{fmt(p.amount)}</td>
                                <td className="text-end">{p.orderCount}</td>
                                <td><span className="badge bg-light text-dark border">{p.isAuto ? 'Auto' : 'Manual'}</span></td>
                                <td>{statusBadge(p.payoutStatus)}</td>
                                <td className="small text-muted">{p.stripeTransferId || '—'}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}

                      {h.ledger && h.ledger.length > 0 && (
                        <>
                          <div className="fw-semibold small mt-4 mb-2">Adjustments &amp; clawbacks</div>
                          <table className="table table-sm mb-0">
                            <thead>
                              <tr>
                                <th>Date</th>
                                <th className="text-end">Amount</th>
                                <th>Type</th>
                                <th>Note</th>
                                <th>Settled</th>
                              </tr>
                            </thead>
                            <tbody>
                              {h.ledger.map((l) => (
                                <tr key={l.ledgerId}>
                                  <td className="small">{new Date(l.created_at).toLocaleString()}</td>
                                  <td className={'text-end fw-semibold ' + (l.amount < 0 ? 'text-danger' : 'text-success')}>
                                    {l.amount < 0 ? '−' : '+'}{fmt(Math.abs(l.amount))}
                                  </td>
                                  <td>
                                    <span className="badge bg-light text-dark border">
                                      {l.entryType === 'RefundClawback' ? 'Refund clawback' : 'Adjustment'}
                                    </span>
                                  </td>
                                  <td className="small">{l.note || '—'}{l.orderId ? <span className="text-muted"> ({l.orderId})</span> : null}</td>
                                  <td className="small">
                                    {l.settled
                                      ? <span className="text-muted">✓ settled</span>
                                      : <span className="text-warning">pending</span>}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </>
                      )}
                    </>
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

      {/* manual balance adjustment */}
      {adjustForm && (
        <div className="modal show d-block" tabIndex="-1" style={{ background: 'rgba(0,0,0,.5)' }}
          onClick={() => !adjusting && setAdjustForm(null)}>
          <div className="modal-dialog" onClick={(e) => e.stopPropagation()}>
            <form className="modal-content" onSubmit={submitAdjust} noValidate>
              <div className="modal-header">
                <h5 className="modal-title">Adjust balance — {adjustForm.supplier.companyName}</h5>
                <button type="button" className="btn-close" onClick={() => setAdjustForm(null)} disabled={adjusting}></button>
              </div>
              <div className="modal-body">
                <p className="text-muted small">
                  Post a manual credit or deduction that nets against this supplier's next payout — for
                  anything the automatic order/refund math doesn't cover (a penalty, a goodwill credit,
                  a reimbursement, or correcting an over/underpayment). It's recorded in the ledger with
                  your note.
                </p>
                {adjustErr && <div className="alert alert-danger py-2">{adjustErr}</div>}

                <div className="mb-2">
                  <label className="form-label small mb-1">Direction</label>
                  <select className="form-select" value={adjustForm.direction} disabled={adjusting}
                    onChange={(e) => setAdjustForm((f) => ({ ...f, direction: e.target.value }))}>
                    <option value="deduct">Deduct — supplier owes (−)</option>
                    <option value="credit">Credit — pay extra (+)</option>
                  </select>
                </div>
                <div className="mb-2">
                  <label className="form-label small mb-1">Amount (RM)</label>
                  <input type="number" min="0.01" step="0.01" className="form-control" placeholder="e.g. 50.00"
                    value={adjustForm.amount} disabled={adjusting}
                    onChange={(e) => setAdjustForm((f) => ({ ...f, amount: e.target.value }))} />
                </div>
                <div className="mb-2">
                  <label className="form-label small mb-1">Note (required — shown in the ledger)</label>
                  <input type="text" maxLength={255} className="form-control" placeholder="e.g. Late-shipping penalty — ORD0042"
                    value={adjustForm.note} disabled={adjusting}
                    onChange={(e) => setAdjustForm((f) => ({ ...f, note: e.target.value }))} />
                </div>

                {Number(adjustForm.amount) > 0 && (
                  <div className="small text-muted">
                    Balance {fmt(adjustForm.supplier.pendingBalance)} →{' '}
                    <span className="fw-semibold">
                      {fmt(adjustForm.supplier.pendingBalance + (adjustForm.direction === 'deduct' ? -1 : 1) * Number(adjustForm.amount))}
                    </span>
                  </div>
                )}
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-light" onClick={() => setAdjustForm(null)} disabled={adjusting}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={adjusting}>
                  {adjusting ? 'Posting…' : 'Post adjustment'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <ConfirmDialog
        isOpen={!!confirm}
        title="Pay supplier?"
        message={confirm ? `Transfer ${fmt(confirm.supplier.pendingBalance)} to ${confirm.supplier.companyName} for ${confirm.supplier.pendingOrders} settled order${confirm.supplier.pendingOrders === 1 ? '' : 's'}? This sends the money via Stripe.` : ''}
        confirmText="Pay out"
        confirmColor="primary"
        onCancel={() => setConfirm(null)}
        onConfirm={() => { const c = confirm; setConfirm(null); if (c) pay(c.supplier); }}
      />
    </div>
  );
}

export default AdminSupplierPayoutsPage;
