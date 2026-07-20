import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import ProductForm from './components/ProductForm';
import { createProduct } from './productService';
import BackButton from '../../../components/BackButton';
import ConfirmDialog from '../../../components/ConfirmDialog';
import { usePayoutBlocked } from '../usePayoutBlocked';

// Dedicated page for creating a product (instead of an inline panel on the
// products list). On success we return to the list, which refetches on mount
// and shows the new product.
function AddProductPage() {
  const navigate = useNavigate();
  const payoutBlocked = usePayoutBlocked();   // guard against direct navigation here
  const [dirty, setDirty] = useState(false);       // unsaved input in the form
  const [confirmLeave, setConfirmLeave] = useState(false);

  // Throw on failure so ProductForm shows the error inline and stays open.
  // On success, return to the list and hand it a toast message to show.
  async function addProduct(newProductData) {
    await createProduct(newProductData);
    navigate('/products', {
      state: { toast: `“${newProductData.name}” was added — it’s now pending admin approval.` },
    });
  }

  // Back-arrow guard: confirm before leaving if there's unsaved input.
  function handleBack() {
    if (dirty) setConfirmLeave(true);
    else navigate('/products');
  }

  return (
    <div className="container py-4 text-start">
      <BackButton onClick={handleBack} />
      <h1 className="mb-4">Add a product</h1>
      {payoutBlocked ? (
        <div className="alert alert-warning">
          💳 <strong>Connect your payout account to start listing products.</strong> You'll receive
          your sales income through Stripe — <Link to="/payouts">set it up first</Link>.
        </div>
      ) : (
        <ProductForm onAdd={addProduct} onCancel={() => navigate('/products')} onDirtyChange={setDirty} />
      )}
      <ConfirmDialog
        isOpen={confirmLeave}
        title="Discard product?"
        message="You have unsaved changes. Are you sure you want to leave without saving?"
        confirmText="Discard"
        confirmColor="danger"
        onCancel={() => setConfirmLeave(false)}
        onConfirm={() => { setConfirmLeave(false); navigate('/products'); }}
      />
    </div>
  );
}

export default AddProductPage;
