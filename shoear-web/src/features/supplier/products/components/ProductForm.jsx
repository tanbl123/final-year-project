import { useState, useEffect, useMemo } from 'react';
import { fetchCategories, uploadFile, validateModel } from '../productService';
import ConfirmDialog from '../../../../components/ConfirmDialog';
import ClearableInput from '../../../../components/ClearableInput';

// A blank size row. Suppliers add one row per size they sell.
const emptyVariant = () => ({ size: '', stock: '' });

// Max product images per listing (kept in sync with the backend cap).
const MAX_IMAGES = 8;

// Letters, numbers, spaces and a little punctuation — blocks junk like "??".
const NAME_RE = /^[\p{L}\p{N} .,&'/+-]+$/u;

// Build the form's starting state from an existing product (edit) or blanks
// (create). `init` is also used as the baseline for the "unsaved changes" check.
function makeInit(initialValues) {
  return {
    name: initialValues?.name ?? '',
    brand: initialValues?.brand ?? '',
    price: initialValues?.price != null ? String(initialValues.price) : '',
    categoryId: initialValues?.categoryId ?? '',
    description: initialValues?.description ?? '',
    variants: initialValues?.variants?.length
      ? initialValues.variants.map((v) => ({ size: v.size, stock: String(v.stock) }))
      : [emptyVariant()],
    images: (initialValues?.images ?? []).map((url) => ({ url })),
    modelUrl: initialValues?.modelUrl ?? '',
    modelName: initialValues?.modelUrl ? '3D model uploaded' : '',
    // VTO only counts as on when a model exists — never load as checked-but-disabled
    tryOn: !!initialValues?.virtualTryOnEnable && !!initialValues?.modelUrl,
  };
}

// A normalised, order-independent fingerprint of the form, so we can tell
// whether anything actually changed (drives the discard-changes prompt).
function signatureOf(s) {
  return JSON.stringify({
    name: s.name.trim(),
    brand: s.brand.trim(),
    price: String(s.price),
    categoryId: s.categoryId,
    description: s.description.trim(),
    variants: s.variants
      .map((v) => ({ size: v.size.trim().toLowerCase(), stock: String(v.stock) }))
      .filter((v) => v.size !== '' || v.stock !== '')
      .sort((a, b) => a.size.localeCompare(b.size)),
    images: s.images.map((i) => i.url),
    modelUrl: s.modelUrl,
    tryOn: !!s.tryOn,
  });
}

function ProductForm({ onAdd, onCancel, initialValues = null, mode = 'create' }) {
  const init = useMemo(() => makeInit(initialValues), [initialValues]);
  const isEdit = mode === 'edit';

  const [name, setName] = useState(init.name);
  const [brand, setBrand] = useState(init.brand);
  const [price, setPrice] = useState(init.price);
  const [categoryId, setCategoryId] = useState(init.categoryId);
  const [description, setDescription] = useState(init.description);
  const [variants, setVariants] = useState(init.variants);
  const [images, setImages] = useState(init.images);  // [{ url }]
  const [modelUrl, setModelUrl] = useState(init.modelUrl);   // single .glb/.gltf
  const [modelName, setModelName] = useState(init.modelName); // shown to the supplier
  const [modelWarnings, setModelWarnings] = useState([]);     // AR validation warnings (non-blocking)
  const [validatingModel, setValidatingModel] = useState(false);
  const [tryOn, setTryOn] = useState(init.tryOn);

  const [categories, setCategories] = useState([]);
  const [uploading, setUploading] = useState(false);  // an upload is in flight
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');             // server / upload errors

  // Per-field validation state. `touched` decides when an error is shown
  // (after the field is blurred, or once submit is attempted).
  const [touched, setTouched] = useState({});
  const [fieldErrors, setFieldErrors] = useState({});
  const [variantTouched, setVariantTouched] = useState({});
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);   // discard-changes prompt

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

  // onChange that validates live: typing marks the field touched and re-checks
  // it on every keystroke (errors still never show on a pristine field).
  function changeField(field, setter, value) {
    setter(value);
    setTouched((t) => (t[field] ? t : { ...t, [field]: true }));
    setFieldErrors((e) => ({ ...e, [field]: validateField(field, { [field]: value }) }));
  }
  function blurField(field) {
    setTouched((t) => ({ ...t, [field]: true }));
    setFieldErrors((e) => ({ ...e, [field]: validateField(field) }));
  }
  const showError = (field) => (touched[field] && fieldErrors[field]) || '';

  // ── sizes ────────────────────────────────────────────────────────
  function updateVariant(index, field, value) {
    setVariants((prev) => prev.map((v, i) => (i === index ? { ...v, [field]: value } : v)));
    // validate this size row live (mark touched so the inline error shows)
    setVariantTouched((t) => ({ ...t, [`${index}-${field}`]: true }));
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
    // enforce the image cap: only upload as many as still fit under MAX_IMAGES
    const room = MAX_IMAGES - images.length;
    if (room <= 0) {
      setError(`You can upload up to ${MAX_IMAGES} images.`);
      return;
    }
    const toUpload = files.slice(0, room);
    if (files.length > room) {
      setError(`Only ${room} more image${room === 1 ? '' : 's'} allowed (max ${MAX_IMAGES}). Extra files were skipped.`);
    }

    setUploading(true);
    try {
      for (const file of toUpload) {
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
    setModelWarnings([]);
    setUploading(true);
    try {
      const { url } = await uploadFile(file, 'model');
      // Fail-fast AR validation: catch a bad model now, not at admin review.
      setValidatingModel(true);
      let result;
      try {
        result = await validateModel(url);
      } catch {
        result = { available: false };   // don't block on a validation hiccup
      } finally {
        setValidatingModel(false);
      }
      if (result?.available && result.rejected) {
        // reject the model so the supplier fixes it before submitting
        setError(`This 3D model can't be used for AR try-on: ${result.rejectReason} Please upload a corrected file.`);
        setModelUrl('');
        setModelName('');
        setTryOn(false);
        return;
      }
      setModelUrl(url);
      setModelName(file.name);
      setModelWarnings(result?.available ? (result.warnings || []) : []);
      // leave the try-on choice to the supplier (they tick the box below)
    } catch (err) {
      setError(err.message);
    } finally {
      setUploading(false);
    }
  }
  function removeModel() {
    setModelUrl('');
    setModelName('');
    setModelWarnings([]);
    setTryOn(false);
  }

  function resetForm() {
    setName(''); setBrand(''); setPrice(''); setCategoryId('');
    setDescription(''); setVariants([emptyVariant()]); setImages([]);
    setModelUrl(''); setModelName(''); setTryOn(false);
    setError(''); setTouched({}); setFieldErrors({}); setVariantTouched({});
    setSubmitAttempted(false);
  }

  // has anything changed from the starting state? (confirm before discarding)
  const dirty =
    signatureOf({ name, brand, price, categoryId, description, variants, images, modelUrl, tryOn })
    !== signatureOf(init);

  // cancel: confirm first if there's unsaved work, otherwise leave straight away
  function handleCancel() {
    if (dirty) setConfirmCancel(true);
    else onCancel();
  }

  // section-level requirements, shown only after a save attempt (and they
  // clear live once the supplier adds a valid size / an image)
  const hasValidVariant = variants.some((row, i) => {
    if (row.size.trim() === '' && row.stock === '') return false;
    return Object.keys(validateVariant(i)).length === 0;
  });
  const sizesError = submitAttempted && !hasValidVariant
    ? 'Add at least one size with its stock quantity.' : '';
  const imagesError = submitAttempted && images.length === 0
    ? 'Upload at least one product image.' : '';

  async function handleSubmit(event) {
    event.preventDefault();
    setError('');
    setSubmitAttempted(true);

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

    // sizes and at least one image are required
    const noSizes = cleanVariants.length === 0;
    const noImages = images.length === 0;

    // inline field errors already explain what to fix — no summary banner
    if (hasBaseError || hasSizeError || noSizes || noImages) {
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
        virtualTryOnEnable: tryOn && !!modelUrl,   // never enable VTO without a model
        variants: cleanVariants,
        images: images.map((img) => img.url),
        modelUrl,
      });
      if (!isEdit) resetForm();   // edit navigates away; create clears for the next one
      // onAdd owns what happens next (e.g. navigate away + show a toast)
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
    <form onSubmit={handleSubmit} className="card card-body mb-4 bg-light" noValidate>
      <h5 className="mb-3">{isEdit ? 'Edit product' : 'New product'}</h5>
      {isEdit && (
        <p className="text-muted small mb-3">
          Price and stock updates apply instantly. Changing product details
          (name, brand, description, category, images or 3D model) will send it
          back to admin for re-approval.
        </p>
      )}

      {error && <div className="alert alert-danger py-2">{error}</div>}

      {/* basics */}
      <div className="row g-3">
        <div className="col-md-6">
          <label className="form-label">Shoe name</label>
          <ClearableInput type="text" maxLength="150" placeholder="e.g. Air Zoom Pegasus 40"
            className={showError('name') ? 'is-invalid' : ''}
            value={name} onChange={(e) => changeField('name', setName, e.target.value)}
            onBlur={() => blurField('name')}
            onClear={() => changeField('name', setName, '')} />
          {showError('name') && <div className="invalid-feedback d-block">{fieldErrors.name}</div>}
        </div>
        <div className="col-md-3">
          <label className="form-label">Brand</label>
          <ClearableInput type="text" maxLength="80" placeholder="e.g. Nike"
            className={showError('brand') ? 'is-invalid' : ''}
            value={brand} onChange={(e) => changeField('brand', setBrand, e.target.value)}
            onBlur={() => blurField('brand')}
            onClear={() => changeField('brand', setBrand, '')} />
          {showError('brand') && <div className="invalid-feedback d-block">{fieldErrors.brand}</div>}
        </div>
        <div className="col-md-3">
          <label className="form-label">Price (RM)</label>
          <input type="number" min="0.01" max="100000" step="0.01" placeholder="e.g. 199.90"
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
      {sizesError && <div className="text-danger small mt-1">{sizesError}</div>}

      <hr className="my-4" />

      {/* images */}
      <label className="form-label fw-semibold">Product images</label>
      <p className="text-muted small">
        JPG, PNG or WebP, up to 5&nbsp;MB each. Up to {MAX_IMAGES} images ({images.length}/{MAX_IMAGES} added).
      </p>
      <input type="file" multiple accept="image/png,image/jpeg,image/webp"
        className={'form-control' + (imagesError ? ' is-invalid' : '')}
        onChange={handleImageFiles} disabled={uploading || images.length >= MAX_IMAGES} />
      {imagesError && <div className="invalid-feedback">{imagesError}</div>}
      {images.length >= MAX_IMAGES && (
        <div className="form-text text-warning">Maximum of {MAX_IMAGES} images reached.</div>
      )}
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
      <p className="text-muted small">A .glb or .gltf file, up to 30&nbsp;MB. It's checked automatically for AR try-on.</p>
      {validatingModel && (
        <div className="text-muted small mb-2">🔎 Checking the model for AR try-on…</div>
      )}
      {modelUrl ? (
        <>
          <div className="d-flex align-items-center gap-2">
            <span className="badge text-bg-success">🧊 {modelName || '3D model uploaded'}</span>
            <button type="button" className="btn btn-outline-danger btn-sm" onClick={removeModel}>Remove</button>
          </div>
          {/* non-blocking AR warnings so the supplier can improve the model */}
          {modelWarnings.length > 0 && (
            <div className="alert alert-warning py-2 small mt-2 mb-0">
              <div className="fw-semibold">AR try-on notes:</div>
              <ul className="mb-0 ps-3">
                {modelWarnings.map((w, i) => <li key={i}>{w}</li>)}
              </ul>
            </div>
          )}
          {/* live WebGL preview so the supplier can verify their 3D model
              (drag to rotate) before saving — matches the admin review preview */}
          <model-viewer
            src={modelUrl}
            camera-controls
            auto-rotate
            shadow-intensity="1"
            style={{ width: '100%', height: '260px', background: '#f8f9fa', borderRadius: '0.5rem', marginTop: '0.5rem' }}
          ></model-viewer>
        </>
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
        {!modelUrl && (
          <div className="form-text">Upload a 3D model first to enable this.</div>
        )}
      </div>

      <hr className="my-4" />

      <div className="d-flex gap-2">
        <button type="submit" className="btn btn-primary" disabled={uploading || submitting}>
          {submitting ? 'Saving…' : uploading ? 'Uploading…' : isEdit ? 'Save changes' : 'Save product'}
        </button>
        {onCancel && (
          <button type="button" className="btn btn-outline-secondary" onClick={handleCancel}>Cancel</button>
        )}
      </div>
    </form>

    <ConfirmDialog
      isOpen={confirmCancel}
      title={isEdit ? 'Discard changes?' : 'Discard product?'}
      message={isEdit
        ? 'You have unsaved changes. Are you sure you want to discard them?'
        : 'You have unsaved changes. Are you sure you want to discard this product?'}
      confirmText="Discard"
      confirmColor="danger"
      onCancel={() => setConfirmCancel(false)}
      onConfirm={() => { setConfirmCancel(false); onCancel(); }}
    />
    </>
  );
}

export default ProductForm;
