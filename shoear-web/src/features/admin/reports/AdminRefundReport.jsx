import { useEffect, useState } from 'react';
import { getAdminRefundReport } from '../adminService';
import { useAuth } from '../../auth/AuthContext';
import ReportPeriodBar from '../../../components/ReportPeriodBar';
import ReportPreviewModal from '../../../components/ReportPreviewModal';
import { ALL_TIME, rm, StatCard } from './reportUtils';

// Platform-wide refunds by status + refund rate.
function AdminRefundReport() {
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
    getAdminRefundReport({ from: range.from, to: range.to })
      .then((d) => { if (active) setData(d); })
      .catch((err) => { if (active) setError(err.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [range.from, range.to]);

  const has = !!data && data.summary.refunds > 0;
  const rateStr = data?.summary?.refundRate != null ? `${data.summary.refundRate}%` : '—';

  function buildReportOpts() {
    return {
      title: 'Refund Report (Platform)',
      generatedBy: user?.fullName,
      period: range.label,
      referencePrefix: 'ARF',
      summary: [
        { label: 'Total refunds', value: String(data.summary.refunds) },
        { label: 'Total refunded', value: rm(data.summary.totalRefunded) },
        { label: 'Paid orders', value: String(data.summary.paidOrders) },
        { label: 'Refund rate', value: rateStr },
      ],
      head: ['Refund status', 'Count'],
      body: Object.entries(data.byStatus).map(([s, n]) => [s, n]),
      foot: [['Total', data.summary.refunds]],
      columnStyles: { 1: { halign: 'right' } },
    };
  }

  return (
    <div>
      <div className="d-flex justify-content-between align-items-end flex-wrap gap-2 mb-3">
        <p className="text-muted mb-0">Refunds across the whole marketplace, and the platform refund rate.</p>
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
      ) : !data ? null : data.summary.refunds === 0 ? (
        <div className="card card-body text-center text-muted">🎉 No refunds across the platform in this period.</div>
      ) : (
        <>
          <div className="row g-3 mb-4">
            <StatCard label="Refunds" value={data.summary.refunds} />
            <StatCard label="Total refunded" value={rm(data.summary.totalRefunded)} color="danger" />
            <StatCard label="Refund rate" value={rateStr} sub={`of ${data.summary.paidOrders} paid orders`} />
          </div>

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
