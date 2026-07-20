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
function AutofitPanel({ productId, modelUrl }) {
  const [ctrl, setCtrl] = useState({ count: 'auto', side: 'right', length: '' });
  const [meta, setMeta] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');

  const [fitted, setFitted] = useState(null);   // { url } of the combined pair glb
  const [generating, setGenerating] = useState(false);
  const [showFitted, setShowFitted] = useState(false);  // preview: original vs fitted pair
  const blobUrls = useRef([]);                    // track for revocation

  function revokeBlobs() {
    blobUrls.current.forEach((u) => URL.revokeObjectURL(u));
    blobUrls.current = [];
  }
  useEffect(() => revokeBlobs, []);              // revoke on unmount

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

  return (
    <div className="mt-3">
      <div className="fw-semibold small text-uppercase text-muted mb-1">
        AR auto-fit (validate &amp; pre-tune the 3D model)
      </div>
      <div className="border rounded p-2">
        {/* controls */}
        <div className="row g-2 align-items-end mb-2">
          <div className="col-auto">
            <label className="form-label small mb-0">Shoes</label>
            <select className="form-select form-select-sm" value={ctrl.count}
              onChange={(e) => setCtrl({ ...ctrl, count: e.target.value })}>
              <option value="auto">Auto-detect</option>
              <option value="1">1 (mirror)</option>
              <option value="2">2 (split)</option>
            </select>
          </div>
          <div className="col-auto">
            <label className="form-label small mb-0">Single = </label>
            <select className="form-select form-select-sm" value={ctrl.side}
              onChange={(e) => setCtrl({ ...ctrl, side: e.target.value })}>
              <option value="right">Right</option>
              <option value="left">Left</option>
            </select>
          </div>
          <div className="col-auto">
            <label className="form-label small mb-0">Length (cm)</label>
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

        {meta && (rejected ? (
          <div className="alert alert-danger py-2 small mb-0">
            <strong>Rejected:</strong> {meta.rejectReason}
          </div>
        ) : (
          <>
            <div className="row g-3">
              {/* report */}
              <div className="col-md-6">
                <Row label="Shoes detected">
                  {meta.shoeCount}
                  {meta.countDetection && <Conf value={meta.countDetection.confidence} />}
                </Row>
                {dims && (
                  <Row label="Fitted size (L×W×H)">
                    {dims.length} × {dims.width} × {dims.height} cm
                  </Row>
                )}
                <Row label="Native units">{meta.nativeUnit} (~{meta.nativeLengthCm} cm)</Row>
                <Row label="Applied scale">×{meta.appliedScale}</Row>
                {meta.orientation && (
                  <Row label="Orientation">
                    sole<Conf value={meta.orientation.sole} /> toe<Conf value={meta.orientation.toe} />
                  </Row>
                )}
                {meta.split && (
                  <Row label="Pair split">
                    {meta.split.method}<Conf value={meta.split.confidence} />
                  </Row>
                )}
                {meta.textures && (
                  <Row label="Textures">
                    {meta.textures.resized
                      ? `${meta.textures.beforePx}px → ${meta.textures.afterPx}px`
                      : meta.textures.willResize
                        ? `${meta.textures.beforePx}px → ${meta.textures.afterPx}px (on generate)`
                        : `${meta.textures.beforePx}px (ok)`}
                  </Row>
                )}
                {meta.decimation && (
                  <Row label="Triangles">
                    {meta.decimation.applied
                      ? `${meta.decimation.before} → ${meta.decimation.after}`
                      : meta.decimation.willDecimate
                        ? `${meta.decimation.before} → ≤${meta.decimation.targetPerFoot} (on generate)`
                        : `${meta.decimation.before} (kept)`}
                  </Row>
                )}
                {anchor && (
                  <Row label="Suggested position (cm)">
                    [{anchor.positionCm.join(', ')}]
                  </Row>
                )}
                {meta.occluder && (
                  <Row label="Occluder">
                    keep template occluder{meta.occluder.highTop && <span className="badge text-bg-warning ms-1">high-top</span>}
                  </Row>
                )}
              </div>

              {/* before / after preview */}
              <div className="col-md-6">
                <div className="btn-group btn-group-sm w-100 mb-1" role="group">
                  <button type="button" className={`btn btn-outline-secondary${!showFitted ? ' active' : ''}`}
                    onClick={() => setShowFitted(false)}>Original</button>
                  <button type="button" className={`btn btn-outline-secondary${showFitted ? ' active' : ''}`}
                    onClick={() => fitted && setShowFitted(true)} disabled={!fitted}>Fitted pair</button>
                </div>
                <model-viewer
                  src={showFitted && fitted ? fitted.url : modelUrl}
                  camera-controls auto-rotate shadow-intensity="1"
                  style={{ width: '100%', height: '240px', background: '#f8f9fa', borderRadius: '0.5rem' }}
                ></model-viewer>
                <div className="text-muted small mt-1">
                  {showFitted && fitted
                    ? 'Fitted pair (Shoe_L + Shoe_R, oriented, scaled, seated).'
                    : 'Original upload. Generate the fitted model to compare.'}
                </div>
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
