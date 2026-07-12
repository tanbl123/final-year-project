import { useState } from 'react';
import SalesReport from './SalesReport';
import ProductPerformanceReport from './ProductPerformanceReport';
import InventoryReport from './InventoryReport';
import FulfilmentReport from './FulfilmentReport';
import RefundReport from './RefundReport';

// Supplier reports, grouped under one tabbed section (like Shopee/Lazada's
// "Business Insights"). Each tab is a self-contained report with its own
// period picker, KPIs, table and PDF export.
const TABS = [
  { key: 'sales',     label: '📊 Sales',           Component: SalesReport },
  { key: 'products',  label: '🏆 Product performance', Component: ProductPerformanceReport },
  { key: 'inventory', label: '📦 Inventory',        Component: InventoryReport },
  { key: 'orders',    label: '🚚 Order & fulfilment', Component: FulfilmentReport },
  { key: 'refunds',   label: '💸 Refunds',          Component: RefundReport },
];

function ReportsPage() {
  const [tab, setTab] = useState('sales');
  const Active = TABS.find((t) => t.key === tab)?.Component ?? SalesReport;

  return (
    <div className="container py-4 text-start">
      <h1 className="mb-1">📈 Reports</h1>
      <p className="text-muted">Insights into your sales, products, inventory, fulfilment and refunds.</p>

      <ul className="nav nav-tabs mb-4 flex-nowrap overflow-auto">
        {TABS.map((t) => (
          <li className="nav-item" key={t.key}>
            <button
              className={`nav-link text-nowrap ${tab === t.key ? 'active' : ''}`}
              onClick={() => setTab(t.key)}
            >
              {t.label}
            </button>
          </li>
        ))}
      </ul>

      <Active />
    </div>
  );
}

export default ReportsPage;
