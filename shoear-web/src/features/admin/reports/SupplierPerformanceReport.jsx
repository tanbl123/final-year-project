import { useEffect, useState } from 'react';
import { getAdminSupplierReport } from '../adminService';
import { useAuth } from '../../auth/AuthContext';
import ReportPeriodBar from '../../../components/ReportPeriodBar';
import ReportPreviewModal from '../../../components/ReportPreviewModal';
import { ALL_TIME, rm, StatCard } from './reportUtils';

// Supplier leaderboard: gross, units, active products, average rating.
function SupplierPerformanceReport() {
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
    getAdminSupplierReport({ from: range.from, to: range.to })
      .then((d) => { if (active) setData(d); })
      .catch((err) => { if (active) setError(err.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [range.from, range.to]);

  const has = !!data && data.summary.suppliers > 0;
  const star = (r) => (r != null ? `★ ${r}` : '—');

  function buildReportOpts() {
    return {
      title: 'Supplier Performance Report',
      generatedBy: user?.fullName,
      period: range.label,
      referencePrefix: 'SP',
      summary: [
        { label: 'Suppliers', value: String(data.summary.suppliers) },
        { label: 'Total units sold', value: String(data.summary.unitsSold) },
        { label: 'Total gross sales', value: rm(data.summary.grossSales) },
      ],
      head: ['Rank', 'Supplier', 'Units', 'Gross sales', 'Products', 'Avg rating'],
      body: data.bySupplier.map((s, i) => [i + 1, s.companyName, s.units, rm(s.gross), s.products, s.avgRating != null ? s.avgRating : '—']),
      columnStyles: { 0: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'right' } },
    };
  }

  return (
    <div>
      <div className="d-flex justify-content-between align-items-end flex-wrap gap-2 mb-3">
        <p className="text-muted mb-0">Suppliers ranked by sales — plus product count and average rating.</p>
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
      ) : !data ? null : data.summary.suppliers === 0 ? (
        <div className="card card-body text-center text-muted">No active suppliers yet.</div>
      ) : (
        <>
          <div className="row g-3 mb-4">
            <StatCard label="Suppliers" value={data.summary.suppliers} />
            <StatCard label="Units sold" value={data.summary.unitsSold} />
            <StatCard label="Gross sales" value={rm(data.summary.grossSales)} color="success" />
          </div>

          <h5 className="mb-3">Leaderboard</h5>
          <div className="table-responsive">
            <table className="table align-middle">
              <thead>
                <tr>
                  <th style={{ width: 50 }}>#</th>
                  <th>Supplier</th>
                  <th className="text-end" style={{ width: 90 }}>Units</th>
                  <th className="text-end" style={{ width: 150 }}>Gross sales</th>
                  <th className="text-end" style={{ width: 100 }}>Products</th>
                  <th className="text-end" style={{ width: 120 }}>Avg rating</th>
                </tr>
              </thead>
              <tbody>
                {data.bySupplier.map((s, i) => (
                  <tr key={s.supplierId}>
                    <td className="text-muted">{i + 1}</td>
                    <td className="fw-semibold">{s.companyName}</td>
                    <td className="text-end">{s.units}</td>
                    <td className="text-end">{rm(s.gross)}</td>
                    <td className="text-end">{s.products}</td>
                    <td className="text-end text-warning">{star(s.avgRating)}{s.reviews ? <span className="text-muted small"> ({s.reviews})</span> : null}</td>
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

export default SupplierPerformanceReport;
