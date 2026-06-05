# ShoeAR — REST API Endpoint Design (v1)

> **What this is:** the contract between the **single MySQL database** and the
> **4 client apps** (Admin web, Supplier web, Customer mobile, Delivery mobile).
> The PHP REST API is the ONLY thing that touches the database. Every app talks
> to these endpoints — never to MySQL directly.
>
> This is a **design/planning document**, not the code. We build the PHP from it
> next. Endpoints map directly onto the tables in `database/schema.sql`.

---

## 1. Conventions (read this first)

### Base URL & versioning
```
http://localhost/shoear/api/v1
```
- All paths below are relative to this base (e.g. `POST /auth/login` =
  `http://localhost/shoear/api/v1/auth/login`).
- `v1` in the path means we can release a `v2` later **without breaking** mobile
  apps already installed on phones.

### Authentication — JWT (Bearer token)
1. App calls `POST /auth/login` with username + password.
2. API checks the hashed password and returns a **JWT** (a signed token holding
   `userId` + `role`).
3. For every protected request, the app sends the token in a header:
   ```
   Authorization: Bearer <token>
   ```
4. The API reads the role from the token to decide if the caller is allowed.

> Why JWT and not PHP sessions? The **mobile** apps (customer + delivery) work
> far more cleanly with a stateless token than with browser cookies. The web
> portals use the same token, so there's one auth system for all 4 apps.

### Who can call what (roles)
Each endpoint lists an **Access** column:
- `Public` — no token needed (browsing the catalog, viewing reviews).
- `Customer`, `Supplier`, `Admin`, `Delivery` — must be logged in with that role.
- `Owner` — must be the user who owns the resource (e.g. your own cart/order).

### Standard response envelope
Every response uses the same shape so apps can parse it the same way:
```json
{ "success": true,  "data": { ... },              "error": null }
{ "success": false, "data": null,  "error": { "code": "VALIDATION", "message": "Email already in use" } }
```

### Standard HTTP status codes
| Code | Meaning |
|------|---------|
| 200 | OK (read/update succeeded) |
| 201 | Created (new resource made) |
| 400 | Bad request (validation failed) |
| 401 | Not logged in / bad token |
| 403 | Logged in but not allowed (wrong role) |
| 404 | Not found |
| 409 | Conflict (e.g. duplicate, or out of stock) |
| 500 | Server error |

### Lists: pagination, filtering, sorting
List endpoints accept query params, e.g.:
```
GET /products?page=1&limit=20&categoryId=CAT0001&search=pegasus&sort=price_asc
```
List responses include paging info:
```json
{ "success": true, "data": { "items": [ ... ], "page": 1, "limit": 20, "total": 137 }, "error": null }
```

---

## 2. AUTH & ACCOUNT  (all apps)

| Method | Path | Access | Purpose |
|--------|------|--------|---------|
| POST | `/auth/register` | Public | Register. Customer → `Active` immediately. Supplier/Delivery → `Pending` (await admin). |
| POST | `/auth/login` | Public | Returns JWT + role + basic profile. |
| POST | `/auth/logout` | Any | Client-side token discard (and optional server token blacklist). |
| GET  | `/auth/me` | Any | Current user's profile (joins role-specific table). |
| PUT  | `/auth/me` | Any | Update own profile (fullName, phone, address, etc.). |
| POST | `/auth/change-password` | Any | Change own password (old + new). |

**`POST /auth/register` request (customer):**
```json
{
  "role": "Customer",
  "username": "alice",
  "password": "PlainTextOverHTTPS",
  "email": "alice@mail.com",
  "fullName": "Alice Tan",
  "phoneNumber": "0123456789",
  "shippingAddress": "12 Jalan Bunga"        // customer-only field
}
```
For `"role": "Supplier"` send `companyName` + `companyAddress` instead; for
`"role": "DeliveryPersonnel"` send `vehicleInfo`. Server hashes the password
(bcrypt/argon2) before storing — never stores plain text.

**`POST /auth/login` response:**
```json
{ "success": true, "data": {
    "token": "eyJhbGciOi...",
    "user": { "userId": "USR0001", "role": "Customer", "fullName": "Alice Tan", "status": "Active" }
}, "error": null }
```

---

## 3. ADMIN — user approval & management  (Admin web)

