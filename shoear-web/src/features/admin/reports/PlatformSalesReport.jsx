import { useEffect, useState } from 'react';
import { getCommissionReport } from '../adminService';
import { useAuth } from '../../auth/AuthContext';
import ReportPeriodBar from '../../../components/ReportPeriodBar';
import ReportPreviewModal from '../../../components/ReportPreviewModal';
import { ALL_TIME, rm, StatCard, CompanyFilter } from './reportUtils';

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
  const netToSuppliers = data ? data.summary.grossSales - data.summary.totalCommission : 0;

  function buildReportOpts() {
    return {
      title: company.id ? `Platform Sales (GMV) — ${company.name}` : 'Platform Sales (GMV) Report',
      generatedBy: user?.fullName,
      period: range.label,
      referencePrefix: 'GMV',
      summary: [
        { label: 'Gross merchandise value (GMV)', value: rm(data.summary.grossSales) },
        { label: `Platform commission (${rate}%)`, value: rm(data.summary.totalCommission) },
        { label: 'Net paid to suppliers', value: rm(netToSuppliers) },
        { label: 'Active selling suppliers', value: String(data.summary.suppliers) },
      ],
      head: ['Supplier', 'Units', 'Gross (GMV)', `Commission (${rate}%)`],
      body: data.bySupplier.map((s) => [s.companyName, s.units, rm(s.gross), rm(s.commission)]),
      foot: [['Total', data.bySupplier.reduce((a, s) => a + s.units, 0), rm(data.summary.grossSales), rm(data.summary.totalCommission)]],
      columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'right' } },
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
            <StatCard label="Paid to suppliers" value={rm(netToSuppliers)} />
            <StatCard label="Selling suppliers" value={data.summary.suppliers} />
          </div>

          <h5 className="mb-3">By supplier</h5>
          <div className="table-responsive">
            <table className="table align-middle">
              <thead>
                <tr>
                  <th>Supplier</th>
                  <th className="text-end" style={{ width: 100 }}>Units</th>
                  <th className="text-end" style={{ width: 160 }}>Gross (GMV)</th>
                  <th className="text-end" style={{ width: 160 }}>Commission ({rate}%)</th>
                </tr>
              </thead>
              <tbody>
                {data.bySupplier.map((s) => (
                  <tr key={s.supplierId}>
                    <td className="fw-semibold">{s.companyName}</td>
                    <td className="text-end">{s.units}</td>
                    <td className="text-end">{rm(s.gross)}</td>
                    <td className="text-end text-success">{rm(s.commission)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="fw-semibold border-top">
                  <td>Total</td>
                  <td className="text-end">{data.bySupplier.reduce((a, s) => a + s.units, 0)}</td>
                  <td className="text-end">{rm(data.summary.grossSales)}</td>
                  <td className="text-end text-success">{rm(data.summary.totalCommission)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

export default PlatformSalesReport;
