// Base URL of the PHP REST API (the same backend the web portal uses).
//
// IMPORTANT — pick the right host for WHERE YOU RUN THE APP. "localhost" on a
// phone/emulator means the device itself, NOT your PC, so:
//
//   Android emulator : http://10.0.2.2/shoear/api/v1     (10.0.2.2 = your PC's localhost)
//   iOS simulator    : http://localhost/shoear/api/v1
//   Physical phone   : http://<your-PC-LAN-IP>/shoear/api/v1   e.g. http://192.168.1.5/shoear/api/v1
//                      (phone + PC must be on the same Wi-Fi; XAMPP Apache must
//                       allow LAN access)
//
// The default below assumes the Android emulator. To target a physical phone
// WITHOUT editing this file, override it at build time:
//
//   flutter run --dart-define=API_BASE_URL=http://192.168.1.5/shoear/api/v1
//
const String apiBaseUrl = String.fromEnvironment(
  'API_BASE_URL',
  defaultValue: 'http://10.0.2.2/shoear/api/v1',
);

// ── Google Places (delivery address autocomplete) ───────────────────────────
//
// The API key is supplied at BUILD TIME, never committed to source control:
//
//   flutter run   --dart-define=GOOGLE_PLACES_API_KEY=AIzaSy...
//   flutter build --dart-define=GOOGLE_PLACES_API_KEY=AIzaSy...
//
// When the key is empty (the default), address autocomplete stays OFF and
// checkout falls back to manual entry + the offline postcode -> city/state
// lookup. So the app works fully with no key; the key only ADDS autocomplete.
const String googlePlacesApiKey =
    String.fromEnvironment('GOOGLE_PLACES_API_KEY', defaultValue: '');

/// True when a Google Places API key was provided at build time.
bool get googlePlacesEnabled => googlePlacesApiKey.isNotEmpty;

