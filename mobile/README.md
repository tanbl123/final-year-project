# ShoeAR — Mobile apps (Flutter)

Two Flutter apps live here. Both consume the **same PHP REST API** in
`../backend/` (contract in `../docs/API_ENDPOINTS.md`).

```
mobile/
├── customer/    Customer app — browse, AR try-on, cart, checkout, track, review, refund
└── delivery/    Delivery personnel app — assignments, status, OTP confirm, proof
```

## Status
Not scaffolded yet. Create each app from a machine with the **Flutter SDK**:

```bash
cd mobile
flutter create customer
flutter create delivery
```

Keep Flutter `build/` and `.dart_tool/` **gitignored** so the repo stays lean.

## API the apps will call (all implemented)

**Customer app** (`Customer` JWT, except public catalog):
- Catalog: `GET /catalog/products`, `GET /catalog/products/{id}` (public)
- Cart: `GET /cart`, `POST /cart/items`, `PUT/DELETE /cart/items/{id}`
- Wishlist: `GET /wishlist`, `POST /wishlist/items`, `DELETE /wishlist/items/{productId}`
- Checkout/orders: `POST /orders`, `GET /orders`, `GET /orders/{id}`
- Payment/receipt: `POST /orders/{id}/payment`, `GET /orders/{id}/receipt`
- Reviews: `POST /products/{id}/reviews`, `PUT/DELETE /reviews/{id}`
- Refunds: `POST /orders/{id}/refund`, `GET /refunds`

**Delivery app** (`DeliveryPersonnel` JWT):
- `GET /delivery/assignments`, `GET /delivery/history`, `GET /deliveries/{id}`
- `PATCH /deliveries/{id}/status`, `POST /deliveries/{id}/verify-otp`,
  `POST /deliveries/{id}/proof`

**Flagship feature:** AR virtual try-on (customer app) overlays the product's
`.glb`/`.gltf` 3D model on the foot via the camera (Unity AR Foundation / an AR
plugin). Models are already uploaded by suppliers and returned as `modelUrl`.

> Auth: `POST /auth/login` returns a JWT; send it as `Authorization: Bearer <token>`.
