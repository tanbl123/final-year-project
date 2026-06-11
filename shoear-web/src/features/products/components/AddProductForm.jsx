import { useState, useEffect } from 'react';
import { fetchCategories } from '../productService';

function AddProductForm(props) {
  // the form owns its OWN input state now (not App)
  const [name, setName] = useState('');
  const [brand, setBrand] = useState('');
  const [price, setPrice] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [categories, setCategories] = useState([]);
  const [error, setError] = useState('');

  // load the category options from the API once
  useEffect(() => {
    fetchCategories()
      .then((data) => setCategories(data))
      .catch((err) => setError(err.message));
  }, []);

  function handleSubmit(event) {
    event.preventDefault();

    const cleanName = name.trim();
    const cleanBrand = brand.trim();
    const priceNumber = Number(price);

    if (cleanName === '' || cleanBrand === '') {
      setError('Name and brand cannot be empty.');
      return;
    }
    if (cleanName.length > 150) {
      setError('Shoe name is too long (max 150 characters).');
      return;
    }
    if (cleanBrand.length > 100) {
      setError('Brand is too long (max 100 characters).');
      return;
    }
    if (Number.isNaN(priceNumber) || priceNumber <= 0) {
      setError('Price must be a number greater than 0.');
      return;
    }
    if (priceNumber > 100000) {
      setError('Price seems too high. Please check.');
      return;
    }
    if (categoryId === '') {
      setError('Please choose a category.');
      return;
    }

    // hand the finished product UP to the parent via the onAdd prop
    props.onAdd({
      name: cleanName,
      brand: cleanBrand,
      price: Math.round(priceNumber * 100) / 100,
      categoryId,
    });

    // clear the form
    setName('');
    setBrand('');
    setPrice('');
    setCategoryId('');
    setError('');
  }

  return (
    <form onSubmit={handleSubmit} className="card card-body mb-4 bg-light">
      {error && <div className="alert alert-danger py-2">{error}</div>}
      <div className="row g-2">
        <div className="col-md-3">
          <input type="text" maxLength="150" className="form-control" placeholder="Shoe name"
            value={name} onChange={(e) => setName(e.target.value)} required />
        </div>
        <div className="col-md-2">
          <input type="text" maxLength="100" className="form-control" placeholder="Brand"
            value={brand} onChange={(e) => setBrand(e.target.value)} required />
        </div>
        <div className="col-md-2">
          <input type="number" min="0.01" max="100000" step="0.01" className="form-control"
            placeholder="Price (RM)" value={price} onChange={(e) => setPrice(e.target.value)} required />
        </div>
        <div className="col-md-3">
          <select className="form-select" value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)} required>
            <option value="">Choose category…</option>
            {categories.map((cat) => (
              <option key={cat.id} value={cat.id}>{cat.name}</option>
            ))}
          </select>
        </div>
        <div className="col-md-2">
          <button type="submit" className="btn btn-primary w-100">+ Add</button>
        </div>
      </div>
    </form>
  );
}

export default AddProductForm;
