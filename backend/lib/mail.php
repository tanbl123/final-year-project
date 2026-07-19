<?php
// Minimal SMTP mailer (no Composer). Sends an email through an authenticated
// SMTP server (e.g. Gmail) using the credentials in config['smtp']. Throws
// RuntimeException on any failure. Mirrors lib/stripe.php's "tiny hand-rolled
// client" style — we talk the SMTP protocol directly over a socket.
//
// NOTE: requires outbound network access to the SMTP host and valid credentials
// in config (set them in config.local.php — see config.local.example.php). With
// nothing configured, mailConfigured() returns false and callers respond with
// MAIL_NOT_CONFIGURED.

// Do we have everything we need to send mail?
function mailConfigured(array $config): bool {
  $s = $config['smtp'] ?? [];
  return !empty($s['host']) && !empty($s['username'])
      && !empty($s['password']) && !empty($s['from']);
}

// Read one full SMTP reply (handles multi-line replies: a line with a '-' after
// the 3-digit code continues; a space after the code marks the final line).
function smtpRead($fp): string {
  $data = '';
  while (($line = fgets($fp, 515)) !== false) {
    $data .= $line;
    if (isset($line[3]) && $line[3] === ' ') break;
  }
  return $data;
}

// Send a command (if any) and assert the reply code is one we expect.
function smtpCmd($fp, string $cmd, array $expect): string {
  if ($cmd !== '') fwrite($fp, $cmd . "\r\n");
  $resp = smtpRead($fp);
  $code = (int) substr($resp, 0, 3);
  if (!in_array($code, $expect, true)) {
    throw new RuntimeException('SMTP error: ' . trim($resp));
  }
  return $resp;
}

// RFC 2047-encode a header value only when it contains non-ASCII (so plain
// ASCII subjects/names stay human-readable on the wire).
function mimeHeader(string $text): string {
  if (preg_match('/[^\x20-\x7E]/', $text)) {
    return '=?UTF-8?B?' . base64_encode($text) . '?=';
  }
  return $text;
}

