import { apiPost, apiGet, apiPut, apiUpload, getToken } from '../../api/client';

// REAL login against the PHP API (POST /auth/login).
// `identifier` may be either an email or a username.
// Returns { token, user } on success, or throws with the server's error message.
export function login(identifier, password) {
  return apiPost('/auth/login', { identifier, password });
}

// Logout is client-side: just discard the saved token + user.
export function logout() {
  localStorage.removeItem('token');
  localStorage.removeItem('user');
}

// Start "forgot password" (POST /auth/forgot-password). Emails a reset code if
// the address has an account. Always resolves with a generic { message } —
// never reveals whether the email is registered.
export function forgotPassword(email) {
  return apiPost('/auth/forgot-password', { email });
}

// Verify a reset code WITHOUT consuming it (POST /auth/reset-password/verify-code)
// — used as its own step before the new-password step. Resolves on success.
export function verifyResetCode(email, code) {
  return apiPost('/auth/reset-password/verify-code', { email, code });
}

// Finish "forgot password" (POST /auth/reset-password): verify the emailed code
// and set a new password. Resolves with a { message } on success.
export function resetPassword(email, code, newPassword) {
  return apiPost('/auth/reset-password', { email, code, newPassword });
}

// Email a 6-digit verification code to the address being registered
// (POST /auth/register/send-code). Must succeed before register() will work.
// Resolves with a { message } on success.
export function sendRegisterCode(email) {
  return apiPost('/auth/register/send-code', { email });
}

// REAL supplier registration (POST /auth/register).
// Requires the verification code emailed by sendRegisterCode().
// Creates a Pending account; resolves with a { message } on success.
export function register(data) {
  return apiPost('/auth/register', data);
}

// Live username availability check (GET /auth/username-available). Public.
// Resolves with { available, suggestion? } — used by the sign-up/profile forms.
export function checkUsername(username) {
  return apiGet(`/auth/username-available?u=${encodeURIComponent(username)}`);
}

// Upload a business document (e.g. SSM certificate) during registration.
// Public — there's no account/token yet. Resolves with { url }.
export function uploadRegistrationDoc(file) {
  const form = new FormData();
  form.append('file', file);
  return apiUpload('/uploads/registration-doc', form);
}

// The signed-in supplier's own registration application (for the resubmit form).
// Resolves with company fields, status and any rejectionReason.
export function getMyApplication() {
  return apiGet('/supplier/application', getToken());
}

// Resubmit a corrected application after a (curable) rejection. Flips the
// account back to Pending for re-review. Resolves with { status, message }.
export function resubmitApplication(data) {
  return apiPost('/supplier/application/resubmit', data, getToken());
}

// Set/update the supplier's payout bank account. Resolves with the saved fields.
export function updateBankAccount(data) {
  return apiPut('/supplier/bank-account', data, getToken());
}

// The supplier's verified business details + any open/last change request.
export function getBusinessDetails() {
  return apiGet('/supplier/business-details', getToken());
}

// Company address is operational — editable freely (no admin review).
export function updateCompanyAddress(companyAddress) {
  return apiPut('/supplier/company-address', { companyAddress }, getToken());
}

// Propose changes to the verified fields (company name, SSM, SST, document).
// Goes to the admin re-approval queue; the account stays Active meanwhile.
export function submitBusinessChangeRequest(data) {
  return apiPost('/supplier/business-details/change-request', data, getToken());
}

// The signed-in user's own profile (GET /auth/me).
export function getMe() {
  return apiGet('/auth/me', getToken());
}

// Update the signed-in user's editable fields (PUT /auth/me).
export function updateMe(data) {
  return apiPut('/auth/me', data, getToken());
}

// Change own password (POST /auth/change-password). Requires the current one.
export function changePassword(currentPassword, newPassword) {
  return apiPost('/auth/change-password', { currentPassword, newPassword }, getToken());
}
