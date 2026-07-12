import { useEffect, useState } from 'react';
import { getProductReport } from './reportService';
import { useAuth } from '../../auth/AuthContext';
import ReportPeriodBar from '../../../components/ReportPeriodBar';
import ReportPreviewModal from '../../../components/ReportPreviewModal';
import { ALL_TIME, rm, StatCard } from './reportUtils';

// Best → worst sellers, including products with zero sales ("dead stock").
function ProductPerformanceReport() {
  const { user } = useAuth();
  const [range, setRange] = useState(ALL_TIME);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [preview, setPreview] = useState(false);

  useEffect(() => {
    let active = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    getProductReport({ from: range.from, to: range.to })
      .then((d) => { if (active) setData(d); })
      .catch((err) => { if (active) setError(err.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [range.from, range.to]);

  const has = !!data && data.summary.products > 0;

  function buildReportOpts() {
    return {
      title: 'Product Performance Report',
      generatedBy: user?.fullName,
      period: range.label,
      referencePrefix: 'PP',
      summary: [
        { label: 'Products', value: String(data.summary.products) },
        { label: 'Products with sales', value: String(data.summary.withSales) },
        { label: 'Products with no sales', value: String(data.summary.noSales) },
        { label: 'Total units sold', value: String(data.summary.unitsSold) },
        { label: 'Total gross sales', value: rm(data.summary.grossSales) },
      ],
      head: ['Rank', 'Product', 'Units sold', 'Gross sales'],
      body: data.byProduct.map((p, i) => [i + 1, p.productName, p.units, rm(p.gross)]),
      columnStyles: { 0: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'right' } },
    };
  }

  return (
    <div>
      <div className="d-flex justify-content-between align-items-end flex-wrap gap-2 mb-3">
        <p className="text-muted mb-0">Which products sell best — and which aren&apos;t moving.</p>
        <div className="d-flex align-items-end gap-2 flex-wrap">
          <ReportPeriodBar onChange={setRange} />
          <button className="btn btn-outline-primary" onClick={() => setPreview(true)} disabled={!has}>
            👁 Preview &amp; export
          </button>
        </div>
      </div>

      <ReportPreviewModal open={preview} onClose={() => setPreview(false)} build={buildReportOpts} />

      {error && <div className="alert alert-danger py-2">{error}</div>}

      {loading ? (
        <p className="text-muted">Loading…</p>
      ) : !data ? null : data.summary.products === 0 ? (
        <div className="card card-body text-center text-muted">
          No approved products yet. Add products to see their performance here.
        </div>
      ) : (
        <>
          <div className="row g-3 mb-4">
            <StatCard label="Units sold" value={data.summary.unitsSold} sub={`across ${data.summary.products} products`} />
            <StatCard label="Gross sales" value={rm(data.summary.grossSales)} />
            <StatCard label="With sales" value={data.summary.withSales} color="success" />
            <StatCard label="No sales" value={data.summary.noSales} color={data.summary.noSales > 0 ? 'warning' : 'dark'} sub="not moving" />
          </div>

          <h5 className="mb-3">Ranked best → worst</h5>
          <div className="table-responsive">
            <table className="table align-middle">
              <thead>
                <tr>
                  <th style={{ width: 60 }}>#</th>
                  <th>Product</th>
                  <th className="text-end" style={{ width: 120 }}>Units sold</th>
                  <th className="text-end" style={{ width: 160 }}>Gross sales</th>
                </tr>
              </thead>
              <tbody>
                {data.byProduct.map((p, i) => (
                  <tr key={p.productId}>
                    <td className="text-muted">{i + 1}</td>
                    <td className="fw-semibold">{p.productName}</td>
                    <td className="text-end">{p.units}</td>
                    <td className="text-end">
                      {p.units > 0
                        ? rm(p.gross)
                        : <span className="badge text-bg-warning">No sales</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

export default ProductPerformanceReport;
