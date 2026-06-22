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
| POST | `/auth/register/send-code` | Public | **(Implemented)** Email a 6-digit verification code before the account is created. Always returns a generic success (no account enumeration); if the email already exists it gets an "account exists" notice instead of a code. Requires SMTP. |
| POST | `/auth/register` | Public | **(Implemented, supplier)** Register. Supplier → `Pending` (await admin); requires a valid `verificationCode`. Customer/Delivery register on their mobile apps. |
| POST | `/auth/register/customer` | Public | **(Implemented)** Customer self-service sign-up (mobile). `Active` immediately, no approval. |
| POST | `/auth/register/courier` | Public | **(Implemented)** Courier self-application (delivery app). Body `{ fullName, username, email, phoneNumber, vehicleInfo, password }`. Creates a `DeliveryPersonnel` as `Pending` — awaits admin approval, no auto-login. |
| POST | `/auth/login` | Public | Returns JWT + role + basic profile. |
| POST | `/auth/logout` | Any | Client-side token discard (and optional server token blacklist). |
| GET  | `/auth/me` | Any | **(Implemented)** Current user's profile (joins role-specific table). Includes `avatarUrl` (null = no photo). |
| PUT  | `/auth/me` | Any | **(Implemented)** Update own profile (`fullName`, `phoneNumber`). |
| POST | `/auth/me/avatar` | Any | **(Implemented)** Upload/replace the profile picture (multipart `file`). Returns `{ avatarUrl }`. |
| DELETE | `/auth/me/avatar` | Any | **(Implemented)** Remove the profile picture (back to initials). |
| POST | `/auth/change-password` | Any | **(Implemented)** Change own password — verifies `currentPassword` before setting `newPassword`. |
| POST | `/auth/forgot-password` | Public | **(Implemented)** Email a 6-digit reset code to a registered address. Always returns a generic success (no account enumeration). Requires SMTP. |
| POST | `/auth/reset-password/verify-code` | Public | **(Implemented)** Check a reset code `{ email, code }` WITHOUT consuming it — lets the UI confirm the code as its own step before the new-password step. |
| POST | `/auth/reset-password` | Public | **(Implemented)** Finish reset: body `{ email, code, newPassword }` — verifies the code (10-min expiry, max 5 attempts) then sets the new password. |

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
For `"role": "Supplier"` send `companyName`, `companyAddress`,
`businessRegNo`, `businessLicenseUrl` (and optional `taxNumber`, and optional
`operationalAddress` — the courier pickup address, defaults to `companyAddress`
when omitted) instead; for
`"role": "DeliveryPersonnel"` send `vehicleInfo`. Server hashes the password
(bcrypt/argon2) before storing — never stores plain text. Bank/payout details
are NOT collected here — suppliers add them later via Stripe Connect.

**Email verification (supplier sign-up).** The supplier portal is a two-step
flow: `POST /auth/register/send-code { email }` emails a 6-digit code (10-min
expiry, 60s resend cooldown, max 5 wrong guesses), then `POST /auth/register`
must include that `verificationCode`. The account (`user` + `supplier`) is only
created once the code checks out; only a hash of the code is ever stored, in the
`email_verification` table. SMTP is configured in `backend/config.local.php`
(see `config.local.example.php`); with no SMTP, `send-code` returns
`MAIL_NOT_CONFIGURED`.

The supplier's `businessLicenseUrl` comes from first uploading the document:

