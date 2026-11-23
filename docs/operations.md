# Sicherheit, Backup und Updates

## Externer Zugriff

Standard: Loopback und Freigabe aus. Für Heimserver oder Cloud eigene HTTPS-Adresse, erlaubte Hosts, exakt vertraute Proxy-IP und MFA für alle Benutzer einrichten. Cloud benötigt einen AUTH_ENCRYPTION_KEY außerhalb des Datenvolumens. Erst danach unter Server & Zugriff Betriebsort wählen und freigeben. Die vollständige Proxy-Anleitung steht in deploy/README.md.

Keine öffentliche Weiterleitung direkt auf den Node-Port und keine beliebigen Forwarded-Header vertrauen. VPN ist eine weitere Option, benötigt ebenfalls richtige Konfiguration. Vor Kundenbetrieb die öffentliche Anmeldung unabhängig prüfen lassen. Es gibt keine 100-%-Sicherheitszusage.

## Aufbewahrung und Schutz

Unter Betrieb → Aufbewahrung gibt es getrennte, standardmäßig ausgeschaltete Regeln für lokale Clips (Alter und GiB-Limit) und R2/S3-Kopien (Alter und optionales GiB-Limit; 0 = unbegrenzt). Vorher gespeicherte Regeln als Vorschau prüfen. Bei Aktivierung läuft die Prüfung alle fünf Minuten. Ein unter Clips geschütztes Video wird von beiden Regeln ausgenommen; laufende Verarbeitung wird übersprungen. Eine volle Platte lässt sich bei vielen geschützten Clips dadurch nicht automatisch bereinigen.

Bleibt nur die Cloud-Kopie, erfolgt die Wiedergabe nach Anmeldung über den Server; der Bucket bleibt privat. Zum Lesen/Löschen müssen ursprünglicher Endpunkt, Region, Bucket und passende Zugangsdaten verfügbar sein. Eine abgelaufene Aufnahme bleibt als Ereignis erhalten. Die Cloud-Quote zählt bekannte Clipgrößen dieser Installation; fremde Bucket-Dateien werden nicht verwaltet. Aufbewahrung ersetzt keine Datensicherung.

## Verschlüsselte Sicherungen

Betrieb → Sicherungen erstellt ein passphrasengeschütztes `.twbackup` mit scrypt und AES-256-GCM. Mindestens 16 Zeichen verwenden und die Passphrase getrennt aufbewahren. Gesichert werden Benutzer/MFA, effektiver Verschlüsselungsschlüssel, Ring-Sitzung, Einstellungen, Ereignisse, Gesichter, Bewertungen und optional Videos. Browser-/Handy-Sitzungen werden nicht übernommen. Modellgewichte, Python, Software und `.env` gehören nicht ins Archiv. `.env`, insbesondere externe Zugangskonfiguration und EXPO_ACCESS_TOKEN, zusätzlich getrennt schützen.

Manuelle Sicherungen bleiben erhalten. Ein optionaler Zeitplan speichert seine Passphrase verschlüsselt auf dem Server und begrenzt nur seine eigenen geplanten Sicherungen. Sicherungen vom selben Laufwerk auf ein zweites Gerät herunterladen. Das Archiv enthält sensible Daten und ist nicht zur Veröffentlichung bestimmt.

## Geprüfte Wiederherstellung / Windows → Linux oder Pi

1. Auf dem Zielsystem dieselbe oder eine kompatible Türwache-Version und die benötigten Python-/KI-Komponenten installieren. Alten Server stoppen; nie beide mit derselben Ring-Sitzung oder Datenablage betreiben.
2. Archiv nach `backups/snapshots/UUID.twbackup` kopieren (oder BACKUP_DIRECTORY verwenden), im Web unter Sicherungen prüfen und die erhaltene Prüfungskennung notieren. Eine Prüfung verändert die laufenden Daten nicht.
3. Zielserver sauber stoppen. Im Projektordner erst ohne `--apply` prüfen; dann bewusst anwenden:

```bash
node scripts/restore.mjs --verification PRUEFUNGS-UUID
node scripts/restore.mjs --verification PRUEFUNGS-UUID --apply
```

Die Wiederherstellung prüft alle Dateien/Hashes und erstellt eine geprüfte Arbeitskopie neben dem Ziel-Datenordner. Erst dann werden bisherige Daten nach `.tuerwache-previous-UUID` verschoben und die vorbereiteten Daten aktiviert. Bei Aktivierungsfehler wird zurückgerollt. Vorherige Daten bleiben erhalten; später nur nach erfolgreicher Prüfung manuell entfernen. Genügend Platz für Archiv, entschlüsselte Prüfung und Arbeitskopie einplanen.

Absolute Clip-Pfade werden für DATA_DIRECTORY neu geschrieben. Ein gesetzter AUTH_ENCRYPTION_KEY muss zum importierten Schlüssel passen. Beim ersten Start müssen Benutzer/Handys neu angemeldet werden. Fernzugriff bleibt aus; Aufbewahrung, Backup-Zeitplan und Discord-Betriebswarnungen werden ausgeschaltet und müssen geprüft neu aktiviert werden.

Bei Docker liegt DATA_DIRECTORY bei Neuinstallationen auf `/app/data/state`, Backups auf einem eigenen Volume. Ein Volume-Wurzelordner lässt sich nicht austauschen: bestehende Container mit älterem `/app/data`-Layout vor einer Umstellung sichern und gezielt in einen Datenunterordner migrieren. Restore-CLI im gestoppten Dienst mit denselben Mounts und Umgebungswerten ausführen. Ein Pi kann die Daten übernehmen; lokale VLM-Leistung hängt stark von Modell/RAM ab. Große Beschreibungsmodelle besser auf einem separaten Rechner betreiben.

## Betrieb und Wiederholungen

Unter Betrieb stehen Ring-/Ereignisverbindung, Offline-Kameras, Plattenplatz, lange Jobs, Zustellfehler und die Wiederholungswarteschlange. Optional sind neutrale Discord-Betriebswarnungen höchstens alle 30 Minuten möglich; standardmäßig aus. Die Ereignis-Stille ist standardmäßig kein Alarm: eine ruhige Szene kann normal sein.

Neue Fehler bei lokaler KI, Beschreibungen und Uploads können begrenzt und dauerhaft gespeichert erneut versucht werden. Pausierte Kameras und inzwischen entfernte lokale Videos werden übersprungen. Ein unklarer Discord-/Push-Versand wird nicht automatisch erneut gesendet. Expo-Zustellbelege zeigen die Übergabe an Apple/Google, nicht die Anzeige beim Nutzer. Abgelehnte Geräte-Tokens werden entfernt. Ein Push-Test lässt sich nur für die eigene Handy-Sitzung auslösen.

## KI-Qualität

Am Clip Richtig/Falsch/Unsicher und optional eine Korrektur speichern. Die Bewertung gehört zur jeweiligen Beschreibungsversion und verändert sie nicht. Unter KI → KI-Qualität ausgewählte Modelle anhand derselben bis zu sechs Einzelbilder vergleichen. Cloud-Aufrufe benötigen ausdrückliche Bildfreigabe, zählen zum Tageslimit und können Gebühren verursachen. Vergleiche senden keine Discord-/Push-Nachrichten und überschreiben keine ursprüngliche Zusammenfassung. Auch Vergleichsergebnisse sind bewertbar. Es findet kein automatisches Training statt.

## Update

Änderungen prüfen, Backup, stoppen, Quellcode aktualisieren und Installer mit passender AI-Option erneut ausführen. Starten und neues Ereignis mit Bild/Ton prüfen. Bei Fehlschlag alten Code und zugehöriges Datenbackup gemeinsam wiederherstellen. Nie zwei Prozesse gegen dieselbe JSON-Datenablage starten.