// Send a plain-text (optionally + HTML) email. Returns nothing; throws on error.
function sendMail(array $config, string $toEmail, string $toName,
                  string $subject, string $textBody, string $htmlBody = ''): void {
  if (!mailConfigured($config)) {
    throw new RuntimeException('Email is not configured on the server.');
  }
  $s       = $config['smtp'];
  $host    = $s['host'];
  $port    = (int) ($s['port'] ?? 587);
  $secure  = strtolower($s['secure'] ?? 'tls');   // 'tls' = STARTTLS (587); 'ssl' = implicit TLS (465)
  $ehlo    = $s['ehlo'] ?? 'localhost';
  $timeout = 30;

  // implicit-TLS connects over ssl:// from the start; STARTTLS upgrades later
  $remote = ($secure === 'ssl') ? "ssl://$host" : $host;
  $fp = @fsockopen($remote, $port, $errno, $errstr, $timeout);
  if (!$fp) {
    throw new RuntimeException("Could not connect to the SMTP server ($host:$port): $errstr");
  }
  stream_set_timeout($fp, $timeout);

  try {
    smtpCmd($fp, '', [220]);                       // server greeting
    smtpCmd($fp, "EHLO $ehlo", [250]);

    if ($secure === 'tls') {
      smtpCmd($fp, 'STARTTLS', [220]);
      if (!stream_socket_enable_crypto($fp, true, STREAM_CRYPTO_METHOD_TLS_CLIENT)) {
        throw new RuntimeException('Failed to start TLS with the SMTP server.');
      }
      smtpCmd($fp, "EHLO $ehlo", [250]);           // re-introduce ourselves over TLS
    }

    // AUTH LOGIN: username then password, each base64-encoded
    smtpCmd($fp, 'AUTH LOGIN', [334]);
    smtpCmd($fp, base64_encode($s['username']), [334]);
    smtpCmd($fp, base64_encode($s['password']), [235]);

    $fromEmail = $s['from'];
    $fromName  = $s['from_name'] ?? 'ShoeAR';
    smtpCmd($fp, "MAIL FROM:<$fromEmail>", [250]);
    smtpCmd($fp, "RCPT TO:<$toEmail>", [250, 251]);
    smtpCmd($fp, 'DATA', [354]);

    // ── build the MIME message ──
    $headers   = [];
    $headers[] = 'From: ' . mimeHeader($fromName) . " <$fromEmail>";
    $headers[] = 'To: ' . ($toName !== '' ? mimeHeader($toName) . " <$toEmail>" : "<$toEmail>");
    $headers[] = 'Subject: ' . mimeHeader($subject);
    $headers[] = 'Date: ' . date('r');
    $headers[] = 'MIME-Version: 1.0';

    if ($htmlBody !== '') {
      $boundary  = 'b' . bin2hex(random_bytes(8));
      $headers[] = "Content-Type: multipart/alternative; boundary=\"$boundary\"";
      $body  = "--$boundary\r\n";
      $body .= "Content-Type: text/plain; charset=UTF-8\r\n";
      $body .= "Content-Transfer-Encoding: 8bit\r\n\r\n";
      $body .= $textBody . "\r\n\r\n";
      $body .= "--$boundary\r\n";
      $body .= "Content-Type: text/html; charset=UTF-8\r\n";
      $body .= "Content-Transfer-Encoding: 8bit\r\n\r\n";
      $body .= $htmlBody . "\r\n\r\n";
      $body .= "--$boundary--";
    } else {
      $headers[] = 'Content-Type: text/plain; charset=UTF-8';
      $headers[] = 'Content-Transfer-Encoding: 8bit';
      $body = $textBody;
    }

    // normalise to CRLF, then dot-stuff lines that begin with '.'
    $message = implode("\r\n", $headers) . "\r\n\r\n" . $body;
    $message = preg_replace('/\r\n|\r|\n/', "\r\n", $message);
    $message = preg_replace('/^\./m', '..', $message);

    smtpCmd($fp, $message . "\r\n.", [250]);        // end-of-data is a lone '.'
    smtpCmd($fp, 'QUIT', [221]);
  } finally {
    fclose($fp);
  }
}

// Compose + send the registration verification-code email. Keeps the message
// copy in one place so both the controller and any future re-use stay tidy.
function sendVerificationCodeEmail(array $config, string $toEmail, string $code, int $ttlMinutes): void {
  $subject = 'Your ShoeAR verification code';
  $text =
    "Welcome to ShoeAR.\n\n" .
    "Your supplier registration verification code is: $code\n\n" .
    "Enter this code to finish creating your account. " .
    "It expires in $ttlMinutes minutes.\n\n" .
    "If you didn't request this, you can ignore this email.";
  $safeCode = htmlspecialchars($code, ENT_QUOTES);
  $html =
    '<div style="font-family:Arial,Helvetica,sans-serif;max-width:480px;margin:auto">' .
    '<h2 style="margin:0 0 12px">👟 ShoeAR</h2>' .
    '<p>Welcome! Use this code to finish your supplier registration:</p>' .
    '<p style="font-size:32px;font-weight:bold;letter-spacing:6px;margin:16px 0">' . $safeCode . '</p>' .
    "<p style=\"color:#666\">It expires in $ttlMinutes minutes. " .
    'If you didn\'t request this, you can ignore this email.</p>' .
    '</div>';
  sendMail($config, $toEmail, '', $subject, $text, $html);
}

