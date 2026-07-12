import { useEffect, useState } from 'react';
import { getFulfilmentReport } from './reportService';
import { useAuth } from '../../auth/AuthContext';
import ReportPeriodBar from '../../../components/ReportPeriodBar';
import ReportPreviewModal from '../../../components/ReportPreviewModal';
import { ALL_TIME, StatCard } from './reportUtils';

const STATUS_LABELS = {
  Pending: 'Pending', Assigned: 'Assigned', PickedUp: 'Picked up',
  OutForDelivery: 'Out for delivery', Delivered: 'Delivered', Failed: 'Failed',
};

// This supplier's parcels (deliveries) by status + on-time delivery rate.
function FulfilmentReport() {
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
    getFulfilmentReport({ from: range.from, to: range.to })
      .then((d) => { if (active) setData(d); })
      .catch((err) => { if (active) setError(err.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [range.from, range.to]);

  const has = !!data && data.summary.totalDeliveries > 0;
  const onTimeStr = data?.summary?.onTimeRate != null ? `${data.summary.onTimeRate}%` : '—';

  function buildReportOpts() {
    return {
      title: 'Order & Fulfilment Report',
      generatedBy: user?.fullName,
      period: range.label,
      referencePrefix: 'OF',
      summary: [
        { label: 'Total parcels', value: String(data.summary.totalDeliveries) },
        { label: 'Delivered', value: String(data.summary.delivered) },
        { label: 'In progress', value: String(data.summary.inProgress) },
        { label: 'Failed', value: String(data.summary.failed) },
        { label: 'On-time delivery rate', value: onTimeStr },
        { label: 'In-house / Standard', value: `${data.summary.inHouse} / ${data.summary.standard}` },
      ],
      head: ['Delivery status', 'Parcels'],
      body: Object.entries(data.byStatus).map(([s, n]) => [STATUS_LABELS[s] || s, n]),
      foot: [['Total', data.summary.totalDeliveries]],
      columnStyles: { 1: { halign: 'right' } },
    };
  }

  return (
    <div>
      <div className="d-flex justify-content-between align-items-end flex-wrap gap-2 mb-3">
        <p className="text-muted mb-0">Your parcels by delivery status, and how many arrive on time.</p>
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
      ) : !data ? null : data.summary.totalDeliveries === 0 ? (
        <div className="card card-body text-center text-muted">
          No deliveries yet in this period. Once your paid orders are dispatched, they appear here.
        </div>
      ) : (
        <>
          <div className="row g-3 mb-4">
            <StatCard label="Total parcels" value={data.summary.totalDeliveries} />
            <StatCard label="Delivered" value={data.summary.delivered} color="success" />
            <StatCard label="On-time rate" value={onTimeStr} color="success" sub="of delivered parcels" />
            <StatCard label="Failed" value={data.summary.failed} color={data.summary.failed > 0 ? 'danger' : 'dark'} />
          </div>

          <h5 className="mb-3">By delivery status</h5>
          <div className="table-responsive">
            <table className="table align-middle">
              <thead>
                <tr>
                  <th>Delivery status</th>
                  <th className="text-end" style={{ width: 140 }}>Parcels</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(data.byStatus).map(([s, n]) => (
                  <tr key={s}>
                    <td>{STATUS_LABELS[s] || s}</td>
                    <td className="text-end">{n}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="fw-semibold border-top">
                  <td>Total</td>
                  <td className="text-end">{data.summary.totalDeliveries}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

export default FulfilmentReport;
