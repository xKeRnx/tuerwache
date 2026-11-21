# Linux und Server

## Native Installation

Zielplattform: Debian/Ubuntu oder Raspberry Pi OS mit 64 Bit. Voraussetzungen: Bash, Node.js 24 LTS mit npm; für lokale KI Python 3.10–3.13, python3-venv, libglib2.0-0 und libgl1. Node über die offizielle Downloadseite installieren; ein veraltetes Distributionspaket reicht möglicherweise nicht. Python-Abhängigkeiten werden in einer eigenen virtuellen Umgebung installiert, nicht systemweit.

```bash
sudo apt-get update
sudo apt-get install -y git ca-certificates python3 python3-venv libglib2.0-0 libgl1
# Repository klonen, dann in seinen Ordner wechseln.
bash scripts/install-linux.sh --with-ai --check-only
bash scripts/install-linux.sh --with-ai
bash scripts/start-linux.sh
```

Ohne lokale Bildanalyse `--with-ai` weglassen. Der Installer benötigt beim eigentlichen Installieren Internet. Er nutzt npm ci, Python-Binärpakete und prüft die Modelldateien gegen das mitgelieferte SHA256-Manifest. Scheitert ein Binärpaket, nicht auf unkontrollierte Builds ausweichen: Python-/CPU-Version prüfen.

## Als Dienst mit systemd

Für dieses einfache Dienstskript ist `/opt/tuerwache` verbindlich. Ein eigener Benutzer besitzt Quellcode und Daten. Beispiel nach Bereitstellung des Quellcodes:

```bash
sudo useradd --system --create-home --home-dir /var/lib/tuerwache --shell /usr/sbin/nologin tuerwache
sudo install -d -o tuerwache -g tuerwache /opt/tuerwache
# Bereinigten Quellcode als Benutzer tuerwache nach /opt/tuerwache übertragen.
cd /opt/tuerwache
sudo -u tuerwache bash scripts/install-linux.sh --with-ai
sudo -u tuerwache mkdir -p data
# Zuerst manuell starten, testen und wieder sauber stoppen.
sudo -u tuerwache bash scripts/start-linux.sh
sudo bash scripts/install-service.sh --user tuerwache
sudo systemctl status tuerwache
sudo journalctl -u tuerwache -f
```

Keine bereits verwendeten Konten-/Datenordner überschreiben. Das Dienstskript überschreibt keine vorhandene Unit. Stoppen: `sudo systemctl stop tuerwache`. Es wartet auf laufende Arbeit bis zu 260 Sekunden. Die Dienst-Härtung erlaubt Schreibzugriff nur auf `data` und temporäre Dateien. Für einen anderen Clip-Ordner braucht es zusätzlich einen gezielten ReadWritePaths-Eintrag und passende Dateirechte. Für Ollama einen eigenen Dienst verwenden; dieser Installer startet Ollama nicht.

## Ersteinrichtung aus der Ferne

Standardmäßig lauscht der Server nur auf 127.0.0.1. Für die erste Anmeldung einen SSH-Tunnel öffnen:

```bash
ssh -L 3210:127.0.0.1:3210 user@server
```

Dann im eigenen Browser localhost:3210 öffnen. Später HTTPS, erlaubten Host und Zwei-Faktor-Anmeldung einrichten und erst danach unter Server & Zugriff freigeben. [Details zu Betrieb und Sicherheit](operations.md).

## Docker

`deploy/compose.yaml` ist eine Linux-Vorlage mit Host-Netzwerk und optionalem Caddy-Profil. `deploy/.env.example` nach `deploy/.env` kopieren und eigene Domain sowie zufälligen 64-stelligen Hex-Schlüssel setzen. Den Schlüssel getrennt vom Datenbackup sichern. App zunächst mit `docker compose -f deploy/compose.yaml up -d --build app` starten; der HTTPS-Proxy wird erst mit Profil `external` bewusst gestartet. Einzelheiten in `deploy/README.md` im Repository. Diese Vorlage gilt nicht unverändert für Docker Desktop und mehrere Mandanten.