| Method | Path | Access | Purpose |
|--------|------|--------|---------|
| GET   | `/admin/users` | Admin | List/filter users (`?role=Supplier&status=Pending`). |
| GET   | `/admin/users/{userId}` | Admin | One user's full detail. |
| PATCH | `/admin/users/{userId}/status` | Admin | Approve / reject / suspend. Body: `{ "status": "Active" }`. |

This is how a `Pending` supplier or delivery person becomes `Active`.

---

## 4. CATEGORIES

| Method | Path | Access | Purpose |
|--------|------|--------|---------|
| GET    | `/categories` | Public | List all categories. |
| POST   | `/categories` | Admin | Create category. |
| PUT    | `/categories/{categoryId}` | Admin | Rename category. |
| DELETE | `/categories/{categoryId}` | Admin | Delete (only if no products use it). |

---

## 5. PRODUCTS  (catalog)

### Public / customer browsing
| Method | Path | Access | Purpose |
|--------|------|--------|---------|
| GET | `/products` | Public | List **Approved** products. Filters: `categoryId`, `search`, `minPrice`, `maxPrice`, `sort`, paging. |
| GET | `/products/{productId}` | Public | Full detail: product + images + 3D model + variants(sizes/stock) + avg rating. |
| GET | `/products/{productId}/variants` | Public | Sizes & stock for one product. |
| GET | `/products/{productId}/reviews` | Public | Reviews for one product. |

**`GET /products/{id}` response (shape):**
```json
{ "success": true, "data": {
    "productId": "PRD0001", "productName": "Air Zoom Pegasus",
    "productPrice": 120.00, "productStatus": "Approved", "virtualTryOnEnable": true,
    "category": { "categoryId": "CAT0001", "categoryName": "Running" },
    "images": [ { "productImageId": "IMG0001", "productImageUrl": "https://.../1.jpg" } ],
    "models": [ { "productModelId": "MOD0001", "productModelUrl": "https://.../shoe.glb" } ],
    "variants": [
      { "productVariantId": "VAR0001", "size": "UK8", "stockQuantity": 5 },
      { "productVariantId": "VAR0002", "size": "UK9", "stockQuantity": 1 }
    ],
    "rating": { "average": 4.3, "count": 12 }
}, "error": null }
```
> The `models[].productModelUrl` (`.glb`/`.gltf` in Firebase) is what the
> **customer app's AR module** loads to overlay on the foot.

### Supplier — manage own catalog (Supplier web)
| Method | Path | Access | Purpose |
|--------|------|--------|---------|
| GET    | `/supplier/products` | Supplier | List the logged-in supplier's own products (any status). |
| POST   | `/products` | Supplier | Create product → starts as `Pending`. |
| PUT    | `/products/{productId}` | Supplier(Owner) | Edit own product. |
| DELETE | `/products/{productId}` | Supplier(Owner)/Admin | Soft delete → `Removed`. |
| POST   | `/products/{productId}/variants` | Supplier(Owner) | Add a size + stock. |
| PUT    | `/variants/{productVariantId}` | Supplier(Owner) | Update a size's stock. |
| DELETE | `/variants/{productVariantId}` | Supplier(Owner) | Remove a size. |
| POST   | `/products/{productId}/images` | Supplier(Owner) | Attach an image URL (uploaded to Firebase first). |
| DELETE | `/images/{productImageId}` | Supplier(Owner) | Remove an image. |
| POST   | `/products/{productId}/models` | Supplier(Owner) | Attach a 3D model URL (Firebase). |
| DELETE | `/models/{productModelId}` | Supplier(Owner) | Remove a 3D model. |

### Admin — product moderation (Admin web)
| Method | Path | Access | Purpose |
|--------|------|--------|---------|
| GET   | `/admin/products` | Admin | List/filter all products (e.g. `?status=Pending` = moderation queue). |
| PATCH | `/admin/products/{productId}/status` | Admin | Approve / reject. Body: `{ "status": "Approved" }`. |

---

## 6. CART  (Customer mobile)

