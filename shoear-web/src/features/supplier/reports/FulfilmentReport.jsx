import { useEffect, useState } from 'react';
import { getFulfilmentReport } from './reportService';
import { useAuth } from '../../auth/AuthContext';
import ReportPeriodBar from '../../../components/ReportPeriodBar';
import ReportPreviewModal from '../../../components/ReportPreviewModal';
import Pagination from '../../../components/Pagination';
import { usePagination } from '../../../hooks/usePagination';
import { ALL_TIME, rm, StatCard } from './reportUtils';

const PAGE_SIZE = 15;

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
  const shipDaysStr = data?.summary?.avgDeliveryDays != null ? `${data.summary.avgDeliveryDays} days` : '—';
  const pct = (v) => (v == null ? '—' : `${v}%`);
  const days = (v) => (v == null ? '—' : `${v}`);
  const deliveryCost = data?.summary?.deliveryCost ?? 0;

  // paginate the on-screen per-order cost table only; totals + PDF stay full
  const orderRows = data?.byOrder ?? [];
  const { page, setPage, totalPages, pageItems } = usePagination(orderRows, PAGE_SIZE, `${range.from}|${range.to}`);

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
        { label: 'Avg delivery time', value: shipDaysStr },
        { label: 'In-house / Standard', value: `${data.summary.inHouse} / ${data.summary.standard}` },
        { label: 'Delivery cost you bear', value: rm(deliveryCost) },
        { label: '  · 3PL labels', value: rm(data.summary.shippingCost ?? 0) },
        { label: '  · In-house courier', value: rm(data.summary.courierFee ?? 0) },
      ],
      head: ['Channel', 'Parcels', 'Delivered', 'On-time %', 'Avg days', 'Failed'],
      body: (data.byChannel ?? []).map((c) => [
        c.channel, c.parcels, c.delivered, pct(c.onTimeRate), days(c.avgDeliveryDays), c.failed,
      ]),
      foot: [['Total', data.summary.totalDeliveries, data.summary.delivered, onTimeStr, days(data.summary.avgDeliveryDays), data.summary.failed]],
      columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'right' }, 5: { halign: 'right' } },
      extraTables: orderRows.length
        ? [{
            title: 'Delivery cost by order',
            head: ['Order', 'Method', 'Carrier / channel', 'Tracking', 'Status', 'Cost'],
            body: orderRows.map((o) => [
              `#${o.orderId}`, o.method, o.channel, o.trackingNumber || '—',
              STATUS_LABELS[o.status] || o.status, rm(o.cost),
            ]),
            foot: [['Total', '', '', '', '', rm(deliveryCost)]],
            columnStyles: { 5: { halign: 'right' } },
          }]
        : [],
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
            <StatCard label="Avg delivery time" value={shipDaysStr} />
            <StatCard label="Failed" value={data.summary.failed} color={data.summary.failed > 0 ? 'danger' : 'dark'} />
            <StatCard label="Delivery cost" value={rm(deliveryCost)} color="danger" sub="deducted from your net" />
          </div>

          <h5 className="mb-3">Fulfilment by channel</h5>
          <div className="table-responsive mb-4">
            <table className="table align-middle">
              <thead>
                <tr>
                  <th>Channel</th>
                  <th className="text-end">Parcels</th>
                  <th className="text-end">Delivered</th>
                  <th className="text-end">On-time %</th>
                  <th className="text-end">Avg days</th>
                  <th className="text-end">Failed</th>
                </tr>
              </thead>
              <tbody>
                {(data.byChannel ?? []).map((c) => (
                  <tr key={c.channel}>
                    <td className="fw-semibold">{c.channel}</td>
                    <td className="text-end">{c.parcels}</td>
                    <td className="text-end">{c.delivered}</td>
                    <td className="text-end">{pct(c.onTimeRate)}</td>
                    <td className="text-end">{days(c.avgDeliveryDays)}</td>
                    <td className={'text-end ' + (c.failed > 0 ? 'text-danger' : 'text-muted')}>{c.failed}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="fw-semibold border-top">
                  <td>Total</td>
                  <td className="text-end">{data.summary.totalDeliveries}</td>
                  <td className="text-end">{data.summary.delivered}</td>
                  <td className="text-end">{onTimeStr}</td>
                  <td className="text-end">{days(data.summary.avgDeliveryDays)}</td>
                  <td className="text-end">{data.summary.failed}</td>
                </tr>
              </tfoot>
            </table>
          </div>

          <h5 className="mb-3">Delivery cost by order</h5>
          <p className="text-muted small mb-3">
            Each parcel that has shipped and its delivery cost — the orders that make up the
            <strong> {rm(deliveryCost)}</strong> deducted from your net earnings. 3PL labels charge the
            EasyParcel cost; in-house deliveries charge a flat courier fee.
          </p>
          {orderRows.length === 0 ? (
            <div className="card card-body text-muted mb-4">No delivery costs incurred in this period yet.</div>
          ) : (
            <div className="table-responsive mb-4">
              <table className="table align-middle">
                <thead>
                  <tr>
                    <th>Order</th>
                    <th>Method</th>
                    <th>Carrier / channel</th>
                    <th>Tracking</th>
                    <th>Status</th>
                    <th className="text-end">Cost</th>
                  </tr>
                </thead>
                <tbody>
                  {pageItems.map((o) => (
                    <tr key={o.orderId}>
                      <td className="fw-semibold">#{o.orderId}</td>
                      <td>{o.method}</td>
                      <td>{o.channel}</td>
                      <td className="text-muted">{o.trackingNumber || '—'}</td>
                      <td>{STATUS_LABELS[o.status] || o.status}</td>
                      <td className="text-end text-danger">{rm(o.cost)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="fw-semibold border-top">
                    <td>Total</td>
                    <td></td><td></td><td></td><td></td>
                    <td className="text-end text-danger">{rm(deliveryCost)}</td>
                  </tr>
                </tfoot>
              </table>
              <Pagination page={page} totalPages={totalPages} onChange={setPage}
                summary={`Page ${page} of ${totalPages} · ${orderRows.length} orders · export includes all rows`} />
            </div>
          )}

          <h5 className="mb-3">By delivery status</h5>
          <div className="table-responsive">
            <table className="table align-middle w-auto">
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
