import { useEffect, useState } from 'react';
import { getAdminSupplierReport } from '../adminService';
import { useAuth } from '../../auth/AuthContext';
import ReportPeriodBar from '../../../components/ReportPeriodBar';
import ReportPreviewModal from '../../../components/ReportPreviewModal';
import Pagination from '../../../components/Pagination';
import { usePagination } from '../../../hooks/usePagination';
import { ALL_TIME, rm, StatCard } from './reportUtils';

const PAGE_SIZE = 15;

// Supplier leaderboard: gross, units, active products, average rating.
// `onDrill(supplierId, companyName)` jumps to that company's Platform Sales report.
function SupplierPerformanceReport({ onDrill }) {
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
  const rate = data?.commissionRate ?? 0;
  const money = (n) => (n == null ? '—' : rm(n));
  const ABC_CLASS = { A: 'success', B: 'primary', C: 'secondary' };

  // paginate the on-screen leaderboard only (export/PDF keeps every row)
  const rows = data?.bySupplier ?? [];
  const { page, setPage, totalPages, pageItems } = usePagination(rows, PAGE_SIZE, `${range.from}|${range.to}`);
  const offset = (page - 1) * PAGE_SIZE;

  function buildReportOpts() {
    return {
      title: 'Supplier Performance Report',
      generatedBy: user?.fullName,
      period: range.label,
      referencePrefix: 'SP',
      orientation: 'landscape',
      summary: [
        { label: 'Suppliers', value: String(data.summary.suppliers) },
        { label: 'Total units sold', value: String(data.summary.unitsSold) },
        { label: 'Total gross sales', value: rm(data.summary.grossSales) },
        { label: `Total commission (${rate}%)`, value: rm(data.summary.totalCommission) },
      ],
      head: ['Rank', 'Supplier', 'Units', 'Orders', 'Gross', 'AOV', '% GMV', 'ABC', `Commission (${rate}%)`, 'Products', 'Avg rating'],
      body: data.bySupplier.map((s, i) => [
        i + 1, s.companyName, s.units, s.orders, rm(s.gross), money(s.avgOrderValue),
        s.sharePct > 0 ? `${s.sharePct}%` : '—', s.abcGrade ?? '—', rm(s.commission),
        s.products, s.avgRating != null ? s.avgRating : '—',
      ]),
      columnStyles: {
        0: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'right' },
        5: { halign: 'right' }, 6: { halign: 'right' }, 7: { halign: 'center' }, 8: { halign: 'right' },
        9: { halign: 'right' }, 10: { halign: 'right' },
      },
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
            <StatCard label={`Commission (${rate}%)`} value={rm(data.summary.totalCommission)} sub="generated" />
          </div>

          <div className="d-flex justify-content-between align-items-end mb-2 flex-wrap gap-2">
            <h5 className="mb-0">Leaderboard</h5>
            <span className="text-muted small">
              ABC: <span className="badge text-bg-success">A</span> top 80% ·
              <span className="badge text-bg-primary ms-1">B</span> next 15% ·
              <span className="badge text-bg-secondary ms-1">C</span> last 5% of GMV
            </span>
          </div>
          <div className="table-responsive">
            <table className="table align-middle">
              <thead>
                <tr>
                  <th style={{ width: 44 }}>#</th>
                  <th>Supplier</th>
                  <th className="text-end">Units</th>
                  <th className="text-end">Orders</th>
                  <th className="text-end">Gross</th>
                  <th className="text-end">AOV</th>
                  <th className="text-end">% GMV</th>
                  <th className="text-center">ABC</th>
                  <th className="text-end">Commission ({rate}%)</th>
                  <th className="text-end">Products</th>
                  <th className="text-end">Avg rating</th>
                  {onDrill && <th style={{ width: 100 }} />}
                </tr>
              </thead>
              <tbody>
                {pageItems.map((s, i) => (
                  <tr key={s.supplierId}>
                    <td className="text-muted">{offset + i + 1}</td>
                    <td className="fw-semibold">{s.companyName}</td>
                    <td className="text-end">{s.units}</td>
                    <td className="text-end">{s.orders}</td>
                    <td className="text-end">{rm(s.gross)}</td>
                    <td className="text-end">{money(s.avgOrderValue)}</td>
                    <td className="text-end">{s.sharePct > 0 ? `${s.sharePct}%` : '—'}</td>
                    <td className="text-center">
                      {s.abcGrade
                        ? <span className={`badge text-bg-${ABC_CLASS[s.abcGrade]}`}>{s.abcGrade}</span>
                        : <span className="text-muted">—</span>}
                    </td>
                    <td className="text-end text-success">{rm(s.commission)}</td>
                    <td className="text-end">{s.products}</td>
                    <td className="text-end text-warning">{star(s.avgRating)}{s.reviews ? <span className="text-muted small"> ({s.reviews})</span> : null}</td>
                    {onDrill && (
                      <td className="text-end">
                        <button
                          className="btn btn-sm btn-outline-primary text-nowrap"
                          onClick={() => onDrill(s.supplierId, s.companyName)}
                          title={`View ${s.companyName}'s sales report`}
                        >
                          📊 Report
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>

            <Pagination page={page} totalPages={totalPages} onChange={setPage}
              summary={`Page ${page} of ${totalPages} · ${rows.length} suppliers · export includes all rows`} />
          </div>
        </>
      )}
    </div>
  );
}

export default SupplierPerformanceReport;
