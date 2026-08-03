import { useState, useEffect, useMemo, useRef } from 'react';
import { fetchCategories, uploadFile, validateModel } from '../productService';
import ConfirmDialog from '../../../../components/ConfirmDialog';
import ClearableInput from '../../../../components/ClearableInput';
import SearchableSelect from '../../../../components/SearchableSelect';

// A blank size row. Suppliers add one row per size they sell.
const emptyVariant = () => ({ size: '', stock: '' });

// Max product images per listing (kept in sync with the backend cap).
const MAX_IMAGES = 8;

// Letters, numbers, spaces and a little punctuation — blocks junk like "??".
const NAME_RE = /^[\p{L}\p{N} .,&'/+-]+$/u;

// UK shoe sizes (Malaysia uses UK) and the fixed ISO/"barleycorn" conversion to
// the shoe's real length in cm: each UK step is exactly 1/3 inch. This is a
// physical standard (unlike a currency rate, it never changes over time); it's a
// convenience so suppliers can pick a size they know and we fill the cm the
// auto-fit needs. The cm field stays editable for brand fine-tuning.
const UK_SIZES = ['3', '3.5', '4', '4.5', '5', '5.5', '6', '6.5', '7', '7.5', '8',
                  '8.5', '9', '9.5', '10', '10.5', '11', '11.5', '12', '12.5', '13'];
const ukToCm = (uk) => Math.round(((Number(uk) + 25) / 3) * 2.54 * 10) / 10;

// Validate a real-shoe-length entry (cm) and return a SPECIFIC reason, or '' if
// OK. A real shoe outsole is roughly 15–35 cm; we accept a generous 5–60 cm to
// allow kids' and outsize shoes, and explain exactly what's wrong otherwise (so
// e.g. a negative value doesn't get the vague "enter the shoe length").
function lengthProblem(v) {
  const s = String(v ?? '').trim();
  if (!s) return 'Enter the shoe length in cm.';
  const n = Number(s);
  if (!Number.isFinite(n)) return 'Enter the length as a number (e.g. 27).';
  if (n <= 0) return 'Length must be a positive number (e.g. 27).';
  if (n < 5 || n > 60) return 'That length looks off — enter a real shoe length, about 5–60 cm.';
  return '';
}

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
    // supplier-declared 3D-model facts (the "submission spec") — no silent
    // defaults; the supplier must consciously choose each one.
    modelShoeCount: initialValues?.modelShoeCount ? String(initialValues.modelShoeCount) : '',
    modelSide: initialValues?.modelSide ?? '',
    modelLengthCm: initialValues?.modelLengthCm != null ? String(initialValues.modelLengthCm) : '',
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
    modelShoeCount: s.modelShoeCount,
    modelSide: s.modelSide,
    modelLengthCm: String(s.modelLengthCm ?? ''),
    tryOn: !!s.tryOn,
  });
}

