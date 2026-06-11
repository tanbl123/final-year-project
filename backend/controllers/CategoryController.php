<?php
// Category endpoints (used to populate the product form's dropdown).

// GET /categories — list all categories.
function handleListCategories(PDO $pdo): void {
  $stmt = $pdo->query('SELECT categoryId AS id, categoryName AS name FROM category ORDER BY categoryName');
  sendJson(200, true, $stmt->fetchAll());
}
