<?php
/**
 * Normalise a Malaysian phone number to E.164 (+60...) for consistent storage.
 *
 * Accepts the formats the app allows — local (0XX-XXXXXXX, mobile or landline),
 * bare international (60...), or full E.164 (+60...) — and always returns the
 * E.164 form so the database holds one canonical representation. Spaces, dashes
 * and brackets are stripped first. Input that doesn't look Malaysian is returned
 * cleaned but otherwise unchanged (format validation is the caller's job).
 *
 *   0123456789    -> +60123456789
 *   0312345678    -> +60312345678   (landline)
 *   60123456789   -> +60123456789
 *   +60123456789  -> +60123456789   (unchanged)
 */
function normalizeMyPhone(string $phone): string {
    $p = preg_replace('/[^\d+]/', '', trim($phone)); // keep digits and a '+'
    if ($p === '') return '';
    if (strpos($p, '+60') === 0) return $p;                   // already E.164
    if (strpos($p, '60')  === 0) return '+' . $p;             // 60...  -> +60...
    if (strpos($p, '0')   === 0) return '+60' . substr($p, 1); // 0XX... -> +60XX...
    return $p;                                                // leave as-is
}
