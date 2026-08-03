<?php
/**
 * Clean a phone number for storage WITHOUT forcing a country prefix.
 *
 * The number is stored the way the user entered it (a local 0-prefixed number
 * stays 0-prefixed; a +60/60 number keeps its prefix) — we no longer rewrite it
 * to a canonical +60 E.164 form. Only stray formatting is removed: spaces,
 * dashes and brackets are stripped, keeping digits and an optional leading '+'.
 * Format validation is the caller's job.
 *
 *   0123456789    -> 0123456789
 *   012-345 6789  -> 0123456789
 *   +60123456789  -> +60123456789
 */
function normalizeMyPhone(string $phone): string {
    return preg_replace('/[^\d+]/', '', trim($phone)); // keep digits and a '+'
}
