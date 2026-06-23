import { useEffect, useState } from 'react';
import { getSalesReport } from './reportService';

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
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    getSalesReport()
      .then((d) => { if (active) setData(d); })
      .catch((err) => { if (active) setError(err.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  return (
    <div className="container py-4 text-start">
      <h1 className="mb-1">📊 Sales Report</h1>
      <p className="text-muted">Your paid sales, and what you keep after platform commission.</p>

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
