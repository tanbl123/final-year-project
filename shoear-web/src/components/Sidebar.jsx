import { useEffect, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { getBadgeCounts } from '../features/admin/adminService';
import { getSupplierBadgeCounts } from '../features/supplier/products/productService';

// Grouped navigation per role. `end` marks links that should only be active on
// an exact match (e.g. /admin, otherwise it'd light up for every /admin/* page).
// `badge` names the work-queue count (from /admin/badge-counts) to show as a pill.
const ADMIN_NAV = [
  { group: 'Main', items: [
    { to: '/admin', label: 'Dashboard', icon: '📊', end: true },
    { to: '/admin/suppliers', label: 'Suppliers', icon: '🏪', badge: 'suppliers' },
    { to: '/admin/couriers', label: 'Couriers', icon: '🛵', badge: 'couriers' },
    { to: '/admin/changes', label: 'Supplier Changes', icon: '📝', badge: 'changes' },
    { to: '/admin/courier-changes', label: 'Courier Changes', icon: '🛠️', badge: 'courierChanges' },
    { to: '/admin/users', label: 'Users', icon: '👥' },
  ] },
  { group: 'Catalog', items: [
    { to: '/admin/products', label: 'Products', icon: '👟', badge: 'products' },
    { to: '/admin/inventory', label: 'Inventory', icon: '📦' },
    { to: '/admin/categories', label: 'Categories', icon: '🏷️' },
  ] },
  { group: 'Operations', items: [
    { to: '/admin/orders', label: 'Orders', icon: '🧾' },
    { to: '/admin/deliveries', label: 'Deliveries', icon: '🚚', badge: 'deliveries' },
    { to: '/admin/delivery-issues', label: 'Issues', icon: '⚠️', badge: 'issues' },
  ] },
  { group: 'Moderation', items: [
    { to: '/admin/reviews', label: 'Reviews', icon: '⭐' },
    { to: '/admin/refunds', label: 'Refunds', icon: '💸', badge: 'refunds' },
  ] },
  { group: 'Finance', items: [
    { to: '/admin/commission', label: 'Commission', icon: '💰' },
    { to: '/admin/courier-payouts', label: 'Courier Pay', icon: '💸', badge: 'courierPayouts' },
  ] },
  { group: 'System', items: [
    { to: '/admin/integrations', label: 'Integrations', icon: '🔌' },
  ] },
];

const SUPPLIER_NAV = [
  { group: 'Main', items: [
    { to: '/dashboard', label: 'Dashboard', icon: '📊', end: true },
  ] },
  { group: 'Catalog', items: [
    { to: '/products', label: 'Products', icon: '👟' },
    { to: '/inventory', label: 'Inventory', icon: '📦', badge: 'inventory' },
  ] },
  { group: 'Sales', items: [
    { to: '/orders', label: 'Orders', icon: '🧾', badge: 'orders' },
    { to: '/refunds', label: 'Refunds', icon: '💸' },
    { to: '/reports', label: 'Reports', icon: '📊' },
    { to: '/payouts', label: 'Payouts', icon: '🏦' },
  ] },
];

const SUPPLIER_PENDING_NAV = [
  { group: 'Account', items: [
    { to: '/resubmit', label: 'My application', icon: '📄', end: true },
  ] },
];

function navFor(user) {
  if (user.role === 'Admin') return ADMIN_NAV;
  if (user.role === 'Supplier') return user.status === 'Active' ? SUPPLIER_NAV : SUPPLIER_PENDING_NAV;
  return [];
}

// Poll the admin work-queue counts so sidebar badges stay roughly live without
// a manual refresh. Returns {} for non-admins (and on error, so the nav still
// renders — badges just won't show).
function useBadgeCounts(role) {
  const [counts, setCounts] = useState({});
  useEffect(() => {
    const fetcher = role === 'Admin' ? getBadgeCounts
                  : role === 'Supplier' ? getSupplierBadgeCounts
                  : null;
    if (!fetcher) return;
    let active = true;
    const load = async () => {
      try {
        const res = await fetcher();
        if (active) setCounts(res?.counts ?? {});
      } catch {
        /* keep the last counts; the nav still works without badges */
      }
    };
    load();
    const id = setInterval(load, 45000);
    // let action pages (approve/reject/save stock/etc.) refresh counts immediately
    window.addEventListener('shoear:badges-refresh', load);
    return () => { active = false; clearInterval(id); window.removeEventListener('shoear:badges-refresh', load); };
  }, [role]);
  return counts;
}

function Sidebar({ user, collapsed }) {
  const groups = navFor(user);
  const isAdmin = user.role === 'Admin';
  const counts = useBadgeCounts(user.role);

  return (
    <aside className={'app-sidebar d-flex flex-column' + (collapsed ? ' collapsed' : '')}>
      <div className="sidebar-brand">
        <span className="brand-icon">👟</span>
        <span className="nav-label">
          <span className="fw-bold d-block lh-1">ShoeAR</span>
          <span className="small text-secondary">{isAdmin ? 'Admin Portal' : 'Supplier Portal'}</span>
        </span>
      </div>

      <nav className="flex-grow-1 overflow-auto py-2">
        {groups.map((g) => (
          <div key={g.group} className="mb-1">
            <div className="sidebar-group nav-label">{g.group}</div>
            {g.items.map((it) => {
              const count = it.badge ? counts[it.badge] ?? 0 : 0;
              return (
                <NavLink key={it.to} to={it.to} end={it.end} className="sidebar-link" title={it.label}>
                  <span className="sidebar-icon">{it.icon}</span>
                  <span className="nav-label">{it.label}</span>
                  {count > 0 && (
                    <span className="sidebar-badge" title={`${count} need${count === 1 ? 's' : ''} attention`}>
                      {count > 99 ? '99+' : count}
                    </span>
                  )}
                </NavLink>
              );
            })}
          </div>
        ))}
      </nav>
    </aside>
  );
}

export default Sidebar;
