# Architektur und Handy-Apps

## Datenfluss

Ring-Kamera → Ring-Cloud → Node-Server → Clip → Python-Erkennung → optionales VLM → Website/Handy/Discord. Die Kamera liefert keinen frei zugänglichen lokalen RTSP-Stream.

data/ ist eine private JSON-/Dateiablage für genau einen Serverprozess. Private APIs/Clips benötigen Anmeldung. Browseraktionen haben CSRF-Schutz; mobile Sitzungen eigene widerrufbare Tokens. Modellschlüssel gehen nicht an Browser oder App zurück.

## Handy-Status

Android: ARM64-Test-APK unter Windows gebaut, Testsignatur, kein Play-Store-Release und noch nicht auf echtem Handy abgenommen. Serveranmeldung, Clips, Zeitstrahl und Livebild-Anbindung vorbereitet. Tatsächlichen Buildstand prüfen: Neue Webfunktionen sind nicht automatisch Teil eines älteren APKs.

iOS: gemeinsamer Code vorhanden, kein signierter installierbarer Build. Apple-Developer-Zugang, Signierung und Geräte-/TestFlight-Abnahme fehlen. Echte Push-Zustellung benötigt Expo-/Firebase-/APNs-Projekte, Berechtigungen und neue Builds. Eine installierte Web-App richtet native Push nicht automatisch ein.

Das Handy braucht eine erreichbare HTTPS-Adresse. 127.0.0.1 meint auf dem Handy das Handy selbst. Ring-Zugänge bleiben auf dem Server. Unter Handy-App steht der verfügbare Download-/Verbindungsstatus.
