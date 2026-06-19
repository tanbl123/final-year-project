<?php
require __DIR__ . '/../../lib/response.php';
require __DIR__ . '/../../lib/db.php';
require __DIR__ . '/../../lib/jwt.php';
require __DIR__ . '/../../lib/request.php';
require __DIR__ . '/../../lib/auth.php';
require __DIR__ . '/../../lib/ids.php';
require __DIR__ . '/../../lib/storage.php';
require __DIR__ . '/../../lib/stripe.php';
require __DIR__ . '/../../lib/delivery.php';
require __DIR__ . '/../../controllers/AuthController.php';
require __DIR__ . '/../../controllers/AdminController.php';
require __DIR__ . '/../../controllers/ProductController.php';
require __DIR__ . '/../../controllers/CategoryController.php';
require __DIR__ . '/../../controllers/UploadController.php';
require __DIR__ . '/../../controllers/StripeController.php';
require __DIR__ . '/../../controllers/ReportController.php';
require __DIR__ . '/../../controllers/SupplierController.php';
require __DIR__ . '/../../controllers/DeliveryController.php';
require __DIR__ . '/../../controllers/OrderController.php';
require __DIR__ . '/../../controllers/ReviewController.php';

// ── Always answer with JSON, even on a PHP error ──
// A stray warning/notice or an uncaught error would otherwise print into the
// body and the client just sees "Server did not return valid JSON". We suppress
// inline error output and convert exceptions/fatals into a JSON error envelope.
ini_set('display_errors', '0');
error_reporting(E_ALL);
set_exception_handler(function ($e) {
  if (!headers_sent()) { http_response_code(500); header('Content-Type: application/json'); }
  echo json_encode(['success' => false, 'data' => null,
    'error' => ['code' => 'SERVER', 'message' => $e->getMessage()]]);
});
register_shutdown_function(function () {
  $err = error_get_last();
  if ($err && in_array($err['type'], [E_ERROR, E_PARSE, E_CORE_ERROR, E_COMPILE_ERROR], true)) {
    if (!headers_sent()) { http_response_code(500); header('Content-Type: application/json'); }
    echo json_encode(['success' => false, 'data' => null,
      'error' => ['code' => 'SERVER', 'message' => $err['message']]]);
  }
});

// ── CORS: let the React dev server (port 5173) call us ──
header('Access-Control-Allow-Origin: http://localhost:5173');
header('Access-Control-Allow-Methods: GET, POST, PUT, PATCH, DELETE, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Authorization');
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(204); exit; }

$config = require __DIR__ . '/../../config.php';
$secret = $config['jwt_secret'];

// ── method + path after /shoear/api/v1 ──
$method = $_SERVER['REQUEST_METHOD'];
$uri    = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
$base   = '/shoear/api/v1';
$path   = '/' . trim(substr($uri, strlen($base)), '/');

// ── public routes ──
if ($method === 'GET' && $path === '/ping') {
  sendJson(200, true, ['message' => 'pong', 'time' => date('c')]);
}

if ($method === 'GET' && $path === '/db-test') {
  $pdo  = getPDO();
  $stmt = $pdo->query('SELECT COUNT(*) AS total FROM product');
  $row  = $stmt->fetch();
  sendJson(200, true, ['productCount' => (int) $row['total']]);
}

if ($method === 'POST' && $path === '/auth/register') {
  $pdo = getPDO();
  handleRegister($pdo);
}

if ($method === 'POST' && $path === '/auth/login') {
  $pdo = getPDO();
  handleLogin($pdo, $secret);
}

// live username availability for the sign-up / profile forms (public)
if ($method === 'GET' && $path === '/auth/username-available') {
  $pdo = getPDO();
  handleUsernameAvailable($pdo);
}

// ── own profile (any signed-in user) ──
if ($method === 'GET' && $path === '/auth/me') {
  $auth = requireAuth($secret);
  $pdo  = getPDO();
  handleMe($pdo, $auth);
}

if ($method === 'PUT' && $path === '/auth/me') {
  $auth = requireAuth($secret);
  $pdo  = getPDO();
  handleUpdateMe($pdo, $auth);
}

if ($method === 'POST' && $path === '/auth/change-password') {
  $auth = requireAuth($secret);
  $pdo  = getPDO();
  handleChangePassword($pdo, $auth);
}

// ── supplier payouts via Stripe Connect ──
if ($method === 'POST' && $path === '/supplier/stripe/onboard') {
  $auth = requireAuth($secret);
  $pdo  = getPDO();
  handleStripeOnboard($pdo, $config, $auth);
}

if ($method === 'POST' && $path === '/supplier/stripe/dashboard') {
  $auth = requireAuth($secret);
  $pdo  = getPDO();
  handleStripeDashboard($pdo, $config, $auth);
}

if ($method === 'GET' && $path === '/supplier/stripe/status') {
  $auth = requireAuth($secret);
  $pdo  = getPDO();
  handleStripeStatus($pdo, $config, $auth);
}

