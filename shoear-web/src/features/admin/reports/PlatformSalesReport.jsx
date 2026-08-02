import { useEffect, useState } from 'react';
import { getCommissionReport } from '../adminService';
import { useAuth } from '../../auth/AuthContext';
import ReportPeriodBar from '../../../components/ReportPeriodBar';
import ReportPreviewModal from '../../../components/ReportPreviewModal';
import Pagination from '../../../components/Pagination';
import { usePagination } from '../../../hooks/usePagination';
import { ALL_TIME, rm, StatCard, CompanyFilter } from './reportUtils';

const PAGE_SIZE = 15;

// Platform GMV + commission revenue, broken down by supplier. `company` scopes it
// to a single supplier ('' id = all companies).
function PlatformSalesReport({ company = { id: '', name: '' }, setCompany }) {
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
    getCommissionReport({ from: range.from, to: range.to, supplierId: company.id })
      .then((d) => { if (active) setData(d); })
      .catch((err) => { if (active) setError(err.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [range.from, range.to, company.id]);

  const has = !!data && data.summary.suppliers > 0;
  const rate = data?.commissionRate ?? 0;
  const sstRate = data?.serviceTaxRate ?? 0;
  const serviceTax = data?.summary.totalServiceTax ?? 0;
  const netToSuppliers = data
    ? (data.summary.netToSuppliers ?? (data.summary.grossSales - data.summary.totalCommission - serviceTax))
    : 0;

  // paginate the on-screen table only; totals (tfoot) + PDF stay full
  const rows = data?.bySupplier ?? [];
  const { page, setPage, totalPages, pageItems } = usePagination(rows, PAGE_SIZE, `${range.from}|${range.to}|${company.id}`);

  function buildReportOpts() {
    return {
      title: company.id ? `Platform Sales (GMV) — ${company.name}` : 'Platform Sales (GMV) Report',
      generatedBy: user?.fullName,
      period: range.label,
      referencePrefix: 'GMV',
      summary: [
        { label: 'Gross merchandise value (GMV)', value: rm(data.summary.grossSales) },
        { label: `Platform commission (${rate}%)`, value: rm(data.summary.totalCommission) },
        { label: `SST (${sstRate}%) on commission`, value: rm(serviceTax) },
        { label: 'Shipping (3PL, recovered from suppliers)', value: rm(data.summary.totalShipping ?? 0) },
        { label: 'Net paid to suppliers', value: rm(netToSuppliers) },
        { label: 'Orders', value: String(data.summary.orders) },
        { label: 'Avg order value', value: data.summary.avgOrderValue != null ? rm(data.summary.avgOrderValue) : '—' },
        { label: 'Active selling suppliers', value: String(data.summary.suppliers) },
      ],
      orientation: 'landscape',
      head: ['Supplier', 'Units', 'Orders', 'Gross (GMV)', 'AOV', '% GMV', `Commission (${rate}%)`, `SST (${sstRate}%)`, 'Net paid'],
      body: data.bySupplier.map((s) => [
        s.companyName, s.units, s.orders, rm(s.gross), s.avgOrderValue != null ? rm(s.avgOrderValue) : '—',
        s.sharePct > 0 ? `${s.sharePct}%` : '—', rm(s.commission), rm(s.serviceTax), rm(s.net),
      ]),
      foot: [['Total',
        data.bySupplier.reduce((a, s) => a + s.units, 0), data.summary.orders,
        rm(data.summary.grossSales), '', '',
        rm(data.summary.totalCommission), rm(serviceTax), rm(netToSuppliers)]],
      columnStyles: {
        1: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'right' },
        5: { halign: 'right' }, 6: { halign: 'right' }, 7: { halign: 'right' }, 8: { halign: 'right' },
      },
    };
  }

  return (
    <div>
      <div className="d-flex justify-content-between align-items-end flex-wrap gap-2 mb-3">
        <p className="text-muted mb-0">
          {company.id ? `Sales (GMV) and commission for ${company.name}.` : "Total marketplace sales (GMV) and the platform's commission revenue."}
        </p>
        <div className="d-flex align-items-end gap-2 flex-wrap">
          {setCompany && <CompanyFilter value={company.id} onChange={(id, name) => setCompany({ id, name })} />}
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
        <div className="card card-body text-center text-muted">{company.id ? `No sales for ${company.name} in this period.` : 'No sales across the platform yet.'}</div>
      ) : (
        <>
          <div className="row g-3 mb-4">
            <StatCard label="GMV" value={rm(data.summary.grossSales)} sub="gross merchandise value" />
            <StatCard label={`Commission (${rate}%)`} value={rm(data.summary.totalCommission)} color="success" sub="platform revenue" />
            <StatCard label={`SST (${sstRate}%)`} value={rm(serviceTax)} sub="on commission · remitted" />
            <StatCard label="Shipping (3PL)" value={rm(data.summary.totalShipping ?? 0)} sub="recovered from suppliers" />
            <StatCard label="Paid to suppliers" value={rm(netToSuppliers)} sub="after commission, SST & shipping" />
            <StatCard label="Orders" value={data.summary.orders} />
            <StatCard label="Avg order value" value={data.summary.avgOrderValue != null ? rm(data.summary.avgOrderValue) : '—'} />
            <StatCard label="Selling suppliers" value={data.summary.suppliers} />
          </div>

          <h5 className="mb-3">By supplier</h5>
          <div className="table-responsive">
            <table className="table align-middle">
              <thead>
                <tr>
                  <th>Supplier</th>
                  <th className="text-end">Units</th>
                  <th className="text-end">Orders</th>
                  <th className="text-end">Gross (GMV)</th>
                  <th className="text-end">AOV</th>
                  <th className="text-end">% GMV</th>
                  <th className="text-end">Commission ({rate}%)</th>
                  <th className="text-end">SST ({sstRate}%)</th>
                  <th className="text-end">Net paid</th>
                </tr>
              </thead>
              <tbody>
                {pageItems.map((s) => (
                  <tr key={s.supplierId}>
                    <td className="fw-semibold">{s.companyName}</td>
                    <td className="text-end">{s.units}</td>
                    <td className="text-end">{s.orders}</td>
                    <td className="text-end">{rm(s.gross)}</td>
                    <td className="text-end">{s.avgOrderValue != null ? rm(s.avgOrderValue) : '—'}</td>
                    <td className="text-end">{s.sharePct > 0 ? `${s.sharePct}%` : '—'}</td>
                    <td className="text-end text-success">{rm(s.commission)}</td>
                    <td className="text-end text-muted">{rm(s.serviceTax)}</td>
                    <td className="text-end fw-semibold">{rm(s.net)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="fw-semibold border-top">
                  <td>Total</td>
                  <td className="text-end">{data.bySupplier.reduce((a, s) => a + s.units, 0)}</td>
                  <td className="text-end">{data.summary.orders}</td>
                  <td className="text-end">{rm(data.summary.grossSales)}</td>
                  <td className="text-end"></td>
                  <td className="text-end"></td>
                  <td className="text-end text-success">{rm(data.summary.totalCommission)}</td>
                  <td className="text-end text-muted">{rm(serviceTax)}</td>
                  <td className="text-end">{rm(netToSuppliers)}</td>
                </tr>
              </tfoot>
            </table>

            <Pagination page={page} totalPages={totalPages} onChange={setPage}
              summary={`Page ${page} of ${totalPages} · ${rows.length} suppliers · export includes all rows`} />
          </div>
        </>
      )}
    </div>
  );
}

export default PlatformSalesReport;
