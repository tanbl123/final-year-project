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

// One foot's transform, laid out like a Lens Studio Transform inspector so the
// admin can copy it straight across. pos/rot/scale are [x, y, z].
function TransformCard({ title, pos, rot, scale }) {
  const rows = [['Position', pos], ['Rotation', rot], ['Scale', scale]];
  return (
    <div className="col-6">
      <div className="small fw-semibold mb-1">{title}</div>
      <table className="table table-sm table-borderless mb-0" style={{ fontSize: '0.78rem' }}>
        <thead>
          <tr className="text-muted">
            <th className="fw-normal"> </th>
            <th className="text-end fw-normal">X</th>
            <th className="text-end fw-normal">Y</th>
            <th className="text-end fw-normal">Z</th>
          </tr>
        </thead>
        <tbody className="font-monospace">
          {rows.map(([label, v]) => (
            <tr key={label}>
              <td className="text-muted">{label}</td>
              <td className="text-end">{v[0]}</td>
              <td className="text-end">{v[1]}</td>
              <td className="text-end">{v[2]}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// "Keep supplier's geometry": a PAIR triangle total so large the ML service never
// decimates, i.e. the full supplier mesh is retained. (A very high-poly shoe kept this
// way can exceed the 8 MB lens cap — that's why the admin can also set a custom target.)
const KEEP_TRIS = 100000000;
// Smallest sensible custom PAIR triangle target — below this a shoe isn't recognisable,
// so we reject it (guards against 0 / negative / junk input).
const MIN_CUSTOM_TRIS = 1000;
// The ~100k pair budget "Optimized" targets, and Lens Studio's texture import ceiling.
// Used to grey out options that wouldn't change an already-light model.
const OPTIMIZED_PAIR_TRIS = 100000;
const LS_TEX_CAP = 2048;

// Admin AR auto-fit panel. Runs the product's uploaded 3D model through the ML
// auto-fit service and shows the analysis + a before/after preview, so the admin
// can QC it and download the fitted, half-tuned model to drop into Lens Studio.
// Turn a product name into a safe, human-readable download filename base:
// strip OS-illegal characters, truncate at a WORD boundary (~40 chars) so a very
// long name doesn't make an unwieldy filename, then append the product id so files
// stay unique/traceable even when names are long or duplicated. Falls back to the
// id (then "model") when there's no name.
function fileBase(name, id) {
  const clean = (name || '').replace(/[\\/:*?"<>|-]+/g, '').replace(/\s+/g, ' ').trim();
  const CAP = 40;
  let base = clean;
  if (base.length > CAP) {
    let cut = base.slice(0, CAP);
    if (base[CAP] !== ' ') {              // sliced mid-word -> back up to the last space
      const sp = cut.lastIndexOf(' ');
      if (sp > 15) cut = cut.slice(0, sp);
    }
    base = cut.trim();
  }
  const tag = (id || '').trim();
  if (!base) return tag || 'model';       // no usable name -> just the id
  return tag ? `${base}-${tag}` : base;
}

function AutofitPanel({ productId, productName, modelUrl, declared = {} }) {
  // default the controls to the supplier's declared submission spec (authoritative),
  // falling back to auto-detect / right / ~26 when they didn't declare it.
  const [ctrl, setCtrl] = useState({
    count: declared.count ? String(declared.count) : 'auto',
    side: declared.side || 'right',
    length: declared.length != null ? String(declared.length) : '',
    straighten: false,   // default: trust the supplier's orientation (don't re-guess)
  });
  const [meta, setMeta] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');

  const [fitted, setFitted] = useState(null);   // { url } of the combined pair glb
  const [generating, setGenerating] = useState(false);
  const [savingOrig, setSavingOrig] = useState(false);  // fetching the raw upload for download
  const [showFitted, setShowFitted] = useState(false);  // preview: original vs fitted pair
  const [textureCap, setTextureCap] = useState(0);      // 0 = supplier full-res; else px cap the admin picked
  const [triCap, setTriCap] = useState(0);              // PAIR target: 0 = ~100k default; KEEP_TRIS = keep supplier's; else custom
  const [customTris, setCustomTris] = useState('');     // admin's custom pair-triangle input (text)
  const [swapLr, setSwapLr] = useState(false);          // flip which foot is Shoe_L vs Shoe_R (fix a wrong guess)
  const [genSettings, setGenSettings] = useState(null); // {textureCap, triCap, swapLr} the current preview was built with
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
      straighten: ctrl.straighten,
      textureCap: textureCap || undefined,   // 0/undefined = keep supplier full-res
      triCap: triCap || undefined,           // 0/undefined = ~50k/foot default
      swapLr: swapLr || undefined,           // flip L/R when the auto-guess is wrong
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

  // Build the fitted pair with the CURRENTLY-SELECTED texture + detail. Selecting a
  // texture/detail only updates state; nothing regenerates until the admin clicks
  // Generate, so they can set both first and build once (instead of a rebuild per click).
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
        setGenSettings({ textureCap, triCap, swapLr });   // remember what this preview was built with
      }
    } catch (e) {
      setErr(e.message || 'Could not generate the fitted model.');
    } finally {
      setGenerating(false);
    }
  }

  // Admin selects a texture resolution / triangle detail -> just update the pending
  // selection (no regenerate; Generate applies it).
  function pickTextureCap(cap) { setTextureCap(cap); }
  function pickTriCap(cap) { setTriCap(cap); setCustomTris(''); }
  // Admin typed a custom PAIR triangle total -> use it (ignored if blank/invalid).
  // Max is the model's own pair triangle count (from the analysis) — you can't decimate
  // UP, so a target above the source is meaningless; "Keep supplier's" covers keeping all.
  const srcTris = meta?.decimation?.before || 0;
  // Already at/under the optimized budget? Then "Optimized" is a no-op (nothing to reduce).
  const alreadyOptimal = srcTris > 0 && srcTris <= OPTIMIZED_PAIR_TRIS;
  // When the analysis shows the model is already within the ~100k budget, "Optimized"
  // is a disabled no-op, so make "Keep supplier's" the active default (still the same
  // result — nothing to reduce — but the selection now matches what actually happens).
  // Only nudges the untouched default (triCap === 0); an explicit admin choice stands.
  useEffect(() => {
    if (alreadyOptimal && triCap === 0) setTriCap(KEEP_TRIS);
  }, [alreadyOptimal, triCap]);
  // Effective source texture resolution = what "Original" yields (supplier px, capped at
  // Lens Studio's 2048). A px preset >= this wouldn't reduce anything, so it's disabled.
  const texEffPx = meta?.textures?.beforePx ? Math.min(meta.textures.beforePx, LS_TEX_CAP) : 0;
  const customTrisNum = parseInt(customTris, 10);
  const customBelowMin = customTris !== '' && customTrisNum < MIN_CUSTOM_TRIS;
  const customAboveMax = customTris !== '' && srcTris > 0 && customTrisNum > srcTris;
  const customTrisValid = customTris !== '' && Number.isInteger(customTrisNum)
    && !customBelowMin && !customAboveMax;
  function applyCustomTris() {
    if (!customTrisValid) return;
    setTriCap(customTrisNum);   // selects the custom detail; Generate applies it
  }
  // The current preview is stale if the selected texture/detail differs from what it
  // was built with — prompt the admin to (re)generate.
  const settingsChanged = !!fitted && !!genSettings
    && (genSettings.textureCap !== textureCap || genSettings.triCap !== triCap
        || genSettings.swapLr !== swapLr);

  function download() {
    if (!fitted?.url) return;
    const a = document.createElement('a');
    a.href = fitted.url;
    a.download = `${fileBase(productName, productId)}_fitted_pair.glb`;
    a.click();
  }

  // Download the supplier's RAW upload the same way as the fitted file: fetch it
  // into a blob and save directly (no new tab), keeping the URL's own filename.
  async function downloadOriginal() {
    if (!modelUrl || savingOrig) return;
    setSavingOrig(true);
    try {
      const resp = await fetch(modelUrl);
      if (!resp.ok) throw new Error('fetch failed');
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      blobUrls.current.push(url);                        // revoked on unmount
      const a = document.createElement('a');
      a.href = url;
      a.download = `${fileBase(productName, productId)}.glb`;
      a.click();
    } catch {
      window.open(modelUrl, '_blank', 'noopener');        // fallback if fetch/CORS blocked
    } finally {
      setSavingOrig(false);
    }
  }

  const rejected = meta?.rejected;
  const dims = meta?.dimensionsCm;
  const anchor = meta?.anchor;
  // Both feet share rotation & scale; only the Position X flips (the left shoe is
  // the right one mirrored across X). The anchor was measured on the base shoe,
  // whose side is meta.side — so give each foot its own position, no manual negate.
  const posBaseSide = (meta?.side || 'right').toLowerCase();
  const posMirror = anchor ? [-anchor.positionCm[0], anchor.positionCm[1], anchor.positionCm[2]] : null;
  const rPos = anchor ? (posBaseSide === 'right' ? anchor.positionCm : posMirror) : null;
  const lPos = anchor ? (posBaseSide === 'left' ? anchor.positionCm : posMirror) : null;
  // plain-English verdicts for the report
  const trustedFile = meta?.orientation?.trustedFile;
  const pairMismatch = meta?.orientation?.pairMismatch;   // the two shoes oriented differently
  const facingOk = meta?.orientation && meta.orientation.sole >= 0.4 && meta.orientation.toe >= 0.4;
  const splitClean = meta?.split && meta.split.confidence >= 0.8;
  const lrFromNames = meta?.split?.lrFromNames;   // left/right came from Shoe_L/Shoe_R labels
  const lrMethod = meta?.split?.lrMethod;         // 'names' | 'shape' | 'position' — how L/R was decided
  const splitSuspect = meta?.split?.suspect;      // separated shoe has odd proportions — likely overlap/bad split

  // The warnings from the service mostly repeat facts already shown as rows
  // (texture resize, "it's a boot", the mirror copy, orientation kept). Drop
  // those and keep only notes that need the admin's eyes, so the report stays
  // short instead of a wall of bullet points.
  const REDUNDANT = [
    /texture|downscal|shrunk|\d+\s*px/i,   // shown in "Textures"
    /boot|high-top|ankle/i,                 // shown in "Ankle cover"
    /mirror|reversed|other foot/i,          // shown in "Shoes in this model"
    /orientation was kept|face forward and sit flat/i, // shown in "Facing"
    /decimat/i,                             // shown in "Detail"
    /assigned by position/i,                // shown in "Pair split"
    /uploaded a pair without labelling/i,   // L/R (shape or position) — shown in "Pair split"
  ];
  // ...but a lens-size / cap message is an action item (reject, or confirm in Lens
  // Studio), not a restatement of a row — always keep it even if it mentions textures.
  const KEEP = /\bcap\b|lens|over \d/i;
  const checkNotes = (meta?.warnings || []).filter(
    (w) => KEEP.test(w) || !REDUNDANT.some((re) => re.test(w)));

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
          {/* only relevant for a single shoe — hidden for a pair to avoid confusion */}
          {ctrl.count !== '2' && (
            <div className="col-auto">
              <label className="form-label small mb-0">
                Which foot {ctrl.count === 'auto' ? '(used only if a single)' : ''}
              </label>
              <select className="form-select form-select-sm" value={ctrl.side}
                onChange={(e) => setCtrl({ ...ctrl, side: e.target.value })}>
                <option value="right">Right</option>
                <option value="left">Left</option>
              </select>
            </div>
          )}
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
          {ctrl.count === 'auto' && (
            <div className="col-12">
              <div className="form-text small mt-0">
                Auto-detect decides <strong>single vs pair</strong> only — not left/right.
                If it resolves to a single shoe, the “Which foot” value above is used; for a pair it's ignored.
              </div>
            </div>
          )}
          <div className="col-12">
            <div className="form-check form-switch">
              <input className="form-check-input" type="checkbox" role="switch" id="straightenSwitch"
                checked={ctrl.straighten}
                onChange={(e) => setCtrl({ ...ctrl, straighten: e.target.checked })} />
              <label className="form-check-label small" htmlFor="straightenSwitch">
                Auto-straighten the model
                <span className="text-muted">
                  {' '}— off keeps the supplier's original orientation (recommended); turn on only if the model is uploaded lying down or upside-down.
                </span>
              </label>
            </div>
          </div>
        </div>

        {err && <div className="alert alert-warning py-2 small mb-2">{err}</div>}

        {/* 3D preview — the admin's main QC tool, always shown. (It used to be
            opt-in when we suspected WebGL was crashing low-spec laptops; that was
            a GPU-driver issue, since fixed, so there's no reason to hide it.) */}
        <div className="mb-2">
          <div className="btn-group btn-group-sm mb-1" role="group">
            <button type="button" className={`btn btn-outline-secondary${!showFitted ? ' active' : ''}`}
              onClick={() => setShowFitted(false)}>Original</button>
            <button type="button" className={`btn btn-outline-secondary${showFitted ? ' active' : ''}`}
              onClick={() => fitted && setShowFitted(true)} disabled={!fitted}>Fitted pair</button>
            <button type="button" className="btn btn-outline-secondary"
              onClick={resetView} title="Snap the camera back to the default view">Reset view</button>
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
          {!showFitted && (
            <div className="text-muted small mt-1">
              The model is used in AR as-is. It should sit upright, sole down, toe forward — if it's
              lying down, tilted or upside-down, Reject and ask the supplier to re-export it upright.
            </div>
          )}
        </div>

        {meta && (rejected ? (
          <div className="alert alert-danger py-2 small mb-0">
            <strong>Rejected:</strong> {meta.rejectReason}
          </div>
        ) : (
          <>
            {/* status line */}
            <div className="d-flex align-items-center gap-2 mb-2">
              <span className="fw-semibold small">Analysis</span>
              {checkNotes.length === 0
                ? <span className="badge text-bg-success">Looks good</span>
                : <span className="badge text-bg-warning">{checkNotes.length} to check</span>}
            </div>

            {/* THE MODEL */}
            <div className="text-muted text-uppercase fw-semibold mb-1" style={{ fontSize: '0.7rem' }}>The model</div>
            <div className="row gx-3 mb-2">
              <div className="col-md-6">
                <Row label="Shoes">
                  {meta.shoeCount === 2 ? 'A pair (2)' : '1 (mirrored)'}
                  {meta.countDetection
                    ? <span className="text-muted ms-1">detected<Conf value={meta.countDetection.confidence} /></span>
                    : <span className="text-muted ms-1">· declared</span>}
                </Row>
              </div>
              {dims && (
                <div className="col-md-6">
                  <Row label="Fitted size">
                    <span className="fw-medium">{dims.length} × {dims.width} × {dims.height}</span>
                    <span className="text-muted"> cm (L×W×H)</span>
                  </Row>
                </div>
              )}
              {meta.orientation && (
                <div className="col-md-6">
                  <Row label="Facing">
                    {pairMismatch
                      ? <span className="text-danger">⚠ Shoes differ — verify</span>
                      : trustedFile
                        ? <span className="text-muted">Kept from the file ⓘ</span>
                        : facingOk
                          ? <span className="text-success">✓ Looks correct</span>
                          : <span className="text-warning">⚠ Verify</span>}
                    {!trustedFile && meta.orientation.flatSole != null && (
                      <span className="text-muted ms-2" style={{ fontSize: '0.75rem' }}>
                        sole flatness {meta.orientation.flatSole}
                        {meta.orientation.axisFlat === false && ' — no flat sole found'}
                      </span>
                    )}
                    {!trustedFile && meta.orientation.lrConf != null && (
                      <span className="text-muted ms-2" style={{ fontSize: '0.75rem' }}>
                        {meta.orientation.lrGuess
                          ? <>· geometry looks {meta.orientation.lrGuess} ({Math.round(meta.orientation.lrConf * 100)}%)
                              {meta.orientation.lrDeclared
                                && meta.orientation.lrGuess !== meta.orientation.lrDeclared
                                && meta.orientation.lrConf >= 0.4
                                && <span className="text-warning"> — declared {meta.orientation.lrDeclared}?</span>}
                            </>
                          : '· no clear L/R signal'}
                      </span>
                    )}
                  </Row>
                </div>
              )}
              {meta.split && (
                <div className="col-md-6">
                  <Row label="Pair split">
                    {lrFromNames
                      ? <span className="text-success">✓ L/R from labels</span>
                      : splitSuspect
                        ? <span className="text-danger">⚠ Odd shape — likely overlap</span>
                        : lrMethod === 'shape'
                          ? <span className="text-warning">⚠ L/R from shape — verify</span>
                          : splitClean
                            ? <span className="text-warning">⚠ L/R by position — verify</span>
                            : <span className="text-warning">⚠ Check split</span>}
                  </Row>
                </div>
              )}
            </div>

            {/* PREPARED FOR AR */}
            <div className="text-muted text-uppercase fw-semibold mb-1" style={{ fontSize: '0.7rem' }}>Prepared for AR</div>
            <div className="row gx-3 mb-1">
              {meta.textures && meta.textures.afterPx > 0 && (
                <div className="col-md-6">
                  <Row label="Textures">
                    {/* Always show the resolution the lens ACTUALLY uses (afterPx), so a
                        4096 map that Lens Studio caps at 2048 reads as 2048, not 4096. */}
                    {meta.textures.lsCapped
                      ? <span>{meta.textures.afterPx}px <span className="text-muted">(capped from {meta.textures.beforePx}px — Lens Studio limit)</span></span>
                      : meta.textures.resized
                        ? <span><span className="text-success">✓</span> {meta.textures.afterPx}px <span className="text-muted">(reduced from {meta.textures.beforePx}px)</span></span>
                        : <span>{meta.textures.afterPx}px <span className="text-muted">(supplier resolution)</span></span>}
                  </Row>
                </div>
              )}
              {meta.decimation && (
                <div className="col-md-6">
                  <Row label="Detail">
                    {/* before/after are both PAIR totals (2 shoes) — like-for-like, so the
                        numbers aren't mixing a pair total with a per-foot target. */}
                    {meta.decimation.applied || meta.decimation.willDecimate
                      ? <span><span className="text-success">✓</span> {meta.decimation.before} → {meta.decimation.after} tris <span className="text-muted">(pair)</span>
                          {meta.decimation.heavy && <span className="badge text-bg-warning ms-1">heavily reduced — check preview</span>}
                        </span>
                      : <span>{meta.decimation.before} tris <span className="text-muted">(pair{meta.decimation.kept ? ', kept' : ', fine'})</span></span>}
                  </Row>
                </div>
              )}
              {meta.lens && (
                <div className="col-md-6">
                  <Row label="Lens size">
                    {/* We can't measure the packaged lens size from the .glb (Lens Studio
                        re-compresses on import), so we don't guess — the admin reads the
                        real "Lens Size" in Lens Studio, which must be ≤ 8 MB. */}
                    <span className="text-muted">check in Lens Studio (must be ≤ {Math.round(meta.lens.capBytes / 1048576)} MB)</span>
                    {meta.lens.nMaps > 0 && <span className="text-muted"> · {meta.lens.nMaps} texture map{meta.lens.nMaps === 1 ? '' : 's'}</span>}
                  </Row>
                </div>
              )}
              {meta.occluder && (
                <div className="col-md-6">
                  <Row label="Ankle cover">
                    Keep foot cover
                    {meta.occluder.highTop && <span className="badge text-bg-warning ms-1">high-top — extend</span>}
                  </Row>
                </div>
              )}
              {anchor && (
                <div className="col-12 mt-1">
                  <div className="text-muted small mb-1">
                    Suggested Lens Studio transform — match each shoe's Transform panel
                  </div>
                  <div className="row g-2">
                    <TransformCard title="Shoe_L (left foot)" pos={lPos}
                                   rot={anchor.rotationDeg} scale={anchor.scale} />
                    <TransformCard title="Shoe_R (right foot)" pos={rPos}
                                   rot={anchor.rotationDeg} scale={anchor.scale} />
                  </div>
                  <div className="text-muted" style={{ fontSize: '0.72rem' }}>
                    Position is in centimetres; rotation in degrees. The two feet differ only in
                    Position X (the left shoe is the right one mirrored). Rotation stays 0.
                    Set the <strong>Scale</strong> shown on both feet — it's sized to cover the
                    foot with a little margin (import with Convert&nbsp;Meters&nbsp;to&nbsp;Centimetres
                    on, then set this Scale). Fine-tune by ±a few if needed.
                  </div>
                </div>
              )}
            </div>

            {/* only the notes that actually need attention */}
            {checkNotes.length > 0 && (
              <div className="alert alert-warning py-2 px-3 small mt-2 mb-0">
                <div className="fw-semibold mb-1">Worth a quick check</div>
                <ul className="mb-0 ps-3">{checkNotes.map((w, i) => <li key={i}>{w}</li>)}</ul>
              </div>
            )}

            {/* texture resolution — faithful full-res by default; the admin reduces
                ONLY to fit an over-cap shoe, then checks the preview still looks right */}
            <div className="d-flex align-items-center gap-2 mt-3 flex-wrap">
              <span className="small text-muted">Textures</span>
              <div className="btn-group btn-group-sm" role="group" aria-label="Texture resolution">
                {/* Only ever show presets that would actually REDUCE the textures. "Original"
                    always shows (and is capped at 2048 on Lens Studio import, so there's no
                    separate 2048 button). A px preset >= the model's own resolution wouldn't
                    change anything, so it's hidden — e.g. a 1024 supplier texture hides the
                    1024 button, since "Original" already yields 1024. */}
                {[{ v: 0, l: 'Original' }, { v: 1024, l: '1024' }, { v: 512, l: '512' }]
                  .filter((o) => o.v === 0 || !(texEffPx > 0 && o.v >= texEffPx))
                  .map((o) => (
                    <button key={o.v} type="button"
                      className={`btn btn-outline-secondary${textureCap === o.v ? ' active' : ''}`}
                      onClick={() => pickTextureCap(o.v)} disabled={generating}>
                      {o.l}{o.v ? 'px' : ''}</button>
                  ))}
              </div>
            </div>
            <div className="text-muted small mt-1">
              Textures stay at the supplier's resolution by default (capped at 2048px — Lens Studio
              downsizes anything larger on import anyway, so it's lossless). If Lens Studio reports the
              lens over the 8 MB cap, reduce here and re-check the preview — or Reject and ask the supplier
              for fewer/simpler texture maps.
            </div>

            {/* triangle detail — optimized to Snapchat's budget by default; the admin can
                keep the supplier's higher-poly mesh (clamped to Lens Studio's import limit) */}
            <div className="d-flex align-items-center gap-2 mt-2 flex-wrap">
              <span className="small text-muted">Detail</span>
              <div className="btn-group btn-group-sm" role="group" aria-label="Triangle detail">
                {/* Hide "Optimized" when the model is already under ~100k — it would do
                    nothing to reduce (same idea as the no-op texture presets). */}
                {!alreadyOptimal && (
                  <button type="button"
                    className={`btn btn-outline-secondary${triCap === 0 ? ' active' : ''}`}
                    onClick={() => pickTriCap(0)} disabled={generating}>
                    Optimized (~100k)</button>
                )}
                <button type="button"
                  className={`btn btn-outline-secondary${triCap === KEEP_TRIS ? ' active' : ''}`}
                  onClick={() => pickTriCap(KEEP_TRIS)} disabled={generating}>Keep supplier's</button>
              </div>
              {/* custom PAIR triangle target — lets the admin dial detail to fit the 8 MB cap.
                  Digits only (strip anything else on input), and require a sensible minimum. */}
              <span className="small text-muted">or</span>
              <div className="input-group input-group-sm" style={{ width: 'auto' }}>
                <input type="text" inputMode="numeric"
                  className={`form-control form-control-sm${customTris !== '' && !customTrisValid ? ' is-invalid' : ''}`}
                  style={{ width: '10rem' }}
                  placeholder={srcTris ? `${MIN_CUSTOM_TRIS}–${srcTris} (pair)` : 'custom tris (pair)'}
                  value={customTris} onChange={(e) => setCustomTris(e.target.value.replace(/\D/g, ''))}
                  onKeyDown={(e) => { if (e.key === 'Enter') applyCustomTris(); }}
                  disabled={generating} />
                <button type="button" className="btn btn-outline-secondary"
                  onClick={applyCustomTris} disabled={generating || !customTrisValid}>Set</button>
              </div>
              {triCap !== 0 && triCap !== KEEP_TRIS && (
                <span className="badge text-bg-secondary">custom: {triCap.toLocaleString()} tris</span>
              )}
            </div>
            {customBelowMin && (
              <div className="text-danger small mt-1">
                Enter a whole number of at least {MIN_CUSTOM_TRIS.toLocaleString()} triangles (for the pair).
              </div>
            )}
            {customAboveMax && (
              <div className="text-danger small mt-1">
                This model has only {srcTris.toLocaleString()} triangles — that's the most you can keep.
                Use "Keep supplier's" to keep them all.
              </div>
            )}
            <div className="text-muted small mt-1">
              {alreadyOptimal
                ? <>This model already has {srcTris.toLocaleString()} triangles (under Snapchat's ~100k budget),
                    so it's kept as-is. Set a lower custom target only if you need it lighter. Numbers are for
                    the pair (both shoes), matching Lens Studio.</>
                : <>By default the pair is reduced to about 100,000 triangles — Snapchat's recommended budget for
                    smooth AR. "Keep supplier's" retains the full geometry (a very high-poly shoe can exceed the
                    8 MB cap this way). Or set a custom target and re-check the real Lens Size in Lens Studio —
                    pick the highest that still fits. Numbers are for the pair (both shoes), matching Lens Studio.</>}
            </div>

            {/* Swap L/R — the fix for a wrong auto-guess. L/R by shape or position is a
                best guess; if the fitted preview shows the shoes on the wrong feet, tick
                this and Regenerate to exchange which geometry is baked into Shoe_L / Shoe_R.
                Only meaningful for a pair; hidden for a single (its side is declared). */}
            {meta.shoeCount === 2 && (
              <div className="mt-3">
                <div className="form-check form-switch">
                  <input className="form-check-input" type="checkbox" role="switch" id="swapLrSwitch"
                    checked={swapLr} onChange={(e) => setSwapLr(e.target.checked)} disabled={generating} />
                  <label className="form-check-label small" htmlFor="swapLrSwitch">
                    Swap left / right
                    <span className="text-muted">
                      {lrFromNames
                        ? " — L/R came from the file's Shoe_L / Shoe_R labels, so this usually isn't needed."
                        : ' — left/right was auto-guessed. If the Fitted-pair preview shows the shoes on the wrong feet, tick this and Regenerate.'}
                    </span>
                  </label>
                </div>
                {meta.lrSwapped && (
                  <div className="small mt-1">
                    <span className="badge text-bg-info">L/R swapped</span>{' '}
                    the fitted model has the two feet exchanged.
                  </div>
                )}
              </div>
            )}

            {/* generate + download — selections above only take effect when this runs */}
            <div className="d-flex gap-2 mt-3">
              <button type="button" className="btn btn-sm btn-primary" onClick={() => generate()} disabled={generating}>
                {generating ? 'Generating…' : fitted ? 'Regenerate fitted model' : 'Generate fitted model'}
              </button>
              {fitted?.url && (
                <button type="button" className="btn btn-sm btn-outline-secondary" onClick={download}>
                  Download fitted .glb
                </button>
              )}
              {modelUrl && (
                <button type="button" className="btn btn-sm btn-outline-secondary"
                        onClick={downloadOriginal} disabled={savingOrig}
                        title="The supplier's raw upload — not scaled/oriented/optimized. Use only if you'll prep it yourself in Lens Studio.">
                  {savingOrig ? 'Downloading…' : 'Download original'}
                </button>
              )}
            </div>
            {settingsChanged && !generating && (
              <div className="small mt-1">
                <span className="badge text-bg-warning">Settings changed</span>{' '}
                the preview was built with different settings — click <strong>Regenerate</strong> to apply your changes.
              </div>
            )}

            {/* Lens Studio steps tucked away — available, not in the way */}
            <details className="mt-2">
              <summary className="small text-primary" style={{ cursor: 'pointer' }}>How to use this in Lens Studio</summary>
              <div className="form-text mt-1 mb-0">
                One .glb with both shoes (Shoe_L + Shoe_R). Import it, bind each named node to its foot
                (keep the Foot Occluder), paste the suggested position above, and publish to your lens group —
                then set the lens id below.
              </div>
            </details>
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
