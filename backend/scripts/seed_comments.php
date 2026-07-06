<?php
// ─────────────────────────────────────────────────────────────────────
// Shared pool of demo-review comments, used by BOTH seed_demo_reviews.php and
// unseed_customer_reviews.php. The seed picks a random comment from these so
// reviews look natural (not identical); the unseed script deletes reviews whose
// comment is in these pools. So: every phrase a seed might write MUST live here,
// including legacy ones, or unseed won't clean it up.
// ─────────────────────────────────────────────────────────────────────

// Positive comments for a shopper's preferred categories (paired with 4–5★).
const SEED_LIKE_COMMENTS = [
  'Love this — exactly my style.',          // legacy phrase (keep for cleanup)
  'Super comfy and a great fit.',
  'Really happy with these — quality feels premium.',
  'Perfect for daily wear, highly recommend.',
  'Great cushioning and grip, no complaints.',
  'Looks even better in person. Five stars.',
  'Comfortable straight out of the box.',
  'My new favourite pair.',
  'Exactly what I was looking for.',
  'Worth every ringgit.',
];

// Lukewarm comments for other categories (paired with 2–3★).
const SEED_MEH_COMMENTS = [
  'Not really my type.',                    // legacy phrase (keep for cleanup)
  "It's okay, but not for me.",
  "Decent, though the style isn't my thing.",
  'Fit was fine, just not what I usually go for.',
  'Average — probably won\'t reorder.',
  'Not bad, but nothing special for me.',
  'A bit plain for my taste.',
  'Fine, but I prefer other styles.',
];

// All seed phrases together — used by the unseed script's delete filter.
function allSeedComments(): array {
  return array_merge(SEED_LIKE_COMMENTS, SEED_MEH_COMMENTS);
}

// Pick a natural-looking comment for a liked / not-liked product.
function pickSeedComment(bool $liked): string {
  $pool = $liked ? SEED_LIKE_COMMENTS : SEED_MEH_COMMENTS;
  return $pool[mt_rand(0, count($pool) - 1)];
}
