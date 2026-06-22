import { NavLink } from 'react-router-dom';

// Grouped navigation per role. `end` marks links that should only be active on
// an exact match (e.g. /admin, otherwise it'd light up for every /admin/* page).
const ADMIN_NAV = [
  { group: 'Main', items: [
    { to: '/admin', label: 'Suppliers', icon: '🏪', end: true },
    { to: '/admin/couriers', label: 'Couriers', icon: '🛵' },
    { to: '/admin/changes', label: 'Changes', icon: '📝' },
    { to: '/admin/users', label: 'Users', icon: '👥' },
  ] },
  { group: 'Catalog', items: [
    { to: '/admin/products', label: 'Products', icon: '👟' },
    { to: '/admin/inventory', label: 'Inventory', icon: '📦' },
    { to: '/admin/categories', label: 'Categories', icon: '🏷️' },
  ] },
  { group: 'Operations', items: [
    { to: '/admin/orders', label: 'Orders', icon: '🧾' },
    { to: '/admin/deliveries', label: 'Deliveries', icon: '🚚' },
    { to: '/admin/delivery-issues', label: 'Issues', icon: '⚠️' },
  ] },
  { group: 'Moderation', items: [
    { to: '/admin/reviews', label: 'Reviews', icon: '⭐' },
    { to: '/admin/refunds', label: 'Refunds', icon: '💸' },
  ] },
  { group: 'Finance', items: [
    { to: '/admin/commission', label: 'Commission', icon: '💰' },
  ] },
];

const SUPPLIER_NAV = [
  { group: 'Catalog', items: [
    { to: '/products', label: 'Products', icon: '👟' },
    { to: '/inventory', label: 'Inventory', icon: '📦' },
  ] },
  { group: 'Sales', items: [
    { to: '/orders', label: 'Orders', icon: '🧾' },
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

function Sidebar({ user, collapsed }) {
  const groups = navFor(user);
  const isAdmin = user.role === 'Admin';

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
            {g.items.map((it) => (
              <NavLink key={it.to} to={it.to} end={it.end} className="sidebar-link" title={it.label}>
                <span className="sidebar-icon">{it.icon}</span>
                <span className="nav-label">{it.label}</span>
              </NavLink>
            ))}
          </div>
        ))}
      </nav>
    </aside>
  );
}

export default Sidebar;
