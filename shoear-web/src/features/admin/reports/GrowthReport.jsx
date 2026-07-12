import { useEffect, useState } from 'react';
import { getAdminGrowthReport } from '../adminService';
import { useAuth } from '../../auth/AuthContext';
import ReportPeriodBar from '../../../components/ReportPeriodBar';
import ReportPreviewModal from '../../../components/ReportPreviewModal';
import { ALL_TIME, StatCard } from './reportUtils';

const ROLE_LABELS = {
  Customer: 'Customers', Supplier: 'Suppliers', DeliveryPersonnel: 'Couriers', Admin: 'Admins',
};

// New sign-ups by role over the period.
function GrowthReport() {
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
    getAdminGrowthReport({ from: range.from, to: range.to })
      .then((d) => { if (active) setData(d); })
      .catch((err) => { if (active) setError(err.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [range.from, range.to]);

  const has = !!data && data.summary.newUsers > 0;

  function buildReportOpts() {
    return {
      title: 'User Growth Report',
      generatedBy: user?.fullName,
      period: range.label,
      referencePrefix: 'GR',
      summary: [
        { label: 'New users', value: String(data.summary.newUsers) },
        { label: 'New customers', value: String(data.summary.newCustomers) },
        { label: 'New suppliers', value: String(data.summary.newSuppliers) },
        { label: 'New couriers', value: String(data.summary.newCouriers) },
      ],
      head: ['Role', 'New sign-ups'],
      body: Object.entries(data.byRole).map(([r, n]) => [ROLE_LABELS[r] || r, n]),
      foot: [['Total', data.summary.newUsers]],
      columnStyles: { 1: { halign: 'right' } },
    };
  }

  return (
    <div>
      <div className="d-flex justify-content-between align-items-end flex-wrap gap-2 mb-3">
        <p className="text-muted mb-0">New registrations by role over the selected period.</p>
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
      ) : !data ? null : data.summary.newUsers === 0 ? (
        <div className="card card-body text-center text-muted">No new sign-ups in this period.</div>
      ) : (
        <>
          <div className="row g-3 mb-4">
            <StatCard label="New users" value={data.summary.newUsers} />
            <StatCard label="Customers" value={data.summary.newCustomers} color="success" />
            <StatCard label="Suppliers" value={data.summary.newSuppliers} />
            <StatCard label="Couriers" value={data.summary.newCouriers} />
          </div>

          <h5 className="mb-3">By role</h5>
          <div className="table-responsive">
            <table className="table align-middle">
              <thead>
                <tr>
                  <th>Role</th>
                  <th className="text-end" style={{ width: 160 }}>New sign-ups</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(data.byRole).map(([r, n]) => (
                  <tr key={r}>
                    <td>{ROLE_LABELS[r] || r}</td>
                    <td className="text-end">{n}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="fw-semibold border-top">
                  <td>Total</td>
                  <td className="text-end">{data.summary.newUsers}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

export default GrowthReport;
