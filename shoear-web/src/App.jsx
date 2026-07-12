import {
  createBrowserRouter, createRoutesFromElements, RouterProvider,
  Route, Outlet, Link, Navigate, useNavigate,
} from 'react-router-dom';
import { useAuth } from './features/auth/AuthContext';
import ProductsPage from './features/supplier/products/ProductsPage';
import ReportsPage from './features/supplier/reports/ReportsPage';
import LoginPage from './features/auth/pages/LoginPage';
import ProtectedRoute, { homePathFor } from './features/auth/ProtectedRoute';
import RegisterPage from './features/auth/pages/RegisterPage';
import ForgotPasswordPage from './features/auth/pages/ForgotPasswordPage';
import ResubmitApplicationPage from './features/auth/pages/ResubmitApplicationPage';
import ProductDetailPage from './features/supplier/products/ProductDetailPage';
import AddProductPage from './features/supplier/products/AddProductPage';
import EditProductPage from './features/supplier/products/EditProductPage';
import SupplierInventoryPage from './features/supplier/products/SupplierInventoryPage';
import SupplierOrdersPage from './features/supplier/orders/SupplierOrdersPage';
import SupplierOrderDetailPage from './features/supplier/orders/SupplierOrderDetailPage';
import AdminReviewsPage from './features/admin/reviews/AdminReviewsPage';
import AdminRefundsPage from './features/admin/refunds/AdminRefundsPage';
import SupplierRefundsPage from './features/supplier/refunds/SupplierRefundsPage';
import AdminOrdersPage from './features/admin/orders/AdminOrdersPage';
import AdminOrderDetailPage from './features/admin/orders/AdminOrderDetailPage';
import AdminInventoryPage from './features/admin/products/AdminInventoryPage';
import AdminDashboardPage from './features/admin/suppliers/AdminDashboardPage';
import AdminOverviewPage from './features/admin/dashboard/AdminOverviewPage';
import SupplierDashboardPage from './features/supplier/dashboard/SupplierDashboardPage';
import AdminProductApprovalsPage from './features/admin/products/AdminProductApprovalsPage';
import AdminCategoriesPage from './features/admin/products/AdminCategoriesPage';
import AdminBusinessChangesPage from './features/admin/suppliers/AdminBusinessChangesPage';
import AdminUsersPage from './features/admin/users/AdminUsersPage';
import AdminCouriersPage from './features/admin/couriers/AdminCouriersPage';
import AdminCourierChangesPage from './features/admin/couriers/AdminCourierChangesPage';
import AdminCommissionPage from './features/admin/commission/AdminCommissionPage';
import AdminReportsPage from './features/admin/reports/AdminReportsPage';
import AdminCourierPayoutsPage from './features/admin/payouts/AdminCourierPayoutsPage';
import AdminDeliveriesPage from './features/admin/deliveries/AdminDeliveriesPage';
import AdminDeliveryIssuesPage from './features/admin/deliveries/AdminDeliveryIssuesPage';
import AdminIntegrationsPage from './features/admin/integrations/AdminIntegrationsPage';
import ProfilePage from './features/profile/ProfilePage';
import PayoutsPage from './features/supplier/payouts/PayoutsPage';
import Avatar from './components/Avatar';
import Sidebar from './components/Sidebar';
import { runSweeps } from './features/admin/adminService';
import { useState } from 'react';

