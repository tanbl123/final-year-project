import { useEffect, useState } from 'react';
import { getAdminProduct, setProductArLens } from '../adminService';
import LensPicker from './LensPicker';
import AutofitPanel from './AutofitPanel';

const rm = (n) => 'RM ' + Number(n || 0).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Full-product preview the admin opens from the approval queue, so they can SEE
// the product (images, description, sizes/stock, 3D model) before deciding.
// Approve / Reject live in the footer and call back to the parent.
function ProductReviewModal({ productId, onClose, onApprove, onReject, busy, title = 'Review product' }) {
  const [product, setProduct] = useState(null);
  const [error, setError] = useState('');
  const [activeImage, setActiveImage] = useState('');
  const [lensId, setLensId] = useState('');       // AR Camera Kit lens id (editable)
  const [savingLens, setSavingLens] = useState(false);
  const [lensMsg, setLensMsg] = useState('');     // transient save feedback

  useEffect(() => {
    if (!productId) return undefined;
    let active = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setProduct(null);
    setError('');
    setLensMsg('');
    getAdminProduct(productId)
      .then((p) => {
        if (!active) return;
        setProduct(p);
        setActiveImage(p.images?.[0] || '');
        setLensId(p.arLensId || '');
      })
      .catch((err) => { if (active) setError(err.message); });
    return () => { active = false; };
  }, [productId]);

  async function saveLens() {
    setSavingLens(true);
    setLensMsg('');
    try {
      const trimmed = lensId.trim();
      await setProductArLens(productId, trimmed);
      setProduct((p) => (p ? { ...p, arLensId: trimmed || null } : p));
      setLensMsg(trimmed ? 'AR lens saved — try-on is now live for this product.' : 'AR lens removed.');
    } catch (err) {
      setLensMsg(err.message || 'Could not save the lens id.');
    } finally {
      setSavingLens(false);
    }
  }

  if (!productId) return null;

  return (
    <>
      <div className="modal-backdrop fade show"></div>
      <div className="modal d-block" tabIndex="-1" role="dialog">
        <div className="modal-dialog modal-lg modal-dialog-centered modal-dialog-scrollable" role="document">
          <div className="modal-content">
            <div className="modal-header">
              <h5 className="modal-title">{title}</h5>
              <button type="button" className="btn-close" onClick={onClose}></button>
            </div>

            <div className="modal-body">
              {error ? (
                <div className="alert alert-danger mb-0">{error}</div>
              ) : !product ? (
                <p className="text-muted mb-0">Loading…</p>
              ) : (
                <>
                  <div className="row g-3">
                    {/* images */}
                    <div className="col-md-5">
                      <div className="ratio ratio-1x1 bg-light rounded overflow-hidden mb-2">
                        {activeImage
                          ? <img src={activeImage} alt={product.name} style={{ objectFit: 'cover' }} className="w-100 h-100" />
                          : <div className="d-flex align-items-center justify-content-center text-muted h-100">No image</div>}
                      </div>
                      {product.images?.length > 1 && (
                        <div className="d-flex gap-2 flex-wrap">
                          {product.images.map((url) => (
                            <img key={url} src={url} alt="" onClick={() => setActiveImage(url)}
                              className={'rounded border' + (url === activeImage ? ' border-primary' : '')}
                              style={{ width: 56, height: 56, objectFit: 'cover', cursor: 'pointer' }} />
                          ))}
                        </div>
                      )}
                    </div>

                    {/* details */}
                    <div className="col-md-7">
                      <h4 className="mb-1">{product.name}</h4>
                      <div className="text-muted mb-2">{product.brand}</div>
                      <div className="fs-5 fw-semibold mb-2">{rm(product.price)}</div>
                      <div className="mb-2">
                        <span className="badge text-bg-light border me-1">{product.categoryName}</span>
                        <span className="badge text-bg-light border">{product.supplierName}</span>
                        {product.virtualTryOnEnable && <span className="badge text-bg-info ms-1">AR try-on</span>}
                      </div>
                      {product.description
                        ? <p className="mb-2" style={{ whiteSpace: 'pre-wrap' }}>{product.description}</p>
                        : <p className="text-muted fst-italic mb-2">No description provided.</p>}

                      <div className="fw-semibold small text-uppercase text-muted mt-3 mb-1">Sizes &amp; stock</div>
                      {product.variants?.length ? (
                        <div className="d-flex flex-wrap gap-1">
                          {product.variants.map((v) => (
                            <span key={v.size} className="badge text-bg-light border">
                              {v.size}: {v.stock}
                            </span>
                          ))}
                        </div>
                      ) : <span className="text-muted small">No sizes.</span>}
                      <div className="text-muted small mt-1">Total stock: {product.totalStock}</div>
                    </div>
                  </div>

                  {/* 3D model */}
                  {product.modelUrl && (
                    <div className="mt-3">
                      <div className="fw-semibold small text-uppercase text-muted mb-1">3D model (AR try-on)</div>
                      <model-viewer
                        src={product.modelUrl}
                        camera-controls
                        auto-rotate
                        shadow-intensity="1"
                        style={{ width: '100%', height: '320px', background: '#f8f9fa', borderRadius: '0.5rem' }}
                      ></model-viewer>
                    </div>
                  )}

                  {/* AR auto-fit: validate + pre-tune the uploaded model, then
                      download the fitted, half-tuned .glb for Lens Studio. */}
                  {product.modelUrl && (
                    <AutofitPanel productId={productId} modelUrl={product.modelUrl} />
                  )}

                  {/* AR try-on lens (Snapchat Camera Kit). Admin builds the lens
                      from the 3D model in Lens Studio, then records the lens id
                      here so the customer app can offer AR try-on. */}
                  {product.modelUrl && (
                    <div className="mt-3">
                      <div className="fw-semibold small text-uppercase text-muted mb-1">
                        AR try-on lens (Camera Kit){' '}
                        {product.arLensId
                          ? <span className="badge text-bg-success">live</span>
                          : <span className="badge text-bg-secondary">not set</span>}
                      </div>

                      {/* Pick from the lenses in your Camera Kit group (loaded via
                          the Web SDK with an admin-only token). */}
                      <div className="mb-2">
                        <LensPicker
                          selectedLensId={lensId}
                          onPick={(id) => setLensId(id)}
                          disabled={savingLens}
                        />
                      </div>

                      {/* Manual fallback / confirm + save. */}
                      <div className="input-group">
                        <input
                          type="text"
                          className="form-control"
                          placeholder="…or paste a Camera Kit lens id"
                          value={lensId}
                          onChange={(e) => setLensId(e.target.value)}
                        />
                        {/* Dirty-check: only enable Save when the id differs from
                            what's already stored, so the admin can't re-save the
                            same lens id. Auto-disables again after a save. */}
                        <button
                          type="button"
                          className="btn btn-primary"
                          disabled={savingLens || lensId.trim() === (product.arLensId || '')}
                          onClick={saveLens}
                        >
                          {savingLens
                            ? 'Saving…'
                            : lensId.trim() === (product.arLensId || '')
                              ? (product.arLensId ? 'Saved' : 'Save')
                              : 'Save'}
                        </button>
                      </div>
                      <div className="form-text">
                        Build the foot-tracking lens from this 3D model in Lens Studio and publish it to your Camera Kit
                        lens group — it then appears above to pick. Customers can use AR try-on once saved; clear it to disable.
                      </div>
                      {lensMsg && <div className="small mt-1">{lensMsg}</div>}
                    </div>
                  )}
                </>
              )}
            </div>

            <div className="modal-footer">
              {/* Approve/Reject only when the parent wants moderation (the approval
                  queue). Read-only callers (e.g. inventory) just get Close. */}
              {(onApprove || onReject) ? (
                <>
                  <button type="button" className="btn btn-light" onClick={onClose}>Close</button>
                  {onReject && (
                    <button type="button" className="btn btn-outline-danger" disabled={busy || !product}
                      onClick={() => onReject(product)}>Reject</button>
                  )}
                  {onApprove && (
                    <button type="button" className="btn btn-success" disabled={busy || !product}
                      onClick={() => onApprove(product)}>{busy ? '…' : 'Approve'}</button>
                  )}
                </>
              ) : (
                <button type="button" className="btn btn-secondary" onClick={onClose}>Close</button>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

export default ProductReviewModal;
