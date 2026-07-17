import { useEffect, useRef, useState } from 'react';
import { bootstrapCameraKit } from '@snap/camera-kit';
import { getCameraKitConfig } from '../adminService';

// Admin lens PICKER. Loads the ShoeAR Camera Kit lens group with the Snap Web SDK
// (using a staging token the backend hands only to a logged-in admin) and shows
// the group's lenses as a thumbnail list, so the admin picks the right shoe lens
// instead of pasting a raw UUID. The parent keeps a paste box as a fallback.
//
// NOTE: bootstrapCameraKit downloads the Web SDK (WASM). It runs client-side
// because Snap exposes no server-side lens-list API.
function LensPicker({ selectedLensId, onPick, disabled }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [lenses, setLenses] = useState([]);
  const ckRef = useRef(null);

  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true);
      setError('');
      try {
        const { apiToken, groupId } = await getCameraKitConfig();
        if (!apiToken) throw new Error('Camera Kit token not configured on the server (config.local.php → camerakit_api_token).');
        if (!groupId) throw new Error('Camera Kit lens group id not configured.');
        const cameraKit = await bootstrapCameraKit({ apiToken });
        ckRef.current = cameraKit;
        const { lenses: list } = await cameraKit.lensRepository.loadLensGroups([groupId]);
        if (active) setLenses(list || []);
      } catch (err) {
        if (active) setError(err?.message || 'Could not load lenses from Camera Kit.');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
      // best-effort cleanup of the SDK instance
      try { ckRef.current?.destroy?.(); } catch { /* ignore */ }
    };
  }, []);

  if (loading) {
    return <div className="text-muted small py-2">Loading lenses from Camera Kit…</div>;
  }
  if (error) {
    return (
      <div className="alert alert-warning small mb-0">
        Couldn’t load the lens picker: {error}
        <div className="mt-1">Use the manual lens-id box below instead.</div>
      </div>
    );
  }
  if (lenses.length === 0) {
    return <div className="text-muted small py-2">No lenses found in the Camera Kit group yet. Publish a lens to it, or paste the id below.</div>;
  }

  return (
    <div className="d-flex flex-wrap gap-2">
      {lenses.map((lens) => {
        const active = lens.id === selectedLensId;
        return (
          <button
            key={lens.id}
            type="button"
            disabled={disabled}
            onClick={() => onPick(lens.id)}
            className={`btn p-1 text-center ${active ? 'btn-primary' : 'btn-outline-secondary'}`}
            style={{ width: 96 }}
            title={`${lens.name || 'Lens'}\n${lens.id}`}
          >
            {lens.iconUrl
              ? <img src={lens.iconUrl} alt={lens.name || 'lens'} style={{ width: 64, height: 64, objectFit: 'cover', borderRadius: 8 }} />
              : <div style={{ width: 64, height: 64, borderRadius: 8, background: '#e9ecef' }} className="d-flex align-items-center justify-content-center">👟</div>}
            <div className="small text-truncate mt-1" style={{ maxWidth: 88 }}>{lens.name || lens.id.slice(0, 8)}</div>
          </button>
        );
      })}
    </div>
  );
}

export default LensPicker;
