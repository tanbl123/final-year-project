import { useState } from 'react';
import ClearableInput from '../../components/ClearableInput';
import { updateStoreName } from '../auth/authService';

const COOLDOWN_DAYS = 30;

// The customer-facing store name (separate from the verified legal company name).
// Self-editable, but throttled by a 30-day cooldown — mirrors Shopee/Etsy, and
// deters a seller building trust as one brand then switching to impersonate
// another. The legal company name lives in Business details (admin-reviewed).
function StoreNameCard({ initialName, updatedAt, onSaved, onToast }) {
  const [name, setName] = useState(initialName || '');
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(initialName || '');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [nextAt, setNextAt] = useState(updatedAt || null);

  // when can the name next be changed? (last change + cooldown)
  const nextAllowed = nextAt ? new Date(nextAt).getTime() + COOLDOWN_DAYS * 86400000 : 0;
  // eslint-disable-next-line react-hooks/purity
  const locked = Date.now() < nextAllowed;
  const nextDate = new Date(nextAllowed).toLocaleDateString('en-MY', { day: 'numeric', month: 'short', year: 'numeric' });

  function validate(v) {
    const t = v.trim();
    if (t === '') return 'Store name is required.';
    if (t.length < 2 || t.length > 60) return 'Store name must be 2–60 characters.';
    if (!/^[\p{L}\p{N}][\p{L}\p{N} .,&'-]*$/u.test(t)) return "Only letters, numbers, spaces and . , & ' -";
    return '';
  }

  async function save() {
    const err = validate(draft);
    if (err) { setError(err); return; }
    setSaving(true);
    setError('');
    try {
      const res = await updateStoreName(draft.trim());
      setName(res.displayName);
      setNextAt(res.nextChangeAt || new Date().toISOString());
      setEditing(false);
      onSaved?.(res.displayName);
      onToast?.('Store name updated.');
    } catch (e) {
      setError(e.message || 'Could not update the store name.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="card mt-4">
      <div className="card-body">
        <h5 className="card-title mb-1">Store name</h5>
        <p className="text-muted small mb-3">
          This is the shop name customers see. It&apos;s separate from your legal company
          name (in Business details) and can be changed once every {COOLDOWN_DAYS} days.
        </p>

        {!editing ? (
          <div className="d-flex justify-content-between align-items-center">
            <div className="fw-semibold fs-5">{name || <span className="text-muted">—</span>}</div>
            <button className="btn btn-outline-primary btn-sm"
              disabled={locked}
              title={locked ? `You can change this again on ${nextDate}` : 'Change store name'}
              onClick={() => { setDraft(name); setError(''); setEditing(true); }}>
              Change
            </button>
          </div>
        ) : (
          <>
            <ClearableInput type="text" maxLength="60" autoFocus
              className={error ? 'is-invalid' : ''}
              value={draft}
              onChange={(e) => { setDraft(e.target.value); setError(''); }}
              onClear={() => setDraft('')} />
            {error && <div className="invalid-feedback d-block">{error}</div>}
            <div className="d-flex gap-2 mt-2">
              <button className="btn btn-primary btn-sm" disabled={saving || draft.trim() === name}
                onClick={save}>{saving ? 'Saving…' : 'Save'}</button>
              <button className="btn btn-outline-secondary btn-sm" disabled={saving}
                onClick={() => { setEditing(false); setError(''); }}>Cancel</button>
            </div>
          </>
        )}

        {locked && !editing && (
          <div className="form-text mt-2">You can change your store name again on <strong>{nextDate}</strong>.</div>
        )}
      </div>
    </div>
  );
}

export default StoreNameCard;
