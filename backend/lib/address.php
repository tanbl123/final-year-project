<?php
// ─────────────────────────────────────────────────────────────────────
// Structured Malaysian address helpers.
//
// Shared by supplier registration and the operational-address profile edit.
// A pickup address is stored BOTH as structured columns (the source of truth,
// used for dispatch routing + future EasyParcel rate quotes) AND as a combined
// single-line string, so every existing screen that prints a one-line address
// keeps working unchanged.
// ─────────────────────────────────────────────────────────────────────

// Canonical Malaysian states (matches the courier coverage-zone list and the
// customer checkout form).
const MY_STATES = [
  'Johor', 'Kedah', 'Kelantan', 'Melaka', 'Negeri Sembilan', 'Pahang',
  'Perak', 'Perlis', 'Pulau Pinang', 'Sabah', 'Sarawak', 'Selangor',
  'Terengganu', 'Kuala Lumpur', 'Labuan', 'Putrajaya',
];

// Pull a structured address out of a request body using a field prefix, e.g.
// 'operational' → operationalLine1, operationalPostcode, operationalCity,
// operationalState. Line 1 holds the whole street address. Values are trimmed.
function readStructuredAddress(array $body, string $prefix): array {
  return [
    'line1'    => trim((string) ($body["{$prefix}Line1"] ?? '')),
    'postcode' => trim((string) ($body["{$prefix}Postcode"] ?? '')),
    'city'     => trim((string) ($body["{$prefix}City"] ?? '')),
    'state'    => trim((string) ($body["{$prefix}State"] ?? '')),
  ];
}

// True when the body carries a structured address (line 1 present) — lets a
// handler accept the new structured payload while staying backward-compatible
// with older clients that only send the combined single line.
function hasStructuredAddress(array $a): bool {
  return $a['line1'] !== '';
}

// Validate a structured Malaysian address (line 2 is optional). Returns an
// error string, or null when valid.
function structuredAddressError(array $a): ?string {
  if ($a['line1'] === '' || $a['postcode'] === '' || $a['city'] === '' || $a['state'] === '') {
    return 'Address line 1, postcode, city and state are all required.';
  }
  if (!preg_match('/^\d{5}$/', $a['postcode'])) {
    return 'Postcode must be 5 digits.';
  }
  if (!in_array($a['state'], MY_STATES, true)) {
    return 'Please choose a valid Malaysian state.';
  }
  if (mb_strlen($a['line1']) > 150 || mb_strlen($a['city']) > 100) {
    return 'One of the address fields is too long.';
  }
  return null;
}

// Compose the combined single-line address from structured parts, e.g.
// "12 Jalan Mawar, Taman Indah, 50480 Kuala Lumpur, Kuala Lumpur".
function composeAddress(array $a): string {
  $parts = array_filter([
    $a['line1'],
    trim($a['postcode'] . ' ' . $a['city']),
    $a['state'],
  ], static fn($p) => $p !== '');
  return implode(', ', $parts);
}
