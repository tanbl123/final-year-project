import { useEffect, useState } from 'react';
import { getSalesReport } from './reportService';
import { useAuth } from '../../auth/AuthContext';
import ReportPeriodBar from '../../../components/ReportPeriodBar';
import ReportPreviewModal from '../../../components/ReportPreviewModal';
import Pagination from '../../../components/Pagination';
import { usePagination } from '../../../hooks/usePagination';
import { ALL_TIME, rm, StatCard } from './reportUtils';

const PAGE_SIZE = 15;

// Paid sales + what the supplier keeps after platform commission.
function SalesReport() {
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
    getSalesReport({ from: range.from, to: range.to })
      .then((d) => { if (active) setData(d); })
      .catch((err) => { if (active) setError(err.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [range.from, range.to]);

  const hasSales = !!data && data.summary.products > 0;
  const growth = data?.period?.growthPct;
  const rate = data?.commissionRate ?? 0;
  const sstRate = data?.serviceTaxRate ?? 0;
  const serviceTax = data?.summary.serviceTax ?? 0;
  const totalGross = data?.summary.grossSales ?? 0;
  // per-line breakdown of the gross → net waterfall
  const commOf = (gross) => (gross * rate) / 100;                       // platform commission
  const sstOf = (gross) => ((gross * rate) / 100) * (sstRate / 100);    // SST on that commission
  const netOf = (gross) => gross - commOf(gross) - sstOf(gross);        // what the supplier keeps
  const shareStr = (gross) => (totalGross > 0 ? `${Math.round((gross / totalGross) * 1000) / 10}%` : '—');

  // paginate the on-screen table only; totals (tfoot) + PDF stay full
  const rows = data?.byProduct ?? [];
  const { page, setPage, totalPages, pageItems } = usePagination(rows, PAGE_SIZE, `${range.from}|${range.to}`);

  function buildReportOpts() {
    return {
      title: 'Sales Report',
      generatedBy: user?.fullName,
      period: range.label,
      referencePrefix: 'SR',
      summary: [
        { label: 'Gross sales', value: rm(data.summary.grossSales) },
        { label: `Commission (${rate}%)`, value: rm(data.summary.commission) },
        { label: `SST (${sstRate}%) on commission`, value: rm(serviceTax) },
        { label: 'Shipping (3PL, platform-booked)', value: rm(data.summary.shippingCost ?? 0) },
        { label: 'Net earnings (after commission, SST & shipping)', value: rm(data.summary.netEarnings) },
        { label: 'Units sold', value: String(data.summary.unitsSold) },
        { label: 'Orders', value: String(data.summary.orders) },
        { label: 'Avg order value', value: data.summary.avgOrderValue != null ? rm(data.summary.avgOrderValue) : '—' },
        { label: 'Products sold', value: String(data.summary.products) },
        ...(growth != null
          ? [{ label: 'Gross sales vs previous period', value: `${growth > 0 ? '+' : ''}${growth}%` }]
          : []),
      ],
      orientation: 'landscape',
      head: ['Product', 'Units', '% sales', 'Gross', `Commission (${rate}%)`, `SST (${sstRate}%)`, 'Net (after comm. & SST)'],
      body: data.byProduct.map((p) => [
        p.productName, p.units, shareStr(p.gross), rm(p.gross),
        rm(commOf(p.gross)), rm(sstOf(p.gross)), rm(netOf(p.gross)),
      ]),
      foot: [['Total', data.summary.unitsSold, '', rm(data.summary.grossSales),
        rm(data.summary.commission), rm(serviceTax), rm(data.summary.netEarnings)]],
      columnStyles: {
        1: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'right' },
        4: { halign: 'right' }, 5: { halign: 'right' }, 6: { halign: 'right' },
      },
    };
  }

  return (
    <div>
      <div className="d-flex justify-content-between align-items-end flex-wrap gap-2 mb-3">
        <p className="text-muted mb-0">Your paid sales, and what you keep after platform commission.</p>
        <div className="d-flex align-items-end gap-2 flex-wrap">
          <ReportPeriodBar onChange={setRange} />
          <button className="btn btn-outline-primary" onClick={() => setPreview(true)} disabled={!hasSales}>
            👁 Preview &amp; export
          </button>
        </div>
      </div>

      <ReportPreviewModal open={preview} onClose={() => setPreview(false)} build={buildReportOpts} />

      {growth != null && (
        <span className={`badge rounded-pill text-bg-${growth >= 0 ? 'success' : 'danger'} mb-3`}>
          {growth >= 0 ? '▲' : '▼'} {Math.abs(growth)}% vs previous period
        </span>
      )}

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
            <StatCard label={`SST (${sstRate}%)`} value={rm(serviceTax)} color="danger" sub="on commission" />
            <StatCard label="Shipping (3PL)" value={rm(data.summary.shippingCost ?? 0)} color="danger" sub="platform-booked" />
            <StatCard label="Net earnings" value={rm(data.summary.netEarnings)} color="success" sub="after commission, SST & shipping" />
            <StatCard label="Orders" value={data.summary.orders} />
            <StatCard label="Avg order value" value={data.summary.avgOrderValue != null ? rm(data.summary.avgOrderValue) : '—'} />
            <StatCard label="Products sold" value={data.summary.products} />
          </div>

          <h5 className="mb-3">By product</h5>
          <div className="table-responsive">
            <table className="table align-middle">
              <thead>
                <tr>
                  <th>Product</th>
                  <th className="text-end">Units</th>
                  <th className="text-end">% sales</th>
                  <th className="text-end">Gross</th>
                  <th className="text-end">Commission ({rate}%)</th>
                  <th className="text-end">SST ({sstRate}%)</th>
                  <th className="text-end">Net (after comm. &amp; SST)</th>
                </tr>
              </thead>
              <tbody>
                {pageItems.map((p) => (
                  <tr key={p.productId}>
                    <td className="fw-semibold">{p.productName}</td>
                    <td className="text-end">{p.units}</td>
                    <td className="text-end">{shareStr(p.gross)}</td>
                    <td className="text-end">{rm(p.gross)}</td>
                    <td className="text-end text-danger">{rm(commOf(p.gross))}</td>
                    <td className="text-end text-muted">{rm(sstOf(p.gross))}</td>
                    <td className="text-end text-success fw-semibold">{rm(netOf(p.gross))}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="fw-semibold border-top">
                  <td>Total</td>
                  <td className="text-end">{data.summary.unitsSold}</td>
                  <td className="text-end"></td>
                  <td className="text-end">{rm(data.summary.grossSales)}</td>
                  <td className="text-end text-danger">{rm(data.summary.commission)}</td>
                  <td className="text-end text-muted">{rm(serviceTax)}</td>
                  <td className="text-end text-success">{rm(data.summary.netEarnings)}</td>
                </tr>
              </tfoot>
            </table>

            <Pagination page={page} totalPages={totalPages} onChange={setPage}
              summary={`Page ${page} of ${totalPages} · ${rows.length} products · export includes all rows`} />

            <p className="text-muted small mt-2 mb-0">
              Shipping is charged per parcel, not per product, so it's deducted once from
              <strong> Net earnings</strong> in the summary above — not shown in this per-product table.
            </p>
          </div>
        </>
      )}
    </div>
  );
}

export default SalesReport;
