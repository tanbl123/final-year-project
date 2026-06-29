import { useEffect, useState } from 'react';
import { getSalesReport } from './reportService';
import { useAuth } from '../../auth/AuthContext';
import ReportPeriodBar from '../../../components/ReportPeriodBar';
import ReportPreviewModal from '../../../components/ReportPreviewModal';

const ALL_TIME = { from: null, to: null, label: 'All time' };

const rm = (n) => 'RM ' + Number(n || 0).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function StatCard({ label, value, sub, color = 'dark' }) {
  return (
    <div className="col-6 col-lg-3">
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

function ReportsPage() {
  const { user } = useAuth();
  const [range, setRange] = useState(ALL_TIME);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    getSalesReport({ from: range.from, to: range.to })
      .then((d) => { if (active) setData(d); })
      .catch((err) => { if (active) setError(err.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [range.from, range.to]);

  const [preview, setPreview] = useState(false);

  const hasSales = !!data && data.summary.products > 0;
  const growth = data?.period?.growthPct;

  // Report options for preview + download (same document for both).
  function buildReportOpts() {
    const rate = data.commissionRate;
    return {
      title: 'Sales Report',
      generatedBy: user?.fullName,
      period: range.label,
      referencePrefix: 'SR',
      summary: [
        { label: 'Gross sales', value: rm(data.summary.grossSales) },
        { label: `Commission (${rate}%)`, value: rm(data.summary.commission) },
        { label: 'Net earnings (after commission)', value: rm(data.summary.netEarnings) },
        { label: 'Units sold', value: String(data.summary.unitsSold) },
        { label: 'Products sold', value: String(data.summary.products) },
        ...(growth != null
          ? [{ label: 'Gross sales vs previous period', value: `${growth > 0 ? '+' : ''}${growth}%` }]
          : []),
      ],
      head: ['Product', 'Units', 'Gross sales', `Net (after ${rate}%)`],
      body: data.byProduct.map((p) => [
        p.productName,
        p.units,
        rm(p.gross),
        rm(p.gross * (1 - rate / 100)),
      ]),
      foot: [['Total', data.summary.unitsSold, rm(data.summary.grossSales), rm(data.summary.netEarnings)]],
      columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'right' } },
    };
  }

  return (
    <div className="container py-4 text-start">
      <div className="d-flex justify-content-between align-items-start flex-wrap gap-2">
        <div>
          <h1 className="mb-1">📊 Sales Report</h1>
          <p className="text-muted mb-0">Your paid sales, and what you keep after platform commission.</p>
        </div>
        <div className="d-flex align-items-end gap-2 flex-wrap">
          <ReportPeriodBar onChange={setRange} />
          <button className="btn btn-outline-primary" onClick={() => setPreview(true)} disabled={!hasSales}>
            👁 Preview &amp; export
          </button>
        </div>
      </div>

      <ReportPreviewModal open={preview} onClose={() => setPreview(false)} build={buildReportOpts} />

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
      ) : !data ? null : data.summary.products === 0 ? (
        <div className="card card-body text-center text-muted">
          No sales yet. Once customers buy your products, your report appears here.
        </div>
      ) : (
        <>
          <div className="row g-3 mb-4">
            <StatCard label="Gross sales" value={rm(data.summary.grossSales)} sub={`${data.summary.unitsSold} units sold`} />
            <StatCard label={`Commission (${data.commissionRate}%)`} value={rm(data.summary.commission)} color="danger" />
            <StatCard label="Net earnings" value={rm(data.summary.netEarnings)} color="success" sub="after commission" />
            <StatCard label="Products sold" value={data.summary.products} />
          </div>

          <h5 className="mb-3">By product</h5>
          <div className="table-responsive">
            <table className="table align-middle">
              <thead>
                <tr>
                  <th>Product</th>
                  <th className="text-end" style={{ width: 110 }}>Units</th>
                  <th className="text-end" style={{ width: 160 }}>Gross sales</th>
                  <th className="text-end" style={{ width: 180 }}>Net (after {data.commissionRate}%)</th>
                </tr>
              </thead>
              <tbody>
                {data.byProduct.map((p) => (
                  <tr key={p.productId}>
                    <td className="fw-semibold">{p.productName}</td>
                    <td className="text-end">{p.units}</td>
                    <td className="text-end">{rm(p.gross)}</td>
                    <td className="text-end text-success">{rm(p.gross * (1 - data.commissionRate / 100))}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="fw-semibold border-top">
                  <td>Total</td>
                  <td className="text-end">{data.summary.unitsSold}</td>
                  <td className="text-end">{rm(data.summary.grossSales)}</td>
                  <td className="text-end text-success">{rm(data.summary.netEarnings)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

export default ReportsPage;
