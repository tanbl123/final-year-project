<?php
require __DIR__ . '/../../lib/response.php';
require __DIR__ . '/../../lib/db.php';
require __DIR__ . '/../../lib/jwt.php';
require __DIR__ . '/../../lib/request.php';
require __DIR__ . '/../../lib/auth.php';
require __DIR__ . '/../../lib/ids.php';
require __DIR__ . '/../../lib/google_auth.php';
require __DIR__ . '/../../lib/storage.php';
require __DIR__ . '/../../lib/stripe.php';
require __DIR__ . '/../../lib/mail.php';
require __DIR__ . '/../../lib/delivery.php';
require __DIR__ . '/../../lib/notifications.php';
require __DIR__ . '/../../lib/push.php';
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
require __DIR__ . '/../../controllers/RefundController.php';
require __DIR__ . '/../../controllers/CommissionController.php';
require __DIR__ . '/../../controllers/CatalogController.php';
require __DIR__ . '/../../controllers/CartController.php';
require __DIR__ . '/../../controllers/WishlistController.php';
require __DIR__ . '/../../controllers/PaymentController.php';
require __DIR__ . '/../../controllers/NotificationController.php';

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

// ── customer cart (require a Customer token) ──
if ($method === 'GET' && $path === '/cart') {
  $auth = requireAuth($secret);
  $pdo  = getPDO();
  handleGetCart($pdo, $auth);
}

if ($method === 'POST' && $path === '/cart/items') {
  $auth = requireAuth($secret);
  $pdo  = getPDO();
  handleAddCartItem($pdo, $auth);
}

if ($method === 'PUT' && preg_match('#^/cart/items/([^/]+)$#', $path, $m)) {
  $auth = requireAuth($secret);
  $pdo  = getPDO();
  handleUpdateCartItem($pdo, $auth, $m[1]);
}

if ($method === 'DELETE' && preg_match('#^/cart/items/([^/]+)$#', $path, $m)) {
  $auth = requireAuth($secret);
  $pdo  = getPDO();
  handleRemoveCartItem($pdo, $auth, $m[1]);
}

// ── customer checkout + orders (require a Customer token) ──
if ($method === 'POST' && $path === '/orders') {
  $auth = requireAuth($secret);
  $pdo  = getPDO();
  handleCheckout($pdo, $auth);
}

if ($method === 'GET' && $path === '/orders') {
  $auth = requireAuth($secret);
  $pdo  = getPDO();
  handleListCustomerOrders($pdo, $auth);
}

if ($method === 'GET' && preg_match('#^/orders/([^/]+)$#', $path, $m)) {
  $auth = requireAuth($secret);
  $pdo  = getPDO();
  handleGetCustomerOrder($pdo, $auth, $m[1]);
}

// create a Stripe PaymentIntent for an order (mobile checkout)
if ($method === 'POST' && preg_match('#^/orders/([^/]+)/payment-intent$#', $path, $m)) {
  $auth = requireAuth($secret);
  $pdo  = getPDO();
  handleCreatePaymentIntent($pdo, $config, $auth, $m[1]);
}

// pay an order: verifies the Stripe PaymentIntent (or simulates) → post-payment pipeline
if ($method === 'POST' && preg_match('#^/orders/([^/]+)/payment$#', $path, $m)) {
  $auth = requireAuth($secret);
  $pdo  = getPDO();
  handlePayOrder($pdo, $config, $auth, $m[1]);
}

if ($method === 'GET' && preg_match('#^/orders/([^/]+)/receipt$#', $path, $m)) {
  $auth = requireAuth($secret);
  $pdo  = getPDO();
  handleGetReceipt($pdo, $auth, $m[1]);
}

// ── customer reviews (create on a purchased product; edit/delete your own) ──
if ($method === 'GET' && preg_match('#^/products/([^/]+)/reviews/mine$#', $path, $m)) {
  $auth = requireAuth($secret);
  $pdo  = getPDO();
  handleGetMyReview($pdo, $auth, $m[1]);
}

if ($method === 'POST' && preg_match('#^/products/([^/]+)/reviews$#', $path, $m)) {
  $auth = requireAuth($secret);
  $pdo  = getPDO();
  handleCreateReview($pdo, $auth, $m[1]);
}

if ($method === 'PUT' && preg_match('#^/reviews/([^/]+)$#', $path, $m)) {
  $auth = requireAuth($secret);
  $pdo  = getPDO();
  handleUpdateReview($pdo, $auth, $m[1]);
}

if ($method === 'DELETE' && preg_match('#^/reviews/([^/]+)$#', $path, $m)) {
  $auth = requireAuth($secret);
  $pdo  = getPDO();
  handleDeleteReview($pdo, $auth, $m[1]);
}

// ── customer refund requests (require a Customer token) ──
if ($method === 'POST' && preg_match('#^/orders/([^/]+)/refund$#', $path, $m)) {
  $auth = requireAuth($secret);
  $pdo  = getPDO();
  handleCreateRefund($pdo, $auth, $m[1]);
}

