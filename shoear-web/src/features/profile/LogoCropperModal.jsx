import { useCallback, useState } from 'react';
import Cropper from 'react-easy-crop';

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';   // blob: src is same-origin → canvas stays untainted
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

// Draw the chosen square region to a canvas and export a PNG File (PNG keeps any
// transparency; the circle itself is a display mask, so we store a square image).
async function cropToFile(src, area) {
  const img = await loadImage(src);
  const out = Math.min(Math.round(area.width), 512);   // cap output size
  const canvas = document.createElement('canvas');
  canvas.width = out;
  canvas.height = out;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, area.x, area.y, area.width, area.height, 0, 0, out, out);
  return new Promise((resolve) =>
    canvas.toBlob((blob) => resolve(new File([blob], 'logo.png', { type: 'image/png' })), 'image/png')
  );
}

// A circular crop/zoom step (like Lens Studio's icon editor): pan + zoom the image
// inside a round frame, then Save returns a square PNG shown as a circle.
function LogoCropperModal({ src, onCancel, onCropped }) {
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [area, setArea] = useState(null);
  const [busy, setBusy] = useState(false);

  const onComplete = useCallback((_, areaPixels) => setArea(areaPixels), []);

  async function save() {
    if (!area) return;
    setBusy(true);
    try {
      const file = await cropToFile(src, area);
      await onCropped(file);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="modal d-block" tabIndex="-1" role="dialog">
        <div className="modal-dialog modal-dialog-centered" role="document">
          <div className="modal-content">
            <div className="modal-header">
              <h5 className="modal-title">Adjust your logo</h5>
              <button type="button" className="btn-close" onClick={onCancel} disabled={busy}></button>
            </div>
            <div className="modal-body">
              <div className="position-relative bg-dark rounded overflow-hidden" style={{ height: 300 }}>
                <Cropper
                  image={src}
                  crop={crop}
                  zoom={zoom}
                  aspect={1}
                  cropShape="round"
                  showGrid={false}
                  onCropChange={setCrop}
                  onZoomChange={setZoom}
                  onCropComplete={onComplete}
                />
              </div>
              <label className="form-label small text-muted mt-3 mb-1">Zoom</label>
              <input type="range" className="form-range" min={1} max={3} step={0.01}
                value={zoom} onChange={(e) => setZoom(Number(e.target.value))} />
              <div className="form-text">Drag to reposition, slide to zoom. The circle is how customers will see it.</div>
            </div>
            <div className="modal-footer">
              <button type="button" className="btn btn-outline-secondary" onClick={onCancel} disabled={busy}>Cancel</button>
              <button type="button" className="btn btn-primary" onClick={save} disabled={busy || !area}>
                {busy ? 'Saving…' : 'Save logo'}
              </button>
            </div>
          </div>
        </div>
      </div>
      <div className="modal-backdrop show"></div>
    </>
  );
}

export default LogoCropperModal;
