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

// REAL supplier registration (POST /auth/register).
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