if ($method === 'GET' && $path === '/refunds') {
  $auth = requireAuth($secret);
  $pdo  = getPDO();
  handleListCustomerRefunds($pdo, $auth);
}

// ── in-app notifications (the bell) + device push token (any logged-in user) ──
if ($method === 'GET' && $path === '/notifications') {
  $auth = requireAuth($secret);
  $pdo  = getPDO();
  handleListNotifications($pdo, $auth);
}

if ($method === 'POST' && $path === '/notifications/read-all') {
  $auth = requireAuth($secret);
  $pdo  = getPDO();
  handleMarkAllNotificationsRead($pdo, $auth);
}

if ($method === 'POST' && $path === '/notifications/device') {
  $auth = requireAuth($secret);
  $pdo  = getPDO();
  handleRegisterDevice($pdo, $auth);
}

if ($method === 'PATCH' && preg_match('#^/notifications/([^/]+)/read$#', $path, $m)) {
  $auth = requireAuth($secret);
  $pdo  = getPDO();
  handleMarkNotificationRead($pdo, $auth, $m[1]);
}

// ── delivery personnel / courier (require a DeliveryPersonnel token) ──
if ($method === 'GET' && $path === '/delivery/assignments') {
  $auth = requireAuth($secret);
  $pdo  = getPDO();
  handleListAssignments($pdo, $auth);
}

if ($method === 'GET' && $path === '/delivery/history') {
  $auth = requireAuth($secret);
  $pdo  = getPDO();
  handleListDeliveryHistory($pdo, $auth);
}

if ($method === 'GET' && preg_match('#^/deliveries/([^/]+)$#', $path, $m)) {
  $auth = requireAuth($secret);
  $pdo  = getPDO();
  handleGetCourierDelivery($pdo, $auth, $m[1]);
}

if ($method === 'PATCH' && preg_match('#^/deliveries/([^/]+)/status$#', $path, $m)) {
  $auth = requireAuth($secret);
  $pdo  = getPDO();
  handleUpdateDeliveryStatus($pdo, $auth, $m[1]);
}

if ($method === 'POST' && preg_match('#^/deliveries/([^/]+)/verify-otp$#', $path, $m)) {
  $auth = requireAuth($secret);
  $pdo  = getPDO();
  handleVerifyOtp($pdo, $auth, $m[1]);
}

if ($method === 'POST' && preg_match('#^/deliveries/([^/]+)/proof$#', $path, $m)) {
  $auth = requireAuth($secret);
  $pdo  = getPDO();
  handleUploadProof($pdo, $auth, $m[1]);
}

if ($method === 'POST' && preg_match('#^/deliveries/([^/]+)/report-issue$#', $path, $m)) {
  $auth = requireAuth($secret);
  $pdo  = getPDO();
  handleReportIssue($pdo, $auth, $m[1]);
}

// ── customer wishlist (require a Customer token) ──
if ($method === 'GET' && $path === '/wishlist') {
  $auth = requireAuth($secret);
  $pdo  = getPDO();
  handleGetWishlist($pdo, $auth);
}

if ($method === 'POST' && $path === '/wishlist/items') {
  $auth = requireAuth($secret);
  $pdo  = getPDO();
  handleAddWishlistItem($pdo, $auth);
}

if ($method === 'DELETE' && preg_match('#^/wishlist/items/([^/]+)$#', $path, $m)) {
  $auth = requireAuth($secret);
  $pdo  = getPDO();
  handleRemoveWishlistItem($pdo, $auth, $m[1]);
}

// ── public catalog (customer app browsing; guests allowed — no token) ──
if ($method === 'GET' && $path === '/catalog/products') {
  $pdo = getPDO();
  handleListCatalog($pdo);
}

if ($method === 'GET' && preg_match('#^/catalog/products/([^/]+)$#', $path, $m)) {
  $pdo = getPDO();
  handleGetCatalogProduct($pdo, $m[1]);
}

// email a verification code before the account is created (public)
if ($method === 'POST' && $path === '/auth/register/send-code') {
  $pdo = getPDO();
  handleSendRegisterCode($pdo, $config);
}

if ($method === 'POST' && $path === '/auth/register') {
  $pdo = getPDO();
  handleRegister($pdo);
}

// customer self-service sign-up (mobile app) — Active immediately, no approval
if ($method === 'POST' && $path === '/auth/register/customer') {
  $pdo = getPDO();
  handleRegisterCustomer($pdo);
}

// courier self-service sign-up (delivery app) — Pending, awaits admin approval
if ($method === 'POST' && $path === '/auth/register/courier') {
  $pdo = getPDO();
  handleRegisterCourier($pdo);
}

if ($method === 'POST' && $path === '/auth/login') {
  $pdo = getPDO();
  handleLogin($pdo, $secret);
}

// forgot-password: email a reset code, then reset with that code (both public)
if ($method === 'POST' && $path === '/auth/forgot-password') {
  $pdo = getPDO();
  handleForgotPassword($pdo, $config);
}

if ($method === 'POST' && $path === '/auth/reset-password/verify-code') {
  $pdo = getPDO();
  handleVerifyResetCode($pdo);
}

