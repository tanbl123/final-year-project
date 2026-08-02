import { useEffect, useState } from 'react';
import { fetchCategories } from '../productService';
import ClearableInput from '../../../../components/ClearableInput';
import { AR_FILTER_OPTIONS } from '../../../../utils/arFilter';

// The old "add" bar lived here (name / brand / price / category). It now
// FILTERS the product list instead of creating products. Changes are pushed
// up to the page via onChange; the page does the actual filtering.
const STATUSES = ['Pending', 'Approved', 'Rejected'];

function ProductFilterBar({ filters, onChange }) {
  const [categories, setCategories] = useState([]);

  useEffect(() => {
    fetchCategories().then(setCategories).catch(() => {});
  }, []);

  function set(field, value) {
    onChange({ ...filters, [field]: value });
  }

  const isFiltering =
    filters.name || filters.brand || filters.categoryId || filters.status || filters.maxPrice || filters.ar;

  return (
    <div className="card card-body mb-4">
      <div className="d-flex justify-content-between align-items-center mb-3">
        <h6 className="mb-0 text-muted">Filter products</h6>
        {isFiltering && (
          <button type="button" className="btn btn-outline-secondary btn-sm"
            onClick={() => onChange({ name: '', brand: '', maxPrice: '', categoryId: '', status: '', ar: '' })}>
            Clear filters
          </button>
        )}
      </div>
      <div className="row g-2 align-items-end">
        <div className="col-6 col-md-4 col-lg-2">
          <label className="form-label small text-muted mb-1">Search name</label>
          <ClearableInput type="text" placeholder="Shoe name"
            value={filters.name} onChange={(e) => set('name', e.target.value)}
            onClear={() => set('name', '')} />
        </div>
        <div className="col-6 col-md-4 col-lg-2">
          <label className="form-label small text-muted mb-1">Brand</label>
          <ClearableInput type="text" placeholder="Brand"
            value={filters.brand} onChange={(e) => set('brand', e.target.value)}
            onClear={() => set('brand', '')} />
        </div>
        <div className="col-6 col-md-4 col-lg-2">
          <label className="form-label small text-muted mb-1">Max price (RM)</label>
          <input type="number" min="0" step="0.01" className="form-control" placeholder="Any"
            value={filters.maxPrice} onChange={(e) => set('maxPrice', e.target.value)} />
        </div>
        <div className="col-6 col-md-4 col-lg-2">
          <label className="form-label small text-muted mb-1">Category</label>
          <select className="form-select" value={filters.categoryId}
            onChange={(e) => set('categoryId', e.target.value)}>
            <option value="">All categories</option>
            {categories.map((cat) => (
              <option key={cat.id} value={cat.id}>{cat.name}</option>
            ))}
          </select>
        </div>
        <div className="col-6 col-md-4 col-lg-2">
          <label className="form-label small text-muted mb-1">Status</label>
          <select className="form-select" value={filters.status}
            onChange={(e) => set('status', e.target.value)}>
            <option value="">All</option>
            {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div className="col-6 col-md-4 col-lg-2">
          <label className="form-label small text-muted mb-1">Virtual try-on</label>
          <select className="form-select" value={filters.ar || ''}
            onChange={(e) => set('ar', e.target.value)}>
            {AR_FILTER_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
      </div>
    </div>
  );
}

export default ProductFilterBar;