// Tell a courier applicant the admin's decision on their application.
// Wrap a decision letter's body paragraphs in a formal letterhead layout:
// brand letterhead, "Dear <name>," salutation, the body, a "Yours sincerely"
// signature, and an automated-message footer.
function formalLetterHtml(string $name, string $bodyHtml, string $brand): string {
  return '<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:auto;color:#1f2430;line-height:1.6;font-size:15px">'
       . '<div style="border-bottom:2px solid #4f46e5;padding-bottom:12px;margin-bottom:22px">'
       .   '<span style="font-size:20px;font-weight:bold;color:#4f46e5">' . $brand . '</span>'
       . '</div>'
       . '<p>Dear ' . htmlspecialchars($name, ENT_QUOTES) . ',</p>'
       . $bodyHtml
       . '<p style="margin-top:26px">Yours sincerely,<br><strong>The ShoeAR Team</strong></p>'
       . '<hr style="border:none;border-top:1px solid #eceef3;margin:24px 0 12px">'
       . '<p style="font-size:12px;color:#9096a2">This is an automated message from ShoeAR. Please do not reply to this email.</p>'
       . '</div>';
}

// $status is 'Active' (approved), 'Rejected' (fixable) or 'Banned' (final).
function sendCourierDecisionEmail(array $config, string $toEmail, string $fullName, string $status, ?string $reason): void {
  $name      = $fullName !== '' ? $fullName : 'Applicant';
  $reasonTxt = ($reason !== null && $reason !== '') ? $reason : '';

  if ($status === 'Active') {
    $subject  = 'ShoeAR Courier Application — Approved';
    $textBody = "We are pleased to inform you that your application to become a delivery partner with ShoeAR has been reviewed and approved.\n\n"
              . "Please open the ShoeAR Express app and sign in to complete your payout (bank) account setup, after which you may begin accepting deliveries.\n\n"
              . "Should you have any questions, please contact our support team.";
    $bodyHtml = '<p>We are pleased to inform you that your application to become a delivery partner with ShoeAR has been reviewed and <strong>approved</strong>.</p>'
              . '<p>Please open the ShoeAR Express app and sign in to complete your payout (bank) account setup, after which you may begin accepting deliveries.</p>'
              . '<p>Should you have any questions, please contact our support team.</p>';
  } elseif ($status === 'Rejected') {
    $subject  = 'ShoeAR Courier Application — Action Required';
    $textBody = "Thank you for your application to become a delivery partner with ShoeAR. After reviewing your submission, we are unable to approve it in its current form.\n\n"
              . ($reasonTxt !== '' ? "Reason: $reasonTxt\n\n" : '')
              . "Please sign in to the ShoeAR Express app to update the required details and resubmit your application for review.\n\n"
              . "We appreciate your interest and look forward to receiving your updated application.";
    $bodyHtml = '<p>Thank you for your application to become a delivery partner with ShoeAR. After reviewing your submission, we are unable to approve it in its current form.</p>'
              . ($reasonTxt !== '' ? '<p><strong>Reason:</strong> ' . htmlspecialchars($reasonTxt, ENT_QUOTES) . '</p>' : '')
              . '<p>Please sign in to the ShoeAR Express app to update the required details and <strong>resubmit</strong> your application for review.</p>'
              . '<p>We appreciate your interest and look forward to receiving your updated application.</p>';
  } else { // Banned
    $subject  = 'ShoeAR Courier Application — Decision';
    $textBody = "Thank you for your interest in becoming a delivery partner with ShoeAR. After careful review, we regret to inform you that your application has not been successful and cannot be resubmitted.\n\n"
              . ($reasonTxt !== '' ? "Reason: $reasonTxt\n\n" : '')
              . "We appreciate the time you took to apply.";
    $bodyHtml = '<p>Thank you for your interest in becoming a delivery partner with ShoeAR. After careful review, we regret to inform you that your application has <strong>not been successful</strong> and cannot be resubmitted.</p>'
              . ($reasonTxt !== '' ? '<p><strong>Reason:</strong> ' . htmlspecialchars($reasonTxt, ENT_QUOTES) . '</p>' : '')
              . '<p>We appreciate the time you took to apply.</p>';
  }

  $text = "Dear $name,\n\n$textBody\n\nYours sincerely,\nThe ShoeAR Team";
  $html = formalLetterHtml($name, $bodyHtml, '🛵 ShoeAR Express');
  sendMail($config, $toEmail, $fullName, $subject, $text, $html);
}