// ── supplier registration application (fix & resubmit after rejection) ──
if ($method === 'GET' && $path === '/supplier/application') {
  $auth = requireAuth($secret);
  $pdo  = getPDO();
  handleGetApplication($pdo, $auth);
}

if ($method === 'POST' && $path === '/supplier/application/resubmit') {
  $auth = requireAuth($secret);
  $pdo  = getPDO();
  handleResubmitApplication($pdo, $auth);
}

if ($method === 'PUT' && $path === '/supplier/bank-account') {
  $auth = requireAuth($secret);
  $pdo  = getPDO();
  handleUpdateBankAccount($pdo, $auth);
}

// ── supplier business details (post-approval changes via re-approval) ──
if ($method === 'GET' && $path === '/supplier/business-details') {
  $auth = requireAuth($secret);
  $pdo  = getPDO();
  handleGetBusinessDetails($pdo, $auth);
}

if ($method === 'PUT' && $path === '/supplier/company-address') {
  $auth = requireAuth($secret);
  $pdo  = getPDO();
  handleUpdateCompanyAddress($pdo, $auth);
}

if ($method === 'POST' && $path === '/supplier/business-details/change-request') {
  $auth = requireAuth($secret);
  $pdo  = getPDO();
  handleSubmitChangeRequest($pdo, $auth);
}

// ── reports ──
if ($method === 'GET' && $path === '/reports/sales') {
  $auth = requireAuth($secret);
  $pdo  = getPDO();
  handleSupplierSalesReport($pdo, $auth);
}

if ($method === 'GET' && $path === '/admin/reports/commission') {
  $auth = requireAuth($secret);
  requireAdmin($auth);
  $pdo  = getPDO();
  handleAdminCommissionReport($pdo);
}

// ── admin routes (require an Admin token) ──
if ($method === 'GET' && $path === '/admin/suppliers/pending') {
  $auth = requireAuth($secret);
  requireAdmin($auth);
  $pdo  = getPDO();
  handleListPendingSuppliers($pdo);
}

if ($method === 'POST' && preg_match('#^/admin/suppliers/([^/]+)/approve$#', $path, $m)) {
  $auth = requireAuth($secret);
  requireAdmin($auth);
  $pdo  = getPDO();
  handleApproveSupplier($pdo, $m[1]);
}

if ($method === 'POST' && preg_match('#^/admin/suppliers/([^/]+)/reject$#', $path, $m)) {
  $auth = requireAuth($secret);
  requireAdmin($auth);
  $pdo  = getPDO();
  handleRejectSupplier($pdo, $m[1]);
}

// supplier business-detail change requests (re-approval queue)
if ($method === 'GET' && $path === '/admin/supplier-changes') {
  $auth = requireAuth($secret);
  requireAdmin($auth);
  $pdo  = getPDO();
  handleListChangeRequests($pdo);
}

if ($method === 'POST' && preg_match('#^/admin/supplier-changes/([^/]+)/approve$#', $path, $m)) {
  $auth = requireAuth($secret);
  requireAdmin($auth);
  $pdo  = getPDO();
  handleApproveChangeRequest($pdo, $auth, $m[1]);
}

if ($method === 'POST' && preg_match('#^/admin/supplier-changes/([^/]+)/reject$#', $path, $m)) {
  $auth = requireAuth($secret);
  requireAdmin($auth);
  $pdo  = getPDO();
  handleRejectChangeRequest($pdo, $auth, $m[1]);
}

if ($method === 'GET' && $path === '/admin/products/pending') {
  $auth = requireAuth($secret);
  requireAdmin($auth);
  $pdo  = getPDO();
  handleListPendingProducts($pdo);
}

if ($method === 'POST' && preg_match('#^/admin/products/([^/]+)/approve$#', $path, $m)) {
  $auth = requireAuth($secret);
  requireAdmin($auth);
  $pdo  = getPDO();
  handleApproveProduct($pdo, $m[1]);
}

if ($method === 'POST' && preg_match('#^/admin/products/([^/]+)/reject$#', $path, $m)) {
  $auth = requireAuth($secret);
  requireAdmin($auth);
  $pdo  = getPDO();
  handleRejectProduct($pdo, $m[1]);
}

// ── category routes (require a valid token) ──
if ($method === 'GET' && $path === '/categories') {
  $auth = requireAuth($secret);
  $pdo  = getPDO();
  handleListCategories($pdo);
}

// ── admin category management (require an Admin token) ──
if ($method === 'GET' && $path === '/admin/categories') {
  $auth = requireAuth($secret);
  requireAdmin($auth);
  $pdo  = getPDO();
  handleAdminListCategories($pdo);
}

if ($method === 'POST' && $path === '/admin/categories') {
  $auth = requireAuth($secret);
  requireAdmin($auth);
  $pdo  = getPDO();
  handleCreateCategory($pdo);
}

if ($method === 'PUT' && preg_match('#^/admin/categories/([^/]+)$#', $path, $m)) {
  $auth = requireAuth($secret);
  requireAdmin($auth);
  $pdo  = getPDO();
  handleRenameCategory($pdo, $m[1]);
}

