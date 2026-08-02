import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getArStats } from '../admin/adminService';

// A KPI tile.
function Stat({ label, value, tone = 'primary', hint }) {
  return (
    <div className="col-sm-6 col-lg-4">
      <div className="card card-body h-100">
        <div className={`fs-2 fw-bold text-${tone}`}>{value}</div>
        <div className="fw-semibold">{label}</div>
        {hint && <div className="text-muted small">{hint}</div>}
      </div>
    </div>
  );
}

// AR Specialist landing page: headline numbers + a jump into the work queue.
function ArDashboardPage() {
  const [stats, setStats] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    getArStats()
      .then((s) => { if (active) setStats(s); })
      .catch((err) => { if (active) setError(err.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  return (
    <div className="container py-4 text-start">
      <h1 className="mb-1">📊 AR Studio</h1>
      <p className="text-muted">
        Prepare products for virtual try-on: run the auto-fit, record the Camera Kit lens,
        and hand off to the admin for final approval.
      </p>

      {error && <div className="alert alert-danger py-2">{error}</div>}

      {loading ? (
        <p className="text-muted">Loading…</p>
      ) : stats && (
        <>
          <div className="row g-3 mb-3">
            <Stat label="Awaiting preparation" value={stats.awaiting} tone="warning"
              hint="Try-on products with no lens yet" />
            <Stat label="Prepared this week" value={stats.preparedThisWeek} tone="success"
              hint="AR-ready in the last 7 days" />
            <Stat label="Prepared (all time)" value={stats.prepared} tone="primary"
              hint="Total products made AR-ready" />
          </div>

          <div className="d-flex gap-2">
            <Link to="/ar/queue" className="btn btn-primary">
              Go to AR Queue{stats.awaiting > 0 ? ` (${stats.awaiting})` : ''}
            </Link>
            <Link to="/ar/completed" className="btn btn-outline-secondary">View completed</Link>
          </div>
        </>
      )}
    </div>
  );
}

export default ArDashboardPage;
