import { apiGet, apiPost } from '../../api/client';

// Public (no auth): a suspended user reaches these via the token-secured link in
// their suspension email.

// Validate the link + fetch the suspension reason / whether an appeal is open.
export function getAppealContext(uid, token) {
  return apiGet(`/appeal?uid=${encodeURIComponent(uid)}&token=${encodeURIComponent(token)}`);
}

// Submit an appeal.
export function submitAppeal(uid, token, message) {
  return apiPost('/appeal', { uid, token, message });
}
