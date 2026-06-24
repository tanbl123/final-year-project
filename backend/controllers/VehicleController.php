<?php
require_once __DIR__ . '/../lib/response.php';

// How many days before cached NHTSA data is considered stale and replaced.
const VEHICLE_CACHE_TTL_DAYS = 30;

// ── Helpers ───────────────────────────────────────────────────────────────────

function _nhtsaType(string $vehicleType): string {
    return match ($vehicleType) {
        'Motorcycle'   => 'motorcycle',
        'Car'          => 'car',
        'Van', 'Truck' => 'truck',
        default        => 'car',
    };
}

// Pull the named field from every NHTSA Results row.
// Returns a sorted, deduplicated list, or null on network/parse failure.
function _nhtsaFetch(string $url, string $field): ?array {
    $ctx = stream_context_create(['http' => [
        'timeout' => 25,
        'header'  => "User-Agent: ShoeARExpress/1.0\r\nAccept: application/json\r\n",
    ]]);
    $raw = @file_get_contents($url, false, $ctx);
    if ($raw === false) return null;
    $body = json_decode($raw, true);
    if (!is_array($body['Results'] ?? null)) return null;
    $names = array_values(array_unique(array_filter(
        array_map(fn($r) => trim($r[$field] ?? ''), $body['Results'])
    )));
    sort($names);
    return $names;
}

// True if the cache key has never been set or is older than VEHICLE_CACHE_TTL_DAYS.
function _isCacheStale(PDO $pdo, string $key): bool {
    $stmt = $pdo->prepare(
        'SELECT DATEDIFF(NOW(), cachedAt) FROM vehicle_cache_log WHERE cacheKey = ?'
    );
    $stmt->execute([$key]);
    $days = $stmt->fetchColumn();
    return $days === false || (int)$days >= VEHICLE_CACHE_TTL_DAYS;
}

function _touchCache(PDO $pdo, string $key): void {
    $pdo->prepare(
        'INSERT INTO vehicle_cache_log (cacheKey, cachedAt) VALUES (?, NOW())
         ON DUPLICATE KEY UPDATE cachedAt = NOW()'
    )->execute([$key]);
}

// Replace all NHTSA-sourced makes for a vehicle type.
// Rows with source='local' (Malaysian brands) are never touched.
function _replaceMakesFromNhtsa(PDO $pdo, string $vehicleType, string $cacheKey): void {
    $nhtsaType = _nhtsaType($vehicleType);
    $url = "https://vpic.nhtsa.dot.gov/api/vehicles/GetMakesForVehicleType/{$nhtsaType}?format=json";
    $fetched = _nhtsaFetch($url, 'MakeName');
    if ($fetched === null) return;

    // Delete stale NHTSA rows, keep local (Malaysian) rows untouched.
    $pdo->prepare('DELETE FROM vehicle_makes WHERE vehicleType = ? AND source = ?')
        ->execute([$vehicleType, 'nhtsa']);

    $ins = $pdo->prepare(
        'INSERT IGNORE INTO vehicle_makes (vehicleType, makeName, source) VALUES (?, ?, ?)'
    );
    foreach ($fetched as $name) $ins->execute([$vehicleType, $name, 'nhtsa']);
    _touchCache($pdo, $cacheKey);
}

// Replace all NHTSA-sourced models for a specific make.
// Rows with source='local' are never touched.
function _replaceModelsFromNhtsa(PDO $pdo, string $vehicleType, string $make, string $cacheKey): void {
    $url = "https://vpic.nhtsa.dot.gov/api/vehicles/GetModelsForMake/"
         . urlencode($make) . "?format=json";
    $fetched = _nhtsaFetch($url, 'Model_Name');
    if ($fetched === null || count($fetched) === 0) return;

    // Delete stale NHTSA models for this make, keep local ones.
    $pdo->prepare(
        'DELETE FROM vehicle_models WHERE vehicleType = ? AND makeName = ? AND source = ?'
    )->execute([$vehicleType, $make, 'nhtsa']);

    $ins = $pdo->prepare(
        'INSERT IGNORE INTO vehicle_models (vehicleType, makeName, modelName, source) VALUES (?, ?, ?, ?)'
    );
    foreach ($fetched as $name) $ins->execute([$vehicleType, $make, $name, 'nhtsa']);
    _touchCache($pdo, $cacheKey);
}

// Send the JSON response to the client and disconnect so background work can
// continue without making the user wait.
function _sendAndDetach(mixed $data): void {
    $body = json_encode(['success' => true, 'data' => $data, 'error' => null]);
    header('Content-Type: application/json');
    header('Content-Length: ' . strlen($body));
    header('Connection: close');
    echo $body;

    if (function_exists('fastcgi_finish_request')) {
        fastcgi_finish_request();
    } else {
        ignore_user_abort(true);
        while (ob_get_level() > 0) ob_end_flush();
        flush();
    }
}

