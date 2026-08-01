import { Navigate } from 'react-router-dom';
import { useAuth } from './AuthContext';

// Internal-staff roles — they share the staff login (/admin/login) and portal.
const STAFF_ROLES = ['Admin', 'ArSpecialist'];

// Where a logged-in user belongs by default, based on their role + status.
export function homePathFor(user) {
  if (user?.role === 'Admin') return '/admin';
  if (user?.role === 'ArSpecialist') return '/ar';
  // a supplier who isn't approved yet can only reach the resubmit/status page
  if (user?.role === 'Supplier' && user?.status && user.status !== 'Active') {
    return '/resubmit';
  }
  return '/dashboard';
}

// allowInactive lets the resubmit page itself be reached by a non-Active
// supplier; every other supplier route is for approved (Active) accounts only.
function ProtectedRoute({ children, role, allowInactive = false }) {
  const { user } = useAuth();

  // not logged in? bounce to the matching login page. Staff roles (Admin,
  // AR Specialist) use the shared staff login; suppliers use /login.
  if (!user) {
    return <Navigate to={STAFF_ROLES.includes(role) ? '/admin/login' : '/login'} replace />;
  }

  // logged in but wrong role? send them to their own home.
  if (role && user.role !== role) {
    return <Navigate to={homePathFor(user)} replace />;
  }

  // a not-yet-approved supplier is confined to the resubmit/status page
  if (user.role === 'Supplier' && user.status && user.status !== 'Active' && !allowInactive) {
    return <Navigate to="/resubmit" replace />;
  }

  return children;
}

export default ProtectedRoute;
