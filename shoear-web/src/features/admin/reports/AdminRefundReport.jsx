import { useEffect, useState } from 'react';
import { getAdminRefundReport } from '../adminService';
import { useAuth } from '../../auth/AuthContext';
import ReportPeriodBar from '../../../components/ReportPeriodBar';
import ReportPreviewModal from '../../../components/ReportPreviewModal';
import { ALL_TIME, rm, StatCard, CompanyFilter } from './reportUtils';

// Platform-wide refunds by status + refund rate. `company` scopes it to refunds
// on one supplier's orders ('' id = all companies).
function AdminRefundReport({ company = { id: '', name: '' }, setCompany }) {
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
    getAdminRefundReport({ from: range.from, to: range.to, supplierId: company.id })
      .then((d) => { if (active) setData(d); })
      .catch((err) => { if (active) setError(err.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [range.from, range.to, company.id]);

  const has = !!data && data.summary.refunds > 0;
  const rateStr = data?.summary?.refundRate != null ? `${data.summary.refundRate}%` : '—';
  const approvalStr = data?.summary?.approvalRate != null ? `${data.summary.approvalRate}%` : '—';
  const valuePctStr = data?.summary?.refundValuePct != null ? `${data.summary.refundValuePct}%` : '—';

  function buildReportOpts() {
    const extraTables = [];
    if (data.bySupplier?.length) {
      extraTables.push({
        title: 'Refunds by supplier',
        head: ['Supplier', 'Refunds', 'Refund rate', 'Refunded value'],
        body: data.bySupplier.map((s) => [s.name, s.refunds, s.refundRate != null ? `${s.refundRate}%` : '—', rm(s.refundedValue)]),
        columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'right' } },
      });
    }
    if (data.topProducts?.length) {
      extraTables.push({
        title: 'Most-refunded products',
        head: ['Product', 'Refunds', 'Value'],
        body: data.topProducts.map((p) => [`${p.brand} ${p.name}`.trim(), p.refunds, rm(p.value)]),
        columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' } },
      });
    }
    if (data.trend?.length) {
      extraTables.push({
        title: 'Refunds over time',
        head: ['Date', 'Refunds', 'Value'],
        body: data.trend.map((t) => [t.date, t.count, rm(t.amount)]),
        columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' } },
      });
    }
    return {
      extraTables,
      title: company.id ? `Refund Report — ${company.name}` : 'Refund Report (Platform)',
      generatedBy: user?.fullName,
      period: range.label,
      referencePrefix: 'ARF',
      summary: [
        { label: 'Total refunds', value: String(data.summary.refunds) },
        { label: 'Total refunded', value: rm(data.summary.totalRefunded) },
        { label: 'Paid orders', value: String(data.summary.paidOrders) },
        { label: 'Refund rate', value: rateStr },
        { label: 'Approval rate', value: approvalStr },
        { label: 'Refund value (% of GMV)', value: valuePctStr },
      ],
      head: ['Refund reason', 'Count', 'Amount'],
      body: (data.byReason ?? []).map((r) => [r.reason, r.count, rm(r.amount)]),
      foot: [['Total', data.summary.refunds, rm(data.summary.totalRefunded)]],
      columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' } },
    };
  }

  return (
    <div>
      <div className="d-flex justify-content-between align-items-end flex-wrap gap-2 mb-3">
        <p className="text-muted mb-0">
          {company.id ? `Refunds on ${company.name}'s orders, and their refund rate.` : 'Refunds across the whole marketplace, and the platform refund rate.'}
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
      ) : !data ? null : data.summary.refunds === 0 ? (
        <div className="card card-body text-center text-muted">🎉 {company.id ? `No refunds for ${company.name} in this period.` : 'No refunds across the platform in this period.'}</div>
      ) : (
        <>
          <div className="row g-3 mb-4">
            <StatCard label="Refunds" value={data.summary.refunds} />
            <StatCard label="Total refunded" value={rm(data.summary.totalRefunded)} color="danger" />
            <StatCard label="Refund rate" value={rateStr} sub={`of ${data.summary.paidOrders} paid orders`} />
            <StatCard label="Approval rate" value={approvalStr} sub="of decided refunds" />
            <StatCard label="Refund value" value={valuePctStr} sub="of GMV" color="danger" />
          </div>

          <div className="row g-4 mb-2">
            {data.byReason?.length > 0 && (
              <div className="col-lg-6">
                <h6 className="text-muted">Top refund reasons</h6>
                <table className="table table-sm align-middle">
                  <thead><tr><th>Reason</th><th className="text-end" style={{ width: 90 }}>Count</th><th className="text-end" style={{ width: 130 }}>Amount</th></tr></thead>
                  <tbody>
                    {data.byReason.map((r) => (
                      <tr key={r.reason}>
                        <td>{r.reason}</td>
                        <td className="text-end">{r.count}</td>
                        <td className="text-end">{rm(r.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {data.topProducts?.length > 0 && (
              <div className="col-lg-6">
                <h6 className="text-muted">Most-refunded products</h6>
                <table className="table table-sm align-middle">
                  <thead><tr><th>Product</th><th className="text-end" style={{ width: 90 }}>Refunds</th><th className="text-end" style={{ width: 130 }}>Value</th></tr></thead>
                  <tbody>
                    {data.topProducts.map((p) => (
                      <tr key={p.productId}>
                        <td>
                          {p.brand && <span className="text-muted">{p.brand} </span>}{p.name}
                        </td>
                        <td className="text-end">{p.refunds}</td>
                        <td className="text-end">{rm(p.value)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {!company.id && data.bySupplier?.length > 0 && (
            <div className="mb-4">
              <h6 className="text-muted">Refunds by supplier</h6>
              <p className="text-muted small mb-2">Suppliers with the most refunded value. Refund rate is refunds ÷ their paid orders.</p>
              <div className="table-responsive">
                <table className="table table-sm align-middle">
                  <thead>
                    <tr>
                      <th>Supplier</th>
                      <th className="text-end" style={{ width: 90 }}>Refunds</th>
                      <th className="text-end" style={{ width: 120 }}>Refund rate</th>
                      <th className="text-end" style={{ width: 140 }}>Refunded value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.bySupplier.map((s) => (
                      <tr key={s.supplierId}>
                        <td>{s.name}</td>
                        <td className="text-end">{s.refunds}</td>
                        <td className="text-end">{s.refundRate != null ? `${s.refundRate}%` : '—'}</td>
                        <td className="text-end">{rm(s.refundedValue)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {data.trend?.length > 0 && (() => {
            const maxCount = Math.max(...data.trend.map((t) => t.count), 1);
            return (
              <div className="mb-4">
                <h6 className="text-muted">Refunds over time</h6>
                <div className="table-responsive">
                  <table className="table table-sm align-middle">
                    <thead>
                      <tr>
                        <th style={{ width: 130 }}>Date</th>
                        <th>Refunds</th>
                        <th className="text-end" style={{ width: 90 }}>Count</th>
                        <th className="text-end" style={{ width: 140 }}>Value</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.trend.map((t) => (
                        <tr key={t.date}>
                          <td className="small">{t.date}</td>
                          <td>
                            <div className="progress" style={{ height: 8, minWidth: 60 }} role="img"
                              aria-label={`${t.count} refunds`}>
                              <div className="progress-bar bg-danger" style={{ width: `${(t.count / maxCount) * 100}%` }}></div>
                            </div>
                          </td>
                          <td className="text-end">{t.count}</td>
                          <td className="text-end">{rm(t.amount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })()}

          <h5 className="mb-3">By refund status</h5>
          <div className="table-responsive">
            <table className="table align-middle">
              <thead>
                <tr>
                  <th>Refund status</th>
                  <th className="text-end" style={{ width: 140 }}>Count</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(data.byStatus).map(([s, n]) => (
                  <tr key={s}>
                    <td>{s}</td>
                    <td className="text-end">{n}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="fw-semibold border-top">
                  <td>Total</td>
                  <td className="text-end">{data.summary.refunds}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

export default AdminRefundReport;
