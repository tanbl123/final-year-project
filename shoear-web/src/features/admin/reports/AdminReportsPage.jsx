import { useState } from 'react';
import PlatformSalesReport from './PlatformSalesReport';
import SupplierPerformanceReport from './SupplierPerformanceReport';
import AdminOrderReport from './AdminOrderReport';
import AdminRefundReport from './AdminRefundReport';
import GrowthReport from './GrowthReport';

// Platform-operator reports, grouped under one tabbed section.
const TABS = [
  { key: 'sales',     label: '💰 Platform sales',     Component: PlatformSalesReport },
  { key: 'suppliers', label: '🏪 Supplier performance', Component: SupplierPerformanceReport },
  { key: 'orders',    label: '🚚 Orders & fulfilment', Component: AdminOrderReport },
  { key: 'refunds',   label: '💸 Refunds',            Component: AdminRefundReport },
  { key: 'growth',    label: '📈 Growth',             Component: GrowthReport },
];

function AdminReportsPage() {
  const [tab, setTab] = useState('sales');
  const Active = TABS.find((t) => t.key === tab)?.Component ?? PlatformSalesReport;

  return (
    <div className="container py-4 text-start">
      <h1 className="mb-1">📈 Platform Reports</h1>
      <p className="text-muted">Marketplace-wide sales, suppliers, fulfilment, refunds and growth.</p>

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

export default AdminReportsPage;
