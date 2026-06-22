// Base URL of the PHP REST API (the same backend the customer app + web use).
//
// IMPORTANT — pick the right host for WHERE YOU RUN THE APP. "localhost" on a
// phone/emulator means the device itself, NOT your PC, so:
//
//   Android emulator : http://10.0.2.2/shoear/api/v1     (10.0.2.2 = your PC's localhost)
//   iOS simulator    : http://localhost/shoear/api/v1
//   Physical phone   : http://<your-PC-LAN-IP>/shoear/api/v1   e.g. http://192.168.1.5/shoear/api/v1
//
// Default below assumes the Android emulator — change it to match your setup.
const String apiBaseUrl = 'http://10.0.2.2/shoear/api/v1';
