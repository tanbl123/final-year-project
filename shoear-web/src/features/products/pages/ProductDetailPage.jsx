import { useState, useEffect } from 'react';
import { useParams, useLocation, useNavigate, Link } from 'react-router-dom';
import { fetchProductById } from '../productService';
import BackButton from '../../../components/BackButton';
import Toast from '../../../components/Toast';
import StarRating from '../../../components/StarRating';

const STATUS_COLORS = { Approved: 'success', Pending: 'warning', Rejected: 'danger', Removed: 'secondary' };
const LOW_STOCK = 5;   // at or below this (but > 0) we flag a size as running low

function ProductDetailPage() {
  const { id } = useParams();          // 👈 read the :id from the URL
  const [product, setProduct] = useState(null);
  const [activeImage, setActiveImage] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');

  // an edit redirect lands here with a toast message to show
  const location = useLocation();
  const navigate = useNavigate();
  useEffect(() => {
    if (location.state?.toast) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setToast(location.state.toast);
      navigate(location.pathname, { replace: true });   // clear it so it won't reappear
    }
  }, [location, navigate]);

  useEffect(() => {
    setIsLoading(true);
    fetchProductById(id)
      .then((data) => {
        setProduct(data);
        setActiveImage(data.images?.[0] || '');
      })
      .catch((err) => setError(err.message))
      .finally(() => setIsLoading(false));
  }, [id]);                            // 👈 re-run if the id changes

  if (isLoading) {
    return (
      <div className="container py-5 text-center">
        <div className="spinner-border text-primary" role="status"></div>
        <p className="mt-2 text-muted">Loading…</p>
      </div>
    );
  }
  if (error) {
    return (
      <div className="container py-4 text-start">
        <BackButton to="/products" />
        <div className="alert alert-danger mt-3">{error}</div>
      </div>
    );
  }

  const statusColor = STATUS_COLORS[product.status] || 'secondary';
  const sizeCount = product.variants?.length || 0;
  const inStockSizes = product.variants?.filter((v) => v.stock > 0).length || 0;
  const allSizesAvailable = sizeCount > 0 && inStockSizes === sizeCount;
  const outOfStock = sizeCount > 0 && product.totalStock === 0;

  return (
    <div className="container py-4 text-start">
      <BackButton to="/products" />

      {/* ── header: title + status on the left, primary action on the right ── */}
      <div className="d-flex flex-wrap justify-content-between align-items-start gap-3 mt-2 mb-4">
        <div>
          <div className="d-flex align-items-center gap-2 mb-1">
            <h2 className="mb-0">{product.name}</h2>
            <span className={`badge text-bg-${statusColor}`}>{product.status}</span>
          </div>
          <div className="text-muted">
            <span className="fw-semibold">{product.brand}</span>
            <span className="mx-2">·</span>
            <span className="badge text-bg-light">{product.categoryName}</span>
            {product.virtualTryOnEnable && (
              <span className="badge text-bg-info ms-2">AR try-on</span>
            )}
            {product.ratingCount > 0 && (
              <span className="ms-2">
                <StarRating score={product.ratingAverage} />
                <span className="small ms-1">{product.ratingAverage.toFixed(1)} ({product.ratingCount})</span>
              </span>
            )}
          </div>
        </div>
        <Link to={`/products/${id}/edit`} state={{ from: `/products/${id}` }} className="btn btn-primary">
          ✎ Edit product
        </Link>
      </div>

      {/* ── summary stat tiles (seller-dashboard style) ── */}
      <div className="row g-3 mb-4">
        <div className="col-6 col-md-3">
          <div className="card card-body py-3">
            <div className="text-muted small text-uppercase">Price</div>
            <div className="fs-4 fw-bold text-primary">RM {Number(product.price).toFixed(2)}</div>
          </div>
        </div>
        <div className="col-6 col-md-3">
          <div className="card card-body py-3">
            <div className="text-muted small text-uppercase">Total stock</div>
            <div className={`fs-4 fw-bold ${outOfStock ? 'text-danger' : ''}`}>
              {product.totalStock}
            </div>
            <div className="text-muted small">
              across {sizeCount} size{sizeCount === 1 ? '' : 's'}
            </div>
          </div>
        </div>
        <div className="col-6 col-md-3">
          <div className="card card-body py-3">
            <div className="text-muted small text-uppercase">Sizes</div>
            <div className="fs-4 fw-bold">{sizeCount}</div>
            <div className={`small ${sizeCount === 0 ? 'text-muted' : allSizesAvailable ? 'text-success' : 'text-warning'}`}>
              {sizeCount === 0 ? 'none added' : `${inStockSizes} of ${sizeCount} in stock`}
            </div>
          </div>
        </div>
        <div className="col-6 col-md-3">
          <div className="card card-body py-3">
            <div className="text-muted small text-uppercase">Status</div>
            <div><span className={`badge text-bg-${statusColor} fs-6`}>{product.status}</span></div>
          </div>
        </div>
      </div>

      <div className="row g-4">
        {/* ── left: media gallery ── */}
        <div className="col-lg-6">
          <div className="card">
            <div className="card-body">
              <div className="ratio ratio-1x1 bg-light rounded border overflow-hidden">
                {activeImage ? (
                  <img src={activeImage} alt={product.name} style={{ objectFit: 'cover' }} className="w-100 h-100" />
                ) : (
                  <div className="d-flex align-items-center justify-content-center text-muted display-1">👟</div>
                )}
              </div>
              {product.images?.length > 1 && (
                <div className="d-flex flex-wrap gap-2 mt-3">
                  {product.images.map((url) => (
                    <img key={url} src={url} alt="" onClick={() => setActiveImage(url)}
                      className={'rounded border ' + (url === activeImage ? 'border-primary border-2' : '')}
                      style={{ width: 64, height: 64, objectFit: 'cover', cursor: 'pointer' }} />
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ── right: description + inventory ── */}
        <div className="col-lg-6">
          <div className="card mb-4">
            <div className="card-header bg-white fw-semibold">Description</div>
            <div className="card-body">
              {product.description
                ? <p className="mb-0" style={{ whiteSpace: 'pre-line' }}>{product.description}</p>
                : <p className="text-muted mb-0">No description provided.</p>}
            </div>
          </div>

          <div className="card">
            <div className="card-header bg-white d-flex justify-content-between align-items-center">
              <span className="fw-semibold">Inventory</span>
              {outOfStock && <span className="badge text-bg-danger">Out of stock</span>}
            </div>
            <div className="card-body">
              {sizeCount > 0 ? (
                <table className="table table-sm align-middle mb-0">
                  <thead>
                    <tr>
                      <th>Size</th>
                      <th className="text-end">Stock</th>
                      <th className="text-end" style={{ width: 120 }}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {product.variants.map((v) => (
                      <tr key={v.size}>
                        <td className="fw-semibold">{v.size}</td>
                        <td className="text-end">{v.stock}</td>
                        <td className="text-end">
                          {v.stock === 0 ? (
                            <span className="badge text-bg-danger">Out</span>
                          ) : v.stock <= LOW_STOCK ? (
                            <span className="badge text-bg-warning">Low</span>
                          ) : (
                            <span className="badge text-bg-success">In stock</span>
                          )}
                        </td>
                      </tr>
                    ))}
                    <tr className="fw-bold border-top">
                      <td>Total</td>
                      <td className="text-end">{product.totalStock}</td>
                      <td></td>
                    </tr>
                  </tbody>
                </table>
              ) : (
                <p className="text-muted mb-0">No sizes added.</p>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ── 3D model preview ── */}
      {product.modelUrl && (
        <div className="card mt-4">
          <div className="card-header bg-white fw-semibold">3D model (AR virtual try-on)</div>
          <div className="card-body">
            <model-viewer
              src={product.modelUrl}
              camera-controls
              auto-rotate
              ar
              shadow-intensity="1"
              style={{ width: '100%', height: '420px', background: '#f8f9fa', borderRadius: '0.5rem' }}
            ></model-viewer>
          </div>
        </div>
      )}

      {/* customer reviews (reviews live on the product) */}
      <div className="card mt-4">
        <div className="card-header bg-white d-flex justify-content-between align-items-center">
          <span className="fw-semibold">Customer reviews</span>
          {product.ratingCount > 0 && (
            <span className="d-flex align-items-center gap-2">
              <span className="fw-bold">{product.ratingAverage.toFixed(1)}</span>
              <StarRating score={product.ratingAverage} />
              <span className="text-muted small">({product.ratingCount})</span>
            </span>
          )}
        </div>
        <div className="card-body">
          {product.reviews?.length > 0 ? (
            <div className="d-flex flex-column gap-3">
              {product.reviews.map((r) => (
                <div key={r.reviewId} className="border-bottom pb-2">
                  <div className="d-flex justify-content-between align-items-center">
                    <StarRating score={r.ratingScore} />
                    <span className="text-muted small">{new Date(r.reviewDate).toLocaleDateString()}</span>
                  </div>
                  {r.reviewComment && <p className="mb-1 mt-1">{r.reviewComment}</p>}
                  <div className="text-muted small">{r.customerName}</div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-muted mb-0">No reviews yet for this product.</p>
          )}
        </div>
      </div>

      <p className="text-muted small mt-4 mb-0">Product ID: {product.id}</p>

      <Toast message={toast} onClose={() => setToast('')} />
    </div>
  );
}

export default ProductDetailPage;
