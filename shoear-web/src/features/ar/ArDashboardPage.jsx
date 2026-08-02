import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getArStats, getArQueue, getArCompleted } from '../admin/adminService';

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

// Whole days since a timestamp, with a colour tone (amber ≥3d, red ≥7d).
function waitDays(createdAt) {
  const days = Math.max(0, Math.floor((Date.now() - new Date(createdAt).getTime()) / 86400000));
  const tone = days >= 7 ? 'danger' : days >= 3 ? 'warning' : 'muted';
  const label = days === 0 ? 'today' : days === 1 ? '1 day' : `${days} days`;
  return { days, tone, label };
}

// AR Specialist landing page: headline numbers, the next items to work on, and
// recent activity — an at-a-glance, actionable overview.
function ArDashboardPage() {
  const [stats, setStats] = useState(null);
  const [queue, setQueue] = useState([]);
  const [recent, setRecent] = useState([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    Promise.all([getArStats(), getArQueue(), getArCompleted()])
      .then(([s, q, c]) => {
        if (!active) return;
        setStats(s);
        setQueue(q.products || []);
        setRecent(c.products || []);
      })
      .catch((err) => { if (active) setError(err.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  const fmt = (d) => (d ? new Date(d).toLocaleString() : '—');
  const nextUp = queue.slice(0, 5);           // getArQueue is oldest-first
  const recentFive = recent.slice(0, 5);      // getArCompleted is newest-first

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
          <div className="row g-3 mb-4">
            <Stat label="Awaiting preparation" value={stats.awaiting} tone="warning"
              hint="Try-on products with no lens yet" />
            <Stat label="Prepared this week" value={stats.preparedThisWeek} tone="success"
              hint="AR-ready in the last 7 days" />
            <Stat label="Prepared (all time)" value={stats.prepared} tone="primary"
              hint="Total products made AR-ready" />
          </div>

          <div className="row g-3">
            {/* Next in the queue — the longest-waiting items */}
            <div className="col-lg-6">
              <div className="card h-100">
                <div className="card-header d-flex justify-content-between align-items-center">
                  <span className="fw-semibold">Next in the queue</span>
                  <Link to="/ar/queue" className="btn btn-sm btn-outline-primary">
                    Go to queue{stats.awaiting > 0 ? ` (${stats.awaiting})` : ''}
                  </Link>
                </div>
                <div className="list-group list-group-flush">
                  {nextUp.length === 0 ? (
                    <div className="list-group-item text-muted text-center py-4">
                      Nothing awaiting — all caught up 🎉
                    </div>
                  ) : nextUp.map((p) => {
                    const w = waitDays(p.created_at);
                    return (
                      <div key={p.productId} className="list-group-item d-flex justify-content-between align-items-center">
                        <div style={{ overflowWrap: 'anywhere' }}>
                          <div className="fw-semibold">{p.productName}</div>
                          <div className="text-muted small">{p.productBrand} · {p.categoryName}</div>
                        </div>
                        <span className={w.tone === 'muted' ? 'text-muted small' : `text-${w.tone} small fw-semibold`}>
                          {w.label}{w.days >= 7 && ' ⚠'}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Recently prepared — recent activity */}
            <div className="col-lg-6">
              <div className="card h-100">
                <div className="card-header d-flex justify-content-between align-items-center">
                  <span className="fw-semibold">Recently prepared</span>
                  <Link to="/ar/completed" className="btn btn-sm btn-outline-secondary">View all</Link>
                </div>
                <div className="list-group list-group-flush">
                  {recentFive.length === 0 ? (
                    <div className="list-group-item text-muted text-center py-4">Nothing prepared yet.</div>
                  ) : recentFive.map((p) => (
                    <div key={p.productId} className="list-group-item d-flex justify-content-between align-items-center">
                      <div style={{ overflowWrap: 'anywhere' }}>
                        <div className="fw-semibold">{p.productName}</div>
                        <div className="text-muted small">
                          {p.productBrand}{p.preparedBy ? ` · by ${p.preparedBy}` : ''}
                        </div>
                      </div>
                      <span className="text-muted small text-nowrap">{fmt(p.arReadyAt)}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export default ArDashboardPage;
