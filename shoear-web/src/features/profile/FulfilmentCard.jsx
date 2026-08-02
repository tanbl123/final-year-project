import { useState } from 'react';
import { setAutoShip } from '../supplier/orders/orderService';

// Supplier fulfilment preference (Profile): auto-book & ship new Standard (3PL)
// parcels. A standing setting, so it lives here with the other supplier settings
// rather than in the Orders list toolbar.
function FulfilmentCard({ initialEnabled = false, onToast }) {
  const [enabled, setEnabled] = useState(initialEnabled);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function toggle(next) {
    setSaving(true);
    setError('');
    try {
      await setAutoShip(next);
      setEnabled(next);
      onToast?.(next
        ? 'Auto-ship on — new standard parcels will be booked & shipped automatically.'
        : 'Auto-ship off.');
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="card mt-4">
      <div className="card-body">
        <h5 className="mb-0">Fulfilment</h5>
        <small className="text-muted">How your standard (3PL) parcels are shipped.</small>

        {error && <div className="alert alert-danger py-2 mt-3 mb-0">{error}</div>}

        <div className="form-check form-switch mt-3">
          <input className="form-check-input" type="checkbox" role="switch" id="autoShipPref"
            checked={enabled} disabled={saving} onChange={(e) => toggle(e.target.checked)} />
          <label className="form-check-label" htmlFor="autoShipPref">Auto-ship new standard orders</label>
        </div>
        <div className="form-text">
          When on, every new standard (3PL) parcel is automatically booked with a courier and tracking
          number (via EasyParcel) — no manual step. You can still book or ship any order yourself from Orders.
        </div>
      </div>
    </div>
  );
}

export default FulfilmentCard;
