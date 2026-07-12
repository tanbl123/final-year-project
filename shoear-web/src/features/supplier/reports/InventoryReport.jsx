import { useEffect, useState } from 'react';
import { getInventoryReport } from './reportService';
import { useAuth } from '../../auth/AuthContext';
import ReportPreviewModal from '../../../components/ReportPreviewModal';
import { rm, StatCard } from './reportUtils';

const STATUS_BADGE = {
  out: { cls: 'text-bg-danger', label: 'Out of stock' },
  low: { cls: 'text-bg-warning', label: 'Low stock' },
  ok:  { cls: 'text-bg-success', label: 'In stock' },
};

// Current stock snapshot + valuation (no date range — it's a live snapshot).
function InventoryReport() {
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [preview, setPreview] = useState(false);

  useEffect(() => {
    let active = true;
    getInventoryReport()
      .then((d) => { if (active) setData(d); })
      .catch((err) => { if (active) setError(err.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  const has = !!data && data.summary.products > 0;

  function buildReportOpts() {
    return {
      title: 'Inventory & Stock Valuation Report',
      generatedBy: user?.fullName,
      period: 'Current snapshot',
      referencePrefix: 'IN',
      summary: [
        { label: 'Products', value: String(data.summary.products) },
        { label: 'Units on hand', value: String(data.summary.unitsOnHand) },
        { label: 'Total stock value', value: rm(data.summary.stockValue) },
        { label: `Low stock (≤ ${data.lowStockThreshold})`, value: String(data.summary.lowStock) },
        { label: 'Out of stock', value: String(data.summary.outOfStock) },
      ],
      head: ['Product', 'Sizes', 'Units', 'Unit price', 'Stock value', 'Status'],
      body: data.products.map((p) => [
        p.productName, p.variants, p.stock, rm(p.price), rm(p.value), STATUS_BADGE[p.status].label,
      ]),
      foot: [['Total', '', data.summary.unitsOnHand, '', rm(data.summary.stockValue), '']],
      columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'right' } },
    };
  }

  return (
    <div>
      <div className="d-flex justify-content-between align-items-end flex-wrap gap-2 mb-3">
        <p className="text-muted mb-0">A live snapshot of stock on hand and what it&apos;s worth — restock priority first.</p>
        <button className="btn btn-outline-primary" onClick={() => setPreview(true)} disabled={!has}>
          👁 Preview &amp; export
        </button>
      </div>

      <ReportPreviewModal open={preview} onClose={() => setPreview(false)} build={buildReportOpts} />

      {error && <div className="alert alert-danger py-2">{error}</div>}

      {loading ? (
        <p className="text-muted">Loading…</p>
      ) : !data ? null : data.summary.products === 0 ? (
        <div className="card card-body text-center text-muted">
          No approved products yet. Add products to see your inventory here.
        </div>
      ) : (
        <>
          <div className="row g-3 mb-4">
            <StatCard label="Stock value" value={rm(data.summary.stockValue)} sub={`${data.summary.unitsOnHand} units on hand`} color="success" />
            <StatCard label="Products" value={data.summary.products} />
            <StatCard label={`Low stock (≤ ${data.lowStockThreshold})`} value={data.summary.lowStock} color={data.summary.lowStock > 0 ? 'warning' : 'dark'} />
            <StatCard label="Out of stock" value={data.summary.outOfStock} color={data.summary.outOfStock > 0 ? 'danger' : 'dark'} />
          </div>

          <h5 className="mb-3">Stock by product</h5>
          <div className="table-responsive">
            <table className="table align-middle">
              <thead>
                <tr>
                  <th>Product</th>
                  <th className="text-end" style={{ width: 80 }}>Sizes</th>
                  <th className="text-end" style={{ width: 90 }}>Units</th>
                  <th className="text-end" style={{ width: 130 }}>Unit price</th>
                  <th className="text-end" style={{ width: 150 }}>Stock value</th>
                  <th style={{ width: 130 }}>Status</th>
                </tr>
              </thead>
              <tbody>
                {data.products.map((p) => (
                  <tr key={p.productId}>
                    <td className="fw-semibold">{p.productName}</td>
                    <td className="text-end">{p.variants}</td>
                    <td className="text-end">{p.stock}</td>
                    <td className="text-end">{rm(p.price)}</td>
                    <td className="text-end">{rm(p.value)}</td>
                    <td><span className={`badge ${STATUS_BADGE[p.status].cls}`}>{STATUS_BADGE[p.status].label}</span></td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="fw-semibold border-top">
                  <td>Total</td>
                  <td></td>
                  <td className="text-end">{data.summary.unitsOnHand}</td>
                  <td></td>
                  <td className="text-end text-success">{rm(data.summary.stockValue)}</td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

export default InventoryReport;
