import { useState } from 'react';

const iso = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// Resolve a preset (+ optional custom dates) into { from, to, label }. from/to
// are 'YYYY-MM-DD' strings, or null for an all-time report.
export function rangeForPreset(preset, customFrom = '', customTo = '') {
  const now = new Date();
  switch (preset) {
    case '7d': {
      const f = new Date(now); f.setDate(f.getDate() - 6);
      return { from: iso(f), to: iso(now), label: 'Last 7 days' };
    }
    case '30d': {
      const f = new Date(now); f.setDate(f.getDate() - 29);
      return { from: iso(f), to: iso(now), label: 'Last 30 days' };
    }
    case 'month': {
      const f = new Date(now.getFullYear(), now.getMonth(), 1);
      return { from: iso(f), to: iso(now), label: 'This month' };
    }
    case 'custom':
      if (customFrom && customTo) return { from: customFrom, to: customTo, label: `${customFrom} to ${customTo}` };
      return { from: null, to: null, label: 'All time' };
    default:
      return { from: null, to: null, label: 'All time' };
  }
}

// Period selector for the reports. Calls onChange({ from, to, label }) when the
// user picks a preset, or completes a custom range.
export default function ReportPeriodBar({ onChange }) {
  const [preset, setPreset] = useState('all');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const apply = (p, f, t) => onChange(rangeForPreset(p, f, t));

  return (
    <div className="d-flex align-items-end gap-2 flex-wrap">
      <div>
        <label className="form-label small text-muted mb-1">Period</label>
        <select
          className="form-select form-select-sm"
          style={{ width: 150 }}
          value={preset}
          onChange={(e) => {
            const p = e.target.value;
            setPreset(p);
            if (p !== 'custom') apply(p, from, to);
          }}
        >
          <option value="all">All time</option>
          <option value="7d">Last 7 days</option>
          <option value="30d">Last 30 days</option>
          <option value="month">This month</option>
          <option value="custom">Custom…</option>
        </select>
      </div>
      {preset === 'custom' && (
        <>
          <div>
            <label className="form-label small text-muted mb-1">From</label>
            <input
              type="date" className="form-control form-control-sm" value={from}
              max={to || undefined}
              onChange={(e) => { setFrom(e.target.value); if (e.target.value && to) apply('custom', e.target.value, to); }}
            />
          </div>
          <div>
            <label className="form-label small text-muted mb-1">To</label>
            <input
              type="date" className="form-control form-control-sm" value={to}
              min={from || undefined}
              onChange={(e) => { setTo(e.target.value); if (from && e.target.value) apply('custom', from, e.target.value); }}
            />
          </div>
        </>
      )}
    </div>
  );
}
