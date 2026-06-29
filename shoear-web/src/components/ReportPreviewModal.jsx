import { useEffect, useRef, useState } from 'react';

// Preview a generated report PDF in a modal before downloading it. `build` is a
// function returning the report options (see utils/reportPdf) — it's called when
// the modal opens so the reference number / timestamp reflect the export moment.
// We build the PDF once, show it in an <iframe> via a blob URL, and download the
// SAME document (so preview and file match exactly). jsPDF is lazy-imported here
// to keep it out of the main bundle.
function ReportPreviewModal({ open, onClose, build }) {
  const [url, setUrl] = useState('');
  const [building, setBuilding] = useState(false);
  const [error, setError] = useState('');
  const docRef = useRef(null);
  const filenameRef = useRef('report.pdf');

  useEffect(() => {
    if (!open) return undefined;
    let objectUrl;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setBuilding(true);
    setError('');
    (async () => {
      try {
        const { buildReportDoc } = await import('../utils/reportPdf');
        const { doc, filename } = buildReportDoc(build());
        if (cancelled) return;
        docRef.current = doc;
        filenameRef.current = filename;
        objectUrl = URL.createObjectURL(doc.output('blob'));
        setUrl(objectUrl);
      } catch (e) {
        if (!cancelled) setError(e.message || 'Could not build the report.');
      } finally {
        if (!cancelled) setBuilding(false);
      }
    })();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      setUrl('');
      docRef.current = null;
    };
    // build is intentionally read fresh each open; rerun only when opened/closed
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;

  const download = () => {
    if (docRef.current) docRef.current.save(filenameRef.current);
  };

  return (
    <>
      <div className="modal-backdrop fade show"></div>
      <div className="modal d-block" tabIndex="-1" role="dialog">
        <div className="modal-dialog modal-xl modal-dialog-centered" role="document">
          <div className="modal-content" style={{ height: '90vh' }}>
            <div className="modal-header">
              <h5 className="modal-title">Report preview</h5>
              <button type="button" className="btn-close" onClick={onClose}></button>
            </div>
            <div className="modal-body p-0 d-flex flex-column" style={{ overflow: 'hidden' }}>
              {error ? (
                <div className="alert alert-danger m-3">{error}</div>
              ) : building || !url ? (
                <div className="d-flex flex-grow-1 align-items-center justify-content-center text-muted">
                  Building preview…
                </div>
              ) : (
                <iframe title="Report preview" src={url} style={{ border: 0, flex: 1, width: '100%' }} />
              )}
            </div>
            <div className="modal-footer">
              <button type="button" className="btn btn-secondary" onClick={onClose}>Close</button>
              <button type="button" className="btn btn-primary" onClick={download} disabled={!url}>
                ⬇ Download PDF
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

export default ReportPreviewModal;
