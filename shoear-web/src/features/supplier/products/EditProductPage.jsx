import { useEffect, useState } from 'react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import ProductForm from './components/ProductForm';
import { fetchProductById, updateProduct } from './productService';
import BackButton from '../../../components/BackButton';

// Edit an existing product. Loads the current values, hands them to the shared
// ProductForm in "edit" mode, and saves changes via PUT /products/{id}.
function EditProductPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();

  // Return to wherever the user opened the editor from (the products list or
  // this product's detail page); default to the detail page if opened directly.
  const from = location.state?.from || `/products/${id}`;

  const [product, setProduct] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    fetchProductById(id)
      .then((data) => setProduct(data))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [id]);

  // Throw on failure so ProductForm shows the error inline and stays open.
  // On success, return to where the user came from with a toast (the list and
  // the detail page both display it) that reflects any re-approval.
  async function saveProduct(data) {
    const res = await updateProduct(id, data);
    const msg = res?.reapproval
      ? `“${data.name}” was updated — it’s back to pending admin approval.`
      : `“${data.name}” was updated.`;
    navigate(from, { state: { toast: msg } });
  }

  if (loading) {
    return <div className="container py-4"><p className="text-muted">Loading…</p></div>;
  }
  if (error) {
    return (
      <div className="container py-4 text-start">
        <BackButton to={from} />
        <div className="alert alert-danger mt-3">{error}</div>
      </div>
    );
  }

  return (
    <div className="container py-4 text-start">
      <BackButton to={from} />
      <h1 className="mb-4">Edit product</h1>
      <ProductForm
        mode="edit"
        initialValues={product}
        onAdd={saveProduct}
        onCancel={() => navigate(from)}
      />
    </div>
  );
}

export default EditProductPage;
