<?php
/**
 * PAT (Pokemon-Attack-Tool) - Data API
 * -----------------------
 * Returns all data in a SINGLE response (approx. 60 KB gzip) so that the search
 * runs entirely in the browser—with no wait time between keystrokes.
 
* Format identical to assets/data/pokedex.js (fallback).
 *
 * Access data: Copy config.sample.php to config.php and fill it out.
 */
declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');
header('X-Content-Type-Options: nosniff');

$configFile = __DIR__ . '/config.php';
if (!is_file($configFile)) {
    http_response_code(503);
    echo json_encode(['error' => 'config.php fehlt']);
    exit;
}
$config = require $configFile;

try {
    $pdo = new PDO(
        sprintf('mysql:host=%s;port=%d;dbname=%s;charset=utf8mb4',
            $config['host'], (int)($config['port'] ?? 3306), $config['database']),
        $config['user'],
        $config['password'],
        [
            PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        ]
    );

    // ---- Languages
    $languages = [];
    foreach ($pdo->query('SELECT code, native_name FROM languages ORDER BY sort_order') as $r) {
        $languages[] = ['code' => $r['code'], 'name' => $r['native_name']];
    }

    // ---- Types
    $types = [];      // id -> {id: slug, color, n}
    $slugById = [];
    foreach ($pdo->query('SELECT id, slug, color FROM types ORDER BY sort_order') as $r) {
        $slugById[(int)$r['id']] = $r['slug'];
        $types[(int)$r['id']] = ['id' => $r['slug'], 'color' => $r['color'], 'n' => new stdClass()];
    }
    foreach ($pdo->query('SELECT type_id, lang_code, name FROM type_names') as $r) {
        $types[(int)$r['type_id']]['n']->{$r['lang_code']} = $r['name'];
    }

    // ---- Type chart as a matrix [Attacker][Defender] in type order
    $index = array_flip(array_keys($types));
    $size  = count($types);
    $chart = array_fill(0, $size, array_fill(0, $size, 100));
    foreach ($pdo->query('SELECT attacking_type_id a, defending_type_id d, factor_percent f FROM type_efficacy') as $r) {
        $chart[$index[(int)$r['a']]][$index[(int)$r['d']]] = (int)$r['f'];
    }

    // ---- Pokémon
    $pokemon = [];
    foreach ($pdo->query('SELECT id, dex_no, type1_id, type2_id FROM pokemon ORDER BY sort_order') as $r) {
        $t = [$slugById[(int)$r['type1_id']]];
        if ($r['type2_id'] !== null) {
            $t[] = $slugById[(int)$r['type2_id']];
        }
        $pokemon[(int)$r['id']] = ['id' => (int)$r['id'], 'no' => (int)$r['dex_no'], 't' => $t, 'n' => new stdClass()];
    }
    foreach ($pdo->query('SELECT pokemon_id, lang_code, name FROM pokemon_names') as $r) {
        if (isset($pokemon[(int)$r['pokemon_id']])) {
            $pokemon[(int)$r['pokemon_id']]['n']->{$r['lang_code']} = $r['name'];
        }
    }
    foreach ($pdo->query('SELECT pokemon_id, alias FROM pokemon_aliases ORDER BY pokemon_id, label') as $r) {
        $id = (int)$r['pokemon_id'];
        if (isset($pokemon[$id]) && !in_array($r['alias'], $pokemon[$id]['a'] ?? [], true)) {
            $pokemon[$id]['a'][] = $r['alias'];
        }
    }

    $payload = json_encode([
        'version'   => count($pokemon),
        'languages' => $languages,
        'types'     => array_values($types),
        'chart'     => $chart,
        'pokemon'   => array_values($pokemon),
    ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);

    // ---- Caching: The browser only checks to see if anything has changed
    $etag = '"' . md5($payload) . '"';
    header('ETag: ' . $etag);
    header('Cache-Control: public, max-age=3600');
    if (trim($_SERVER['HTTP_IF_NONE_MATCH'] ?? '') === $etag) {
        http_response_code(304);
        exit;
    }
    echo $payload;
} catch (Throwable $e) {
    http_response_code(500);
    error_log('PAT (Pokemon-Attack-Tool) API: ' . $e->getMessage());
    echo json_encode(['error' => 'Datenbankfehler']);
}
