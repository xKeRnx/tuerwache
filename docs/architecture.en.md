# Architecture and mobile apps

Ring camera → Ring cloud → Node server → clip → Python recognition → optional VLM → web/mobile/Discord. ring-client-api does not establish an official Ring SaaS contract. The camera does not expose a freely accessible local RTSP stream.

src/server.mjs provides HTTP/API, ring-service.mjs events, features.mjs analysis/storage/notifications, ai-service.mjs bounded JSON IPC with ai/analyze.py --worker. public/ contains the bilingual web UI; mobile/ contains Expo/React Native.

data/ is private JSON/file storage for one server process. Accounts protect private APIs/clips. Browser writes use CSRF; mobile sessions have separate revocable tokens. Model keys are not returned to apps/browsers.

## Mobile status

Android: ARM64 test APK built on Windows, test-signed, not a Play Store release, not yet accepted on a physical phone. Server sign-in, clips, timeline and live integration are prepared. Verify actual build version: new web features are not automatically included in older APKs.

iOS: shared code exists, no signed installable build. Apple Developer access, signing and device/TestFlight tests remain. Real push needs Expo/Firebase/APNs projects, permissions and new builds. Installing the web app does not configure native push.

Phones need a reachable HTTPS address. On a phone, 127.0.0.1 refers to the phone itself. Ring credentials remain on the server. The Mobile app page shows available download/connection status.

## Development

```bash
npm ci
npm run check
npm test
node scripts/build-docs.mjs
```

Tests use isolated storage. Real OpenCV tests require models/Python and TEST_AI=1. test/preview.mjs is synthetic UI data only; never use its credentials in production.

