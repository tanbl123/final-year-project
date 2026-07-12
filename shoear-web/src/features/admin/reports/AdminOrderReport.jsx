import { useEffect, useState } from 'react';
import { getAdminOrderReport } from '../adminService';
import { useAuth } from '../../auth/AuthContext';
import ReportPeriodBar from '../../../components/ReportPeriodBar';
import ReportPreviewModal from '../../../components/ReportPreviewModal';
import { ALL_TIME, rm, StatCard, CompanyFilter } from './reportUtils';

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

  function buildReportOpts() {
    return {
      title: company.id ? `Order & Fulfilment — ${company.name}` : 'Order & Fulfilment Report (Platform)',
      generatedBy: user?.fullName,
      period: range.label,
      referencePrefix: 'AOF',
      summary: [
        { label: 'Total orders', value: String(data.summary.totalOrders) },
        { label: company.id ? 'Merchandise value' : 'Total order value', value: rm(data.summary.totalValue) },
        { label: 'Delivered parcels', value: String(data.summary.delivered) },
        { label: 'Cancelled orders', value: String(data.summary.cancelled) },
        { label: 'On-time delivery rate', value: onTimeStr },
      ],
      head: ['Order status', 'Orders'],
      body: Object.entries(data.byStatus).map(([s, n]) => [LABELS[s] || s, n]),
      foot: [['Total', data.summary.totalOrders]],
      columnStyles: { 1: { halign: 'right' } },
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
            <StatCard label="Cancelled" value={data.summary.cancelled} color={data.summary.cancelled > 0 ? 'danger' : 'dark'} />
          </div>

          <h5 className="mb-3">By order status</h5>
          <div className="table-responsive">
            <table className="table align-middle">
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
