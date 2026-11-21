# Optionaler Fernzugriff: zuhause oder Cloud

Eine 100-%-Sicherheitsgarantie gibt es nicht. Die App besitzt serverseitige Anmeldung, Rollen, 2FA, begrenzte Anfragegrößen/-zeiten, CSRF-/Host-/Origin-Prüfungen sowie eine ausdrückliche Freigabe. Clips, Vorschaubilder und Gesichtsdaten bleiben authentifiziert. Dies ersetzt keinen unabhängigen Penetrationstest, Betriebssystempflege, sichere Backups oder Schutz durch den Hostinganbieter. Ein echter öffentlicher Betrieb ist hier noch nicht geprüft; es wurde keine Domain, Routerfreigabe oder Cloud-Instanz eingerichtet.

## Freigabe

Unter **Server & Zugriff** zuerst für jedes Konto eine Authenticator-App einrichten. Den angezeigten Schlüssel lokal übernehmen, einen aktuellen Code bestätigen und die einmaligen Wiederherstellungscodes sichern. Ab dann benötigt jede Anmeldung Passwort plus Code oder unbenutzten Wiederherstellungscode. Frühere Web-/Handy-Anmeldungen werden widerrufen. Standardmäßig bleibt externer Zugriff aus. Eine Aktivierung wird ohne HTTPS/vertrauenswürdigen Proxy, erlaubte Hostnamen und 2FA für alle Konten abgewiesen. Neue Konten ohne 2FA sperren externen Zugriff wieder; neue Benutzer deshalb über lokalen Zugriff einrichten.

2FA-Geheimnisse liegen AES-256-GCM-verschlüsselt in `users.json`. Lokal erzeugt die App `data/auth-encryption.key` mit eingeschränktem Dateimodus. In der Cloud muss ein eigener `AUTH_ENCRYPTION_KEY` aus 64 zufälligen Hex-Zeichen außerhalb des Datenvolumens gesetzt sein. Den Schlüssel sicher getrennt sichern: Sein Verlust macht 2FA-Geheimnisse unlesbar. Andere Kamera-/S3-/KI-Zugangsdaten liegen derzeit weiterhin in privaten Dateien im Datenvolumen. Das gesamte Volumen und Backups schützen und verschlüsseln. Niemals den Datenordner per Webserver freigeben.

## Zuhause auf Windows / Mini-PC

Der vorhandene Node-Server bleibt auf `127.0.0.1:3210`. Für Zugriff über eine eigene Domain Caddy aus offizieller Quelle davor betreiben. Domain-DNS, Router/VPN und Zertifikatsausstellung müssen zur gewählten Einrichtung passen. Alternativ privaten VPN-Zugriff einrichten; kein Routerport wird von der App geöffnet.

Für einen lokalen Caddy-Proxy in der **Serverumgebung** setzen:

```text
HOST=127.0.0.1
PUBLIC_ORIGIN=https://kameras.example.de
ALLOWED_HOSTS=kameras.example.de
TRUSTED_PROXY_IPS=127.0.0.1
```

Caddy mit der beiliegenden Konfiguration und `DOMAIN=kameras.example.de` starten. Unveränderte Proxy-Header anderer Absender werden abgewiesen. Caddy überschreibt Client-IP und HTTPS-Header; keine weiteren Proxies davor schalten, ohne diese Vertrauensgrenze neu zu konfigurieren. HTTP-Backends bleiben ausschließlich auf Loopback. Direkter TLS-Betrieb mit `TLS_CERT`, `TLS_KEY`, passendem `HOST` und erlaubten Hostnamen ist ebenfalls möglich; Freigabe und 2FA bleiben erforderlich.

## Eigener Linux-Cloud-Server / Linux-Mini-PC

Die Vorlage nutzt Linux-Hostnetzwerk. Der App-Port wird ausschließlich an Host-Loopback gebunden; Caddy übernimmt die öffentlichen Ports. Docker-Desktop unter Windows ist hierfür nicht geprüft. Vor der Bereitstellung aktuelle Basisimages prüfen und regelmäßig aktualisieren. Ein Host mit mindestens 2 GB verfügbarer RAM-Kapazität für die App ist ein Ausgangspunkt; KI und Ollama benötigen je nach Modell mehr Ressourcen. Raspberry-Pi-Betrieb und ARM-Images sind noch nicht praktisch geprüft.

1. `deploy/.env.example` nach `deploy/.env` kopieren; eigene Domain und zufälligen Verschlüsselungsschlüssel lokal eintragen. Beispiel zur Schlüsselgenerierung: `openssl rand -hex 32`. Nicht in den Chat oder Git kopieren.
2. Die lokalen OpenCV-Modelle bei Bedarf nach `ai/models` laden (siehe Haupt-README). Die Bildauswertung benötigt diese Dateien; die App startet ohne sie, zeigt KI aber als nicht bereit.
3. Im Ordner `deploy` zunächst **nur die App** starten: `docker compose up -d --build app`. Caddy startet ohne Profil ausdrücklich noch nicht.
4. Vom eigenen Rechner einen SSH-Tunnel öffnen: `ssh -L 3210:127.0.0.1:3210 benutzer@server`. Lokal `http://127.0.0.1:3210` öffnen und das eigene Administratorkonto, Ring und 2FA einrichten. Keine entfernte Erstregistrierung zulassen.
5. Alle Konten mit 2FA ausstatten. Unter **Server & Zugriff** den Betriebsort Cloud und die Freigabe speichern.
6. Erst anschließend Caddy mit `docker compose --profile external up -d caddy` starten. Die Domain muss auf den Host zeigen; benötigte Firewallports und Zertifikatsausstellung selbst prüfen. [Caddy HTTPS-Dokumentation](https://caddyserver.com/docs/automatic-https).
7. Den tatsächlichen externen Zugriff mit eigenem Browser/Handy prüfen: HTTPS ohne Zertifikatswarnung, Passwort + 2FA, gesperrte private URLs ohne Anmeldung, Abmeldung/Widerruf und Abschalten der Freigabe. Es gibt keine eingerichtete öffentliche Zieladresse, deshalb ist diese Prüfung hier noch offen.

Zum Abschalten genügt die Freigabe in der App; zusätzlich kann Caddy gestoppt werden. Die Host-Firewall bleibt eine eigene Betriebseinstellung. Ring benötigt weiterhin seine Cloud und Internet. Bei Ausfall oder Migration muss die geschützte Datenablage inklusive Auth-Schlüssel und privaten Original-Clips erhalten bleiben. Ein Windows-Clip-Pfad ist in Linux ungültig: alte Clips kontrolliert in das Datenvolumen übernehmen und ihre Pfadzuordnung migrieren; keine ungeprüfte Datenkopie direkt als Produktionsinstanz starten.

Nur eine App-Instanz pro Datenvolumen betreiben. Die JSON-Dateien sind keine verteilte Datenbank; parallele Instanzen/Autoskalierung sind damit nicht unterstützt. Die verwendete Ring-Bibliothek besitzt dokumentierte transitive Abhängigkeitswarnungen (siehe Haupt-README); keine Aussage „frei von Sicherheitslücken“ ableiten. Den öffentlichen Host vor einer dauerhaften Freigabe unabhängig prüfen lassen.