// Tell a supplier applicant the admin's decision on their application.
// $status is 'Active' (approved), 'Rejected' (fixable) or 'Banned' (final).
// Formal notice to a supplier when the admin rejects one of their products,
// naming the product and the reason so they can fix it and resubmit.
function sendProductDecisionEmail(array $config, string $toEmail, string $companyName, string $productName, ?string $reason): void {
  $name      = $companyName !== '' ? $companyName : 'Supplier';
  $product   = $productName !== '' ? $productName : 'your product';
  $reasonTxt = ($reason !== null && $reason !== '') ? $reason : '';

  $subject  = 'ShoeAR Product Submission — Action Required';
  $textBody = "Thank you for submitting \"$product\" to the ShoeAR platform. After reviewing it, we are unable to approve it in its current form, so it will not be listed.\n\n"
            . ($reasonTxt !== '' ? "Reason: $reasonTxt\n\n" : '')
            . "Please sign in to the ShoeAR Supplier Portal to update the product and resubmit it for review.\n\n"
            . "If you have any questions, please contact our support team.";
  $bodyHtml = '<p>Thank you for submitting <strong>' . htmlspecialchars($product, ENT_QUOTES) . '</strong> to the ShoeAR platform. After reviewing it, we are unable to approve it in its current form, so it will not be listed.</p>'
            . ($reasonTxt !== '' ? '<p><strong>Reason:</strong> ' . htmlspecialchars($reasonTxt, ENT_QUOTES) . '</p>' : '')
            . '<p>Please sign in to the ShoeAR Supplier Portal to update the product and <strong>resubmit</strong> it for review.</p>'
            . '<p>If you have any questions, please contact our support team.</p>';

  $text = "Dear $name,\n\n$textBody\n\nYours sincerely,\nThe ShoeAR Team";
  $html = formalLetterHtml($name, $bodyHtml, '👟 ShoeAR');
  sendMail($config, $toEmail, $companyName, $subject, $text, $html);
}

function sendSupplierDecisionEmail(array $config, string $toEmail, string $companyName, string $status, ?string $reason): void {
  $name      = $companyName !== '' ? $companyName : 'Applicant';
  $reasonTxt = ($reason !== null && $reason !== '') ? $reason : '';

  if ($status === 'Active') {
    $subject  = 'ShoeAR Supplier Application — Approved';
    $textBody = "We are pleased to inform you that your application to become a supplier on the ShoeAR platform has been reviewed and approved.\n\n"
              . "You may now sign in to the ShoeAR Supplier Portal to complete your payout setup, list your products, and begin selling.\n\n"
              . "Should you have any questions, please contact our support team.";
    $bodyHtml = '<p>We are pleased to inform you that your application to become a supplier on the ShoeAR platform has been reviewed and <strong>approved</strong>.</p>'
              . '<p>You may now sign in to the ShoeAR Supplier Portal to complete your payout setup, list your products, and begin selling.</p>'
              . '<p>Should you have any questions, please contact our support team.</p>';
  } elseif ($status === 'Rejected') {
    $subject  = 'ShoeAR Supplier Application — Action Required';
    $textBody = "Thank you for your application to become a supplier on the ShoeAR platform. After reviewing your submission, we are unable to approve it in its current form.\n\n"
              . ($reasonTxt !== '' ? "Reason: $reasonTxt\n\n" : '')
              . "Please sign in to the ShoeAR Supplier Portal to update the required details and resubmit your application for review.\n\n"
              . "We appreciate your interest and look forward to receiving your updated application.";
    $bodyHtml = '<p>Thank you for your application to become a supplier on the ShoeAR platform. After reviewing your submission, we are unable to approve it in its current form.</p>'
              . ($reasonTxt !== '' ? '<p><strong>Reason:</strong> ' . htmlspecialchars($reasonTxt, ENT_QUOTES) . '</p>' : '')
              . '<p>Please sign in to the ShoeAR Supplier Portal to update the required details and <strong>resubmit</strong> your application for review.</p>'
              . '<p>We appreciate your interest and look forward to receiving your updated application.</p>';
  } else { // Banned
    $subject  = 'ShoeAR Supplier Application — Decision';
    $textBody = "Thank you for your interest in becoming a supplier on the ShoeAR platform. After careful review, we regret to inform you that your application has not been successful and cannot be resubmitted.\n\n"
              . ($reasonTxt !== '' ? "Reason: $reasonTxt\n\n" : '')
              . "We appreciate the time you took to apply.";
    $bodyHtml = '<p>Thank you for your interest in becoming a supplier on the ShoeAR platform. After careful review, we regret to inform you that your application has <strong>not been successful</strong> and cannot be resubmitted.</p>'
              . ($reasonTxt !== '' ? '<p><strong>Reason:</strong> ' . htmlspecialchars($reasonTxt, ENT_QUOTES) . '</p>' : '')
              . '<p>We appreciate the time you took to apply.</p>';
  }

  $text = "Dear $name,\n\n$textBody\n\nYours sincerely,\nThe ShoeAR Team";
  $html = formalLetterHtml($name, $bodyHtml, '👟 ShoeAR');
  sendMail($config, $toEmail, $companyName, $subject, $text, $html);
}

