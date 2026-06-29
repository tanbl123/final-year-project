// Structured Malaysian address constants + helpers, shared by AddressFields and
// the forms that use it (kept out of the component file so fast-refresh works).

// Canonical Malaysian states (matches the backend MY_STATES + courier zones).
export const MY_STATES = [
  'Johor', 'Kedah', 'Kelantan', 'Melaka', 'Negeri Sembilan', 'Pahang',
  'Perak', 'Perlis', 'Pulau Pinang', 'Sabah', 'Sarawak', 'Selangor',
  'Terengganu', 'Kuala Lumpur', 'Labuan', 'Putrajaya',
];

export function emptyAddress() {
  return { line1: '', postcode: '', city: '', state: '' };
}

// Validate a structured address; returns a { field: message } map (empty = ok).
// Line 1 holds the full street address (everything before the postcode), matching
// the customer's address form. Mirrors the backend rules in lib/address.php.
export function validateAddress(a) {
  const e = {};
  if (!a.line1.trim()) e.line1 = 'Address line is required.';
  if (!a.postcode.trim()) e.postcode = 'Postcode is required.';
  else if (!/^\d{5}$/.test(a.postcode.trim())) e.postcode = 'Postcode must be 5 digits.';
  if (!a.city.trim()) e.city = 'City is required.';
  if (!MY_STATES.includes(a.state)) e.state = 'Please choose a state.';
  return e;
}
