import { useRef, useState } from 'react';
import { uploadImage, submitCompanyLogo } from '../auth/authService';

// Customer-facing company logo (square). The supplier uploads it, but an admin
// must approve it before it goes live. A new upload sits as "Pending review"
// (previewed here) while the current approved logo, if any, stays live.
function CompanyLogoCard({ profile, onSaved, onToast }) {
  const fileRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const liveUrl    = profile?.companyPhotoUrl || null;
  const pendingUrl = profile?.companyPhotoPendingUrl || null;
  const status     = profile?.companyPhotoStatus || 'None';
  const pending    = status === 'Pending';
  const rejected   = status === 'Rejected';
  // preview the image under review while pending, otherwise the live logo
  const previewUrl = pending ? (pendingUrl || liveUrl) : liveUrl;

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

        <div className="d-flex align-items-start gap-3 flex-wrap">
          {/* clickable preview / dropzone */}
          <button type="button" title="Upload a new logo" disabled={busy}
            onClick={() => fileRef.current?.click()}
            className="p-0 border rounded bg-light overflow-hidden position-relative flex-shrink-0"
            style={{ width: 112, height: 112 }}>
            {previewUrl ? (
              <img src={previewUrl} alt="Company logo"
                style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            ) : (
              <span className="d-flex flex-column align-items-center justify-content-center h-100 text-muted small">
                <span style={{ fontSize: 22 }}>＋</span>Add logo
              </span>
            )}
            {busy && (
              <span className="position-absolute top-0 start-0 w-100 h-100 d-flex align-items-center justify-content-center bg-white bg-opacity-75">
                <span className="spinner-border spinner-border-sm" />
              </span>
            )}
          </button>

          <div className="flex-grow-1" style={{ minWidth: 220 }}>
            {pending && <span className="badge text-bg-warning">Pending review</span>}
            {status === 'Approved' && liveUrl && <span className="badge text-bg-success">Approved · live</span>}
            {rejected && <span className="badge text-bg-danger">Last submission rejected</span>}

            {rejected && profile?.companyPhotoNote && (
              <div className="text-danger small mt-1">Reason: {profile.companyPhotoNote}</div>
            )}
            {pending && (
              <div className="form-text mt-1">
                This logo is awaiting admin review; your current logo stays live until it&apos;s approved.
              </div>
            )}

            <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp"
              className="d-none" onChange={onPick} />
            <div className="mt-2">
              <button className="btn btn-outline-primary btn-sm" disabled={busy}
                onClick={() => fileRef.current?.click()}>
                {busy ? 'Uploading…' : (previewUrl ? 'Upload new logo' : 'Upload logo')}
              </button>
            </div>
            <div className="form-text mt-1">Square image · JPG, PNG or WebP · up to 5&nbsp;MB · 400×400px or larger recommended.</div>
            {error && <div className="text-danger small mt-1">{error}</div>}
          </div>
        </div>
      </div>
    </div>
  );
}

export default CompanyLogoCard;
