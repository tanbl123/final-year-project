import { useEffect, useState } from 'react';
import { getSupplierPayouts, paySupplier, getSupplierPayoutHistory } from '../adminService';
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
  const [openId, setOpenId] = useState('');       // supplier whose history is expanded
  const [history, setHistory] = useState({});     // { [supplierId]: payouts[] | 'loading' }
  const [confirm, setConfirm] = useState(null);   // { supplier }

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
      if (openId === supplier.supplierId) setOpenId('');
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId('');
    }
  }

  async function toggleHistory(supplierId) {
    if (openId === supplierId) { setOpenId(''); return; }
    setOpenId(supplierId);
    if (!history[supplierId]) {
      setHistory((h) => ({ ...h, [supplierId]: 'loading' }));
      try {
        const data = await getSupplierPayoutHistory(supplierId);
        setHistory((h) => ({ ...h, [supplierId]: data.payouts }));
      } catch (err) {
        setHistory((h) => ({ ...h, [supplierId]: [] }));
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
          account, so they can't be paid yet.
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
                    <td className="text-end fw-semibold">{fmt(s.pendingBalance)}</td>
                    <td className="text-end">{s.pendingOrders}</td>
                    <td className="text-end text-muted">{fmt(s.lifetimePaid)}</td>
                    <td className="text-end text-nowrap">
                      <button className="btn btn-outline-secondary btn-sm me-2"
                        onClick={() => toggleHistory(s.supplierId)}>
                        {openId === s.supplierId ? 'Hide' : 'History'}
                      </button>
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
              }).flatMap((row, i) => {
                const s = sort.sorted[i];
                const out = [row];
                if (openId === s.supplierId) {
                  const h = history[s.supplierId];
                  out.push(
                    <tr key={`${s.supplierId}-history`}>
                      <td colSpan={6} className="bg-light">
                        <div className="px-2 py-1">
                          <div className="fw-semibold small mb-2">Payout history — {s.companyName}</div>
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
                                  <th className="text-end">Orders</th>
                                  <th>Type</th>
                                  <th>Status</th>
                                  <th>Stripe transfer</th>
                                </tr>
                              </thead>
                              <tbody>
                                {h.map((p) => (
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
