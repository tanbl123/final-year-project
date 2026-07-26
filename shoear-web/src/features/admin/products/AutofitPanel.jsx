import { useEffect, useRef, useState } from 'react';
import { getProductAutofit } from '../adminService';

// Decode a base64 .glb into an object URL the <model-viewer> / a download link
// can use. Caller is responsible for revoking it.
function b64ToBlobUrl(b64) {
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) { arr[i] = bin.charCodeAt(i); }
  return URL.createObjectURL(new Blob([arr], { type: 'model/gltf-binary' }));
}

// A 0..1 confidence rendered as a coloured badge.
function Conf({ value }) {
  if (value == null) return null;
  const v = Number(value);
  const tone = v >= 0.7 ? 'success' : v >= 0.4 ? 'warning' : 'danger';
  return <span className={`badge text-bg-${tone} ms-1`}>{Math.round(v * 100)}%</span>;
}

function Row({ label, children }) {
  return (
    <div className="d-flex justify-content-between border-bottom py-1 small">
      <span className="text-muted">{label}</span>
      <span className="text-end">{children}</span>
    </div>
  );
}

// Admin AR auto-fit panel. Runs the product's uploaded 3D model through the ML
// auto-fit service and shows the analysis + a before/after preview, so the admin
// can QC it and download the fitted, half-tuned model to drop into Lens Studio.
function AutofitPanel({ productId, modelUrl, declared = {} }) {
  // default the controls to the supplier's declared submission spec (authoritative),
  // falling back to auto-detect / right / ~26 when they didn't declare it.
  const [ctrl, setCtrl] = useState({
    count: declared.count ? String(declared.count) : 'auto',
    side: declared.side || 'right',
    length: declared.length != null ? String(declared.length) : '',
  });
  const [meta, setMeta] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');

  const [fitted, setFitted] = useState(null);   // { url } of the combined pair glb
  const [generating, setGenerating] = useState(false);
  const [showFitted, setShowFitted] = useState(false);  // preview: original vs fitted pair
  const [showPreview, setShowPreview] = useState(true); // 3D preview shown by default (can Hide)
  const blobUrls = useRef([]);                    // track for revocation
  const mvRef = useRef(null);                     // the <model-viewer> element

  function revokeBlobs() {
    blobUrls.current.forEach((u) => URL.revokeObjectURL(u));
    blobUrls.current = [];
  }
  useEffect(() => revokeBlobs, []);              // revoke on unmount

  // Snap the camera back to the default framing after the admin has orbited the
  // model with the mouse (resets the CAMERA only — the model isn't moved).
  function resetView() {
    const mv = mvRef.current;
    if (!mv) return;
    mv.cameraOrbit = '0deg 75deg auto';
    mv.cameraTarget = 'auto';
    mv.fieldOfView = 'auto';
    if (typeof mv.jumpCameraToGoal === 'function') mv.jumpCameraToGoal();
  }

  function opts(extra = {}) {
    return {
      count: ctrl.count,
      side: ctrl.side,
      length: ctrl.length ? Number(ctrl.length) : undefined,
      ...extra,
    };
  }

  async function run() {
    setLoading(true); setErr(''); setFitted(null); revokeBlobs();
    try {
      setMeta(await getProductAutofit(productId, opts()));
    } catch (e) {
      setErr(e.message || 'Auto-fit failed.');
      setMeta(null);
    } finally {
      setLoading(false);
    }
  }

  async function generate() {
    setGenerating(true); setErr(''); revokeBlobs();
    try {
      const res = await getProductAutofit(productId, opts({ files: true }));
      setMeta(res);
      if (res.fitted?.combined) {
        const url = b64ToBlobUrl(res.fitted.combined);
        blobUrls.current.push(url);
        setFitted({ url });
        setShowFitted(true);
      }
    } catch (e) {
      setErr(e.message || 'Could not generate the fitted model.');
    } finally {
      setGenerating(false);
    }
  }

  function download() {
    if (!fitted?.url) return;
    const a = document.createElement('a');
    a.href = fitted.url;
    a.download = `${productId}_fitted_pair.glb`;
    a.click();
  }

  const rejected = meta?.rejected;
  const dims = meta?.dimensionsCm;
  const anchor = meta?.anchor;
  // plain-English verdicts for the report
  const facingOk = meta?.orientation && meta.orientation.sole >= 0.4 && meta.orientation.toe >= 0.4;
  const splitClean = meta?.split && meta.split.confidence >= 0.8;

  return (
    <div className="mt-3">
      <div className="fw-semibold small text-uppercase text-muted mb-1">
        AR auto-fit (validate &amp; pre-tune the 3D model)
      </div>
      <div className="border rounded p-2">
        {/* controls */}
        <div className="row g-2 align-items-end mb-2">
          <div className="col-auto">
            <label className="form-label small mb-0">Number of shoes</label>
            <select className="form-select form-select-sm" value={ctrl.count}
              onChange={(e) => setCtrl({ ...ctrl, count: e.target.value })}>
              <option value="auto">Auto-detect</option>
              <option value="1">1 shoe (mirror)</option>
              <option value="2">A pair (split)</option>
            </select>
          </div>
          <div className="col-auto">
            <label className="form-label small mb-0">Which foot (if single)</label>
            <select className="form-select form-select-sm" value={ctrl.side}
              disabled={ctrl.count === '2'}
              title={ctrl.count === '2' ? 'Only applies to a single shoe' : ''}
              onChange={(e) => setCtrl({ ...ctrl, side: e.target.value })}>
              <option value="right">Right</option>
              <option value="left">Left</option>
            </select>
          </div>
          <div className="col-auto">
            <label className="form-label small mb-0">Real length (cm)</label>
            <input type="number" className="form-control form-control-sm" style={{ width: 90 }}
              placeholder="~26" value={ctrl.length}
              onChange={(e) => setCtrl({ ...ctrl, length: e.target.value })} />
          </div>
          <div className="col-auto">
            <button type="button" className="btn btn-sm btn-primary" onClick={run} disabled={loading}>
              {loading ? 'Analysing…' : meta ? 'Re-run' : 'Run auto-fit'}
            </button>
          </div>
        </div>

        {err && <div className="alert alert-warning py-2 small mb-2">{err}</div>}

        {/* 3D preview is OPT-IN. Rendering a large model in the browser (WebGL)
            is what crashes low-spec machines — and none of the auto-fit analysis
            needs it. So it only mounts when the admin explicitly asks. */}
        {!showPreview ? (
          <button type="button" className="btn btn-sm btn-outline-secondary mb-2"
            onClick={() => setShowPreview(true)}>
            Load 3D preview {fitted ? '(fitted pair)' : '(original — may be heavy)'}
          </button>
        ) : (
          <div className="mb-2">
            <div className="btn-group btn-group-sm mb-1" role="group">
              <button type="button" className={`btn btn-outline-secondary${!showFitted ? ' active' : ''}`}
                onClick={() => setShowFitted(false)}>Original</button>
              <button type="button" className={`btn btn-outline-secondary${showFitted ? ' active' : ''}`}
                onClick={() => fitted && setShowFitted(true)} disabled={!fitted}>Fitted pair</button>
              <button type="button" className="btn btn-outline-secondary"
                onClick={resetView} title="Snap the camera back to the default view">Reset view</button>
              <button type="button" className="btn btn-outline-secondary"
                onClick={() => setShowPreview(false)}>Hide</button>
            </div>
            <model-viewer
              ref={mvRef}
              src={showFitted && fitted ? fitted.url : modelUrl}
              camera-controls loading="lazy"
              style={{ width: '100%', height: '260px', background: '#f8f9fa', borderRadius: '0.5rem' }}
            ></model-viewer>
            <div className="text-muted small mt-1">
              {showFitted && fitted
                ? 'Fitted pair (Shoe_L + Shoe_R — lighter, optimised).'
                : 'Original upload (full-size). Generate the fitted model for a lighter preview.'}
            </div>
          </div>
        )}

        {meta && (rejected ? (
          <div className="alert alert-danger py-2 small mb-0">
            <strong>Rejected:</strong> {meta.rejectReason}
          </div>
        ) : (
          <>
            <div className="text-muted small mb-2">What the auto-fit found, and what it prepared for Lens Studio:</div>
            <div className="row g-3">
              {/* report — plain labels, real numbers kept where the admin needs them */}
              <div className="col-12">
                <Row label="Shoes in this model">
                  {meta.shoeCount === 2 ? 'A pair (2 shoes)' : '1 shoe (mirrored to the other foot)'}
                  {meta.countDetection
                    ? <span className="text-muted ms-1">· auto-detected<Conf value={meta.countDetection.confidence} /></span>
                    : <span className="text-muted ms-1">· as the supplier declared</span>}
                </Row>
                {dims && (
                  <Row label="Fitted size">
                    {dims.length} × {dims.width} × {dims.height} cm <span className="text-muted">(length × width × height)</span>
                  </Row>
                )}
                {meta.orientation && (
                  <Row label="Facing (toe & sole)">
                    {facingOk
                      ? <span className="text-success">Looks correct</span>
                      : <span className="text-warning">Please verify in Lens Studio</span>}
                  </Row>
                )}
                {meta.split && (
                  <Row label="Pair separated">
                    {splitClean
                      ? <span className="text-success">Cleanly (by named parts)</span>
                      : <span className="text-warning">Roughly — please check the split</span>}
                  </Row>
                )}
                {meta.textures && meta.textures.beforePx > 0 && (
                  <Row label="Textures">
                    {meta.textures.resized
                      ? `Shrunk ${meta.textures.beforePx}px → ${meta.textures.afterPx}px for mobile`
                      : meta.textures.willResize
                        ? `Will shrink ${meta.textures.beforePx}px → ${meta.textures.afterPx}px when generated`
                        : `${meta.textures.beforePx}px (fine)`}
                  </Row>
                )}
                {meta.decimation && (
                  <Row label="Detail (triangles)">
                    {meta.decimation.applied
                      ? `Reduced ${meta.decimation.before} → ${meta.decimation.after} for smooth AR`
                      : meta.decimation.willDecimate
                        ? `Will reduce ${meta.decimation.before} → ≤${meta.decimation.targetPerFoot} when generated`
                        : `${meta.decimation.before} (fine as-is)`}
                  </Row>
                )}
                {anchor && (
                  <Row label="Place it at (Lens Studio, cm)">
                    X {anchor.positionCm[0]}, Y {anchor.positionCm[1]}, Z {anchor.positionCm[2]}
                  </Row>
                )}
                {meta.occluder && (
                  <Row label="Ankle cover">
                    Keep the template's foot cover
                    {meta.occluder.highTop && <span className="badge text-bg-warning ms-1">boot — cover more ankle</span>}
                  </Row>
                )}
              </div>
            </div>

            {/* warnings */}
            {meta.warnings?.length > 0 && (
              <ul className="small text-muted mt-2 mb-0 ps-3">
                {meta.warnings.map((w, i) => <li key={i}>{w}</li>)}
              </ul>
            )}

            {/* generate + download */}
            <div className="d-flex gap-2 mt-2">
              <button type="button" className="btn btn-sm btn-outline-primary" onClick={generate} disabled={generating}>
                {generating ? 'Generating…' : fitted ? 'Regenerate fitted model' : 'Generate fitted model (preview + download)'}
              </button>
              {fitted?.url && (
                <button type="button" className="btn btn-sm btn-outline-secondary" onClick={download}>
                  Download fitted pair .glb
                </button>
              )}
            </div>
            <div className="form-text">
              One .glb with both shoes (Shoe_L + Shoe_R). Import it into Lens Studio, bind each named node to its
              foot (keep the Foot Occluder), paste the suggested position, and publish to your lens group — then set the lens id below.
            </div>
          </>
        ))}

        {!meta && !loading && !err && (
          <div className="text-muted small">Run auto-fit to validate this model and pre-tune it for Lens Studio.</div>
        )}
      </div>
    </div>
  );
}

export default AutofitPanel;
