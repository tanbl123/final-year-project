import { apiPost, apiGet, apiPut, apiUpload, getToken } from '../../api/client';

// REAL login against the PHP API (POST /auth/login).
// Returns { token, user } on success, or throws with the server's error message.
export function login(email, password) {
  return apiPost('/auth/login', { email, password });
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

// Upload a business document (e.g. SSM certificate) during registration.
// Public — there's no account/token yet. Resolves with { url }.
export function uploadRegistrationDoc(file) {
  const form = new FormData();
  form.append('file', file);
  return apiUpload('/uploads/registration-doc', form);
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
