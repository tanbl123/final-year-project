import { useEffect, useState } from 'react';
import { useParams, useLocation } from 'react-router-dom';
import { getAdminOrder } from '../adminService';
import BackButton from '../../../components/BackButton';
import { OrderDetailBody } from './OrderDetailModal';

function AdminOrderDetailPage() {
  const { orderId } = useParams();
  const location = useLocation();
  const backTo = location.state?.from || '/admin/orders';   // return to the list page we came from
  const [order, setOrder] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    getAdminOrder(orderId)
      .then((data) => setOrder(data))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [orderId]);

  if (loading) return <div className="container py-4"><p className="text-muted">Loading…</p></div>;
  if (error) {
    return (
      <div className="container py-4 text-start">
        <BackButton to={backTo} />
        <div className="alert alert-danger mt-3">{error}</div>
      </div>
    );
  }

  return (
    <div className="container py-4 text-start">
      <BackButton to={backTo} />
      <div className="mt-2">
        <OrderDetailBody order={order} />
      </div>
    </div>
  );
}

export default AdminOrderDetailPage;
