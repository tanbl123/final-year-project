// Shared helpers for the admin report tabs (constants + a small KPI card).
/* eslint-disable react-refresh/only-export-components */
import { useEffect, useState } from 'react';
import { getReportCompanies } from '../adminService';

export const ALL_TIME = { from: null, to: null, label: 'All time' };

export const rm = (n) =>
  'RM ' + Number(n || 0).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

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

// "Company" filter dropdown for the platform reports. Controlled: `value` is the
// selected supplierId ('' = all companies); onChange(supplierId, companyName).
// Fetches the active-supplier list once on mount.
export function CompanyFilter({ value, onChange }) {
  const [companies, setCompanies] = useState([]);
  useEffect(() => {
    let active = true;
    getReportCompanies()
      .then((d) => { if (active) setCompanies(d.companies || []); })
      .catch(() => { /* leave empty — the report still works for "all companies" */ });
    return () => { active = false; };
  }, []);

  return (
    <div>
      <label className="form-label small text-muted mb-1">Company</label>
      <select
        className="form-select form-select-sm"
        style={{ width: 190 }}
        value={value}
        onChange={(e) => {
          const id = e.target.value;
          const name = companies.find((c) => c.supplierId === id)?.companyName || '';
          onChange(id, name);
        }}
      >
        <option value="">All companies</option>
        {companies.map((c) => (
          <option key={c.supplierId} value={c.supplierId}>{c.companyName}</option>
        ))}
      </select>
    </div>
  );
}
