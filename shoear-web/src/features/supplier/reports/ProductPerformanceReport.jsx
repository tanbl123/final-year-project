import { useEffect, useState } from 'react';
import { getProductReport } from './reportService';
import { useAuth } from '../../auth/AuthContext';
import ReportPeriodBar from '../../../components/ReportPeriodBar';
import ReportPreviewModal from '../../../components/ReportPreviewModal';
import Pagination from '../../../components/Pagination';
import { usePagination } from '../../../hooks/usePagination';
import { ALL_TIME, rm, StatCard } from './reportUtils';

const PAGE_SIZE = 15;

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

  // Paginate only the on-screen table (the export/PDF still gets every row via
  // buildReportOpts). Ranking is preserved across pages via the page offset.
  const rows = data?.byProduct ?? [];
  const { page, setPage, totalPages, pageItems } = usePagination(rows, PAGE_SIZE, `${range.from}|${range.to}`);
  const offset = (page - 1) * PAGE_SIZE;

  // display helpers for the optional/derived columns
  const pct = (n) => (n == null ? '—' : `${n}%`);
  const money = (n) => (n == null ? '—' : rm(n));
  const ratingText = (p) => (p.avgRating == null ? '—' : `${p.avgRating} (${p.reviewCount})`);
  const ABC_CLASS = { A: 'success', B: 'primary', C: 'secondary' };

  function buildReportOpts() {
    return {
      title: 'Product Performance Report',
      generatedBy: user?.fullName,
      period: range.label,
      referencePrefix: 'PP',
      orientation: 'landscape',   // wide, many-column table
      summary: [
        { label: 'Products', value: String(data.summary.products) },
        { label: 'Products with sales', value: String(data.summary.withSales) },
        { label: 'Products with no sales', value: String(data.summary.noSales) },
        { label: 'Total units sold', value: String(data.summary.unitsSold) },
        { label: 'Total orders', value: String(data.summary.orders) },
        { label: 'Total gross sales', value: rm(data.summary.grossSales) },
        { label: 'Avg. selling price', value: money(data.summary.avgPrice) },
        { label: 'Stock on hand', value: String(data.summary.stockOnHand) },
      ],
      head: ['#', 'Product', 'Units', 'Orders', 'Gross', 'Avg price', '% sales', 'ABC', 'Stock', 'Sell-through', 'Rating'],
      body: data.byProduct.map((p, i) => [
        i + 1, p.productName, p.units, p.orders, rm(p.gross), money(p.avgPrice),
        p.sharePct > 0 ? `${p.sharePct}%` : '—', p.abcGrade ?? '—',
        p.stock, pct(p.sellThrough), ratingText(p),
      ]),
      columnStyles: {
        0: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'right' },
        4: { halign: 'right' }, 5: { halign: 'right' }, 6: { halign: 'right' },
        7: { halign: 'center' }, 8: { halign: 'right' }, 9: { halign: 'right' }, 10: { halign: 'right' },
      },
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
            <StatCard label="Orders" value={data.summary.orders} />
            <StatCard label="Gross sales" value={rm(data.summary.grossSales)} />
            <StatCard label="Avg. price" value={money(data.summary.avgPrice)} sub="per unit sold" />
            <StatCard label="No sales" value={data.summary.noSales} color={data.summary.noSales > 0 ? 'warning' : 'dark'} sub="not moving" />
          </div>

          <div className="d-flex justify-content-between align-items-end mb-2 flex-wrap gap-2">
            <h5 className="mb-0">Ranked best → worst</h5>
            <span className="text-muted small">
              ABC: <span className="badge text-bg-success">A</span> top 80% ·
              <span className="badge text-bg-primary ms-1">B</span> next 15% ·
              <span className="badge text-bg-secondary ms-1">C</span> last 5% of sales
            </span>
          </div>
          <div className="table-responsive">
            <table className="table align-middle">
              <thead>
                <tr>
                  <th style={{ width: 44 }}>#</th>
                  <th>Product</th>
                  <th className="text-end">Units</th>
                  <th className="text-end">Orders</th>
                  <th className="text-end">Gross</th>
                  <th className="text-end">Avg price</th>
                  <th className="text-end">% sales</th>
                  <th className="text-center">ABC</th>
                  <th className="text-end">Stock</th>
                  <th className="text-end">Sell-through</th>
                  <th className="text-end">Rating</th>
                </tr>
              </thead>
              <tbody>
                {pageItems.map((p, i) => (
                  <tr key={p.productId}>
                    <td className="text-muted">{offset + i + 1}</td>
                    <td className="fw-semibold">{p.productName}</td>
                    <td className="text-end">{p.units}</td>
                    <td className="text-end">{p.orders}</td>
                    <td className="text-end">
                      {p.units > 0 ? rm(p.gross) : <span className="badge text-bg-warning">No sales</span>}
                    </td>
                    <td className="text-end">{money(p.avgPrice)}</td>
                    <td className="text-end">{p.sharePct > 0 ? `${p.sharePct}%` : '—'}</td>
                    <td className="text-center">
                      {p.abcGrade
                        ? <span className={`badge text-bg-${ABC_CLASS[p.abcGrade]}`}>{p.abcGrade}</span>
                        : <span className="text-muted">—</span>}
                    </td>
                    <td className={'text-end' + (p.stock === 0 ? ' text-danger' : '')}>{p.stock}</td>
                    <td className="text-end">{pct(p.sellThrough)}</td>
                    <td className="text-end">{p.avgRating == null
                      ? <span className="text-muted">—</span>
                      : <span>★ {p.avgRating} <span className="text-muted small">({p.reviewCount})</span></span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <Pagination page={page} totalPages={totalPages} onChange={setPage}
              summary={`Page ${page} of ${totalPages} · ${rows.length} products · export includes all rows`} />
          </div>
        </>
      )}
    </div>
  );
}

export default ProductPerformanceReport;