// Compose + send the "forgot password" reset-code email.
function sendPasswordResetCodeEmail(array $config, string $toEmail, string $code, int $ttlMinutes): void {
  $subject = 'Your ShoeAR password reset code';
  $text =
    "We received a request to reset your ShoeAR password.\n\n" .
    "Your password reset code is: $code\n\n" .
    "Enter this code to choose a new password. It expires in $ttlMinutes minutes.\n\n" .
    "If you didn't request this, you can ignore this email — your password won't change.";
  $safeCode = htmlspecialchars($code, ENT_QUOTES);
  $html =
    '<div style="font-family:Arial,Helvetica,sans-serif;max-width:480px;margin:auto">' .
    '<h2 style="margin:0 0 12px">👟 ShoeAR</h2>' .
    '<p>We received a request to reset your password. Use this code to continue:</p>' .
    '<p style="font-size:32px;font-weight:bold;letter-spacing:6px;margin:16px 0">' . $safeCode . '</p>' .
    "<p style=\"color:#666\">It expires in $ttlMinutes minutes. If you didn't request this, " .
    'you can ignore this email — your password won\'t change.</p>' .
    '</div>';
  sendMail($config, $toEmail, '', $subject, $text, $html);
}

// Sent when someone tries to REGISTER with an email that already has an
// account. We never tell the browser the email exists (anti-enumeration); the
// heads-up goes only to the real inbox owner.
function sendAccountExistsEmail(array $config, string $toEmail): void {
  $subject = 'You already have a ShoeAR account';
  $text =
    "Someone tried to register a ShoeAR supplier account using this email, but " .
    "you already have an account.\n\n" .
    "If this was you, just log in. If you forgot your password, use " .
    "\"Forgot password\" on the login page to reset it.\n\n" .
    "If this wasn't you, you can safely ignore this email.";
  $html =
    '<div style="font-family:Arial,Helvetica,sans-serif;max-width:480px;margin:auto">' .
    '<h2 style="margin:0 0 12px">👟 ShoeAR</h2>' .
    '<p>Someone tried to register a supplier account using this email, but you ' .
    'already have a ShoeAR account.</p>' .
    '<p>If this was you, just <strong>log in</strong> — or use ' .
    '<strong>"Forgot password"</strong> if you need to reset it.</p>' .
    '<p style="color:#666">If this wasn\'t you, you can safely ignore this email.</p>' .
    '</div>';
  sendMail($config, $toEmail, '', $subject, $text, $html);
}