| Method | Path | Access | Purpose |
|--------|------|--------|---------|
| GET    | `/cart` | Customer | Current customer's cart + items + computed total. |
| POST   | `/cart/items` | Customer | Add a **variant** (size) to cart. Body: `{ "productVariantId": "VAR0001", "quantity": 1 }`. |
| PUT    | `/cart/items/{cartItemId}` | Customer(Owner) | Change quantity. |
| DELETE | `/cart/items/{cartItemId}` | Customer(Owner) | Remove a line. |
| DELETE | `/cart` | Customer | Empty the whole cart. |

> Cart items reference `productVariantId` (the chosen **size**), matching the
> schema's per-size stock design. Adding the same variant twice updates quantity
> (enforced by `uq_cart_variant`).

---

## 7. WISHLIST  (Customer mobile)

| Method | Path | Access | Purpose |
|--------|------|--------|---------|
| GET    | `/wishlist` | Customer | Current customer's wishlist + items. |
| POST   | `/wishlist/items` | Customer | Add a **product**. Body: `{ "productId": "PRD0001" }`. |
| DELETE | `/wishlist/items/{wishlistItemId}` | Customer(Owner) | Remove an item. |

> Wishlist references `productId` (you wishlist a product, not a size) — matches schema.

---

## 8. ORDERS & CHECKOUT  (Customer mobile + Admin web)

| Method | Path | Access | Purpose |
|--------|------|--------|---------|
| POST  | `/orders` | Customer | Checkout: turn the cart into an order (`Placed`). Snapshots price + size into `order_item`. |
| GET   | `/orders` | Customer | Logged-in customer's own orders. |
| GET   | `/orders/{orderId}` | Customer(Owner)/Admin | Order detail + items + payment + delivery status. |
| GET   | `/admin/orders` | Admin | All orders, filterable by status. |
| PATCH | `/admin/orders/{orderId}/status` | Admin | Manual status change if needed. |

**`POST /orders` request:**
```json
{ "deliveryAddress": "12 Jalan Bunga" }    // items come from the server-side cart
```
**Order lifecycle (orderStatus):**
`Placed → Paid → Processing → Shipped → OutForDelivery → Delivered → Completed`
(or `Cancelled`). Payment success (Section 9) moves `Placed → Paid`; delivery
updates (Section 11) drive the later stages.

> **Important:** stock is **not** decremented at checkout — only at **payment
> success**, using the atomic decrement (see `database/NOTES.md` §3). This avoids
> holding stock for orders that are never paid.

---

## 9. PAYMENT  (Customer mobile)

| Method | Path | Access | Purpose |
|--------|------|--------|---------|
| POST | `/orders/{orderId}/payment` | Customer(Owner) | Start payment. Body: `{ "paymentMethod": "Stripe" }`. Returns gateway client-secret / approval URL. |
| GET  | `/orders/{orderId}/payment` | Customer(Owner)/Admin | Payment status for an order. |
| POST | `/payments/webhook` | Public (gateway-signed) | **Stripe/PayPal calls this**, not an app. On success → run atomic stock decrement, set payment `Successful`, order → `Paid`, create receipt + a `Pending` delivery row. |

> The webhook is the trusted "payment really happened" signal. The
> **atomic stock decrement** (`UPDATE ... WHERE stockQuantity >= :qty`) runs here,
> inside a transaction, so two buyers can't oversell the last pair.

---

## 10. RECEIPT

| Method | Path | Access | Purpose |
|--------|------|--------|---------|
| GET | `/orders/{orderId}/receipt` | Customer(Owner)/Admin | Receipt for a paid order (JSON now; PDF later). |

---

## 11. DELIVERY  (Admin web + Delivery mobile)

| Method | Path | Access | Purpose |
|--------|------|--------|---------|
| GET   | `/admin/deliveries` | Admin | All deliveries, filter by status (`Pending` = needs assigning). |
| POST  | `/admin/deliveries/{deliveryId}/assign` | Admin | Assign a delivery person. Body: `{ "deliveryPersonnelId": "DEL0001" }` → status `Assigned`. |
| GET   | `/delivery/assignments` | Delivery | Deliveries assigned to the logged-in delivery person. |
| GET   | `/deliveries/{deliveryId}` | Delivery(Owner)/Admin | One delivery's detail (address, customer, items). |
| PATCH | `/deliveries/{deliveryId}/status` | Delivery(Owner) | Update: `PickedUp` → `OutForDelivery` → `Delivered`/`Failed`. |
| POST  | `/deliveries/{deliveryId}/verify-otp` | Delivery(Owner) | Confirm hand-off. Body: `{ "otpCode": "1234" }`. On match → `Delivered`, order → `Delivered`. |
| POST  | `/deliveries/{deliveryId}/proof` | Delivery(Owner) | Attach proof-of-delivery photo URL (Firebase). |

