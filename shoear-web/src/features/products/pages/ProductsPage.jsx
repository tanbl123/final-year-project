import { useState, useEffect, useMemo } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import ProductCard from '../components/ProductCard';
import ProductFilterBar from '../components/ProductFilterBar';
import ConfirmDialog from '../../../components/ConfirmDialog';
import Toast from '../../../components/Toast';
import Pagination from '../../../components/Pagination';
import { usePagination } from '../../../hooks/usePagination';
import { fetchProducts, deleteProduct } from '../productService';

const EMPTY_FILTERS = { name: '', brand: '', maxPrice: '', categoryId: '', status: '' };
const PAGE_SIZE = 12;

function ProductsPage() {
  const [products, setProducts] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [toast, setToast] = useState('');

  // a redirect (e.g. after adding a product) may pass a toast message
  const location = useLocation();
  const navigate = useNavigate();
  useEffect(() => {
    if (location.state?.toast) {
      setToast(location.state.toast);
      navigate(location.pathname, { replace: true });   // clear it so it won't reappear
    }
  }, [location, navigate]);

  const [dialog, setDialog] = useState({
    isOpen: false, title: '', message: '',
    confirmText: 'Confirm', confirmColor: 'primary', onConfirm: () => {},
  });

  function closeDialog() {
    setDialog((d) => ({ ...d, isOpen: false }));
  }

  // load this supplier's products from the API on first render
  useEffect(() => {
    fetchProducts()
      .then((data) => setProducts(data))
      .catch((err) => setError(err.message))
      .finally(() => setIsLoading(false));
  }, []);

  function askDelete(id) {
    setDialog({
      isOpen: true,
      title: 'Delete product',
      message: 'Are you sure you want to delete this product?',
      confirmText: 'Delete',
      confirmColor: 'danger',
      onConfirm: async () => {
        try {
          await deleteProduct(id);
          setProducts((prev) => prev.filter((shoe) => shoe.id !== id));
        } catch (err) {
          setError(err.message);
        }
        closeDialog();
      },
    });
  }

  // at-a-glance counts for the supplier (computed from the full list)
  const stats = useMemo(() => ({
    total: products.length,
    approved: products.filter((p) => p.status === 'Approved').length,
    pending: products.filter((p) => p.status === 'Pending').length,
    outOfStock: products.filter((p) => typeof p.totalStock === 'number' && p.totalStock === 0).length,
  }), [products]);

  // client-side filtering driven by the filter bar
  const visible = useMemo(() => {
    const name = filters.name.trim().toLowerCase();
    const brand = filters.brand.trim().toLowerCase();
    const maxPrice = filters.maxPrice === '' ? null : Number(filters.maxPrice);
    return products.filter((p) => {
      if (name && !p.name.toLowerCase().includes(name)) return false;
      if (brand && !p.brand.toLowerCase().includes(brand)) return false;
      if (filters.categoryId && p.categoryId !== filters.categoryId) return false;
      if (filters.status && p.status !== filters.status) return false;
      if (maxPrice !== null && !Number.isNaN(maxPrice) && p.price > maxPrice) return false;
      return true;
    });
  }, [products, filters]);

  const { page, setPage, totalPages, pageItems } = usePagination(visible, PAGE_SIZE);
  // jump back to page 1 whenever the filters change
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPage(1);
  }, [filters, setPage]);

  return (
    <div className="container py-4 text-start">
      <div className="d-flex justify-content-between align-items-start flex-wrap gap-2 mb-4">
        <div>
          <h1 className="mb-1">👟 Supplier Products</h1>
          <p className="text-muted mb-0">Manage your catalogue — add, edit and track stock.</p>
        </div>
        <Link to="/products/new" className="btn btn-primary">+ Add product</Link>
      </div>

      {error && <div className="alert alert-danger">{error}</div>}

      {/* at-a-glance stats */}
      {!isLoading && products.length > 0 && (
        <div className="row g-3 mb-4">
          <div className="col-6 col-md-3">
            <div className="card card-body py-3">
              <div className="text-muted small text-uppercase">Products</div>
              <div className="fs-4 fw-bold">{stats.total}</div>
            </div>
          </div>
          <div className="col-6 col-md-3">
            <div className="card card-body py-3">
              <div className="text-muted small text-uppercase">Approved</div>
              <div className="fs-4 fw-bold text-success">{stats.approved}</div>
            </div>
          </div>
          <div className="col-6 col-md-3">
            <div className="card card-body py-3">
              <div className="text-muted small text-uppercase">Pending</div>
              <div className={`fs-4 fw-bold ${stats.pending ? 'text-warning' : ''}`}>{stats.pending}</div>
            </div>
          </div>
          <div className="col-6 col-md-3">
            <div className="card card-body py-3">
              <div className="text-muted small text-uppercase">Out of stock</div>
              <div className={`fs-4 fw-bold ${stats.outOfStock ? 'text-danger' : ''}`}>{stats.outOfStock}</div>
            </div>
          </div>
        </div>
      )}

      <ProductFilterBar filters={filters} onChange={setFilters} />

      {isLoading ? (
        <div className="text-center my-5">
          <div className="spinner-border text-primary" role="status"></div>
          <p className="mt-2">Loading products...</p>
        </div>
      ) : (
        <>
          <p className="text-muted">
            Showing {visible.length} of {products.length} product{products.length === 1 ? '' : 's'}
          </p>
          {visible.length === 0 ? (
            <div className="card card-body text-center text-muted">
              {products.length === 0
                ? 'No products yet. Click “+ Add product” to create your first one.'
                : 'No products match these filters.'}
            </div>
          ) : (
            <>
              <div className="row g-3">
                {pageItems.map((shoe) => (
                  <div className="col-12 col-sm-6 col-md-4 col-lg-3" key={shoe.id}>
                    <ProductCard
                      id={shoe.id}
                      name={shoe.name}
                      brand={shoe.brand}
                      price={shoe.price}
                      status={shoe.status}
                      imageUrl={shoe.imageUrl}
                      totalStock={shoe.totalStock}
                      onDelete={askDelete}
                    />
                  </div>
                ))}
              </div>
              <Pagination page={page} totalPages={totalPages} onChange={setPage}
                summary={`Page ${page} of ${totalPages} · ${visible.length} products`} />
            </>
          )}
        </>
      )}

      <ConfirmDialog
        isOpen={dialog.isOpen}
        title={dialog.title}
        message={dialog.message}
        confirmText={dialog.confirmText}
        confirmColor={dialog.confirmColor}
        onConfirm={dialog.onConfirm}
        onCancel={closeDialog}
      />

      <Toast message={toast} onClose={() => setToast('')} />
    </div>
  );
}

export default ProductsPage;
