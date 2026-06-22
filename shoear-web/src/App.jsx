import {
  createBrowserRouter, createRoutesFromElements, RouterProvider,
  Route, Outlet, Link, Navigate, useNavigate,
} from 'react-router-dom';
import { useAuth } from './features/auth/AuthContext';
import ProductsPage from './features/products/pages/ProductsPage';
import ReportsPage from './features/reports/pages/ReportsPage';
import LoginPage from './features/auth/pages/LoginPage';
import ProtectedRoute, { homePathFor } from './features/auth/ProtectedRoute';
import RegisterPage from './features/auth/pages/RegisterPage';
import ForgotPasswordPage from './features/auth/pages/ForgotPasswordPage';
import ResubmitApplicationPage from './features/auth/pages/ResubmitApplicationPage';
import ProductDetailPage from './features/products/pages/ProductDetailPage';
import AddProductPage from './features/products/pages/AddProductPage';
import EditProductPage from './features/products/pages/EditProductPage';
import SupplierInventoryPage from './features/products/pages/SupplierInventoryPage';
import SupplierOrdersPage from './features/orders/pages/SupplierOrdersPage';
import SupplierOrderDetailPage from './features/orders/pages/SupplierOrderDetailPage';
import AdminReviewsPage from './features/reviews/pages/AdminReviewsPage';
import AdminRefundsPage from './features/refunds/pages/AdminRefundsPage';
import SupplierRefundsPage from './features/refunds/pages/SupplierRefundsPage';
import AdminOrdersPage from './features/admin/pages/AdminOrdersPage';
import AdminOrderDetailPage from './features/admin/pages/AdminOrderDetailPage';
import AdminInventoryPage from './features/admin/pages/AdminInventoryPage';
import AdminDashboardPage from './features/admin/pages/AdminDashboardPage';
import AdminProductApprovalsPage from './features/admin/pages/AdminProductApprovalsPage';
import AdminCategoriesPage from './features/admin/pages/AdminCategoriesPage';
import AdminBusinessChangesPage from './features/admin/pages/AdminBusinessChangesPage';
import AdminUsersPage from './features/admin/pages/AdminUsersPage';
import AdminCouriersPage from './features/admin/pages/AdminCouriersPage';
import AdminCommissionPage from './features/admin/pages/AdminCommissionPage';
import AdminDeliveriesPage from './features/admin/pages/AdminDeliveriesPage';
import AdminDeliveryIssuesPage from './features/admin/pages/AdminDeliveryIssuesPage';
import ProfilePage from './features/profile/ProfilePage';
import PayoutsPage from './features/payouts/PayoutsPage';
import Avatar from './components/Avatar';
import Sidebar from './components/Sidebar';
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

      {/* any signed-in user's own profile */}
      <Route path="/profile" element={
        <ProtectedRoute><ProfilePage /></ProtectedRoute>
      } />

      {/* supplier */}
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
