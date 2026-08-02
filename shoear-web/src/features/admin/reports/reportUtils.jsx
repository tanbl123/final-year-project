// Shared helpers for the admin report tabs (constants + a small KPI card).
/* eslint-disable react-refresh/only-export-components */
import { useEffect, useState } from 'react';
import { getReportCompanies } from '../adminService';
import SearchableSelect from '../../../components/SearchableSelect';

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

// "Company" filter for the platform reports. Controlled: `value` is the selected
// supplierId ('' = all companies); onChange(supplierId, companyName). Fetches the
// active-supplier list once on mount. Uses a searchable combobox so the filter
// stays usable when there are many suppliers (a flat <select> of hundreds is
// unscrollable).
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
      <SearchableSelect
        value={value}
        onChange={onChange}
        options={companies.map((c) => ({ id: c.supplierId, label: c.companyName }))}
        allLabel="All companies"
        placeholder="Search company…"
        width={220}
      />
    </div>
  );
}
