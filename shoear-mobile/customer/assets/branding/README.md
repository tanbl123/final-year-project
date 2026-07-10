# Customer app branding assets

Drop these PNGs here (export from Canva / your logo design):

- **`app_icon.png`** — 1024×1024, the **sneaker on the indigo tile** (no text).
  This becomes the app launcher icon.
- **`logo.png`** — the full logo (sneaker + "SHOEAR" + "AR TRY-ON"), transparent
  background if possible. Used for in-app headers / splash.

## Generate the launcher icons (run locally, from `shoear-mobile/customer`)
```
flutter pub get
dart run flutter_launcher_icons
```
This reads the `flutter_launcher_icons:` config in `pubspec.yaml` and writes the
Android/iOS icon sets automatically.
