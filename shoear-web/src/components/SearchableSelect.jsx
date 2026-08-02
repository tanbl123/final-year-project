// Searchable single-select (combobox) with no external dependency — a text
// input that filters `options` as you type and shows matches in a dropdown.
// Built for lists too long to scroll comfortably in a native <select> (e.g. the
// reports "Company" filter once there are many suppliers). Filtering is
// client-side, which is fine for hundreds of options; a much larger list would
// want server-side search instead.
//
// Controlled: `value` is the selected option id ('' = the reset / "all" row).
// `onChange(id, label)` fires on pick (label is '' for the reset row).
// `options` is [{ id, label }]. Mirrors the suggestion-dropdown pattern used in
// AddressFields (list-group, onMouseDown to beat the input blur, blur-with-
// timeout to close) so it behaves consistently with the rest of the app.
import { useEffect, useMemo, useRef, useState } from 'react';

function SearchableSelect({
  value,
  onChange,
  options,
  allLabel = 'All',
  placeholder = 'Search…',
  width = 200,
  size = 'sm',
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [highlight, setHighlight] = useState(0);
  const listRef = useRef(null);

  const selectedLabel = value
    ? (options.find((o) => o.id === value)?.label ?? allLabel)
    : allLabel;

  // "All" reset row + options filtered by the typed query (case-insensitive).
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matches = q
      ? options.filter((o) => String(o.label).toLowerCase().includes(q))
      : options;
    // keep the reset row unless the query would exclude it
    return (!q || allLabel.toLowerCase().includes(q))
      ? [{ id: '', label: allLabel }, ...matches]
      : matches;
  }, [options, query, allLabel]);

  // keep the highlighted row scrolled into view during keyboard navigation
  useEffect(() => {
    const el = listRef.current?.children?.[highlight];
    if (el) el.scrollIntoView({ block: 'nearest' });
  }, [highlight]);

  function pick(row) {
    onChange(row.id, row.id ? row.label : '');
    setOpen(false);
    setQuery('');
  }

  function onKeyDown(e) {
    if (e.key === 'Escape') { setOpen(false); return; }
    if (!open && (e.key === 'ArrowDown' || e.key === 'Enter')) { setOpen(true); setHighlight(0); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); setHighlight((h) => Math.min(h + 1, rows.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHighlight((h) => Math.max(h - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); if (rows[highlight]) pick(rows[highlight]); }
  }

  return (
    <div className="position-relative" style={{ width }}>
      <input
        className={`form-control form-control-${size}`}
        role="combobox"
        aria-expanded={open}
        autoComplete="off"
        placeholder={placeholder}
        value={open ? query : selectedLabel}
        onFocus={() => { setOpen(true); setQuery(''); setHighlight(0); }}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); setHighlight(0); }}
        onKeyDown={onKeyDown}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
      />
      {open && (
        <ul ref={listRef} role="listbox" className="list-group position-absolute w-100 shadow-sm"
          style={{ zIndex: 1000, maxHeight: 260, overflowY: 'auto' }}>
          {rows.length === 0 ? (
            <li className="list-group-item py-2 text-muted small">No matches.</li>
          ) : rows.map((row, i) => (
            <li key={row.id || '__all'} role="option" aria-selected={row.id === value}
              className={'list-group-item list-group-item-action py-2 d-flex justify-content-between'
                + (i === highlight ? ' active' : '')}
              style={{ cursor: 'pointer' }}
              onMouseEnter={() => setHighlight(i)}
              onMouseDown={(ev) => { ev.preventDefault(); pick(row); }}>
              <span className="text-truncate">{row.label}</span>
              {row.id === value && <span className="ms-2">✓</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default SearchableSelect;
