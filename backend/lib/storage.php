<?php
// ─────────────────────────────────────────────────────────────────────
// File storage for product images and 3D models.
//
// SWAP SEAM: today storeUploadedFile() writes to backend/uploads/ and returns
// a local Apache URL (works on XAMPP with no external service). The project
// architecture (see HANDOFF.md) ultimately keeps these files in Firebase
// Storage — to switch, replace ONLY the body of storeUploadedFile() with a
// Firebase upload that returns the public download URL. Nothing else in the
// app cares where the file lives; it only stores/serves the returned URL.
// ─────────────────────────────────────────────────────────────────────

// What each kind of upload is allowed to be. Models are validated by
// extension (browsers send .glb as application/octet-stream, so MIME is
// unreliable); images are additionally checked with getimagesize().
const UPLOAD_KINDS = [
  'image' => [
    'dir'      => 'images',
    'exts'     => ['jpg', 'jpeg', 'png', 'webp'],
    'maxBytes' => 5 * 1024 * 1024,   // 5 MB
  ],
  'model' => [
    'dir'      => 'models',
    'exts'     => ['glb', 'gltf'],
    'maxBytes' => 30 * 1024 * 1024,  // 30 MB
  ],
  // business documents (e.g. the SSM registration certificate) submitted at
  // supplier registration. PDF or an image scan.
  'document' => [
    'dir'      => 'documents',
    'exts'     => ['pdf', 'jpg', 'jpeg', 'png', 'webp'],
    'maxBytes' => 10 * 1024 * 1024,  // 10 MB
  ],
];

// Public base URL for served upload files. Derived from the request so it
// works whether the host is localhost or something else. /shoear maps to the
// backend/ folder (same mapping the API uses), and Apache serves files under
// backend/uploads/ directly (the front-controller rewrite only covers api/v1).
function publicUploadsBaseUrl(): string {
  $scheme = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') ? 'https' : 'http';
  $host   = $_SERVER['HTTP_HOST'] ?? 'localhost';
  return $scheme . '://' . $host . '/shoear/uploads';
}

// Validate and store one uploaded file. Returns the public URL on success,
// or sends a 400 and exits on any validation failure.
function storeUploadedFile(array $file, string $kind): string {
  if (!isset(UPLOAD_KINDS[$kind])) {
    sendJson(400, false, null, ['code' => 'VALIDATION', 'message' => 'Unknown upload kind.']);
  }
  $rules = UPLOAD_KINDS[$kind];

  if (($file['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK) {
    sendJson(400, false, null, ['code' => 'VALIDATION', 'message' => 'File upload failed.']);
  }
  if ($file['size'] <= 0 || $file['size'] > $rules['maxBytes']) {
    $mb = $rules['maxBytes'] / (1024 * 1024);
    sendJson(400, false, null, ['code' => 'VALIDATION', 'message' => "File must be between 1 byte and {$mb} MB."]);
  }

  $ext = strtolower(pathinfo($file['name'], PATHINFO_EXTENSION));
  if (!in_array($ext, $rules['exts'], true)) {
    $allowed = implode(', ', $rules['exts']);
    sendJson(400, false, null, ['code' => 'VALIDATION', 'message' => "Allowed file types: {$allowed}."]);
  }
  if ($kind === 'image' && getimagesize($file['tmp_name']) === false) {
    sendJson(400, false, null, ['code' => 'VALIDATION', 'message' => 'That file is not a valid image.']);
  }

  $dir = __DIR__ . '/../uploads/' . $rules['dir'];
  if (!is_dir($dir) && !mkdir($dir, 0775, true) && !is_dir($dir)) {
    sendJson(500, false, null, ['code' => 'STORAGE', 'message' => 'Could not prepare upload directory.']);
  }

  // Random, collision-proof filename; never trust the client's name.
  $filename = bin2hex(random_bytes(16)) . '.' . $ext;
  $dest     = $dir . '/' . $filename;

  if (!move_uploaded_file($file['tmp_name'], $dest)) {
    sendJson(500, false, null, ['code' => 'STORAGE', 'message' => 'Could not save the uploaded file.']);
  }

  return publicUploadsBaseUrl() . '/' . $rules['dir'] . '/' . $filename;
}
