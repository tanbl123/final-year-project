# Delivery app branding assets

Drop these PNGs here:

- **`app_icon.png`** — 1024×1024, the **delivery truck on the indigo tile**
  (no text). This becomes the app launcher icon.
- **`logo.png`** — the full logo, transparent background if possible. Used for
  in-app headers / splash.

A ready-made truck icon design lives at `docs/branding/shoear-icon-delivery.svg`
(convert SVG → 1024 PNG with any free online converter, or re-create in Canva).

## Generate the launcher icons (run locally, from `shoear-mobile/delivery`)
```
flutter pub get
dart run flutter_launcher_icons
```
