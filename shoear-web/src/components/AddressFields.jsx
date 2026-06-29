// Reusable structured Malaysian address inputs (line 1, optional line 2,
// postcode, city, state). Used for the supplier's operational (pickup) address
// at registration and in profile management, and shaped to match the structured
// address the customer app collects, so the whole platform is consistent.
//
// Controlled: pass `value` ({ line1, line2, postcode, city, state }) and an
// `onChange` that receives the next value. `errors` is a { field: message } map.
// Constants/helpers (MY_STATES, emptyAddress, validateAddress) live in
// ./addressUtils so this file only exports the component (fast-refresh safe).
// Typing a 5-digit postcode auto-fills city + state from the offline Malaysian
// postcode dataset (postcodeLookup). Typing line 1 also shows Google Places
// suggestions when the backend has a Places key (else it's a plain field) —
// both mirror the customer's address form.
import { useEffect, useRef, useState } from 'react';
import { MY_STATES } from './addressUtils';
import { lookupPostcode } from './postcodeLookup';
import { placesAutocomplete, placeDetails, newSessionToken } from './placesService';

function AddressFields({ value, onChange, errors = {}, disabled = false, idPrefix = 'addr' }) {
  // keep the freshest value for the async lookup callbacks
  const latest = useRef(value);
  useEffect(() => { latest.current = value; }, [value]);
  const [autofilled, setAutofilled] = useState(false);

  // Places autocomplete state
  const [suggestions, setSuggestions] = useState([]);
  const sessionRef = useRef('');     // current Places billing session token
  const debounceRef = useRef(null);  // line-1 typing debounce
  useEffect(() => () => { if (debounceRef.current) clearTimeout(debounceRef.current); }, []);

  const cls = (key) => 'form-control' + (errors[key] ? ' is-invalid' : '');
  // editing city/state by hand clears the "filled from postcode" hint
  const set = (key) => (e) => {
    if (key === 'city' || key === 'state') setAutofilled(false);
    onChange({ ...value, [key]: e.target.value });
  };

  // postcode → auto-fill city + state (postcode is authoritative, like the
  // customer form). Only applies if the postcode hasn't changed since the lookup.
  const onPostcode = (e) => {
    const postcode = e.target.value;
    setAutofilled(false);
    onChange({ ...value, postcode });
    if (/^\d{5}$/.test(postcode)) {
      lookupPostcode(postcode).then((hit) => {
        if (!hit || latest.current.postcode !== postcode) return;
        onChange({ ...latest.current, city: hit.city, state: hit.state });
        setAutofilled(true);
      });
    }
  };

  // line 1 → debounced Places suggestions (no-op when Places is disabled)
  const onLine1 = (e) => {
    const line1 = e.target.value;
    onChange({ ...value, line1 });
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (line1.trim().length < 3) { setSuggestions([]); return; }
    debounceRef.current = setTimeout(async () => {
      if (!sessionRef.current) sessionRef.current = newSessionToken();
      setSuggestions(await placesAutocomplete(line1, sessionRef.current));
    }, 300);
  };

  // user picked a suggestion → resolve it and fill the structured fields
  const pickSuggestion = async (s) => {
    setSuggestions([]);
    const session = sessionRef.current || newSessionToken();
    const addr = await placeDetails(s.placeId, session);
    sessionRef.current = '';   // closes the billing session
    const line1 = (addr && addr.line1) || s.mainText || s.description || latest.current.line1;
    onChange({
      ...latest.current,
      line1,
      postcode: (addr && addr.postcode) || latest.current.postcode,
      city: (addr && addr.city) || latest.current.city,
      state: (addr && addr.state) || latest.current.state,
    });
    setAutofilled(!!(addr && (addr.city || addr.state)));
  };

  return (
    <div className="row g-2">
      <div className="col-12 position-relative">
        <label htmlFor={`${idPrefix}-line1`} className="form-label small mb-1">Address line</label>
        <input id={`${idPrefix}-line1`} className={cls('line1')} value={value.line1}
          onChange={onLine1} disabled={disabled} autoComplete="off"
          onBlur={() => setTimeout(() => setSuggestions([]), 150)}
          placeholder="Unit, street, building, area" maxLength={150} />
        {suggestions.length > 0 && (
          <ul className="list-group position-absolute w-100 shadow-sm"
            style={{ zIndex: 1000, maxHeight: 240, overflowY: 'auto' }}>
            {suggestions.map((s) => (
              <li key={s.placeId} className="list-group-item list-group-item-action py-2"
                style={{ cursor: 'pointer' }}
                onMouseDown={(ev) => { ev.preventDefault(); pickSuggestion(s); }}>
                <div className="small fw-semibold">{s.mainText || s.description}</div>
                {s.mainText && <div className="text-muted" style={{ fontSize: 12 }}>{s.description}</div>}
              </li>
            ))}
          </ul>
        )}
        {errors.line1 && <div className="invalid-feedback d-block">{errors.line1}</div>}
      </div>

      <div className="col-sm-4">
        <label htmlFor={`${idPrefix}-postcode`} className="form-label small mb-1">Postcode</label>
        <input id={`${idPrefix}-postcode`} className={cls('postcode')} value={value.postcode}
          onChange={onPostcode} disabled={disabled} inputMode="numeric" maxLength={5} placeholder="50480" />
        {errors.postcode && <div className="invalid-feedback d-block">{errors.postcode}</div>}
      </div>

      <div className="col-sm-8">
        <label htmlFor={`${idPrefix}-city`} className="form-label small mb-1">City</label>
        <input id={`${idPrefix}-city`} className={cls('city')} value={value.city}
          onChange={set('city')} disabled={disabled} maxLength={100} placeholder="Kuala Lumpur" />
        {errors.city && <div className="invalid-feedback d-block">{errors.city}</div>}
      </div>

      <div className="col-12">
        <label htmlFor={`${idPrefix}-state`} className="form-label small mb-1">State</label>
        <select id={`${idPrefix}-state`} className={'form-select' + (errors.state ? ' is-invalid' : '')}
          value={value.state} onChange={set('state')} disabled={disabled}>
          <option value="">Select a state…</option>
          {MY_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        {errors.state && <div className="invalid-feedback d-block">{errors.state}</div>}
        {autofilled && <div className="form-text text-success">✓ City &amp; state filled from postcode.</div>}
      </div>
    </div>
  );
}

export default AddressFields;
