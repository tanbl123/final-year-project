# ShoeAR — AR Virtual Try-On (DeepAR, Flutter)

Real **foot-tracking** shoe try-on for the customer app, using **DeepAR** via the
`deepar_shoe_try_on_flutter` plugin. DeepAR does the camera, foot tracking, and
shoe rendering; the Flutter app just hosts DeepAR's view and passes it a
`.deepar` shoe effect URL.

> Decision: we use **DeepAR-Flutter** (no Unity). DeepAR handles all AR work, so
> a Unity layer would add complexity with no benefit. The proposal's
> "Unity AR Foundation" wording will be updated to DeepAR later.

> Staged **outside `lib/`** on purpose — the plugin needs native camera
> permissions and a real device to build/run, so wiring it in early would break
> the buildable app. Follow the steps below on your machine, then activate.

## How it works

```
Customer app (Flutter)
  └─ ArTryOnScreen
       └─ DeepARShoeTryOnPreview(link: <product's .deepar effect URL>)
            └─ DeepAR (WebView): camera + foot tracking + shoe rendering
```

The plugin is **WebView-based** (it wraps DeepAR's web shoe try-on). Each shoe is
a `.deepar` **effect** you build in **DeepAR Studio** and host (e.g. Firebase).

---

## ⚠️ STEP 1 — Feasibility spike FIRST (do this before anything else)

Prove the plugin works on your phone using DeepAR's **own demo effect** (already
licensed), before building your own effects or wiring the app.

1. New throwaway Flutter app (or a test screen).
2. `flutter pub add deepar_shoe_try_on_flutter`
3. Add camera permission (see Step 4).
4. Show the demo effect:
   ```dart
   DeepARShoeTryOnPreview(
     link: Uri.parse('https://demo.deepar.ai/flutter/shoe/nike-airforce1.deepar'),
   )
   ```
5. Run on a **real Android phone** and point at your feet.

**If the shoe tracks your foot → the plugin works; continue.**
**If not → stop;** the plugin/mobile shoe try-on isn't viable and we rethink.

Resolve these unknowns during the spike:
- **License key:** the demo link is pre-licensed. Confirm what's required to use
  **your own** `.deepar` effects (a DeepAR license key for your app bundle id?
  a licensed hosting domain?). Check the plugin version's docs / DeepAR portal.
- **Hosting:** confirm a `.deepar` file you host (Firebase) loads in the widget
  (URL reachable, correct content-type, no CORS block in the WebView).

---

## STEP 2 — DeepAR account + Studio effects

1. Create a **free DeepAR account** (10 MAU, watermark — fine for the FYP; your
   own device testing doesn't burn the quota).
2. In **DeepAR Studio**, for each **hero shoe** you want to demo:
   - import the shoe's 3D model,
   - attach it to the **foot-tracking** template,
   - tune **scale / position / rotation** so it sits correctly on the foot
     (this is your parameter-tuning work),
   - **export a `.deepar` effect**.
3. **Host** each `.deepar` file (Firebase Storage — you already use it) and note
   its public URL.

> Only build effects for the few products you'll demo. `virtualTryOnEnable`
> already gates the AR button per product, so the rest of the catalogue simply
> won't offer AR.

## STEP 3 — Add the plugin

In `shoear-mobile/customer/`:
```
flutter pub add deepar_shoe_try_on_flutter
```
(Confirm the version + its exact import name and any license-key API.)

## STEP 4 — Platform permissions

- **Android** — `android/app/src/main/AndroidManifest.xml`:
  ```xml
  <uses-permission android:name="android.permission.CAMERA" />
  <uses-permission android:name="android.permission.INTERNET" />
  ```
  Ensure `minSdkVersion` ≥ 19 in `android/app/build.gradle`.
- **iOS** — `ios/Runner/Info.plist`:
  ```xml
  <key>NSCameraUsageDescription</key>
  <string>Camera access is needed for AR shoe try-on.</string>
  ```

## STEP 5 — Add the screen + wire the button

1. Copy the screen in:
   ```
   ar-deepar/flutter/ar_tryon_screen.dart
     →  shoear-mobile/customer/lib/features/ar/screens/ar_tryon_screen.dart
   ```
2. Map each product to its effect URL. Two options:
   - **Clean:** add an optional `arEffectUrl` field to the product (backend
     column + API + supplier upload). Best long-term.
   - **Demo-quick:** a small map in the app for the hero shoes, e.g.
     ```dart
     const kShoeEffects = {
       'PRD0007': 'https://<firebase>/effects/zoom-vapor.deepar',
       // ...hero shoes only
     };
     ```
3. Wire the existing **AR Try-On** button in
   `lib/features/catalog/screens/product_detail_screen.dart`:
   ```dart
   import 'package:customer/features/ar/screens/ar_tryon_screen.dart';
   ```
   ```dart
   // replace the placeholder onPressed:
   onPressed: () {
     final effect = kShoeEffects[p.id]; // or p.arEffectUrl
     if (effect == null || effect.isEmpty) {
       context.showSnack('AR try-on is not available for this product yet.');
       return;
     }
     Navigator.of(context).push(MaterialPageRoute(
       builder: (_) => ArTryOnScreen(productName: p.name, effectUrl: effect),
     ));
   },
   ```

## STEP 6 — Run on a device

```
cd shoear-mobile/customer
flutter pub get
flutter run   # on a real Android phone (camera + AR won't work on an emulator)
```
Open a hero-shoe product → tap **AR Try-On** → point at your feet.

---

## Your contribution (for the viva)
DeepAR is the SDK; **your work is the per-shoe effect tuning** in DeepAR Studio —
importing each model and calibrating **scale / position / rotation** so the shoe
fits the foot — plus the Flutter integration and product→effect mapping. No
computer-vision code; DeepAR provides the foot tracking.

## Honest notes for the report
- Free tier applies a **DeepAR watermark** and a **10-MAU** cap — fine for a demo;
  mention as a limitation (a paid licence removes both).
- The plugin is **WebView-based** and its API is thin; interactions come from
  DeepAR's own try-on UI.
- Foot-tracking try-on requires a **`.deepar` effect per shoe** (built in Studio),
  so AR is enabled only for selected demo products, not the whole catalogue.

## Proposal edits (do later)
Swap "Unity AR Foundation" → "DeepAR" throughout (Ch 1 abstract/solution/
methodology; Ch 4 solution) and rewrite the Chapter 2 AR-tracking section +
Table 2.2 to select DeepAR (justification: ARCore/ARKit/AR Foundation provide
plane/world SLAM but not foot tracking, which footwear try-on requires; DeepAR —
already reviewed in §2.1.2 — provides dedicated foot tracking).