> OTP + proof-of-delivery satisfy the delivery app's confirmation requirement.

---

## 12. REVIEWS & RATINGS  (Customer mobile + Admin)

| Method | Path | Access | Purpose |
|--------|------|--------|---------|
| GET    | `/products/{productId}/reviews` | Public | List published reviews for a product. |
| POST   | `/products/{productId}/reviews` | Customer | Leave a review. Body: `{ "ratingScore": 5, "reviewComment": "..." }`. |
| PUT    | `/reviews/{reviewId}` | Customer(Owner) | Edit own review. |
| DELETE | `/reviews/{reviewId}` | Customer(Owner)/Admin | Remove own review. |
| PATCH  | `/admin/reviews/{reviewId}/status` | Admin | Moderate (set `Removed`). |

> Rules from the schema: one review per (customer, product); rating must be 1–5.
> Recommended business rule: only customers who **purchased** the product may review.

---

## 13. REFUNDS  (Customer mobile + Admin web)

| Method | Path | Access | Purpose |
|--------|------|--------|---------|
| POST  | `/orders/{orderId}/refund` | Customer(Owner) | Request refund. Body: `{ "refundReason": "...", "refundAmount": 120.00, "refundProof": "https://.../proof.jpg" }`. |
| GET   | `/refunds` | Customer/Admin | Customer sees own; admin sees all (filter by status). |
| GET   | `/refunds/{refundId}` | Customer(Owner)/Admin | One refund's detail. |
| PATCH | `/admin/refunds/{refundId}/status` | Admin | Approve / reject / complete. On `Completed` → payment becomes `Refunded`. |

---

## 14. COMMISSION  (Admin web)

| Method | Path | Access | Purpose |
|--------|------|--------|---------|
| GET  | `/admin/commission` | Admin | Current active commission rate. |
| GET  | `/admin/commission/history` | Admin | All rate changes over time. |
| POST | `/admin/commission` | Admin | Set a new rate. Body: `{ "commissionRateValue": 10.00, "effectiveDate": "2026-07-01" }` (deactivates the old one). |

---

## 15. REPORTS  (Admin web + Supplier web)

| Method | Path | Access | Purpose |
|--------|------|--------|---------|
| GET | `/admin/reports/sales` | Admin | Platform sales + commission earned, date-range filter. |
| GET | `/supplier/reports/sales` | Supplier | The logged-in supplier's own sales summary. |

> These rely on the `created_at` / `updated_at` columns and the order/payment
> tables — the reason those audit columns were added to the schema.

---

## 16. ML RECOMMENDATIONS & INTERACTION LOGGING  (Customer mobile)

> Designed now as the **contract**; the underlying table + model come in the ML
> increment (noted as deferred in `database/NOTES.md` §5).

| Method | Path | Access | Purpose |
|--------|------|--------|---------|
| GET  | `/recommendations` | Customer | Personalised product list for the logged-in customer. |
| GET  | `/products/{productId}/similar` | Public | "You may also like" — similar products. |
| POST | `/interactions` | Customer | Log a view/click/add-to-cart event to train the recommender. Body: `{ "productId": "PRD0001", "type": "view" }`. |

---

## 17. Build order (suggested)

A practical order to implement these in PHP, so each app can be built on a
working API:

1. **Auth** (register/login/JWT/me) — everything else needs it.
2. **Categories + Products + Variants + Images/Models** — populates the catalog.
3. **Admin** user-approval & product-moderation — unblocks suppliers/customers.
4. **Cart + Wishlist** — customer shopping.
5. **Orders + Payment (+ webhook, atomic stock decrement) + Receipt** — checkout.
6. **Delivery** — assignment + status + OTP/proof.
7. **Reviews + Refunds** — post-purchase.
8. **Commission + Reports** — admin/supplier analytics.
9. **ML recommendations + interaction logging** — final increment.

> Mirrors the HANDOFF "Next steps": build the **Admin/Supplier web portals first**
> (steps 1–3) because they fill the catalog the customer + delivery apps depend on.
