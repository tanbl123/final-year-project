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
import AdminCommissionPage from './features/admin/pages/AdminCommissionPage';
import AdminDeliveriesPage from './features/admin/pages/AdminDeliveriesPage';
import ProfilePage from './features/profile/ProfilePage';
import PayoutsPage from './features/payouts/PayoutsPage';
import Avatar from './components/Avatar';

// Top bar + the active route's content. As a layout route it renders <Outlet/>,
// so every page below shares this chrome. (Data router → enables useBlocker.)
function Layout() {
  const { user, logout } = useAuth();   // 👈 tune in to the auth broadcast
  const navigate = useNavigate();

  const isAdmin = user?.role === 'Admin';

  function handleLogout() {
    logout();
    navigate('/login');
  }

  return (
    <>
      {/* the top bar only makes sense once you're signed in; the login and
          register pages are full-screen on their own */}
      {user && (
        <header>
          {/* top bar: brand on the left, the signed-in user on the right */}
          <nav className="navbar navbar-dark bg-dark px-4 d-flex justify-content-between">
            <span className="navbar-brand me-0">👟 ShoeAR {isAdmin ? 'Admin' : 'Supplier'}</span>
            <div className="navbar-nav flex-row align-items-center">
              <Link to="/profile"
                className="navbar-text text-light me-3 d-inline-flex align-items-center text-decoration-none text-nowrap">
                <Avatar name={user.fullName} size={32} className="me-2" />
                <span>Hi, {user.fullName}</span>
              </Link>
              <button className="btn btn-outline-light btn-sm" onClick={handleLogout}>
                Logout
              </button>
            </div>
          </nav>

          {/* second bar: the section links on their own row (wrap if needed, so
              nothing is ever hidden) — admins manage approvals, suppliers their catalogue */}
          <div className="navbar navbar-dark bg-dark px-4 py-0 border-top border-secondary">
            <div className="navbar-nav flex-row flex-wrap">
              {isAdmin ? (
                <>
                  <Link className="nav-link" to="/admin">Suppliers</Link>
                  <Link className="nav-link" to="/admin/changes">Changes</Link>
                  <Link className="nav-link" to="/admin/users">Users</Link>
                  <Link className="nav-link" to="/admin/products">Products</Link>
                  <Link className="nav-link" to="/admin/inventory">Inventory</Link>
                  <Link className="nav-link" to="/admin/categories">Categories</Link>
                  <Link className="nav-link" to="/admin/orders">Orders</Link>
                  <Link className="nav-link" to="/admin/deliveries">Deliveries</Link>
                  <Link className="nav-link" to="/admin/reviews">Reviews</Link>
                  <Link className="nav-link" to="/admin/refunds">Refunds</Link>
                  <Link className="nav-link" to="/admin/commission">Commission</Link>
                </>
              ) : user.status === 'Active' ? (
                <>
                  <Link className="nav-link" to="/products">Products</Link>
                  <Link className="nav-link" to="/inventory">Inventory</Link>
                  <Link className="nav-link" to="/orders">Orders</Link>
                  <Link className="nav-link" to="/refunds">Refunds</Link>
                  <Link className="nav-link" to="/reports">Reports</Link>
                  <Link className="nav-link" to="/payouts">Payouts</Link>
                </>
              ) : (
                // a not-yet-approved supplier only has the resubmit/status page
                <Link className="nav-link" to="/resubmit">My application</Link>
              )}
            </div>
          </div>
        </header>
      )}

      <Outlet />
    </>
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
      <Route path="/admin/deliveries" element={
        <ProtectedRoute role="Admin"><AdminDeliveriesPage /></ProtectedRoute>
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
