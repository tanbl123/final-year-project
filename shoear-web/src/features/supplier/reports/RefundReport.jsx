import { useEffect, useState } from 'react';
import { getRefundReport } from './reportService';
import { useAuth } from '../../auth/AuthContext';
import ReportPeriodBar from '../../../components/ReportPeriodBar';
import ReportPreviewModal from '../../../components/ReportPreviewModal';
import { ALL_TIME, rm, StatCard } from './reportUtils';

const STATUS_BADGE = {
  Pending: 'text-bg-secondary', Approved: 'text-bg-success',
  Rejected: 'text-bg-danger', Completed: 'text-bg-primary',
};

// Refunds raised on orders containing this supplier's products.
function RefundReport() {
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
    getRefundReport({ from: range.from, to: range.to })
      .then((d) => { if (active) setData(d); })
      .catch((err) => { if (active) setError(err.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [range.from, range.to]);

  const has = !!data && data.summary.refunds > 0;
  const rateStr = data?.summary?.refundRate != null ? `${data.summary.refundRate}%` : '—';

  function buildReportOpts() {
    return {
      title: 'Refund Report',
      generatedBy: user?.fullName,
      period: range.label,
      referencePrefix: 'RF',
      summary: [
        { label: 'Refunds', value: String(data.summary.refunds) },
        { label: 'Total refunded', value: rm(data.summary.totalRefunded) },
        { label: 'Paid orders', value: String(data.summary.paidOrders) },
        { label: 'Refund rate', value: rateStr },
      ],
      head: ['Order', 'Reason', 'Amount', 'Status', 'Date'],
      body: data.refunds.map((r) => [r.orderId, r.reason, rm(r.amount), r.status, r.requestDate]),
      columnStyles: { 2: { halign: 'right' } },
    };
  }

  return (
    <div>
      <div className="d-flex justify-content-between align-items-end flex-wrap gap-2 mb-3">
        <p className="text-muted mb-0">Refunds on orders that included your products.</p>
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
        <div className="card card-body text-center text-muted">
          🎉 No refunds in this period.
        </div>
      ) : (
        <>
          <div className="row g-3 mb-4">
            <StatCard label="Refunds" value={data.summary.refunds} />
            <StatCard label="Total refunded" value={rm(data.summary.totalRefunded)} color="danger" />
            <StatCard label="Refund rate" value={rateStr} sub={`of ${data.summary.paidOrders} paid orders`} />
          </div>

          <h5 className="mb-3">Refund requests</h5>
          <div className="table-responsive">
            <table className="table align-middle">
              <thead>
                <tr>
                  <th style={{ width: 100 }}>Order</th>
                  <th>Reason</th>
                  <th className="text-end" style={{ width: 130 }}>Amount</th>
                  <th style={{ width: 120 }}>Status</th>
                  <th style={{ width: 120 }}>Date</th>
                </tr>
              </thead>
              <tbody>
                {data.refunds.map((r) => (
                  <tr key={r.refundId}>
                    <td className="text-muted">{r.orderId}</td>
                    <td>{r.reason}</td>
                    <td className="text-end">{rm(r.amount)}</td>
                    <td><span className={`badge ${STATUS_BADGE[r.status] || 'text-bg-secondary'}`}>{r.status}</span></td>
                    <td className="text-muted small">{r.requestDate}</td>
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

export default RefundReport;
