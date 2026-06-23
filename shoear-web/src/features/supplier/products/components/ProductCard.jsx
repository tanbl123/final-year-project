import { Link } from 'react-router-dom';

// Bootstrap badge colour for each approval status.
const STATUS_COLORS = {
  Approved: 'success',
  Pending: 'warning',
  Rejected: 'danger',
  Removed: 'secondary',
};
const LOW_STOCK = 10;   // at or below this (but > 0) the card flags "low stock"

function ProductCard(props) {
  const statusColor = STATUS_COLORS[props.status] || 'secondary';

  const stock = props.totalStock;
  const stockBadge = typeof stock !== 'number'
    ? null
    : stock === 0
      ? { color: 'danger', text: 'Out of stock' }
      : stock <= LOW_STOCK
        ? { color: 'warning', text: `Low stock · ${stock}` }
        : { color: 'success', text: `${stock} in stock` };

  return (
    <div className="card h-100 border-0 shadow-sm product-card">
      {/* image with the status badge overlaid in the corner */}
      <div className="position-relative">
        <div className="ratio ratio-4x3 bg-light rounded-top overflow-hidden">
          {props.imageUrl ? (
            <img src={props.imageUrl} alt={props.name}
              style={{ objectFit: 'cover' }} className="w-100 h-100" />
          ) : (
            <div className="d-flex align-items-center justify-content-center text-muted fs-1">👟</div>
          )}
        </div>
        {props.status && (
          <span className={`badge text-bg-${statusColor} position-absolute top-0 end-0 m-2 shadow-sm`}>
            {props.status}
          </span>
        )}
      </div>

      <div className="card-body d-flex flex-column">
        <h6 className="card-title mb-0 text-truncate" title={props.name}>{props.name}</h6>
        <div className="text-muted small mb-2">{props.brand}</div>

        <div className="fs-5 fw-bold text-primary mb-2">RM {Number(props.price).toFixed(2)}</div>

        {stockBadge && (
          <div className="mb-3">
            <span className={`badge rounded-pill text-bg-${stockBadge.color}`}>{stockBadge.text}</span>
          </div>
        )}

        {/* actions pinned to the bottom so every card lines up */}
        <div className="mt-auto d-flex gap-2">
          <Link to={'/products/' + props.id} className="btn btn-outline-primary btn-sm flex-fill">
            View
          </Link>
          <Link to={'/products/' + props.id + '/edit'} state={{ from: '/products' }}
            className="btn btn-outline-secondary btn-sm flex-fill">
            Edit
          </Link>
          <button className="btn btn-outline-danger btn-sm" title="Delete product"
            onClick={() => props.onDelete(props.id)}>
            🗑
          </button>
        </div>
      </div>
    </div>
  );
}

export default ProductCard;
