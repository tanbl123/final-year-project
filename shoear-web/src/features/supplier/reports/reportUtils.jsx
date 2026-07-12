// Shared helpers for the supplier report tabs (constants + a small KPI card).
/* eslint-disable react-refresh/only-export-components */

export const ALL_TIME = { from: null, to: null, label: 'All time' };

export const rm = (n) =>
  'RM ' + Number(n || 0).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// A compact KPI card used across the report tabs.
export function StatCard({ label, value, sub, color = 'dark' }) {
  return (
    <div className="col-6 col-lg-3">
      <div className="card h-100">
        <div className="card-body">
          <div className="text-muted small text-uppercase">{label}</div>
          <div className={`fs-4 fw-semibold text-${color}`}>{value}</div>
          {sub && <div className="text-muted small">{sub}</div>}
        </div>
      </div>
    </div>
  );
}
