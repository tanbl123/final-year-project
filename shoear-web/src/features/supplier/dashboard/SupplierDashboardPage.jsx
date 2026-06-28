import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getSupplierDashboard } from '../reports/reportService';
import SalesTrendChart from '../../../components/SalesTrendChart';
import ReportPeriodBar from '../../../components/ReportPeriodBar';

const ALL_TIME = { from: null, to: null, label: 'All time' };
const rm = (n) => 'RM ' + Number(n || 0).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtDate = (s) => (s ? new Date(s).toLocaleDateString('en-MY', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');

const ACTIONS = [
  { key: 'ordersToShip',    label: 'Orders to ship',     to: '/orders' },
  { key: 'lowStock',        label: 'Low-stock sizes',    to: '/inventory' },
  { key: 'pendingProducts', label: 'Products in review', to: '/products' },
];

const STATUS_BADGE = {
  Placed: 'secondary', Paid: 'primary', Cancelled: 'danger',
  Shipped: 'info', OutForDelivery: 'info', Delivered: 'success', Completed: 'success',
};

function Kpi({ label, value, sub, color = 'dark' }) {
  return (
    <div className="col-6 col-xl-3">
      <div className="card h-100">
        <div className="card-body">
          <div className="text-muted small text-uppercase">{label}</div>
          <div className={`fs-4 fw-semibold text-${color}`}>{value}</div>
          {sub && <div className="text-muted small">{sub}</div>}
        </div>
      </div>
    </div>
  );
}

function SupplierDashboardPage() {
  const [range, setRange] = useState(ALL_TIME);
  const [d, setD] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    setLoading(true);
    getSupplierDashboard({ from: range.from, to: range.to })
      .then((res) => { if (active) setD(res); })
      .catch((err) => { if (active) setError(err.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [range.from, range.to]);

  const totalActions = d ? ACTIONS.reduce((s, a) => s + (d.actions?.[a.key] || 0), 0) : 0;
  const growth = d?.period?.growthPct;

  return (
    <div className="container py-4 text-start">
      <div className="d-flex justify-content-between align-items-start flex-wrap gap-2">
        <div>
          <h1 className="mb-1">📊 Dashboard</h1>
          <p className="text-muted mb-0">Your shop at a glance — sales, what needs doing, and recent orders.</p>
        </div>
        <ReportPeriodBar onChange={setRange} />
      </div>
      <div className="d-flex align-items-center gap-2 mb-3 mt-2">
        <span className="text-muted small">Showing: <span className="fw-semibold">{range.label}</span></span>
        {growth != null && (
          <span className={`badge rounded-pill text-bg-${growth >= 0 ? 'success' : 'danger'}`}>
            {growth >= 0 ? '▲' : '▼'} {Math.abs(growth)}% vs previous period
          </span>
        )}
      </div>

      {error && <div className="alert alert-danger py-2">{error}</div>}
      {loading ? (
        <p className="text-muted">Loading…</p>
      ) : !d ? null : (
        <>
          {/* KPIs */}
          <div className="row g-3 mb-4">
            <Kpi label="Gross sales" value={rm(d.kpis.grossSales)} sub={`${d.kpis.unitsSold} units sold`} />
            <Kpi label="Net earnings" value={rm(d.kpis.netEarnings)} color="success" sub="after commission" />
            <Kpi label="Paid orders" value={d.kpis.orders} />
            <Kpi label="Units sold" value={d.kpis.unitsSold} />
          </div>

          <div className="row g-3">
            {/* Needs attention */}
            <div className="col-lg-5">
              <div className="card h-100">
                <div className="card-header bg-white fw-semibold d-flex justify-content-between">
                  <span>Needs attention</span>
                  {totalActions === 0 && <span className="badge text-bg-success">All clear</span>}
                </div>
                <div className="list-group list-group-flush">
                  {ACTIONS.map((a) => {
                    const n = d.actions?.[a.key] || 0;
                    return (
                      <Link key={a.key} to={a.to}
                        className="list-group-item list-group-item-action d-flex justify-content-between align-items-center">
                        <span className={n > 0 ? '' : 'text-muted'}>{a.label}</span>
                        <span className={`badge rounded-pill text-bg-${n > 0 ? 'danger' : 'light'}`}>{n}</span>
                      </Link>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Sales trend */}
            <div className="col-lg-7">
              <div className="card h-100">
                <div className="card-header bg-white fw-semibold">Sales — last 14 days</div>
                <div className="card-body">
                  <SalesTrendChart data={d.trend} color="#0d6efd" />
                </div>
              </div>
            </div>
          </div>

          {/* Recent orders */}
          <h5 className="mt-4 mb-3">Recent orders</h5>
          {d.recentOrders.length === 0 ? (
            <div className="card card-body text-center text-muted">No orders yet.</div>
          ) : (
            <div className="table-responsive">
              <table className="table align-middle">
                <thead>
                  <tr>
                    <th>Order</th>
                    <th className="text-end">Your subtotal</th><th>Status</th><th>Date</th>
                  </tr>
                </thead>
                <tbody>
                  {d.recentOrders.map((o) => (
                    <tr key={o.orderId}>
                      <td><Link to={`/orders/${o.orderId}`} className="fw-semibold text-decoration-none">{o.orderId}</Link></td>
                      <td className="text-end">{rm(o.total)}</td>
                      <td><span className={`badge text-bg-${STATUS_BADGE[o.status] || 'secondary'}`}>{o.status}</span></td>
                      <td>{fmtDate(o.date)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default SupplierDashboardPage;
