// Searchable single-select (combobox) with no external dependency — a text
// input that filters `options` as you type and shows matches in a dropdown.
// Built for lists too long to scroll comfortably in a native <select> (e.g. the
// reports "Company" filter, or the product "Category" picker — both admin-grown
// and unbounded). Filtering is client-side, which is fine for hundreds of
// options; a much larger list would want server-side search instead.
//
// Controlled: `value` is the selected option id; `onChange(id, label)` fires on
// pick (and with ('', '') when the field is cleared). `options` is
// [{ id, label }]. Pass `allLabel` to show a reset row (e.g. "All companies")
// whose id is '' — omit it for a required field, where an empty value means
// "nothing chosen yet" and the placeholder shows instead.
//
// For form use: `invalid` toggles Bootstrap's is-invalid styling and `onBlur`
// fires when focus leaves (so the field can be marked "touched" and validated).
//
// Mirrors the suggestion-dropdown pattern used in AddressFields (list-group,
// onMouseDown to beat the input blur, blur-with-timeout to close) so it behaves
// consistently with the rest of the app.
import { useEffect, useMemo, useRef, useState } from 'react';

function SearchableSelect({
  value,
  onChange,
  options,
  allLabel = '',          // truthy → show a reset row with this label (id '')
  placeholder = 'Search…',
  invalid = false,
  onBlur,
  id,
  width = 200,
  size = 'sm',
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [highlight, setHighlight] = useState(0);
  const listRef = useRef(null);

  const hasAll = !!allLabel;
  const selectedLabel = value
    ? (options.find((o) => o.id === value)?.label ?? '')
    : allLabel;   // '' when there is no reset row → placeholder shows

  // match the dropdown's text size to the input's (sm vs default) so the
  // placeholder/selection and the list rows read as one control
  const fontSize = size === 'sm' ? '0.875rem' : '1rem';

  // optional "reset" row + options filtered by the typed query (case-insensitive)
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matches = q
      ? options.filter((o) => String(o.label).toLowerCase().includes(q))
      : options;
    const showAll = hasAll && (!q || allLabel.toLowerCase().includes(q));
    return showAll ? [{ id: '', label: allLabel }, ...matches] : matches;
  }, [options, query, allLabel, hasAll]);

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

  function clear() {
    onChange('', '');
    setQuery('');
    setOpen(false);
  }

  function onKeyDown(e) {
    if (e.key === 'Escape') { setOpen(false); return; }
    if (!open && (e.key === 'ArrowDown' || e.key === 'Enter')) { setOpen(true); setHighlight(0); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); setHighlight((h) => Math.min(h + 1, rows.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHighlight((h) => Math.max(h - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); if (rows[highlight]) pick(rows[highlight]); }
  }

  // show the clear "×" once something is selected (not while it's still empty)
  const showClear = !!value;

  return (
    <div className="position-relative" style={{ width }}>
      <input
        id={id}
        // Bootstrap only has -sm / -lg; treat 'md' as the default (no suffix)
        className={'form-control' + (size && size !== 'md' ? ` form-control-${size}` : '')
          + (showClear ? ' pe-5' : '') + (invalid ? ' is-invalid' : '')}
        role="combobox"
        aria-expanded={open}
        autoComplete="off"
        placeholder={placeholder}
        value={open ? query : selectedLabel}
        onFocus={() => { setOpen(true); setQuery(''); setHighlight(0); }}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); setHighlight(0); }}
        onKeyDown={onKeyDown}
        onBlur={() => { setTimeout(() => setOpen(false), 150); if (onBlur) onBlur(); }}
      />
      {showClear && (
        <button type="button" aria-label="Clear" className="btn-close position-absolute"
          style={{ top: '50%', right: 12, transform: 'translateY(-50%)', fontSize: '0.7rem' }}
          // onMouseDown (not onClick) so it fires before the input's blur closes things
          onMouseDown={(e) => { e.preventDefault(); clear(); }} />
      )}
      {open && (
        <ul ref={listRef} role="listbox"
          className="list-group position-absolute w-100 shadow-sm"
          style={{ zIndex: 1000, maxHeight: 260, overflowY: 'auto', fontSize }}>
          {rows.length === 0 ? (
            <li className="list-group-item py-2 text-muted small">No matches.</li>
          ) : rows.map((row, i) => (
            <li key={row.id || '__all'} role="option" aria-selected={row.id === value}
              className={'list-group-item list-group-item-action py-2 d-flex justify-content-between align-items-start'
                + (i === highlight ? ' active' : '')}
              style={{ cursor: 'pointer' }}
              onMouseEnter={() => setHighlight(i)}
              onMouseDown={(ev) => { ev.preventDefault(); pick(row); }}>
              {/* wrap long names onto a second line rather than truncating */}
              <span style={{ overflowWrap: 'anywhere' }}>{row.label}</span>
              {row.id === value && <span className="ms-2">✓</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default SearchableSelect;