if ($method === 'DELETE' && preg_match('#^/admin/categories/([^/]+)$#', $path, $m)) {
  $auth = requireAuth($secret);
  requireAdmin($auth);
  $pdo  = getPDO();
  handleDeleteCategory($pdo, $m[1]);
}

// ── admin user management (require an Admin token) ──
if ($method === 'GET' && $path === '/admin/users') {
  $auth = requireAuth($secret);
  requireAdmin($auth);
  $pdo  = getPDO();
  handleListUsers($pdo);
}

if ($method === 'GET' && preg_match('#^/admin/users/([^/]+)$#', $path, $m)) {
  $auth = requireAuth($secret);
  requireAdmin($auth);
  $pdo  = getPDO();
  handleGetUser($pdo, $m[1]);
}

if ($method === 'PATCH' && preg_match('#^/admin/users/([^/]+)/status$#', $path, $m)) {
  $auth = requireAuth($secret);
  requireAdmin($auth);
  $pdo  = getPDO();
  handleSetUserStatus($pdo, $auth, $m[1]);
}

// ── admin delivery dispatch (require an Admin token) ──
if ($method === 'GET' && $path === '/admin/deliveries') {
  $auth = requireAuth($secret);
  requireAdmin($auth);
  $pdo  = getPDO();
  handleListDeliveries($pdo);
}

if ($method === 'GET' && $path === '/admin/couriers') {
  $auth = requireAuth($secret);
  requireAdmin($auth);
  $pdo  = getPDO();
  handleListCouriers($pdo);
}

if ($method === 'POST' && preg_match('#^/admin/deliveries/([^/]+)/assign$#', $path, $m)) {
  $auth = requireAuth($secret);
  requireAdmin($auth);
  $pdo  = getPDO();
  handleAssignDelivery($pdo, $m[1]);
}

// ── file uploads (multipart): images + 3D models for products ──
if ($path === '/uploads' && $method === 'POST') {
  $auth = requireAuth($secret);
  $pdo  = getPDO();
  handleUpload($pdo, $auth);
}

// PUBLIC: business document upload used during supplier registration (no token
// exists yet). Locked to the 'document' kind inside the handler.
if ($path === '/uploads/registration-doc' && $method === 'POST') {
  $pdo = getPDO();
  handleRegistrationUpload($pdo);
}

// ── supplier orders (orders containing this supplier's products) ──
if ($method === 'GET' && $path === '/supplier/orders') {
  $auth = requireAuth($secret);
  $pdo  = getPDO();
  handleListSupplierOrders($pdo, $auth);
}

if ($method === 'GET' && preg_match('#^/supplier/orders/([^/]+)$#', $path, $m)) {
  $auth = requireAuth($secret);
  $pdo  = getPDO();
  handleGetSupplierOrder($pdo, $auth, $m[1]);
}

// ── reviews & ratings ──
if ($method === 'GET' && $path === '/supplier/reviews') {
  $auth = requireAuth($secret);
  $pdo  = getPDO();
  handleListSupplierReviews($pdo, $auth);
}

if ($method === 'GET' && $path === '/admin/reviews') {
  $auth = requireAuth($secret);
  requireAdmin($auth);
  $pdo  = getPDO();
  handleListAdminReviews($pdo);
}

if ($method === 'PATCH' && preg_match('#^/admin/reviews/([^/]+)/status$#', $path, $m)) {
  $auth = requireAuth($secret);
  requireAdmin($auth);
  $pdo  = getPDO();
  handleSetReviewStatus($pdo, $m[1]);
}

// ── supplier inventory (quick stock management) ──
if ($path === '/supplier/inventory') {
  $auth = requireAuth($secret);
  $pdo  = getPDO();
  if ($method === 'GET')   handleListInventory($pdo, $auth);
  if ($method === 'PATCH') handleUpdateInventory($pdo, $auth);
  sendJson(405, false, null, ['code' => 'METHOD', 'message' => 'Method not allowed.']);
}

// ── product routes (all require a valid token) ──
if ($path === '/products') {
  $auth = requireAuth($secret);
  $pdo  = getPDO();
  if ($method === 'GET')  handleListProducts($pdo, $auth);
  if ($method === 'POST') handleCreateProduct($pdo, $auth);
  sendJson(405, false, null, ['code' => 'METHOD', 'message' => 'Method not allowed.']);
}

if (preg_match('#^/products/([^/]+)$#', $path, $m)) {
  $id   = $m[1];
  $auth = requireAuth($secret);
  $pdo  = getPDO();
  if ($method === 'GET')    handleGetProduct($pdo, $auth, $id);
  if ($method === 'PUT')    handleUpdateProduct($pdo, $auth, $id);
  if ($method === 'DELETE') handleDeleteProduct($pdo, $auth, $id);
  sendJson(405, false, null, ['code' => 'METHOD', 'message' => 'Method not allowed.']);
}

// ── nothing matched ──
sendJson(404, false, null, ['code' => 'NOT_FOUND', 'message' => "No route for $method $path"]);
