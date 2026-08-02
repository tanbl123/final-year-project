import { useEffect, useState } from 'react';
import { getAdminProduct, setProductArLens, flagProductArModel } from '../adminService';
import LensPicker from './LensPicker';
import AutofitPanel from './AutofitPanel';

const rm = (n) => 'RM ' + Number(n || 0).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Full-product preview the admin opens from the approval queue, so they can SEE
// the product (images, description, sizes/stock, 3D model) before deciding.
// Approve / Reject live in the footer and call back to the parent.
// mode: 'admin' (default) shows the full commercial detail (price, supplier,
// stock) for approval; 'ar' is the slim AR-prep view for an AR Specialist —
// it hides the commercial/supplier blocks and keeps only what's needed to
// prepare the try-on (images, name/brand/category, the model + lens).
function ProductReviewModal({ productId, onClose, onApprove, onReject, onFlagged, busy, mode = 'admin', title = 'Review product' }) {
  const arMode = mode === 'ar';
  const [product, setProduct] = useState(null);
  const [error, setError] = useState('');
  const [activeImage, setActiveImage] = useState('');
  const [lensId, setLensId] = useState('');       // AR Camera Kit lens id (editable)
  const [savingLens, setSavingLens] = useState(false);
  const [lensMsg, setLensMsg] = useState('');     // transient save feedback
  const [lensReqMsg, setLensReqMsg] = useState(''); // shown at the field if Approve is clicked with a required lens missing
  const [flagOpen, setFlagOpen] = useState(false); // AR reviewer's "report model issue" panel
  const [flagNote, setFlagNote] = useState('');
  const [flagging, setFlagging] = useState(false);
  const [flagErr, setFlagErr] = useState('');

  useEffect(() => {
    if (!productId) return undefined;
    let active = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setProduct(null);
    setError('');
    setLensMsg('');
    setLensReqMsg('');
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
      if (trimmed) setLensReqMsg('');   // requirement satisfied — clear the approve-time error
      setLensMsg(trimmed ? 'AR lens saved — try-on is now live for this product.' : 'AR lens removed.');
    } catch (err) {
      setLensMsg(err.message || 'Could not save the lens id.');
    } finally {
      setSavingLens(false);
    }
  }

  async function saveFlag() {
    const note = flagNote.trim();
    if (!note) { setFlagErr('Please describe what is wrong with the model.'); return; }
    setFlagging(true);
    setFlagErr('');
    try {
      await flagProductArModel(productId, note);
      onFlagged?.();   // let the parent refresh + toast
      onClose();
    } catch (err) {
      setFlagErr(err.message || 'Could not report the issue.');
      setFlagging(false);
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
                      {/* price is commercial info — hidden in the AR-prep view */}
                      {!arMode && <div className="fs-5 fw-semibold mb-2">{rm(product.price)}</div>}
                      <div className="mb-2">
                        <span className="badge text-bg-light border me-1">{product.categoryName}</span>
                        {/* supplier identity is hidden from AR staff */}
                        {!arMode && <span className="badge text-bg-light border">{product.supplierName}</span>}
                        {product.virtualTryOnEnable && <span className="badge text-bg-info ms-1">AR try-on</span>}
                      </div>
                      {product.description
                        ? <p className="mb-2" style={{ whiteSpace: 'pre-wrap' }}>{product.description}</p>
                        : <p className="text-muted fst-italic mb-2">No description provided.</p>}

                      {/* sizes/stock is inventory info — hidden in the AR-prep view */}
                      {!arMode && (
                        <>
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
                        </>
                      )}
                    </div>
                  </div>

                  {/* AR auto-fit: validate + pre-tune the uploaded model, then
                      download the fitted, half-tuned .glb for Lens Studio. Its
                      preview is the single 3D viewer in this modal (a second
                      WebGL canvas here was crashing weak GPUs). */}
                  {product.modelUrl && (
                    <AutofitPanel
                      productId={productId}
                      productName={product.name}
                      modelUrl={product.modelUrl}
                      declared={{
                        count: product.modelShoeCount,
                        side: product.modelSide,
                        length: product.modelLengthCm,
                      }}
                    />
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
                          : product.virtualTryOnEnable
                            ? <span className="badge text-bg-warning">required</span>
                            : <span className="badge text-bg-secondary">not set</span>}
                      </div>

                      {/* Supplier's try-on choice + lens state, kept as badges + muted
                          helper text to match the panel (the badge carries the signal —
                          no error-red paragraph, since nothing has actually failed). */}
                      <div className="mb-1 small text-muted">
                        Virtual try-on:{' '}
                        {product.virtualTryOnEnable
                          ? <span className="badge text-bg-info">enabled by supplier</span>
                          : <span className="badge text-bg-secondary">not enabled by supplier</span>}
                      </div>
                      {!product.virtualTryOnEnable && (
                        <div className="form-text mt-0 mb-2">
                          Virtual try-on isn't enabled for this product, so a lens here has no effect
                          until the supplier enables it.
                        </div>
                      )}

                      {/* Pick from the lenses in your Camera Kit group (loaded via
                          the Web SDK with an admin-only token). */}
                      <div className="mb-2">
                        <LensPicker
                          selectedLensId={lensId}
                          onPick={(id) => { setLensId(id); setLensReqMsg(''); }}
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
                          onChange={(e) => { setLensId(e.target.value); setLensReqMsg(''); }}
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
                      {/* Shown only after the admin tries to Approve without the
                          required lens — validate-on-submit, error at the field. */}
                      {lensReqMsg && <div className="text-danger small mt-1">{lensReqMsg}</div>}
                      <div className="form-text">
                        Build the foot-tracking lens from this 3D model in Lens Studio and publish it to your Camera Kit
                        lens group — it then appears above to pick. Customers can use AR try-on once saved; clear it to disable.
                      </div>
                      {lensMsg && <div className="small mt-1">{lensMsg}</div>}
                    </div>
                  )}

                  {/* A reviewer's reported model issue — surfaced in both views. */}
                  {product.arFlagged && product.arFlagNote && (
                    <div className="alert alert-warning mt-3 mb-0 py-2">
                      <strong>⚠️ Model issue reported:</strong> {product.arFlagNote}
                      {arMode
                        ? <div className="small text-muted mt-1">Sent to the admin — awaiting rejection so the supplier can fix &amp; resubmit.</div>
                        : <div className="small mt-1">Reject this product with this reason so the supplier can fix and resubmit.</div>}
                    </div>
                  )}

                  {/* AR reviewer action: report an unusable model (wrong orientation,
                      broken export, …) instead of setting a lens. Goes to the admin
                      to reject → supplier fixes & resubmits. */}
                  {arMode && product.modelUrl && !product.arFlagged && (
                    <div className="mt-3">
                      {!flagOpen ? (
                        <button type="button" className="btn btn-outline-danger btn-sm" onClick={() => setFlagOpen(true)}>
                          ⚠ Report model issue
                        </button>
                      ) : (
                        <div className="border rounded p-3">
                          <div className="fw-semibold small text-uppercase text-muted mb-1">Report model issue</div>
                          <p className="small text-muted mb-2">
                            Describe what's wrong (e.g. the model is lying on its side, upside-down, or won't load).
                            The admin will reject the product with your reason so the supplier can re-export and resubmit.
                          </p>
                          <textarea
                            className={'form-control' + (flagErr ? ' is-invalid' : '')}
                            rows={3} maxLength={255} value={flagNote}
                            onChange={(e) => { setFlagNote(e.target.value); setFlagErr(''); }}
                            placeholder="e.g. Model is on its side — please re-export it upright, sole down, toe forward." />
                          {flagErr && <div className="invalid-feedback d-block">{flagErr}</div>}
                          <div className="d-flex gap-2 mt-2">
                            <button type="button" className="btn btn-danger btn-sm" disabled={flagging} onClick={saveFlag}>
                              {flagging ? 'Sending…' : 'Send report to admin'}
                            </button>
                            <button type="button" className="btn btn-outline-secondary btn-sm" disabled={flagging}
                              onClick={() => { setFlagOpen(false); setFlagNote(''); setFlagErr(''); }}>Cancel</button>
                          </div>
                        </div>
                      )}
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
                      onClick={() => {
                        // Validate on submit instead of disabling the button: a VTO
                        // product needs a saved lens. Surface it inline at the field.
                        if (product.virtualTryOnEnable && !product.arLensId) {
                          setLensReqMsg('A Camera Kit lens id is required before approving — pick a lens or paste an id, then Save.');
                          return;
                        }
                        onApprove(product);
                      }}>{busy ? '…' : 'Approve'}</button>
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
