import { useEffect, useState } from 'react';
import { getAdminOrderReport } from '../adminService';
import { useAuth } from '../../auth/AuthContext';
import ReportPeriodBar from '../../../components/ReportPeriodBar';
import ReportPreviewModal from '../../../components/ReportPreviewModal';
import Pagination from '../../../components/Pagination';
import { usePagination } from '../../../hooks/usePagination';
import { ALL_TIME, rm, StatCard, CompanyFilter } from './reportUtils';

const PAGE_SIZE = 15;

const LABELS = {
  Placed: 'Placed (unpaid)', Paid: 'Paid', Processing: 'Processing', Shipped: 'Shipped',
  OutForDelivery: 'Out for delivery', Delivered: 'Delivered', Completed: 'Completed', Cancelled: 'Cancelled',
};

// Platform-wide orders by status + overall on-time delivery. `company` scopes it
// to one supplier's orders/parcels ('' id = all companies).
function AdminOrderReport({ company = { id: '', name: '' }, setCompany }) {
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
    getAdminOrderReport({ from: range.from, to: range.to, supplierId: company.id })
      .then((d) => { if (active) setData(d); })
      .catch((err) => { if (active) setError(err.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [range.from, range.to, company.id]);

  const has = !!data && data.summary.totalOrders > 0;
  const onTimeStr = data?.summary?.onTimeRate != null ? `${data.summary.onTimeRate}%` : '—';
  const cancelStr = data?.summary?.cancellationRate != null ? `${data.summary.cancellationRate}%` : '—';
  const shipDaysStr = data?.summary?.avgDeliveryDays != null ? `${data.summary.avgDeliveryDays} days` : '—';
  const pct = (v) => (v == null ? '—' : `${v}%`);
  const days = (v) => (v == null ? '—' : `${v}`);

  // paginate the on-screen per-supplier table only (export/PDF keeps every row)
  const rows = data?.bySupplier ?? [];
  const { page, setPage, totalPages, pageItems } = usePagination(rows, PAGE_SIZE, `${range.from}|${range.to}|${company.id}`);
  const failedTotal = rows.reduce((a, s) => a + s.failed, 0);

  function buildReportOpts() {
    return {
      title: company.id ? `Order & Fulfilment — ${company.name}` : 'Order & Fulfilment Report (Platform)',
      generatedBy: user?.fullName,
      period: range.label,
      referencePrefix: 'AOF',
      orientation: 'landscape',
      summary: [
        { label: 'Total orders', value: String(data.summary.totalOrders) },
        { label: company.id ? 'Merchandise value' : 'Total order value', value: rm(data.summary.totalValue) },
        { label: 'Delivered parcels', value: String(data.summary.delivered) },
        { label: 'On-time delivery rate', value: onTimeStr },
        { label: 'Avg delivery time', value: shipDaysStr },
        { label: 'Cancelled orders', value: String(data.summary.cancelled) },
        { label: 'Cancellation rate', value: cancelStr },
      ],
      head: ['Supplier', 'Orders', 'Delivered', 'On-time %', 'Avg days', 'Cancelled', 'Cancel rate', 'Failed'],
      body: data.bySupplier.map((s) => [
        s.companyName, s.orders, s.delivered, pct(s.onTimeRate), days(s.avgDeliveryDays),
        s.cancelled, pct(s.cancellationRate), s.failed,
      ]),
      foot: [['Total', data.summary.totalOrders, data.summary.delivered, onTimeStr, days(data.summary.avgDeliveryDays),
        data.summary.cancelled, cancelStr, failedTotal]],
      columnStyles: {
        1: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'right' },
        5: { halign: 'right' }, 6: { halign: 'right' }, 7: { halign: 'right' },
      },
    };
  }

  return (
    <div>
      <div className="d-flex justify-content-between align-items-end flex-wrap gap-2 mb-3">
        <p className="text-muted mb-0">
          {company.id ? `Orders containing ${company.name}'s products, and their delivery performance.` : 'All marketplace orders by status, and platform-wide on-time delivery.'}
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
      ) : !data ? null : data.summary.totalOrders === 0 ? (
        <div className="card card-body text-center text-muted">{company.id ? `No orders for ${company.name} in this period.` : 'No orders in this period.'}</div>
      ) : (
        <>
          <div className="row g-3 mb-4">
            <StatCard label="Total orders" value={data.summary.totalOrders} sub={rm(data.summary.totalValue)} />
            <StatCard label="Delivered" value={data.summary.delivered} color="success" />
            <StatCard label="On-time rate" value={onTimeStr} color="success" />
            <StatCard label="Avg delivery time" value={shipDaysStr} />
            <StatCard label="Cancelled" value={data.summary.cancelled} sub={`${cancelStr} of orders`} color={data.summary.cancelled > 0 ? 'danger' : 'dark'} />
          </div>

          <h5 className="mb-3">Fulfilment by supplier</h5>
          <div className="table-responsive mb-4">
            <table className="table align-middle">
              <thead>
                <tr>
                  <th>Supplier</th>
                  <th className="text-end">Orders</th>
                  <th className="text-end">Delivered</th>
                  <th className="text-end">On-time %</th>
                  <th className="text-end">Avg days</th>
                  <th className="text-end">Cancelled</th>
                  <th className="text-end">Cancel rate</th>
                  <th className="text-end">Failed</th>
                </tr>
              </thead>
              <tbody>
                {pageItems.map((s) => (
                  <tr key={s.supplierId}>
                    <td className="fw-semibold">{s.companyName}</td>
                    <td className="text-end">{s.orders}</td>
                    <td className="text-end">{s.delivered}</td>
                    <td className="text-end">{pct(s.onTimeRate)}</td>
                    <td className="text-end">{days(s.avgDeliveryDays)}</td>
                    <td className="text-end">{s.cancelled}</td>
                    <td className={'text-end ' + (s.cancellationRate > 0 ? 'text-danger' : '')}>{pct(s.cancellationRate)}</td>
                    <td className={'text-end ' + (s.failed > 0 ? 'text-danger' : 'text-muted')}>{s.failed}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="fw-semibold border-top">
                  <td>Total</td>
                  <td className="text-end">{data.summary.totalOrders}</td>
                  <td className="text-end">{data.summary.delivered}</td>
                  <td className="text-end">{onTimeStr}</td>
                  <td className="text-end">{days(data.summary.avgDeliveryDays)}</td>
                  <td className="text-end">{data.summary.cancelled}</td>
                  <td className="text-end">{cancelStr}</td>
                  <td className="text-end">{failedTotal}</td>
                </tr>
              </tfoot>
            </table>

            <Pagination page={page} totalPages={totalPages} onChange={setPage}
              summary={`Page ${page} of ${totalPages} · ${rows.length} suppliers · export includes all rows`} />
          </div>

          <h5 className="mb-3">By order status</h5>
          <div className="table-responsive">
            <table className="table align-middle w-auto">
              <thead>
                <tr>
                  <th>Order status</th>
                  <th className="text-end" style={{ width: 140 }}>Orders</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(data.byStatus).map(([s, n]) => (
                  <tr key={s}>
                    <td>{LABELS[s] || s}</td>
                    <td className="text-end">{n}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="fw-semibold border-top">
                  <td>Total</td>
                  <td className="text-end">{data.summary.totalOrders}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

export default AdminOrderReport;
