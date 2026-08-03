import { useEffect, useState } from 'react';
import { fetchProductById } from './productService';

const STATUS_COLORS = { Approved: 'success', Pending: 'warning', Rejected: 'danger', Removed: 'secondary' };
const rm = (n) => 'RM ' + Number(n || 0).toFixed(2);
const LOW_STOCK = 5;

// Read-only product preview shown in a popup (e.g. from the Reviews page), so a
// supplier can glance at the product a review is about without leaving the page.
// Pass a productId to open, null to close. Self-fetches via the supplier
// /products/{id} endpoint.
function ProductPeekModal({ productId, onClose }) {
  const [product, setProduct] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [activeImage, setActiveImage] = useState('');

  useEffect(() => {
    if (!productId) { setProduct(null); setError(''); return; }
    setLoading(true);
    setError('');
    fetchProductById(productId)
      .then((p) => { setProduct(p); setActiveImage(p.images?.[0] || ''); })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [productId]);

  if (!productId) return null;
  const statusColor = product ? (STATUS_COLORS[product.status] || 'secondary') : 'secondary';

  return (
    <div className="modal show d-block" tabIndex="-1" style={{ background: 'rgba(0,0,0,.5)' }} onClick={onClose}>
      <div className="modal-dialog modal-lg modal-dialog-scrollable" onClick={(e) => e.stopPropagation()}>
        <div className="modal-content">
          <div className="modal-header">
            <h5 className="modal-title">Product</h5>
            <button type="button" className="btn-close" onClick={onClose}></button>
          </div>
          <div className="modal-body">
            {loading || (!product && !error) ? (
              <p className="text-muted mb-0">Loading…</p>
            ) : error ? (
              <div className="alert alert-danger mb-0">{error}</div>
            ) : (
              <>
                <div className="d-flex align-items-center gap-2 mb-1">
                  <h5 className="mb-0">{product.name}</h5>
                  <span className={`badge text-bg-${statusColor}`}>{product.status}</span>
                </div>
                <div className="text-muted mb-3">
                  <span className="fw-semibold">{product.brand}</span>
                  <span className="mx-2">·</span>
                  <span className="badge text-bg-light">{product.categoryName}</span>
                </div>

                <div className="row g-3">
                  <div className="col-md-5">
                    <div className="ratio ratio-1x1 bg-light rounded border overflow-hidden">
                      {activeImage
                        ? <img src={activeImage} alt={product.name} style={{ objectFit: 'cover' }} className="w-100 h-100" />
                        : <div className="d-flex align-items-center justify-content-center text-muted display-3">👟</div>}
                    </div>
                    {product.images?.length > 1 && (
                      <div className="d-flex flex-wrap gap-2 mt-2">
                        {product.images.map((url) => (
                          <img key={url} src={url} alt="" onClick={() => setActiveImage(url)}
                            className={'rounded border ' + (url === activeImage ? 'border-primary border-2' : '')}
                            style={{ width: 48, height: 48, objectFit: 'cover', cursor: 'pointer' }} />
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="col-md-7">
                    <div className="d-flex gap-4 mb-3">
                      <div>
                        <div className="text-muted small text-uppercase">Price</div>
                        <div className="fs-5 fw-bold text-primary">{rm(product.price)}</div>
                      </div>
                      <div>
                        <div className="text-muted small text-uppercase">Total stock</div>
                        <div className="fs-5 fw-bold">{product.totalStock}</div>
                      </div>
                    </div>
                    {product.description
                      ? <p className="mb-3" style={{ whiteSpace: 'pre-line' }}>{product.description}</p>
                      : <p className="text-muted mb-3">No description provided.</p>}
                    {product.variants?.length > 0 && (
                      <table className="table table-sm align-middle mb-0">
                        <thead><tr><th>Size</th><th className="text-end">Stock</th><th className="text-end" style={{ width: 90 }}>Status</th></tr></thead>
                        <tbody>
                          {product.variants.map((v) => (
                            <tr key={v.size}>
                              <td className="fw-semibold">{v.size}</td>
                              <td className="text-end">{v.stock}</td>
                              <td className="text-end">
                                {v.stock === 0
                                  ? <span className="badge text-bg-danger">Out</span>
                                  : v.stock <= LOW_STOCK
                                    ? <span className="badge text-bg-warning">Low</span>
                                    : <span className="badge text-bg-success">In stock</span>}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                </div>
              </>
            )}
          </div>
          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={onClose}>Close</button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default ProductPeekModal;