function ProductForm({ onAdd, onCancel, initialValues = null, mode = 'create', onDirtyChange }) {
  const init = useMemo(() => makeInit(initialValues), [initialValues]);
  const isEdit = mode === 'edit';

  const [name, setName] = useState(init.name);
  const [brand, setBrand] = useState(init.brand);
  const [price, setPrice] = useState(init.price);
  const [categoryId, setCategoryId] = useState(init.categoryId);
  const [description, setDescription] = useState(init.description);
  const [variants, setVariants] = useState(init.variants);
  const [images, setImages] = useState(init.images);  // [{ url }]
  const [modelUrl, setModelUrl] = useState(init.modelUrl);   // single .glb
  const [modelName, setModelName] = useState(init.modelName); // shown to the supplier
  const [modelWarnings, setModelWarnings] = useState([]);     // AR validation warnings (non-blocking)
  const [modelError, setModelError] = useState('');           // shown inline at the 3D-model section
  const [validatingModel, setValidatingModel] = useState(false);
  // supplier-declared 3D-model facts (the "submission spec")
  const [modelShoeCount, setModelShoeCount] = useState(init.modelShoeCount);  // '1' | '2'
  const [modelSide, setModelSide] = useState(init.modelSide);                 // 'right' | 'left'
  const [modelLengthCm, setModelLengthCm] = useState(init.modelLengthCm);     // cm (string) — stored
  const [modelUkSize, setModelUkSize] = useState('');                          // transient UK-size helper
  const [tryOn, setTryOn] = useState(init.tryOn);

  const [categories, setCategories] = useState([]);
  const [uploading, setUploading] = useState(false);  // an upload is in flight
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');             // server / upload errors

  // 3D preview: ref + a "reset view" that snaps the camera back to its default
  // framing after the supplier drags the model around (moves the CAMERA only).
  const mvRef = useRef(null);
  function resetView() {
    const mv = mvRef.current;
    if (!mv) return;
    mv.cameraOrbit = '0deg 75deg auto';
    mv.cameraTarget = 'auto';
    mv.fieldOfView = 'auto';
    if (typeof mv.jumpCameraToGoal === 'function') mv.jumpCameraToGoal();
  }

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
    const v = { name, brand, price, categoryId, description, ...over };
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
      case 'description': {
        const s = (v.description || '').trim();
        if (!s) return 'Description is required.';
        if (s.length > 2000) return 'Keep it under 2000 characters.';
        return '';
      }
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

    setModelError('');
    setModelWarnings([]);

    // .glb ONLY — reject anything else immediately (the OS "All files" option
    // can bypass the picker filter). .glb is self-contained; a lone .gltf is
    // missing its .bin/textures and would arrive broken. Shown inline so the
    // supplier sees it right here, not in a banner at the top of the form.
    const chosen = file.name || 'that file';
    if (!file.name.toLowerCase().endsWith('.glb')) {
      setModelError(`"${chosen}" is not a .glb file, so it was not uploaded. Please choose a .glb file (a single self-contained 3D model) — other formats, including .gltf, are not supported.`);
      return;
    }

    // A new model gets a FRESH, EMPTY declaration — the supplier must pick
    // count/side/length for this file (never inherit the previous one's).
    setModelShoeCount('');
    setModelSide('');
    setModelLengthCm('');
    setModelUkSize('');

    setUploading(true);
    try {
      const { url } = await uploadFile(file, 'model');
      // Fail-fast AR validation: catch a bad/corrupt model now. Nothing is
      // declared yet, so this first pass auto-detects (just an initial hint);
      // the notes refresh once the supplier picks the count/side.
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
        setModelError(`This 3D model can't be used for AR try-on: ${result.rejectReason} Please upload a corrected file.`);
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
      setModelError(err.message);
    } finally {
      setUploading(false);
    }
  }
  function removeModel() {
    setModelError('');
    setModelUrl('');
    setModelName('');
    setModelWarnings([]);
    // the declaration is per-model — clear it so the next upload starts fresh
    setModelShoeCount('');
    setModelSide('');
    setModelLengthCm('');
    setModelUkSize('');
    setTryOn(false);
  }

  // Re-run the AR check with the supplier's DECLARED count so the notes stay in
  // sync with their choice (never auto-detects over the declaration).
  async function revalidateModel(count, side) {
    if (!modelUrl) return;
    setValidatingModel(true);
    try {
      const r = await validateModel(modelUrl, {
        count: Number(count),
        side,
        length: modelLengthCm ? Number(modelLengthCm) : undefined,
      });
      if (r?.available) { setModelWarnings(r.warnings || []); }
    } catch { /* keep the existing notes on a hiccup */ }
    finally { setValidatingModel(false); }
  }

  function resetForm() {
    setName(''); setBrand(''); setPrice(''); setCategoryId('');
    setDescription(''); setVariants([emptyVariant()]); setImages([]);
    setModelUrl(''); setModelName(''); setTryOn(false);
    setModelShoeCount(''); setModelSide(''); setModelLengthCm(''); setModelUkSize('');
    setError(''); setTouched({}); setFieldErrors({}); setVariantTouched({});
    setSubmitAttempted(false);
  }

  // has anything changed from the starting state? (confirm before discarding)
  const dirty =
    signatureOf({ name, brand, price, categoryId, description, variants, images, modelUrl,
                  modelShoeCount, modelSide, modelLengthCm, tryOn })
    !== signatureOf(init);

  // report unsaved-changes state up so the page's back button can guard too
  useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);

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
  // when a 3D model is uploaded, its submission spec must be filled in —
  // per-field errors so each shows under its own control
  const showModelSpec = submitAttempted && !!modelUrl;
  const countError  = showModelSpec && !modelShoeCount ? 'Select the number of shoes.' : '';
  const sideError   = showModelSpec && modelShoeCount === '1' && !modelSide ? 'Select left or right.' : '';
  const lengthError = showModelSpec ? lengthProblem(modelLengthCm) : '';

  async function handleSubmit(event) {
    event.preventDefault();
    setError('');
    setSubmitAttempted(true);

    // validate the base fields and mark them all touched
    const base = ['name', 'brand', 'price', 'categoryId', 'description'];
    const baseErrors = {};
    base.forEach((f) => { baseErrors[f] = validateField(f); });
    setFieldErrors((e) => ({ ...e, ...baseErrors }));
    setTouched((t) => ({ ...t, name: true, brand: true, price: true, categoryId: true, description: true }));
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
    // if a 3D model is uploaded, its submission spec (count/side/length) is required
    const modelSpecIncomplete = !!modelUrl &&
      (!modelShoeCount || (modelShoeCount === '1' && !modelSide) || !!lengthProblem(modelLengthCm));

    // inline field errors already explain what to fix — no summary banner
    if (hasBaseError || hasSizeError || noSizes || noImages || modelSpecIncomplete) {
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
        // supplier-declared submission spec (only meaningful when a model exists)
        modelShoeCount: modelUrl && modelShoeCount ? Number(modelShoeCount) : null,
        modelSide: modelUrl && modelShoeCount === '1' ? (modelSide || null) : null,
        modelLengthCm: modelUrl && modelLengthCm ? Number(modelLengthCm) : null,
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
          <SearchableSelect
            value={categoryId}
            onChange={(id) => changeField('categoryId', setCategoryId, id)}
            onBlur={() => blurField('categoryId')}
            options={categories.map((cat) => ({ id: cat.id, label: cat.name }))}
            placeholder="Choose category…"
            clearable={false}
            invalid={showError('categoryId')}
            size="md"
            width="100%"
          />
          {showError('categoryId') && <div className="invalid-feedback d-block">{fieldErrors.categoryId}</div>}
        </div>
        <div className="col-12">
          <label className="form-label">Description</label>
          <textarea className={'form-control' + (showError('description') ? ' is-invalid' : '')} rows="3" maxLength="2000"
            placeholder="Materials, fit, technology, what makes this shoe special…"
            value={description}
            onChange={(e) => changeField('description', setDescription, e.target.value)}
            onBlur={() => blurField('description')} />
          {showError('description') && <div className="invalid-feedback d-block">{fieldErrors.description}</div>}
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
      {sizesError && <div className="invalid-feedback d-block">{sizesError}</div>}

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
      <p className="text-muted small">
        A .glb file (self-contained), up to 30&nbsp;MB. It's checked automatically for AR try-on.
        Export it <b>upright and facing forward</b> — sole down, toe pointing forward, the way the
        shoe sits when worn.
      </p>
      {modelError && <div className="invalid-feedback d-block mb-2">{modelError}</div>}
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
            ref={mvRef}
            src={modelUrl}
            camera-controls
            loading="lazy"
            style={{ width: '100%', height: '260px', background: '#f8f9fa', borderRadius: '0.5rem', marginTop: '0.5rem' }}
          ></model-viewer>
          <div className="mt-1">
            <button type="button" className="btn btn-sm btn-outline-secondary"
              onClick={resetView} title="Snap the camera back to the default view">
              Reset view
            </button>
          </div>

          {/* Submission spec: the facts geometry can't reliably read, so the
              supplier declares them once. The AR auto-fit uses these as the
              authoritative values. */}
          <div className="border rounded p-2 mt-2">
            <div className="fw-semibold small text-uppercase text-muted mb-2">
              About this 3D model <span className="text-danger">*</span>
            </div>
            {/* top-align so a per-field error growing one column doesn't shove
                the other fields' inputs up/down (keeps them on one line) */}
            <div className="row g-2 align-items-start">
              <div className="col-sm-4">
                <label className="form-label small mb-1">This file contains</label>
                <select className={'form-select form-select-sm' + (countError ? ' is-invalid' : '')}
                  value={modelShoeCount}
                  onChange={(e) => { setModelShoeCount(e.target.value); revalidateModel(e.target.value, modelSide); }}>
                  <option value="" disabled>Select the number of shoes…</option>
                  <option value="1">1 shoe (we mirror the other foot)</option>
                  <option value="2">A pair (2 shoes)</option>
                </select>
                {countError && <div className="invalid-feedback d-block">{countError}</div>}
              </div>
              {modelShoeCount === '1' && (
                <div className="col-sm-4">
                  <label className="form-label small mb-1">Which foot is it?</label>
                  <select className={'form-select form-select-sm' + (sideError ? ' is-invalid' : '')}
                    value={modelSide}
                    onChange={(e) => { setModelSide(e.target.value); revalidateModel(modelShoeCount, e.target.value); }}>
                    <option value="" disabled>Select left or right…</option>
                    <option value="right">Right</option>
                    <option value="left">Left</option>
                  </select>
                  {sideError && <div className="invalid-feedback d-block">{sideError}</div>}
                </div>
              )}
              <div className="col-sm-4">
                <label className="form-label small mb-1">Real shoe length (cm)</label>
                {/* cm (primary, left) is the value the auto-fit uses, so its error
                    falls right under it; the UK picker on the right just auto-fills it. */}
                <div className="input-group input-group-sm">
                  <input type="number" min="5" max="60" step="0.1"
                    className={'form-control' + (lengthError ? ' is-invalid' : '')}
                    placeholder="e.g. 28" value={modelLengthCm}
                    onChange={(e) => { setModelLengthCm(e.target.value); setModelUkSize(''); }} />
                  <select className="form-select" style={{ maxWidth: '6.5rem' }} value={modelUkSize}
                    title="Pick a UK size to auto-fill the length"
                    onChange={(e) => {
                      const v = e.target.value;
                      setModelUkSize(v);
                      if (v) { setModelLengthCm(String(ukToCm(v))); }
                    }}>
                    <option value="">UK size…</option>
                    {UK_SIZES.map((s) => <option key={s} value={s}>UK {s}</option>)}
                  </select>
                </div>
                {lengthError && <div className="invalid-feedback d-block">{lengthError}</div>}
              </div>
            </div>
            <div className="form-text">
              Required — this places the shoe accurately in AR. Pick the model's <b>UK size</b> to
              auto-fill the length (you can fine-tune the cm).
            </div>
            {modelShoeCount === '2' && (
              <div className="alert alert-warning py-2 px-3 small mt-2 mb-0">
                <b>For a pair, name the two parts <span className="font-monospace">Shoe_L</span> and{' '}
                <span className="font-monospace">Shoe_R</span></b> (left and right) in your 3D tool
                before exporting. The names tell the auto-fit which shoe goes on which foot. Without
                them, left and right are guessed by position, which can put them on the wrong feet.
              </div>
            )}
          </div>
        </>
      ) : (
        <input type="file" className="form-control" accept=".glb,model/gltf-binary"
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
