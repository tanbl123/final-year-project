<?php
// AR auto-fit: the admin-side bridge to the Python ML service's /autofit
// endpoint (see ml-service/autofit.py). Given a product's uploaded 3D model, the
// service validates it, auto-orients + scales it, optimises it for mobile AR,
// and returns the fitted per-foot .glb files + an analysis report (dimensions,
// anchor suggestion, occluder note, warnings). The admin reviews that here and
// downloads the fitted model to drop into Lens Studio — semi-automatic, because
// full runtime auto-generation is blocked by Snap's privacy model (documented in
// ar-lens-prototype/README.md).
//
// This runs ON DEMAND when the admin opens a product's review, so it always
// reflects the current model and needs no extra storage or DB columns.

// POST a JSON body to the ML service's /autofit and return the decoded response,
// or ['__error' => message] if the service is unreachable / misconfigured.
function mlAutofit(array $config, array $payload): array {
  $base = trim($config['ml_service_url'] ?? '');
  if ($base === '') {
    return ['__error' => 'The AR auto-fit service is not configured (set ml_service_url).'];
  }
  $ch = curl_init(rtrim($base, '/') . '/autofit');
  curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_POST           => true,
    CURLOPT_POSTFIELDS     => json_encode($payload),
    CURLOPT_HTTPHEADER     => ['Content-Type: application/json'],
    CURLOPT_CONNECTTIMEOUT => 3,
    CURLOPT_TIMEOUT        => 90,   // downloading + processing a model can take a while
  ]);
  $res  = curl_exec($ch);
  $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
  $cerr = curl_error($ch);
  curl_close($ch);

  if ($res === false) {
    return ['__error' => 'Could not reach the AR auto-fit service' . ($cerr ? ": $cerr" : '.')];
  }
  $data = json_decode($res, true);
  if (!is_array($data)) {
    // Non-JSON usually means an HTML error page: 404 = the service is stale
    // (restart python app.py after pulling) or the route is missing; 500 = it
    // crashed. Surface the status so it's diagnosable, not just "unexpected".
    $hint = $code === 404
      ? ' (HTTP 404 — the AR service may be running old code; restart python app.py)'
      : ' (HTTP ' . (int) $code . ')';
    return ['__error' => 'The AR auto-fit service returned an unexpected response' . $hint . '.'];
  }
  if ($code < 200 || $code >= 300) {
    return ['__error' => (string) ($data['error'] ?? 'The AR auto-fit service reported an error.')];
  }
  return $data;
}

// POST /supplier/models/validate   body: { modelUrl }
//
// Fail-fast validation the supplier's upload widget calls right after uploading
// a .glb, so a bad model (corrupt / Draco / no mesh / implausible size) is caught
// in seconds — instead of the slow round-trip of admin review -> rejection email
// -> re-upload. Returns a light validation summary (no fitted files).
//
// Graceful: if the ML service is offline, returns available=false so the upload
// still proceeds (infrastructure being down must not block suppliers).
function handleValidateSupplierModel(PDO $pdo, array $auth, array $config): void {
  requireSupplierId($pdo, $auth);   // suppliers only

  $body     = getJsonBody();
  $modelUrl = trim($body['modelUrl'] ?? '');
  if ($modelUrl === '') {
    sendJson(400, false, null, ['code' => 'VALIDATION', 'message' => 'modelUrl is required.']);
    return;
  }

  $result = mlAutofit($config, ['modelUrl' => $modelUrl, 'returnFiles' => false]);
  if (isset($result['__error'])) {
    // ML down -> don't block the supplier; the admin still validates at review.
    sendJson(200, true, ['available' => false, 'note' => $result['__error']]);
    return;
  }

  sendJson(200, true, [
    'available'     => true,
    'rejected'      => (bool) ($result['rejected'] ?? false),
    'rejectReason'  => $result['rejectReason'] ?? null,
    'warnings'      => $result['warnings'] ?? [],
    'shoeCount'     => $result['shoeCount'] ?? null,
    'dimensionsCm'  => $result['dimensionsCm'] ?? null,
    'nativeLengthCm'=> $result['nativeLengthCm'] ?? null,
  ]);
}

// GET /admin/products/{id}/autofit
//   ?count=auto|1|2   (default auto — let the algorithm detect)
//   &side=left|right  (single-shoe base foot; default right)
//   &length=<cm>      (real shoe length for scaling; default ~26)
//   &files=0|1        (1 also returns the fitted per-foot .glb as base64)
//
// Runs the uploaded model through the ML auto-fit and returns the analysis so
// the admin can QC it and download the fitted model for Lens Studio.
function handleAdminProductAutofit(PDO $pdo, string $id, array $config): void {
  // the product's primary 3D model (same lookup the admin detail view uses)
  $mdl = $pdo->prepare(
    'SELECT productModelUrl FROM product_model WHERE productId = :id ORDER BY productModelId LIMIT 1'
  );
  $mdl->execute(['id' => $id]);
  $modelUrl = (string) ($mdl->fetchColumn() ?: '');
  if ($modelUrl === '') {
    sendJson(404, false, null, ['code' => 'NO_MODEL',
      'message' => 'This product has no 3D model to auto-fit.']);
    return;
  }

  $countRaw = strtolower(trim((string) ($_GET['count'] ?? 'auto')));
  $side     = strtolower(trim((string) ($_GET['side'] ?? 'right')));
  $files    = ((string) ($_GET['files'] ?? '0')) === '1';
  $lengthCm = isset($_GET['length']) && is_numeric($_GET['length']) ? (float) $_GET['length'] : null;

  $payload = [
    'modelUrl'     => $modelUrl,
    'side'         => in_array($side, ['left', 'right'], true) ? $side : 'right',
    'mirrorSingle' => true,
    'autoOrient'   => true,
    'returnFiles'  => $files,
  ];
  if ($countRaw === '1' || $countRaw === '2') { $payload['count'] = (int) $countRaw; }  // else auto-detect
  if ($lengthCm !== null && $lengthCm > 0)    { $payload['lengthCm'] = $lengthCm; }

  $result = mlAutofit($config, $payload);
  if (isset($result['__error'])) {
    // 503 so the UI can show "service offline" without treating it as a hard failure
    sendJson(503, false, null, ['code' => 'ML_UNAVAILABLE', 'message' => $result['__error']]);
    return;
  }

  $result['modelUrl'] = $modelUrl;   // echo the source so the UI can show before/after
  sendJson(200, true, $result);
}
