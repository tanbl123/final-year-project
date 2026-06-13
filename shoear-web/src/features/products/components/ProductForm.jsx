import { useState, useEffect } from 'react';
import { fetchCategories, uploadFile } from '../productService';

// A blank size row. Suppliers add one row per size they sell.
const emptyVariant = () => ({ size: '', stock: '' });

// Letters, numbers, spaces and a little punctuation — blocks junk like "??".
const NAME_RE = /^[\p{L}\p{N} .,&'\/+-]+$/u;

function ProductForm({ onAdd, onCancel }) {
  const [name, setName] = useState('');
  const [brand, setBrand] = useState('');
  const [price, setPrice] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [description, setDescription] = useState('');
  const [variants, setVariants] = useState([emptyVariant()]);
  const [images, setImages] = useState([]);          // [{ url }]
  const [modelUrl, setModelUrl] = useState('');       // single .glb/.gltf
  const [modelName, setModelName] = useState('');     // shown to the supplier
  const [tryOn, setTryOn] = useState(false);

  const [categories, setCategories] = useState([]);
  const [uploading, setUploading] = useState(false);  // an upload is in flight
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');             // server / upload errors

  // Per-field validation state. `touched` decides when an error is shown
  // (after the field is blurred, or once submit is attempted).
  const [touched, setTouched] = useState({});
  const [fieldErrors, setFieldErrors] = useState({});
  const [variantTouched, setVariantTouched] = useState({});

  useEffect(() => {
    fetchCategories()
      .then((data) => setCategories(data))
      .catch((err) => setError(err.message));
  }, []);

  // ── field validators ─────────────────────────────────────────────
  // Returns an error string ('' when valid). `over` lets callers validate a
  // not-yet-committed value (so onChange can re-check the field live).
  function validateField(field, over = {}) {
    const v = { name, brand, price, categoryId, ...over };
    switch (field) {
      case 'name': {
        const s = v.name.trim();
        if (!s) return 'Shoe name is required.';
        if (s.length > 150) return 'Keep it under 150 characters.';
        if (!NAME_RE.test(s)) return 'Use letters, numbers and basic punctuation only.';
        return '';
      }
      case 'brand': {
        const s = v.brand.trim();
        if (!s) return 'Brand is required.';
        if (s.length > 80) return 'Keep it under 80 characters.';
        if (!NAME_RE.test(s)) return 'Use letters, numbers and basic punctuation only.';
        return '';
      }
      case 'price': {
        if (v.price === '' || v.price === null) return 'Price is required.';
        const n = Number(v.price);
        if (Number.isNaN(n)) return 'Price must be a number.';
        if (n <= 0) return 'Price must be greater than 0.';
        if (n > 100000) return 'Price looks too high — please check.';
        return '';
      }
      case 'categoryId':
        return v.categoryId ? '' : 'Please choose a category.';
      default:
        return '';
    }
  }

  // Validate one size row. Returns { size?, stock? } error messages.
  function validateVariant(index, list = variants) {
    const row = list[index];
    const size = row.size.trim();
    const stock = row.stock;
    if (size === '' && stock === '') return {};        // a blank row is fine (ignored)

    const errs = {};
    if (size === '') {
      errs.size = 'Enter a size.';
    } else if (list.some((o, j) =>
      j !== index && o.size.trim().toLowerCase() === size.toLowerCase())) {
      errs.size = 'Duplicate size.';
    }
    if (stock === '') {
      errs.stock = 'Enter stock.';
    } else {
      const n = Number(stock);
      if (Number.isNaN(n) || n < 0 || !Number.isInteger(n)) errs.stock = 'Whole number, 0 or more.';
    }
    return errs;
  }

  // onChange that also re-validates the field once it has been touched.
  function changeField(field, setter, value) {
    setter(value);
    if (touched[field]) {
      setFieldErrors((e) => ({ ...e, [field]: validateField(field, { [field]: value }) }));
    }
  }
  function blurField(field) {
    setTouched((t) => ({ ...t, [field]: true }));
    setFieldErrors((e) => ({ ...e, [field]: validateField(field) }));
  }
  const showError = (field) => (touched[field] && fieldErrors[field]) || '';

  // ── sizes ────────────────────────────────────────────────────────
  function updateVariant(index, field, value) {
    setVariants((prev) => prev.map((v, i) => (i === index ? { ...v, [field]: value } : v)));
  }
  function addVariantRow() {
    setVariants((prev) => [...prev, emptyVariant()]);
  }
  function removeVariantRow(index) {
    setVariants((prev) => (prev.length === 1 ? prev : prev.filter((_, i) => i !== index)));
  }
  function blurVariant(index, field) {
    setVariantTouched((t) => ({ ...t, [`${index}-${field}`]: true }));
  }
  function variantError(index, field) {
    if (!variantTouched[`${index}-${field}`]) return '';
    return validateVariant(index)[field] || '';
  }

  // ── image uploads ────────────────────────────────────────────────
  async function handleImageFiles(event) {
    const files = Array.from(event.target.files);
    event.target.value = '';              // let the same file be re-picked later
    if (files.length === 0) return;

    setError('');
    setUploading(true);
    try {
      for (const file of files) {
        const { url } = await uploadFile(file, 'image');
        setImages((prev) => [...prev, { url }]);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setUploading(false);
    }
  }
  function removeImage(url) {
    setImages((prev) => prev.filter((img) => img.url !== url));
  }

  // ── 3D model upload ──────────────────────────────────────────────
  async function handleModelFile(event) {
    const file = event.target.files[0];
    event.target.value = '';
    if (!file) return;

    setError('');
    setUploading(true);
    try {
      const { url } = await uploadFile(file, 'model');
      setModelUrl(url);
      setModelName(file.name);
      setTryOn(true);                     // a model means try-on can be enabled
    } catch (err) {
      setError(err.message);
    } finally {
      setUploading(false);
    }
  }
  function removeModel() {
    setModelUrl('');
    setModelName('');
    setTryOn(false);
  }

  function resetForm() {
    setName(''); setBrand(''); setPrice(''); setCategoryId('');
    setDescription(''); setVariants([emptyVariant()]); setImages([]);
    setModelUrl(''); setModelName(''); setTryOn(false);
    setError(''); setTouched({}); setFieldErrors({}); setVariantTouched({});
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setError('');

    // validate the base fields and mark them all touched
    const base = ['name', 'brand', 'price', 'categoryId'];
    const baseErrors = {};
    base.forEach((f) => { baseErrors[f] = validateField(f); });
    setFieldErrors((e) => ({ ...e, ...baseErrors }));
    setTouched((t) => ({ ...t, name: true, brand: true, price: true, categoryId: true }));
    const hasBaseError = base.some((f) => baseErrors[f]);

    // validate size rows; collect the non-blank, valid ones
    const cleanVariants = [];
    let hasSizeError = false;
    variants.forEach((row, i) => {
      const size = row.size.trim();
      if (size === '' && row.stock === '') return;     // ignore a fully-blank row
      const errs = validateVariant(i);
      if (Object.keys(errs).length > 0) { hasSizeError = true; return; }
      cleanVariants.push({ size, stock: Number(row.stock) });
    });
    if (hasSizeError) {
      const allTouched = {};
      variants.forEach((_, i) => { allTouched[`${i}-size`] = true; allTouched[`${i}-stock`] = true; });
      setVariantTouched((t) => ({ ...t, ...allTouched }));
    }

    // inline field errors already explain what to fix — no summary banner
    if (hasBaseError || hasSizeError) {
      return;
    }
    if (uploading) { setError('Please wait for uploads to finish.'); return; }

    setSubmitting(true);
    try {
      await onAdd({
        name: name.trim(),
        brand: brand.trim(),
        price: Math.round(Number(price) * 100) / 100,
        categoryId,
        description: description.trim(),
        virtualTryOnEnable: tryOn,
        variants: cleanVariants,
        images: images.map((img) => img.url),
        modelUrl,
      });
      resetForm();
      if (onCancel) onCancel();          // leave the form after a successful add
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="card card-body mb-4 bg-light" noValidate>
      <h5 className="mb-3">New product</h5>

      {error && <div className="alert alert-danger py-2">{error}</div>}

      {/* basics */}
      <div className="row g-3">
        <div className="col-md-6">
          <label className="form-label">Shoe name</label>
          <input type="text" maxLength="150" placeholder="e.g. Air Zoom Pegasus 40"
            className={'form-control' + (showError('name') ? ' is-invalid' : '')}
            value={name} onChange={(e) => changeField('name', setName, e.target.value)}
            onBlur={() => blurField('name')} />
          {showError('name') && <div className="invalid-feedback">{fieldErrors.name}</div>}
        </div>
        <div className="col-md-3">
          <label className="form-label">Brand</label>
          <input type="text" maxLength="80" placeholder="e.g. Nike"
            className={'form-control' + (showError('brand') ? ' is-invalid' : '')}
            value={brand} onChange={(e) => changeField('brand', setBrand, e.target.value)}
            onBlur={() => blurField('brand')} />
          {showError('brand') && <div className="invalid-feedback">{fieldErrors.brand}</div>}
        </div>
        <div className="col-md-3">
          <label className="form-label">Price (RM)</label>
          <input type="number" min="0.01" max="100000" step="0.01" placeholder="0.00"
            className={'form-control' + (showError('price') ? ' is-invalid' : '')}
            value={price} onChange={(e) => changeField('price', setPrice, e.target.value)}
            onBlur={() => blurField('price')} />
          {showError('price') && <div className="invalid-feedback">{fieldErrors.price}</div>}
        </div>
        <div className="col-md-6">
          <label className="form-label">Category</label>
          <select value={categoryId}
            className={'form-select' + (showError('categoryId') ? ' is-invalid' : '')}
            onChange={(e) => changeField('categoryId', setCategoryId, e.target.value)}
            onBlur={() => blurField('categoryId')}>
            <option value="">Choose category…</option>
            {categories.map((cat) => (
              <option key={cat.id} value={cat.id}>{cat.name}</option>
            ))}
          </select>
          {showError('categoryId') && <div className="invalid-feedback">{fieldErrors.categoryId}</div>}
        </div>
        <div className="col-12">
          <label className="form-label">Description</label>
          <textarea className="form-control" rows="3" maxLength="2000"
            placeholder="Materials, fit, technology, what makes this shoe special…"
            value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
      </div>

      <hr className="my-4" />

      {/* sizes & stock */}
      <div className="d-flex justify-content-between align-items-center mb-2">
        <label className="form-label mb-0 fw-semibold">Sizes &amp; stock</label>
        <button type="button" className="btn btn-outline-secondary btn-sm" onClick={addVariantRow}>
          + Add size
        </button>
      </div>
      <p className="text-muted small">Stock is tracked per size. Add a row for each size you sell.</p>
      {variants.map((v, i) => (
        <div className="row g-2 mb-2 align-items-start" key={i}>
          <div className="col-5 col-md-3">
            <input type="text" placeholder="Size (e.g. UK8)"
              className={'form-control' + (variantError(i, 'size') ? ' is-invalid' : '')}
              value={v.size} onChange={(e) => updateVariant(i, 'size', e.target.value)}
              onBlur={() => blurVariant(i, 'size')} />
            {variantError(i, 'size') && <div className="invalid-feedback">{variantError(i, 'size')}</div>}
          </div>
          <div className="col-5 col-md-3">
            <input type="number" min="0" step="1" placeholder="Stock qty"
              className={'form-control' + (variantError(i, 'stock') ? ' is-invalid' : '')}
              value={v.stock} onChange={(e) => updateVariant(i, 'stock', e.target.value)}
              onBlur={() => blurVariant(i, 'stock')} />
            {variantError(i, 'stock') && <div className="invalid-feedback">{variantError(i, 'stock')}</div>}
          </div>
          <div className="col-2 col-md-1">
            <button type="button" className="btn btn-outline-danger btn-sm w-100"
              disabled={variants.length === 1} onClick={() => removeVariantRow(i)} title="Remove size">
              ✕
            </button>
          </div>
        </div>
      ))}

      <hr className="my-4" />

      {/* images */}
      <label className="form-label fw-semibold">Product images</label>
      <p className="text-muted small">JPG, PNG or WebP, up to 5&nbsp;MB each.</p>
      <input type="file" className="form-control" accept="image/png,image/jpeg,image/webp"
        multiple onChange={handleImageFiles} disabled={uploading} />
      {images.length > 0 && (
        <div className="d-flex flex-wrap gap-2 mt-3">
          {images.map((img) => (
            <div key={img.url} className="position-relative">
              <img src={img.url} alt="" className="rounded border"
                style={{ width: 90, height: 90, objectFit: 'cover' }} />
              <button type="button" className="btn btn-sm btn-danger position-absolute top-0 end-0 py-0 px-1"
                style={{ transform: 'translate(30%,-30%)' }} onClick={() => removeImage(img.url)}>
                ✕
              </button>
            </div>
          ))}
        </div>
      )}

      <hr className="my-4" />

      {/* 3D model + try-on */}
      <label className="form-label fw-semibold">3D model (for AR virtual try-on)</label>
      <p className="text-muted small">A .glb or .gltf file, up to 30&nbsp;MB.</p>
      {modelUrl ? (
        <div className="d-flex align-items-center gap-2">
          <span className="badge text-bg-success">🧊 {modelName || '3D model uploaded'}</span>
          <button type="button" className="btn btn-outline-danger btn-sm" onClick={removeModel}>Remove</button>
        </div>
      ) : (
        <input type="file" className="form-control" accept=".glb,.gltf,model/gltf-binary,model/gltf+json"
          onChange={handleModelFile} disabled={uploading} />
      )}
      <div className="form-check mt-3">
        <input className="form-check-input" type="checkbox" id="tryOn"
          checked={tryOn} disabled={!modelUrl} onChange={(e) => setTryOn(e.target.checked)} />
        <label className="form-check-label" htmlFor="tryOn">
          Enable virtual try-on for this product
        </label>
      </div>

      <hr className="my-4" />

      <div className="d-flex gap-2">
        <button type="submit" className="btn btn-primary" disabled={uploading || submitting}>
          {submitting ? 'Saving…' : uploading ? 'Uploading…' : 'Save product'}
        </button>
        {onCancel && (
          <button type="button" className="btn btn-outline-secondary" onClick={onCancel}>Cancel</button>
        )}
      </div>
    </form>
  );
}

export default ProductForm;