if ($method === 'POST' && $path === '/auth/reset-password') {
  $pdo = getPDO();
  handleResetPassword($pdo);
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

if ($method === 'DELETE' && $path === '/auth/me') {
  $auth = requireAuth($secret);
  $pdo  = getPDO();
  handleDeleteMe($pdo, $auth);
}

// profile picture (multipart upload / remove) — any signed-in user
if ($method === 'POST' && $path === '/auth/me/avatar') {
  $auth = requireAuth($secret);
  $pdo  = getPDO();
  handleUploadAvatar($pdo, $auth);
}

if ($method === 'DELETE' && $path === '/auth/me/avatar') {
  $auth = requireAuth($secret);
  $pdo  = getPDO();
  handleRemoveAvatar($pdo, $auth);
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

if ($method === 'PUT' && $path === '/supplier/operational-address') {
  $auth = requireAuth($secret);
  $pdo  = getPDO();
  handleUpdateOperationalAddress($pdo, $auth);
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

// ── admin commission rate configuration ──
if ($path === '/admin/commission') {
  $auth = requireAuth($secret);
  requireAdmin($auth);
  $pdo  = getPDO();
  if ($method === 'GET')  handleGetCommission($pdo);
  if ($method === 'POST') handleSetCommission($pdo, $auth);
  sendJson(405, false, null, ['code' => 'METHOD', 'message' => 'Method not allowed.']);
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

// courier approval queue (self-applied delivery personnel awaiting approval)
if ($method === 'GET' && $path === '/admin/couriers/pending') {
  $auth = requireAuth($secret);
  requireAdmin($auth);
  $pdo  = getPDO();
  handleListPendingCouriers($pdo);
}

if ($method === 'POST' && preg_match('#^/admin/couriers/([^/]+)/approve$#', $path, $m)) {
  $auth = requireAuth($secret);
  requireAdmin($auth);
  $pdo  = getPDO();
  handleApproveCourier($pdo, $m[1]);
}

if ($method === 'POST' && preg_match('#^/admin/couriers/([^/]+)/reject$#', $path, $m)) {
  $auth = requireAuth($secret);
  requireAdmin($auth);
  $pdo  = getPDO();
  handleRejectCourier($pdo, $m[1]);
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
  // public: the category list is public taxonomy used by the catalog filters
  // (guests browse + filter without signing in)
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

// ── admin delivery-issue queue (the courier "report an issue" reports) ──
if ($method === 'GET' && $path === '/admin/delivery-issues') {
  $auth = requireAuth($secret);
  requireAdmin($auth);
  $pdo  = getPDO();
  handleListDeliveryIssues($pdo);
}

if ($method === 'PATCH' && preg_match('#^/admin/delivery-issues/([^/]+)/resolve$#', $path, $m)) {
  $auth = requireAuth($secret);
  requireAdmin($auth);
  $pdo  = getPDO();
  handleResolveDeliveryIssue($pdo, $m[1]);
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

// ── admin order oversight ──
if ($method === 'GET' && $path === '/admin/orders') {
  $auth = requireAuth($secret);
  requireAdmin($auth);
  $pdo  = getPDO();
  handleListAdminOrders($pdo);
}

if ($method === 'GET' && preg_match('#^/admin/orders/([^/]+)$#', $path, $m)) {
  $auth = requireAuth($secret);
  requireAdmin($auth);
  $pdo  = getPDO();
  handleGetAdminOrder($pdo, $m[1]);
}

// ── admin product inventory view ──
if ($method === 'GET' && $path === '/admin/inventory') {
  $auth = requireAuth($secret);
  requireAdmin($auth);
  $pdo  = getPDO();
  handleListAdminInventory($pdo);
}

// ── refunds ──
if ($method === 'GET' && $path === '/supplier/refunds') {
  $auth = requireAuth($secret);
  $pdo  = getPDO();
  handleListSupplierRefunds($pdo, $auth);
}

if ($method === 'GET' && $path === '/admin/refunds') {
  $auth = requireAuth($secret);
  requireAdmin($auth);
  $pdo  = getPDO();
  handleListRefunds($pdo);
}

if ($method === 'PATCH' && preg_match('#^/admin/refunds/([^/]+)/status$#', $path, $m)) {
  $auth = requireAuth($secret);
  requireAdmin($auth);
  $pdo  = getPDO();
  handleSetRefundStatus($pdo, $m[1]);
}

// ── reviews & ratings (admin moderation; supplier sees reviews on product detail) ──
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

// supplier reply to a review on their own product (create/update + delete)
if ($method === 'PUT' && preg_match('#^/supplier/reviews/([^/]+)/reply$#', $path, $m)) {
  $auth = requireAuth($secret);
  $pdo  = getPDO();
  handleReplyToReview($pdo, $auth, $m[1]);
}

if ($method === 'DELETE' && preg_match('#^/supplier/reviews/([^/]+)/reply$#', $path, $m)) {
  $auth = requireAuth($secret);
  $pdo  = getPDO();
  handleDeleteReviewReply($pdo, $auth, $m[1]);
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
