<?php
// Suspension appeals. When an admin suspends an account we email the person a
// token-secured link to a PUBLIC appeal page (they can't log in while
// suspended). They submit an appeal here; the admin reviews it and either
// reinstates the account (Approved) or declines (Rejected).

// Verify the appeal link's user + raw token against the stored hash. Returns the
// user row, or null when the token is missing/invalid.
function appealUserForToken(PDO $pdo, string $userId, string $token): ?array {
  if ($userId === '' || $token === '') { return null; }
  $stmt = $pdo->prepare('SELECT userId, fullName, status, rejectionReason, appealToken FROM `user` WHERE userId = :id');
  $stmt->execute(['id' => $userId]);
  $u = $stmt->fetch();
  if (!$u || empty($u['appealToken']) || !password_verify($token, (string) $u['appealToken'])) {
    return null;
  }
  return $u;
}

// GET /appeal?uid=&token= — PUBLIC. Validate the link and return the context the
// appeal page shows: the suspension reason + whether an appeal is already open.
function handleGetAppealContext(PDO $pdo): void {
  $userId = trim($_GET['uid'] ?? '');
  $token  = trim($_GET['token'] ?? '');
  $u = appealUserForToken($pdo, $userId, $token);
  if (!$u) {
    sendJson(404, false, null, ['code' => 'INVALID_LINK', 'message' => 'This appeal link is invalid or has expired.']);
  }
  if ($u['status'] !== 'Suspended') {
    // already reinstated (or otherwise not suspended) → nothing to appeal
    sendJson(200, true, ['status' => $u['status'], 'reason' => null, 'canAppeal' => false, 'openAppeal' => false,
      'fullName' => $u['fullName']]);
  }
  $open = $pdo->prepare("SELECT 1 FROM account_appeal WHERE userId = :id AND appealStatus = 'Open' LIMIT 1");
  $open->execute(['id' => $userId]);
  $hasOpen = (bool) $open->fetchColumn();
  sendJson(200, true, [
    'status'     => 'Suspended',
    'fullName'   => $u['fullName'],
    'reason'     => $u['rejectionReason'],
    'canAppeal'  => !$hasOpen,
    'openAppeal' => $hasOpen,
  ]);
}

// POST /appeal — PUBLIC. Body: { uid, token, message }. Record the appeal.
function handleSubmitAppeal(PDO $pdo): void {
  $body    = getJsonBody();
  $userId  = trim($body['uid'] ?? '');
  $token   = trim($body['token'] ?? '');
  $message = trim($body['message'] ?? '');

  $u = appealUserForToken($pdo, $userId, $token);
  if (!$u) {
    sendJson(404, false, null, ['code' => 'INVALID_LINK', 'message' => 'This appeal link is invalid or has expired.']);
  }
  if ($u['status'] !== 'Suspended') {
    sendJson(409, false, null, ['code' => 'NOT_SUSPENDED', 'message' => 'This account is not suspended, so there is nothing to appeal.']);
  }
  if ($message === '') {
    sendJson(400, false, null, ['code' => 'VALIDATION', 'message' => 'Please explain your appeal.']);
  }
  if (mb_strlen($message) < 10) {
    sendJson(400, false, null, ['code' => 'VALIDATION', 'message' => 'Please give a bit more detail (at least 10 characters).']);
  }
  if (mb_strlen($message) > 1000) { $message = mb_substr($message, 0, 1000); }

  $open = $pdo->prepare("SELECT 1 FROM account_appeal WHERE userId = :id AND appealStatus = 'Open' LIMIT 1");
  $open->execute(['id' => $userId]);
  if ($open->fetchColumn()) {
    sendJson(409, false, null, ['code' => 'ALREADY_OPEN', 'message' => 'You already have an appeal under review.']);
  }

  $appealId = nextId($pdo, 'account_appeal', 'appealId', 'APL');
  $pdo->prepare('INSERT INTO account_appeal (appealId, userId, message) VALUES (:aid, :uid, :msg)')
      ->execute(['aid' => $appealId, 'uid' => $userId, 'msg' => $message]);

  sendJson(201, true, ['appealId' => $appealId, 'appealStatus' => 'Open',
    'message' => 'Your appeal has been submitted. Our team will review it and email you the outcome.']);
}

// GET /admin/appeals — open appeals with the user + suspension reason.
function handleListAppeals(PDO $pdo): void {
  $stmt = $pdo->query(
    "SELECT a.appealId, a.message, a.created_at,
            u.userId, u.fullName, u.email, u.role, u.rejectionReason AS suspensionReason
       FROM account_appeal a
       JOIN `user` u ON u.userId = a.userId
      WHERE a.appealStatus = 'Open'
      ORDER BY a.created_at ASC"
  );
  sendJson(200, true, ['appeals' => $stmt->fetchAll()]);
}

// POST /admin/appeals/{appealId}/resolve — body { action: 'approve'|'reject', note? }.
// approve → reinstate the account (Active, clear reason + token); reject → keep
// suspended. Either way the appeal is closed and the user is emailed the outcome.
function handleResolveAppeal(PDO $pdo, array $auth, string $appealId, array $config = []): void {
  $body   = getJsonBody();
  $action = trim($body['action'] ?? '');
  $note   = trim($body['note'] ?? '');
  if (mb_strlen($note) > 255) { $note = mb_substr($note, 0, 255); }
  if (!in_array($action, ['approve', 'reject'], true)) {
    sendJson(400, false, null, ['code' => 'VALIDATION', 'message' => 'Unknown action.']);
  }

  $stmt = $pdo->prepare(
    "SELECT a.appealStatus, u.userId, u.email, u.fullName
       FROM account_appeal a JOIN `user` u ON u.userId = a.userId
      WHERE a.appealId = :id"
  );
  $stmt->execute(['id' => $appealId]);
  $row = $stmt->fetch();
  if (!$row) {
    sendJson(404, false, null, ['code' => 'NOT_FOUND', 'message' => 'Appeal not found.']);
  }
  if ($row['appealStatus'] !== 'Open') {
    sendJson(409, false, null, ['code' => 'CONFLICT', 'message' => 'This appeal has already been handled.']);
  }

  $newStatus = $action === 'approve' ? 'Approved' : 'Rejected';
  $pdo->beginTransaction();
  try {
    $pdo->prepare(
      "UPDATE account_appeal SET appealStatus = :st, adminNote = :n, reviewedBy = :by, reviewed_at = NOW() WHERE appealId = :id"
    )->execute(['st' => $newStatus, 'n' => $note !== '' ? $note : null, 'by' => $auth['userId'], 'id' => $appealId]);

    if ($action === 'approve') {
      // reinstate: back to Active, clear the suspension reason + appeal token
      $pdo->prepare("UPDATE `user` SET status = 'Active', rejectionReason = NULL, appealToken = NULL WHERE userId = :id")
          ->execute(['id' => $row['userId']]);
    }
    $pdo->commit();
  } catch (Throwable $e) {
    $pdo->rollBack();
    sendJson(500, false, null, ['code' => 'SERVER', 'message' => 'Could not resolve the appeal.']);
  }

  // Best-effort: email the outcome.
  if (function_exists('mailConfigured') && mailConfigured($config) && function_exists('sendAppealDecisionEmail')) {
    try {
      sendAppealDecisionEmail($config, (string) $row['email'], (string) ($row['fullName'] ?? ''), $action === 'approve', $note);
    } catch (Throwable $e) { /* best-effort */ }
  }

  sendJson(200, true, ['appealId' => $appealId, 'appealStatus' => $newStatus, 'action' => $action]);
}