// Normalize a make name for display. NHTSA returns makes in ALL CAPS
// ("WHIZZER", "HONDA") while models come back title-cased ("Whizzer"), which
// looks inconsistent in the picker. Title-case each word, but keep vowel-less
// tokens uppercase so acronym brands stay intact (BMW, KTM, SYM, TVS, GMC).
function _normalizeMakeName(string $name): string {
    $words = preg_split('/\s+/', trim($name));
    $out = [];
    foreach ($words as $w) {
        if ($w === '') continue;
        if (!preg_match('/[AEIOUaeiou]/', $w)) {
            $out[] = strtoupper($w);            // BMW, KTM, SYM …
        } else {
            // Title-case each alphabetic run (handles hyphens: Harley-Davidson)
            $out[] = preg_replace_callback(
                '/[A-Za-z]+/',
                fn($m) => ucfirst(strtolower($m[0])),
                $w
            );
        }
    }
    return implode(' ', $out);
}

// Normalize + dedupe a list of make names, then re-sort A–Z.
function _normalizeMakeList(array $makes): array {
    $seen = [];
    foreach ($makes as $m) {
        $norm = _normalizeMakeName((string) $m);
        $seen[$norm] = true;          // keyed dedupe (case-folded by normalization)
    }
    $list = array_keys($seen);
    sort($list);
    return $list;
}

// ── Route handlers ────────────────────────────────────────────────────────────

// GET /vehicles/makes/{vehicleType}
// Always returns from DB immediately. If the NHTSA cache is stale the old
// nhtsa rows are deleted and fresh ones inserted in the background — local
// (Malaysian) rows are never affected.
function handleGetVehicleMakes(PDO $pdo, string $vehicleType): void {
    $allowed = ['Motorcycle', 'Car', 'Van', 'Truck'];
    if (!in_array($vehicleType, $allowed, true)) {
        sendJson(400, false, null, ['code' => 'VALIDATION', 'message' => 'Unknown vehicle type.']);
        return;
    }

    $stmt = $pdo->prepare(
        'SELECT makeName FROM vehicle_makes WHERE vehicleType = ? ORDER BY makeName'
    );
    $stmt->execute([$vehicleType]);
    $makes = $stmt->fetchAll(PDO::FETCH_COLUMN);
    $cacheKey = 'makes_' . $vehicleType;

    // Fetch from NHTSA synchronously when no NHTSA rows exist yet (only local
    // seeds are present) or when the 30-day cache has expired. Background detach
    // is unreliable on Apache/XAMPP, so we do it inline and accept the one-time
    // latency (once every 30 days at most).
    $nhtsaCheck = $pdo->prepare(
        'SELECT 1 FROM vehicle_makes WHERE vehicleType = ? AND source = ? LIMIT 1'
    );
    $nhtsaCheck->execute([$vehicleType, 'nhtsa']);
    $hasNhtsa = (bool) $nhtsaCheck->fetch();

    if (!$hasNhtsa || _isCacheStale($pdo, $cacheKey)) {
        _replaceMakesFromNhtsa($pdo, $vehicleType, $cacheKey);
        $stmt->execute([$vehicleType]);
        $makes = $stmt->fetchAll(PDO::FETCH_COLUMN);
    }

    sendJson(200, true, _normalizeMakeList($makes));
}

// GET /vehicles/models/{vehicleType}/{make}
// Same pattern: serve from DB instantly, replace stale NHTSA rows in background.
function handleGetVehicleModels(PDO $pdo, string $vehicleType, string $make): void {
    $allowed = ['Motorcycle', 'Car', 'Van', 'Truck'];
    if (!in_array($vehicleType, $allowed, true)) {
        sendJson(400, false, null, ['code' => 'VALIDATION', 'message' => 'Unknown vehicle type.']);
        return;
    }

    $stmt = $pdo->prepare(
        'SELECT modelName FROM vehicle_models WHERE vehicleType = ? AND makeName = ? ORDER BY modelName'
    );
    $stmt->execute([$vehicleType, $make]);
    $models = $stmt->fetchAll(PDO::FETCH_COLUMN);
    $cacheKey = 'models_' . $vehicleType . '_' . $make;

    // Same synchronous-refresh approach as makes — background detach is
    // unreliable on Apache/XAMPP.
    $nhtsaCheck = $pdo->prepare(
        'SELECT 1 FROM vehicle_models WHERE vehicleType = ? AND makeName = ? AND source = ? LIMIT 1'
    );
    $nhtsaCheck->execute([$vehicleType, $make, 'nhtsa']);
    $hasNhtsa = (bool) $nhtsaCheck->fetch();

    if (empty($models) || !$hasNhtsa || _isCacheStale($pdo, $cacheKey)) {
        _replaceModelsFromNhtsa($pdo, $vehicleType, $make, $cacheKey);
        $stmt->execute([$vehicleType, $make]);
        $models = $stmt->fetchAll(PDO::FETCH_COLUMN);
    }

    // Empty list is valid — VehiclePicker falls back to free-text entry.
    sendJson(200, true, array_values($models));
}
