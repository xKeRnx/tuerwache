# Architektur und Handy-Apps

## Datenfluss

Ring-Kamera → Ring-Cloud → Node-Server → Clip → Python-Erkennung → optionales VLM → Website/Handy/Discord. ring-client-api ist keine Zusage eines offiziellen Ring-SaaS-Vertrags. Die Kamera liefert keinen frei zugänglichen lokalen RTSP-Stream.

src/server.mjs stellt HTTP/API bereit, ring-service.mjs verarbeitet Ereignisse, features.mjs koordiniert Analyse/Speicher/Meldungen. ai-service.mjs kommuniziert über begrenzte JSON-Nachrichten mit ai/analyze.py --worker. public/ enthält die deutsch/englische Website, mobile/ die Expo/React-Native-App.

data/ ist eine private JSON-/Dateiablage für genau einen Serverprozess. Private APIs/Clips benötigen Anmeldung. Browseraktionen haben CSRF-Schutz; mobile Sitzungen eigene widerrufbare Tokens. Modellschlüssel gehen nicht an Browser oder App zurück.

## Handy-Status

Android: ARM64-Test-APK unter Windows gebaut, Testsignatur, kein Play-Store-Release und noch nicht auf echtem Handy abgenommen. Serveranmeldung, Clips, Zeitstrahl und Livebild-Anbindung vorbereitet. Tatsächlichen Buildstand prüfen: Neue Webfunktionen sind nicht automatisch Teil eines älteren APKs.

iOS: gemeinsamer Code vorhanden, kein signierter installierbarer Build. Apple-Developer-Zugang, Signierung und Geräte-/TestFlight-Abnahme fehlen. Echte Push-Zustellung benötigt Expo-/Firebase-/APNs-Projekte, Berechtigungen und neue Builds. Eine installierte Web-App richtet native Push nicht automatisch ein.

Das Handy braucht eine erreichbare HTTPS-Adresse. 127.0.0.1 meint auf dem Handy das Handy selbst. Ring-Zugänge bleiben auf dem Server. Unter Handy-App steht der verfügbare Download-/Verbindungsstatus.

## Entwicklung

```bash
npm ci
npm run check
npm test
node scripts/build-docs.mjs
```

Tests nutzen isolierte Ablagen. Echte OpenCV-Tests brauchen Modelle/Python und TEST_AI=1. test/preview.mjs enthält nur synthetische lokale UI-Daten. Vorschau-Zugänge niemals produktiv verwenden.

