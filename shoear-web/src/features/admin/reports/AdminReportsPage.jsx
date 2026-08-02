import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import PlatformSalesReport from './PlatformSalesReport';
import SupplierPerformanceReport from './SupplierPerformanceReport';
import AdminOrderReport from './AdminOrderReport';
import AdminRefundReport from './AdminRefundReport';

// Platform-operator reports, grouped under one tabbed section.
const TABS = [
  { key: 'sales',     label: '💰 Platform sales',     Component: PlatformSalesReport },
  { key: 'suppliers', label: '🏪 Supplier performance', Component: SupplierPerformanceReport },
  { key: 'orders',    label: '🚚 Orders & fulfilment', Component: AdminOrderReport },
  { key: 'refunds',   label: '💸 Refunds',            Component: AdminRefundReport },
];

function AdminReportsPage() {
  const [tab, setTab] = useState('sales');
  // the "Company" filter, shared across the money/ops tabs (Sales, Orders,
  // Refunds) so picking a company once carries between them. '' = all companies.
  const [company, setCompany] = useState({ id: '', name: '' });
  const [searchParams, setSearchParams] = useSearchParams();
  const Active = TABS.find((t) => t.key === tab)?.Component ?? PlatformSalesReport;

  // switching tabs mounts a different paginated table — drop ?page so the new
  // tab opens on page 1 instead of inheriting the previous tab's page number
  function clearPage() {
    if (searchParams.has('page')) {
      setSearchParams((prev) => { const n = new URLSearchParams(prev); n.delete('page'); return n; }, { replace: true });
    }
  }
  function changeTab(key) { setTab(key); clearPage(); }

  // drill-down: "View report" on a supplier row → jump to Platform Sales with
  // that company pre-selected.
  function drillTo(supplierId, companyName) {
    setCompany({ id: supplierId, name: companyName });
    setTab('sales');
    clearPage();
  }

  return (
    <div className="container py-4 text-start">
      <h1 className="mb-1">📈 Platform Reports</h1>
      <p className="text-muted">Marketplace-wide sales, suppliers, fulfilment and refunds.</p>

      <ul className="nav nav-tabs mb-4 flex-nowrap overflow-auto">
        {TABS.map((t) => (
          <li className="nav-item" key={t.key}>
            <button
              className={`nav-link text-nowrap ${tab === t.key ? 'active' : ''}`}
              onClick={() => changeTab(t.key)}
            >
              {t.label}
            </button>
          </li>
        ))}
      </ul>

      <Active company={company} setCompany={setCompany} onDrill={drillTo} />
    </div>
  );
}

export default AdminReportsPage;