// Top bar + the active route's content. As a layout route it renders <Outlet/>,
// so every page below shares this chrome. (Data router → enables useBlocker.)
function Layout() {
  const { user, logout } = useAuth();   // 👈 tune in to the auth broadcast
  const navigate = useNavigate();
  const [collapsed, setCollapsed] = useState(false);

  function handleLogout() {
    logout();
    navigate('/login');
  }

  const [sweeping, setSweeping] = useState(false);
  async function handleRunSweeps() {
    setSweeping(true);
    try {
      const res = await runSweeps();
      const s = res?.swept ?? {};
      const cp = s.courierPayouts ?? {};
      const payoutLine = cp.ran
        ? `• Courier monthly payout: paid ${cp.paid ?? 0} (RM ${Number(cp.total ?? 0).toFixed(2)})` +
          (cp.failed ? `, ${cp.failed} failed` : '')
        : `• Courier monthly payout: skipped (${cp.reason ?? 'n/a'})`;
      alert(
        'Reminder sweeps run:\n' +
        `• Payment reminders: ${s.paymentReminders ?? 0}\n` +
        `• Abandoned-cart reminders: ${s.abandonedCarts ?? 0}\n` +
        `• Review reminders: ${s.reviewReminders ?? 0}\n` +
        `• Orders auto-cancelled: ${s.autoCancelled ?? 0}\n` +
        `• Parcels re-assigned to couriers: ${s.redispatched ?? 0}\n` +
        `• Recommender model: ${s.recommenderReloaded ? 'refreshed' : 'not configured/reachable'}\n` +
        payoutLine
      );
    } catch (e) {
      alert('Could not run sweeps: ' + (e?.message ?? 'unknown error'));
    } finally {
      setSweeping(false);
    }
  }

  // login / register pages are full-screen on their own (no app shell)
  if (!user) {
    return <Outlet />;
  }

  return (
    <div className="app-shell d-flex">
      <Sidebar user={user} collapsed={collapsed} />

      <div className="app-main d-flex flex-column flex-grow-1" style={{ minWidth: 0 }}>
        {/* top bar: collapse toggle on the left, the signed-in user on the right */}
        <header className="app-topbar d-flex align-items-center justify-content-between border-bottom bg-white px-3 py-2 flex-shrink-0">
          <button className="btn btn-light btn-sm" onClick={() => setCollapsed((c) => !c)} aria-label="Toggle sidebar">
            ☰
          </button>
          <div className="d-flex align-items-center gap-3">
            {user.role === 'Admin' && (
              <button
                className="btn btn-outline-primary btn-sm"
                onClick={handleRunSweeps}
                disabled={sweeping}
                title="Send any due payment/cart/review reminders now (a cron does this on a timer in production)"
              >
                {sweeping ? 'Running…' : '🔔 Run reminders'}
              </button>
            )}
            <Link to="/profile" className="d-inline-flex align-items-center text-decoration-none text-dark text-nowrap">
              <Avatar name={user.fullName} size={32} className="me-2" />
              <span>{user.fullName}</span>
            </Link>
            <button className="btn btn-outline-secondary btn-sm" onClick={handleLogout}>
              Logout
            </button>
          </div>
        </header>

        {/* the active page scrolls here, while the sidebar + top bar stay put */}
        <main className="app-content flex-grow-1 overflow-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

// "/" sends each user to their own home (reads auth at render time).
function HomeRedirect() {
  const { user } = useAuth();
  return <Navigate to={homePathFor(user)} replace />;
}

const router = createBrowserRouter(
  createRoutesFromElements(
    <Route element={<Layout />}>
      <Route path="/login" element={<LoginPage variant="supplier" />} />
      <Route path="/admin/login" element={<LoginPage variant="admin" />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />

      {/* rejected suppliers fix & resubmit their application here */}
      <Route path="/resubmit" element={
        <ProtectedRoute role="Supplier" allowInactive><ResubmitApplicationPage /></ProtectedRoute>
      } />

      <Route path="/" element={
        <ProtectedRoute><HomeRedirect /></ProtectedRoute>
      } />

      {/* admin */}
      <Route path="/admin" element={
        <ProtectedRoute role="Admin"><AdminOverviewPage /></ProtectedRoute>
      } />
      <Route path="/admin/suppliers" element={
        <ProtectedRoute role="Admin"><AdminDashboardPage /></ProtectedRoute>
      } />
      <Route path="/admin/products" element={
        <ProtectedRoute role="Admin"><AdminProductApprovalsPage /></ProtectedRoute>
      } />
      <Route path="/admin/categories" element={
        <ProtectedRoute role="Admin"><AdminCategoriesPage /></ProtectedRoute>
      } />
      <Route path="/admin/changes" element={
        <ProtectedRoute role="Admin"><AdminBusinessChangesPage /></ProtectedRoute>
      } />
      <Route path="/admin/courier-changes" element={
        <ProtectedRoute role="Admin"><AdminCourierChangesPage /></ProtectedRoute>
      } />
      <Route path="/admin/users" element={
        <ProtectedRoute role="Admin"><AdminUsersPage /></ProtectedRoute>
      } />
      <Route path="/admin/couriers" element={
        <ProtectedRoute role="Admin"><AdminCouriersPage /></ProtectedRoute>
      } />
      <Route path="/admin/deliveries" element={
        <ProtectedRoute role="Admin"><AdminDeliveriesPage /></ProtectedRoute>
      } />
      <Route path="/admin/delivery-issues" element={
        <ProtectedRoute role="Admin"><AdminDeliveryIssuesPage /></ProtectedRoute>
      } />
      <Route path="/admin/reviews" element={
        <ProtectedRoute role="Admin"><AdminReviewsPage /></ProtectedRoute>
      } />
      <Route path="/admin/refunds" element={
        <ProtectedRoute role="Admin"><AdminRefundsPage /></ProtectedRoute>
      } />
      <Route path="/admin/orders" element={
        <ProtectedRoute role="Admin"><AdminOrdersPage /></ProtectedRoute>
      } />
      <Route path="/admin/orders/:orderId" element={
        <ProtectedRoute role="Admin"><AdminOrderDetailPage /></ProtectedRoute>
      } />
      <Route path="/admin/inventory" element={
        <ProtectedRoute role="Admin"><AdminInventoryPage /></ProtectedRoute>
      } />
      <Route path="/admin/commission" element={
        <ProtectedRoute role="Admin"><AdminCommissionPage /></ProtectedRoute>
      } />
      <Route path="/admin/reports" element={
        <ProtectedRoute role="Admin"><AdminReportsPage /></ProtectedRoute>
      } />
      <Route path="/admin/courier-payouts" element={
        <ProtectedRoute role="Admin"><AdminCourierPayoutsPage /></ProtectedRoute>
      } />
      <Route path="/admin/integrations" element={
        <ProtectedRoute role="Admin"><AdminIntegrationsPage /></ProtectedRoute>
      } />

      {/* any signed-in user's own profile */}
      <Route path="/profile" element={
        <ProtectedRoute><ProfilePage /></ProtectedRoute>
      } />

      {/* supplier */}
      <Route path="/dashboard" element={
        <ProtectedRoute role="Supplier"><SupplierDashboardPage /></ProtectedRoute>
      } />
      <Route path="/products" element={
        <ProtectedRoute role="Supplier"><ProductsPage /></ProtectedRoute>
      } />
      <Route path="/products/new" element={
        <ProtectedRoute role="Supplier"><AddProductPage /></ProtectedRoute>
      } />
      <Route path="/inventory" element={
        <ProtectedRoute role="Supplier"><SupplierInventoryPage /></ProtectedRoute>
      } />
      <Route path="/orders" element={
        <ProtectedRoute role="Supplier"><SupplierOrdersPage /></ProtectedRoute>
      } />
      <Route path="/orders/:orderId" element={
        <ProtectedRoute role="Supplier"><SupplierOrderDetailPage /></ProtectedRoute>
      } />
      <Route path="/refunds" element={
        <ProtectedRoute role="Supplier"><SupplierRefundsPage /></ProtectedRoute>
      } />
      <Route path="/products/:id/edit" element={
        <ProtectedRoute role="Supplier"><EditProductPage /></ProtectedRoute>
      } />
      <Route path="/products/:id" element={
        <ProtectedRoute role="Supplier"><ProductDetailPage /></ProtectedRoute>
      } />
      <Route path="/reports" element={
        <ProtectedRoute role="Supplier"><ReportsPage /></ProtectedRoute>
      } />
      <Route path="/payouts" element={
        <ProtectedRoute role="Supplier"><PayoutsPage /></ProtectedRoute>
      } />
    </Route>
  )
);

function App() {
  return <RouterProvider router={router} />;
}

export default App;
