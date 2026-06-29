// ─────────────────────────────────────────────────────────────
// Central place that talks to the PHP API.
// Change API_BASE here when moving to a different server (local → cloud).
// ─────────────────────────────────────────────────────────────
export const API_BASE = 'http://localhost/shoear/api/v1';

// The saved JWT (set at login), used to authenticate protected requests.
export function getToken() {
  return localStorage.getItem('token');
}

// Low-level request: calls the API, unwraps the {success,data,error} envelope.
async function request(path, options = {}) {
  const res = await fetch(API_BASE + path, options);

  let json;
  try {
    json = await res.json();
  } catch {
    throw new Error('Server did not return valid JSON.');
  }

  if (!json.success) {
    const err = new Error(json.error?.message || 'Request failed.');
    err.code = json.error?.code;
    if (json.error?.detail) { err.detail = json.error.detail; }   // extra diagnostic (e.g. EasyParcel's reason)
    throw err;
  }
  return json.data;
}

// GET request (optionally with a JWT token for protected endpoints).
export function apiGet(path, token) {
  return request(path, {
    headers: token ? { Authorization: 'Bearer ' + token } : {},
  });
}

// POST request with a JSON body (optionally with a token).
export function apiPost(path, body, token) {
  return request(path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: 'Bearer ' + token } : {}),
    },
    body: JSON.stringify(body),
  });
}

// PUT request with a JSON body (optionally with a token).
export function apiPut(path, body, token) {
  return request(path, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: 'Bearer ' + token } : {}),
    },
    body: JSON.stringify(body),
  });
}

// PATCH request with a JSON body (optionally with a token).
export function apiPatch(path, body, token) {
  return request(path, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: 'Bearer ' + token } : {}),
    },
    body: JSON.stringify(body),
  });
}

// Multipart upload (a FormData body). We deliberately DON'T set Content-Type:
// the browser adds it with the correct multipart boundary.
export function apiUpload(path, formData, token) {
  return request(path, {
    method: 'POST',
    headers: token ? { Authorization: 'Bearer ' + token } : {},
    body: formData,
  });
}

// DELETE request (optionally with a token).
export function apiDelete(path, token) {
  return request(path, {
    method: 'DELETE',
    headers: token ? { Authorization: 'Bearer ' + token } : {},
  });
}
