# Architecture and mobile apps

Ring camera → Ring cloud → Node server → clip → Python recognition → optional VLM → web/mobile/Discord. The camera does not expose a freely accessible local RTSP stream.

data/ is private JSON/file storage for one server process. Accounts protect private APIs/clips. Browser writes use CSRF; mobile sessions have separate revocable tokens. Model keys are not returned to apps/browsers.

## Mobile status

Android: ARM64 test APK built on Windows, test-signed, not a Play Store release, not yet accepted on a physical phone. Server sign-in, clips, timeline and live integration are prepared. Verify actual build version: new web features are not automatically included in older APKs.

iOS: shared code exists, no signed installable build. Apple Developer access, signing and device/TestFlight tests remain. Real push needs Expo/Firebase/APNs projects, permissions and new builds. Installing the web app does not configure native push.

Phones need a reachable HTTPS address. On a phone, 127.0.0.1 refers to the phone itself. Ring credentials remain on the server. The Mobile app page shows available download/connection status.
