import { useRef, useState } from 'react';
import { uploadImage, submitCompanyLogo } from '../auth/authService';

// Customer-facing company logo (square). The supplier uploads it, but an admin
// must approve it before it goes live. A new upload sits as "Pending review"
// while the current approved logo (if any) stays live.
function CompanyLogoCard({ profile, onSaved, onToast }) {
  const fileRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const liveUrl  = profile?.companyPhotoUrl || null;
  const status   = profile?.companyPhotoStatus || 'None';
  const pending  = status === 'Pending';
  const rejected = status === 'Rejected';

  async function onPick(e) {
    const file = e.target.files?.[0];
    e.target.value = '';           // allow re-picking the same file later
    if (!file) return;
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) { setError('Please choose a JPG, PNG or WebP image.'); return; }
    if (file.size > 5 * 1024 * 1024) { setError('Image must be 5 MB or smaller.'); return; }
    setBusy(true); setError('');
    try {
      const { url } = await uploadImage(file);
      await submitCompanyLogo(url);
      onToast?.('Company logo submitted for review.');
      onSaved?.();                 // reload profile so the status reflects Pending
    } catch (err) {
      setError(err.message || 'Could not upload the logo.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card mt-4">
      <div className="card-body">
        <h5 className="card-title mb-1">Company logo</h5>
        <p className="text-muted small mb-3">
          A square logo customers will see for your store. New logos are reviewed by
          an admin before they go live.
        </p>

        <div className="d-flex align-items-center gap-3">
          <div className="border rounded bg-light d-flex align-items-center justify-content-center overflow-hidden flex-shrink-0"
            style={{ width: 96, height: 96 }}>
            {liveUrl
              ? <img src={liveUrl} alt="Company logo" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              : <span className="text-muted small">No logo</span>}
          </div>
          <div>
            {pending && <span className="badge text-bg-warning">Pending review</span>}
            {rejected && <span className="badge text-bg-danger">Last submission rejected</span>}
            {status === 'Approved' && liveUrl && <span className="badge text-bg-success">Approved</span>}
            {rejected && profile?.companyPhotoNote && (
              <div className="text-danger small mt-1">Reason: {profile.companyPhotoNote}</div>
            )}
            <div className="mt-2">
              <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp"
                className="d-none" onChange={onPick} />
              <button className="btn btn-outline-primary btn-sm" disabled={busy}
                onClick={() => fileRef.current?.click()}>
                {busy ? 'Uploading…' : (liveUrl || pending ? 'Upload new logo' : 'Upload logo')}
              </button>
            </div>
            {error && <div className="text-danger small mt-1">{error}</div>}
          </div>
        </div>

        {pending && (
          <div className="form-text mt-2">
            Your new logo is awaiting admin review; your current logo stays live until it&apos;s approved.
          </div>
        )}
      </div>
    </div>
  );
}

export default CompanyLogoCard;