| Method | Path | Access | Purpose |
|--------|------|--------|---------|
| POST | `/uploads/registration-doc` | Public | **(Implemented)** Upload a business document (PDF/image, ≤10 MB) during registration; returns `{ url }`. No token (the account doesn't exist yet). |
| POST | `/supplier/stripe/onboard` | Supplier | **(Implemented)** Create/resume a Stripe Connect account; returns a hosted onboarding `{ url }`. Needs `STRIPE_SECRET` configured. |
| GET | `/supplier/stripe/status` | Supplier | **(Implemented)** Payout status `{ connected, payoutsEnabled, configured }`; syncs `payoutsEnabled` from Stripe. |

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
| GET   | `/admin/users` | Admin | **(Implemented)** List/filter users (`?role=Supplier&status=Pending&search=...`). |
| GET   | `/admin/users/{userId}` | Admin | **(Implemented)** One user's full detail, incl. role-specific `profile`. |
| PATCH | `/admin/users/{userId}/status` | Admin | **(Implemented)** Approve / reject / suspend / reactivate / delete. Body: `{ "status": "Active" }`. |
| GET   | `/admin/suppliers/pending` | Admin | **(Implemented)** Supplier approval queue (with KYB fields + document URL). |
| POST  | `/admin/suppliers/{userId}/approve` | Admin | **(Implemented)** Approve a pending supplier (→ `Active`). |
| POST  | `/admin/suppliers/{userId}/reject` | Admin | **(Implemented)** Reject a pending supplier. Body `{ reason, terminal? }` — `terminal=true` bans. |
| GET   | `/admin/couriers/pending` | Admin | **(Implemented)** Courier approval queue (self-applied delivery personnel, with vehicle info). |
| POST  | `/admin/couriers/{userId}/approve` | Admin | **(Implemented)** Approve a pending courier (→ `Active`). |
| POST  | `/admin/couriers/{userId}/reject` | Admin | **(Implemented)** Reject a pending courier. Body `{ reason, terminal? }` — reason shown at login; `terminal=true` bans. |

This is how a `Pending` supplier or delivery person becomes `Active`. Guards:
an admin cannot change **their own** account, and **Admin** accounts cannot be
modified through this endpoint.

---

## 4. CATEGORIES

| Method | Path | Access | Purpose |
|--------|------|--------|---------|
| GET    | `/categories` | Auth | List all categories (populates the product form dropdown). |

**Implemented admin management** (Admin → Manage Categories screen):
| Method | Path | Access | Purpose |
|--------|------|--------|---------|
| GET    | `/admin/categories` | Admin | List categories with `productCount` (how many products use each). |
| POST   | `/admin/categories` | Admin | Create category. Body: `{ "name": "Tennis" }`. 409 if the name already exists. |
| PUT    | `/admin/categories/{categoryId}` | Admin | Rename. Body: `{ "name": "..." }`. 409 on duplicate name. |
| DELETE | `/admin/categories/{categoryId}` | Admin | Delete — **blocked (409)** if any product still uses it. |

---

## 5. PRODUCTS  (catalog)

### Public / customer browsing
| Method | Path | Access | Purpose |
|--------|------|--------|---------|
| GET | `/catalog/products` | Public | **(Implemented)** List **Approved** products. Filters: `categoryId`, `search`, `minPrice`, `maxPrice`, `sort` (`price_asc`/`price_desc`/`newest`), `page`, `limit`. Returns `{ items, page, limit, total }` with a primary image + rating summary per card. |
| GET | `/catalog/products/{productId}` | Public | **(Implemented)** Full detail: product + supplier + images + 3D model + variants (sizes/stock) + published reviews + rating summary. |

> Note: customer browsing lives under `/catalog/*` (the bare `/products` is the
> supplier's own catalogue management). Sizes and reviews are embedded in the
> detail response, so no separate `/variants` or `/reviews` call is needed.

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
| POST   | `/products` | Supplier | **(Implemented)** Create product → starts as `Pending`. |
| PUT    | `/products/{productId}` | Supplier(Owner) | **(Implemented)** Edit own product — details, sizes/stock, images and 3D model in one call (see note below). |
| DELETE | `/products/{productId}` | Supplier(Owner)/Admin | **(Implemented)** Soft delete → `Removed`. |
| GET    | `/supplier/inventory` | Supplier | **(Implemented)** Flat, size-level stock list for the quick "Inventory" page. |
| PATCH  | `/supplier/inventory` | Supplier | **(Implemented)** Bulk stock update `{ updates: [ { variantId, stock } ] }` in one transaction; stock-only, no re-approval. |
| POST   | `/products/{productId}/variants` | Supplier(Owner) | Add a size + stock. *(Folded into the `PUT` above.)* |
| PUT    | `/variants/{productVariantId}` | Supplier(Owner) | Update a size's stock. *(Folded into the `PUT` above.)* |
| DELETE | `/variants/{productVariantId}` | Supplier(Owner) | Remove a size. *(Folded into the `PUT` above.)* |
| POST   | `/products/{productId}/images` | Supplier(Owner) | Attach an image URL (uploaded to Firebase first). *(Folded into the `PUT` above.)* |
| DELETE | `/images/{productImageId}` | Supplier(Owner) | Remove an image. *(Folded into the `PUT` above.)* |
| POST   | `/products/{productId}/models` | Supplier(Owner) | Attach a 3D model URL (Firebase). *(Folded into the `PUT` above.)* |
| DELETE | `/models/{productModelId}` | Supplier(Owner) | Remove a 3D model. |

### File uploads (Supplier web) — IMPLEMENTED
| Method | Path | Access | Purpose |
|--------|------|--------|---------|
| POST | `/uploads` | Supplier | Upload one image or 3D model (`multipart/form-data`: `kind=image\|model`, `file=<file>`). Returns `{ "url": "..." }`. |

> Storage is behind a swap seam (`backend/lib/storage.php`): today files are
> saved under `backend/uploads/` and served by Apache; to move to **Firebase
> Storage** (the project's target), only that helper's body changes. The
> supplier `POST /products` create accepts the returned URLs.

**Implemented `POST /products` request (supplier, rich form):**
```json
{
  "name": "Air Zoom Pegasus 40", "brand": "Nike", "price": 199.00,
  "categoryId": "CAT0001", "description": "Lightweight daily trainer.",
  "virtualTryOnEnable": true,
  "variants": [ { "size": "UK8", "stock": 20 }, { "size": "UK9", "stock": 15 } ],
  "images": [ "http://localhost/shoear/uploads/images/ab12.jpg" ],
  "modelUrl": "http://localhost/shoear/uploads/models/cd34.glb"
}
```
Product, variants, images and model are written in **one transaction**; the
product starts as `Pending` (awaiting admin approval, Section "Admin — product
moderation").

**`PUT /products/{productId}` (edit)** takes the **same body shape** as create
and also writes in one transaction. Two behaviours:
- **Re-approval:** changing a product's *identity* (name, brand, category,
  description, images, 3D model, try-on) sends an `Approved`/`Rejected` product
  back to `Pending` — this guards against bait-and-switch, the same reason real
  marketplaces re-review these fields. **Price and stock apply instantly** (no
  re-approval), matching how Amazon/Shopee/Lazada handle live edits. The
  response includes `"reapproval": true` when a reset happens.
- **Sizes are reconciled, not wiped:** existing sizes have their stock updated,
  new sizes are inserted, and a removed size is deleted — unless it has already
  been ordered (`order_item` FK is `RESTRICT`), in which case it's kept at `0`
  stock so order history is preserved.

### Admin — product moderation (Admin web)
| Method | Path | Access | Purpose |
|--------|------|--------|---------|
| GET   | `/admin/products` | Admin | List/filter all products (e.g. `?status=Pending` = moderation queue). |
| PATCH | `/admin/products/{productId}/status` | Admin | Approve / reject. Body: `{ "status": "Approved" }`. |
| GET   | `/admin/products/pending` | Admin | **(Implemented)** moderation queue of `Pending` products. |
| POST  | `/admin/products/{productId}/approve` | Admin | **(Implemented)** set status `Approved`. |
| POST  | `/admin/products/{productId}/reject` | Admin | **(Implemented)** set status `Rejected`. |

---

## 6. CART  (Customer mobile)

| Method | Path | Access | Purpose |
|--------|------|--------|---------|
| GET    | `/cart` | Customer | **(Implemented)** Cart + items (live price/subtotal) + total. Creates an empty cart on first use. |
| POST   | `/cart/items` | Customer | **(Implemented)** Add a **variant** (size). Body: `{ "variantId": "VAR0001", "quantity": 1 }`. Tops up an existing line; rejects exceeding stock (409). |
| PUT    | `/cart/items/{cartItemId}` | Customer(Owner) | **(Implemented)** Set exact quantity. Body: `{ "quantity": 2 }`. Stock-checked. |
| DELETE | `/cart/items/{cartItemId}` | Customer(Owner) | **(Implemented)** Remove a line. |

> Cart items reference `productVariantId` (the chosen **size**), matching the
> schema's per-size stock design. Adding the same variant twice updates quantity
> (enforced by `uq_cart_variant`).

---

## 7. WISHLIST  (Customer mobile)

| Method | Path | Access | Purpose |
|--------|------|--------|---------|
| GET    | `/wishlist` | Customer | **(Implemented)** Wishlist + saved products (each with an `available` flag). |
| POST   | `/wishlist/items` | Customer | **(Implemented)** Save a **product**. Body: `{ "productId": "PRD0001" }`. Idempotent. |
| DELETE | `/wishlist/items/{productId}` | Customer(Owner) | **(Implemented)** Remove by product (the heart-toggle). |

> Wishlist references `productId` (you wishlist a product, not a size) — matches schema.

---

## 8. ORDERS & CHECKOUT  (Customer mobile + Admin web)

| Method | Path | Access | Purpose |
|--------|------|--------|---------|
| POST  | `/orders` | Customer | **(Implemented)** Checkout: cart → order (`Placed`), snapshots price+size into `order_item`, clears the cart. Body: `{ deliveryAddress? }` (falls back to saved shipping address). **No stock change** — that's at payment. |
| GET   | `/orders` | Customer | **(Implemented)** Logged-in customer's own orders (with payment + delivery status). |
| GET   | `/orders/{orderId}` | Customer(Owner) | **(Implemented)** Order detail: items, payment, delivery tracking, refunds. |
| GET   | `/admin/orders` | Admin | **(Implemented)** All orders; filters `?status=`, `?search=` (order id / customer). |
| GET   | `/admin/orders/{orderId}` | Admin | **(Implemented)** Full detail: customer, **payment record** (FR 899), all items (every supplier), delivery + refunds. |
| GET   | `/admin/inventory` | Admin | **(Implemented)** Product stock across all suppliers (FR 906); filters `?status=`, `?search=`. |
| PATCH | `/admin/orders/{orderId}/status` | Admin | Manual status change if needed. |
| GET   | `/supplier/orders` | Supplier | **(Implemented)** Orders containing this supplier's products; their item count + subtotal only. Optional `?status=`. |
| GET   | `/supplier/orders/{orderId}` | Supplier | **(Implemented)** One order in detail — the supplier's own line items, customer **name**, order + payment status. Per PDPA, the delivery address/contact is **not** returned (delivery personnel get that, not suppliers). |

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
| POST | `/orders/{orderId}/payment` | Customer(Owner) | **(Implemented)** Pay a `Placed` order. Body: `{ "paymentMethod": "Stripe"|"PayPal" }`. Confirms payment (simulated gateway) and runs the pipeline **in one transaction**: atomic stock decrement → payment `Successful` → order `Paid` → receipt → **auto-assign courier**. 409 if an item sold out (not charged). |
| POST | `/payments/webhook` | Public (gateway-signed) | *(Future)* Real Stripe/PayPal confirmation. The post-payment pipeline above is what it would trigger; the payout demo already proves the live Stripe flow. |

> The **atomic stock decrement** (`UPDATE ... WHERE stockQuantity >= :qty`) runs
> here, inside the payment transaction, so two buyers can't oversell the last
> pair — the loser's payment fails and is rolled back (not charged).

---

## 10. RECEIPT

| Method | Path | Access | Purpose |
|--------|------|--------|---------|
| GET | `/orders/{orderId}/receipt` | Customer(Owner) | **(Implemented)** Receipt for a paid order — order + payment + line items (JSON now; PDF later). |

---

## 11. DELIVERY  (Admin web + Delivery mobile)

| Method | Path | Access | Purpose |
|--------|------|--------|---------|
| GET   | `/admin/deliveries` | Admin | All deliveries; filters `?status=` and `?unassigned=1` (unassigned = needs assigning). Unassigned/`Pending` are listed first. |
| GET   | `/admin/couriers` | Admin | Active courier roster ranked best-first by current load (the same scoring the auto-assigner uses) — powers the manual-assign dropdown. |
| POST  | `/admin/deliveries/{deliveryId}/assign` | Admin | Manually (re)assign a courier. Body: `{ "deliveryPersonnelId": "DEL0001" }`. `Pending` → `Assigned`; allowed until the delivery is `Delivered`/`Failed`. |
| GET   | `/delivery/assignments` | Delivery | **(Implemented)** The courier's active deliveries (Assigned/PickedUp/OutForDelivery) with customer address + phone. |
| GET   | `/delivery/history` | Delivery | **(Implemented)** The courier's finished deliveries (Delivered/Failed). |
| GET   | `/deliveries/{deliveryId}` | Delivery(Owner) | **(Implemented)** Detail: **pickup** (the parcel's supplier + `pickupAddress`), customer contact + address, and only THIS supplier's items (OTP **not** returned to the courier). |
| PATCH | `/deliveries/{deliveryId}/status` | Delivery(Owner) | **(Implemented)** `Assigned→PickedUp→OutForDelivery` (or `→Failed`); the order status is rolled up from all its parcels; going `OutForDelivery` generates this parcel's OTP. |
| POST  | `/deliveries/{deliveryId}/verify-otp` | Delivery(Owner) | **(Implemented)** Body: `{ "otpCode": "1234" }`. On match (must be OutForDelivery) → this parcel `Delivered`; order → `Delivered` only once **every** parcel is delivered. |
| POST  | `/deliveries/{deliveryId}/proof` | Delivery(Owner) | **(Implemented)** Attach a proof-of-delivery photo (multipart `file`, or JSON `{ proofUrl }`). |
| POST  | `/deliveries/{deliveryId}/report-issue` | Delivery(Owner) | **(Implemented)** Report a problem. Multipart `reason`,`note?`,`file?` (or JSON). Records a `delivery_issue`; a fail-reason → parcel `Failed`, `vehicle_emergency` → back to dispatch (`Pending`, unassigned); customer is notified. Reasons: `customer_unreachable`,`customer_unavailable`,`customer_refused`,`wrong_address`,`package_damaged`,`vehicle_emergency`,`other`. |
| GET   | `/admin/delivery-issues` | Admin | **(Implemented)** Reported-issue queue (Open first); optional `?status=Open\|Resolved`. |
| PATCH | `/admin/delivery-issues/{issueId}/resolve` | Admin | **(Implemented)** Mark a reported issue resolved. |

> **Split fulfilment (one parcel per supplier).** An order can contain items
> from several suppliers, so on payment the order is split into **one delivery
> per supplier** — each with its own pickup address (the supplier's
> `operationalAddress`), its own courier, and its own OTP. This mirrors how
> Shopee/Lazada/Amazon ship multi-seller orders as independent parcels. Order
> detail therefore returns a `deliveries[]` array (per supplier), and the order's
> own status is a rollup of the least-progressed parcel.

> The customer reads each parcel's OTP from order tracking (`GET /orders/{id}` →
> `deliveries[].otpCode`, set when that parcel goes OutForDelivery) and reads it
> to the courier delivering that parcel, who enters it to confirm receipt.

> OTP + proof-of-delivery satisfy the delivery app's confirmation requirement.

> **Dispatch design (auto-assign).** Courier assignment is modelled as a
> **scoring function** — the same core pattern production platforms (DoorDash,
> Uber, Grab) use: every Active courier is scored and the best one wins
> (`backend/lib/delivery.php`). Today the score weights only courier **load**
> (fewest in-progress deliveries); it is structured so geographic/ETA, vehicle
> and rating terms can be added as extra weighted terms without changing the
> callers. When no courier is free the order is left in the **manual queue**
> (unassigned `Pending`) for an admin to dispatch by hand. The production
> extension would replace greedy one-order-at-a-time picking with **batched
> min-cost assignment** across many orders/couriers at once — identified as
> future work.

---

## 12. REVIEWS & RATINGS  (Customer mobile + Admin)

| Method | Path | Access | Purpose |
|--------|------|--------|---------|
| GET    | `/products/{productId}/reviews` | Public | List published reviews for a product. |
| POST   | `/products/{productId}/reviews` | Customer | **(Implemented)** Leave a review. Body: `{ "ratingScore": 5, "reviewComment": "..." }`. **Only if the customer purchased the product** (403 otherwise); one review per product (409 if a duplicate). |
| PUT    | `/reviews/{reviewId}` | Customer(Owner) | **(Implemented)** Edit own review (rating/comment). |
| DELETE | `/reviews/{reviewId}` | Customer(Owner) | **(Implemented)** Delete own review (its supplier reply goes with it). |
| GET    | `/products/{productId}` | Supplier(Owner) | **(Implemented)** Product detail embeds `reviews` (incl. any `supplierReply`) + `ratingAverage`/`ratingCount`, so a supplier sees a product's reviews on its own page. |
| PUT    | `/supplier/reviews/{reviewId}/reply` | Supplier(Owner) | **(Implemented)** Add/edit the supplier's public reply (one per review; only on a Published review on their product). Cannot touch the customer's review text. |
| DELETE | `/supplier/reviews/{reviewId}/reply` | Supplier(Owner) | **(Implemented)** Delete the supplier's own reply. |
| GET    | `/admin/reviews` | Admin | **(Implemented)** All reviews; filters `?status=`, `?rating=`, `?search=`. |
| PATCH  | `/admin/reviews/{reviewId}/status` | Admin | **(Implemented)** Moderate — `Removed` hides an inappropriate review, `Published` restores it. |

> Rules from the schema: one review per (customer, product); rating must be 1–5.
> Recommended business rule: only customers who **purchased** the product may review.

---

## 13. REFUNDS  (Customer mobile + Admin web)

| Method | Path | Access | Purpose |
|--------|------|--------|---------|
| POST  | `/orders/{orderId}/refund` | Customer(Owner) | **(Implemented)** Request a refund on a **paid** order. Body: `{ refundReason, refundAmount?, refundProof? }` (amount defaults to the order total; must be ≤ it). 409 if one is already in progress. Creates a `Pending` refund → admin queue + supplier views. |
| GET   | `/refunds` | Customer | **(Implemented)** The customer's own refund requests + status. |
| GET   | `/admin/refunds` | Admin | **(Implemented)** All refund requests (Pending first); optional `?status=`. |
| GET   | `/supplier/refunds` | Supplier | **(Implemented)** Refunds on orders containing the supplier's products (read-only, no customer PII); optional `?status=`. |
| PATCH | `/admin/refunds/{refundId}/status` | Admin | **(Implemented)** Transitions: `Pending`→`Approved`/`Rejected`, `Approved`→`Completed`. On `Completed` → payment becomes `Refunded`. |
| GET   | `/supplier/orders/{orderId}` | Supplier | **(Implemented)** Order detail embeds `refunds[]` for that order (per-order, so suppliers see refunds on their orders here). The list `/supplier/orders` carries the latest `refundStatus` per order. |

---

## 13b. NOTIFICATIONS  (Customer app — the bell)

| Method | Path | Access | Purpose |
|--------|------|--------|---------|
| GET   | `/notifications` | Customer | **(Implemented)** The user's notifications (newest first, max 100) + `unreadCount` for the bell badge. |
| PATCH | `/notifications/{id}/read` | Customer(Owner) | **(Implemented)** Mark one notification read. |
| POST  | `/notifications/read-all` | Customer | **(Implemented)** Mark all the user's notifications read. |
| POST  | `/notifications/device` | Customer | **(Implemented)** Register this device's FCM token for background push. Body: `{ token, platform? }`. |

> The backend writes a notification row on every order/refund status change
> (`recomputeOrderStatus` → Shipped/OutForDelivery/Delivered, payment → Paid,
> refund → Approved/Rejected/Completed). See `backend/lib/notifications.php`.
>
> **Push is a swap seam** (`backend/lib/push.php`, mirroring storage): when a
> notification is created it ALSO dispatches a Firebase Cloud Messaging push to
> the user's registered devices — but only if `fcm_service_account` is set in
> `config.local.php`. Unset (the default), push is a silent no-op and the
> in-app bell works on its own.

---

## 14. COMMISSION  (Admin web)

| Method | Path | Access | Purpose |
|--------|------|--------|---------|
| GET  | `/admin/commission` | Admin | **(Implemented)** Current active rate + full change `history` (with who set each). |
| POST | `/admin/commission` | Admin | **(Implemented)** Set a new rate. Body: `{ "commissionRateValue": 10.00 }` (0–100). Effective now; deactivates the previous rate but keeps it as history. |

---

## 15. REPORTS  (Admin web + Supplier web)

| Method | Path | Access | Purpose |
|--------|------|--------|---------|
| GET | `/reports/sales` | Supplier | **(Implemented)** The logged-in supplier's own sales summary + per-product breakdown (paid orders); commission derived from the active rate. |
| GET | `/admin/reports/commission` | Admin | **(Implemented)** Platform commission across all suppliers (paid orders), broken down per supplier. |

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
