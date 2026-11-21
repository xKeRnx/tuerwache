# Türwache für Android und iOS

Gemeinsamer Expo-SDK-58-/React-Native-Client für deinen Türwache-Server. Keine Ring-Zugangsdaten in dieser App: Sie verwendet dein eigenes Türwache-Konto. Kameras, Livebild, Clips, KI-Ergebnisse und Push-Auswahl liegen auf getrennten Ansichten. Die Verwaltung von Kameraprofilen, KI-Anbietern, Speicher und Benutzern öffnet die Web-Oberfläche.

## Aktueller Prüfstand

- TypeScript geprüft; Android- und iOS-JavaScript-Bundles erzeugt.
- Native Server-Anmeldung, Geräte-Widerruf, Rollen und geschützte Clips automatisiert geprüft, einschließlich Neustart und Passwortwechsel.
- Server erzeugt abspielbare Live-HLS-Segmente von der tatsächlichen Ring-Kamera.
- Echte Installation/Wiedergabe und Push-Zustellung auf Android/iPhone stehen noch aus. Kein Handy angeschlossen; Apple-/Expo-/Firebase-Projekte sind noch nicht eingerichtet.
- Ein lokal erzeugtes Test-APK ist mit dem Android-Entwicklerschlüssel signiert. Es ist ein Testpaket für ARM64, keine Veröffentlichung und kein Produktionssignierschlüssel.

## Server verbinden

Auf dem Handy eine erreichbare **HTTPS-Adresse mit vertrauenswürdigem Zertifikat** eingeben, ohne Unterpfad. Der aktuelle PC-Server hört standardmäßig ausschließlich auf `127.0.0.1:3210`; das ist auf dem Handy das Handy selbst. Siehe HTTPS-Einrichtung im Haupt-README. Keine Zertifikatsprüfung ausschalten und keine Portfreigabe ohne eingerichtete Anmeldung/TLS erstellen.

Nur für lokale Entwicklung erlaubt der Client unverschlüsseltes HTTP zu localhost, `127.0.0.1` oder dem Android-Emulator-Gateway `10.0.2.2`. Das ist im Release-Build deaktiviert. Nach der Anmeldung liegt der zufällige Schlüssel in Expo SecureStore, nicht in AsyncStorage oder einer URL. Die App merkt ihn höchstens 30 Tage. Bei Widerruf oder Passwort-/Rollenänderung erneut anmelden.

## Lokal entwickeln und Android bauen

Im Ordner `mobile` einmal `npm ci`, danach `npx expo start`. Expo Go genügt nicht für echte Remote-Push-Tests. Für ein eigenständiges Android-Paket mit eingebettetem JavaScript:

```powershell
npx expo prebuild --platform android --no-install
cd android
./gradlew.bat assembleRelease -PreactNativeArchitectures=arm64-v8a --console=plain
```

JDK 17 und Android SDK müssen erreichbar sein. Auf diesem PC: JDK `C:\Program Files\Java\jdk-17`, SDK `H:\Android\SDK` (der Ordner `H:\Android` allein genügt nicht). Benötigte SDK-/NDK-Versionen werden durch das erzeugte Gradle-Projekt vorgegeben. Das Ergebnis liegt unter `android/app/build/outputs/apk/release/app-release.apk`. `scripts/Build-Android.ps1` im Hauptprojekt führt diese Schritte mit Pfadprüfung aus und kopiert das Paket nach `artifacts`.

iOS benötigt eine macOS-/Xcode-Buildumgebung oder einen eingerichteten EAS-Build sowie passende Apple-Signierung. Ein erfolgreiches JavaScript-Bundle ist keine installierbare IPA-Datei. Die Bundle-ID `de.tuerwache.app` ist ein lokaler Vorschlag; vor Veröffentlichung eine eigene eindeutige Kennung wählen.

## Push später einrichten

1. Eigene Expo-/EAS-Anmeldung und Projekt erstellen. Die Projekt-UUID als `EXPO_PUBLIC_EAS_PROJECT_ID` in einer lokalen `.env` setzen (siehe `.env.example`). Keine Benutzerkennwörter oder privaten Signierschlüssel ins Repository legen.
2. Für Android ein eigenes Firebase-Projekt mit der zur App passenden Paketkennung einrichten. Dessen `google-services.json` lokal ablegen; die Datei ist ignoriert. FCM-v1-Serverzugang für dieses Projekt über EAS einrichten.
3. Für iOS Apple-Developer-Team, App-Kennung, Provisioning und APNs-Schlüssel einrichten. Die App enthält das Notifications-Config-Plugin; Signierung und Push-Berechtigung erfolgen beim nativen Build.
4. Mit dem eingerichteten Projekt einen nativen Build erstellen und auf einem echten Handy installieren. In **Mein Handy** die Meldungen je Kamera wählen und **Push aktivieren & Auswahl speichern** drücken. Erst hierbei wird die Betriebssystem-Berechtigung angefragt und das Push-Token beim eigenen Server registriert.
5. Mit einem echten Klingelereignis testen; optional nach Fertigstellung Clip/Person/Szene. Textannahme durch Expo und tatsächliche Anzeige am Handy getrennt prüfen. Energiespar- und Fokus-Einstellungen können Benachrichtigungen verhindern.

Für zusätzliche Absicherung kann Expo Push Security aktiviert und der zugehörige eigene Serverzugang als `EXPO_ACCESS_TOKEN` in der Serverumgebung gesetzt werden. Dieser Wert gehört nie in die Handy-App. Ohne registrierte Geräte startet der Server keine Push-Anfrage. HTTPS-Zugriff auf den eigenen Server ist für Livebild/Clips nötig; Expo ersetzt diesen Zugriff nicht.

Offizielle Anleitungen: [Expo Push einrichten](https://docs.expo.dev/push-notifications/push-notifications-setup/), [Push versenden](https://docs.expo.dev/push-notifications/sending-notifications/), [Signierung](https://docs.expo.dev/app-signing/managed-credentials/).

## Version 0.13.0

Expo Router verwendet eigene Ansichten für Kameras, Clips mit Nachladen, Zeitstrahl, Ereignislinks (`tuerwache:///event/UUID`) und Mein Handy. Deutsch/English lässt sich oben umschalten. Aufnahmen anderer Kameras blockieren die Aufnahme-Schaltfläche nicht mehr. Livebild und Aufnahme können gleichzeitig laufen.

Push-Test nur an dieses angemeldete Gerät; Belege werden serverseitig nach etwa 15 Minuten abgefragt. Übergabe an Apple/Google ist keine Bestätigung der Anzeige. Ein Build ohne Expo-Projekt zeigt die fehlende Einrichtung ausdrücklich. Keine echten Push-/iOS-Gerätetests ohne passende Projekte, Signierung und Hardware behaupten.
