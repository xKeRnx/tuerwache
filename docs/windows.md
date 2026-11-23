# Windows installieren

## Voraussetzungen

Windows 10/11, Node.js 24 LTS und bei lokaler Bildanalyse Python 3.12 (64 Bit). Node 22 wird ebenfalls unterstützt; Node 26 ist für diese Version nicht freigegeben. Installer laden keine beliebigen Systemprogramme herunter und öffnen keine Firewall-Ports.

- [Offizielles Node.js](https://nodejs.org/en/download)
- [Offizielles Python](https://www.python.org/downloads/windows/)

## Installieren und starten

Privates Repository klonen oder den bereinigten Quellordner verwenden. PowerShell im Projekt öffnen. Der Ordner sollte dem normalen Benutzer gehören. Nicht als Administrator betreiben.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\Install-Windows.ps1 -WithAI -CheckOnly
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\Install-Windows.ps1 -WithAI
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\Start-Tuerwache.ps1
```

Ohne lokale Personen-/Gesichtserkennung `-WithAI` weglassen. Die Installation lädt exakt die npm-Lockdatei, FFmpeg, die Python-Pakete und bei `-WithAI` drei per SHA256 geprüfte OpenCV-Modelle. Sie startet keinen Server. CheckOnly prüft Voraussetzungen ohne Downloads oder Änderungen.

Anschließend [Türwache öffnen](http://127.0.0.1:3210): erstes Türwache-Admin-Konto anlegen, danach das Ring-Konto verbinden und dessen Bestätigungscode eingeben. Passwörter nur in die eigene lokale App eingeben.

## Konfiguration und Start

Optional `.env.example` nach `.env` kopieren. Die neuen Startskripte laden diese Datei. `npm start` allein lädt sie nicht. `.venv/Scripts/python.exe` wird automatisch ausgewählt, sofern `AI_PYTHON` nicht gesetzt ist. Eine vorhandene `.env`-Einstellung hat Vorrang vor dieser Vorauswahl, soweit keine Prozessvariable gesetzt ist.

Der Doppelklick auf `Start-Tuerwache.cmd` nutzt denselben Starter. Das Fenster offen lassen; mit Strg+C sauber stoppen. Bei einem Update zuerst stoppen und ein Backup anlegen. Kein zweites Exemplar gegen dieselbe Datenablage starten.

## Gesichts-Worker auf demselben Windows-PC

Die Gesichts-Engine **Lokal auf Türwache** verwendet SFace direkt. Über den Worker kannst du auch **ArcFace** nutzen. Dafür müssen Python und die OpenCV-Modelle eingerichtet sein, wie unter **Installieren und starten** beschrieben.

### Automatisch mit Türwache starten

Wähle unter **KI-Anbieter → Gesichts-Worker** die Option **Automatisch auf diesem Gerät**. Lass **ArcFace für Kameras freigeben** für den ersten SFace-Test aus. Prüfe die Verbindung, schalte **Gesichts-Worker freigeben** ein und speichere. Bei jedem Türwache-Start läuft der integrierte Worker mit. Er braucht weder eine Adresse im Panel noch einen selbst erzeugten Token. Unter **Standorte → Privatzonen & KI** kannst du **Integrierter Gesichts-Worker** pro Kamera als Gesichts-Engine wählen.

Wenn du das InsightFace-Modell für nichtkommerzielle Forschung verwenden möchtest, klicke auf **ArcFace herunterladen (289 MB)**. Türwache legt den Ordner `models` in seinem Datenverzeichnis an, lädt das offizielle Archiv und prüft dessen Prüfsumme und die der enthaltenen Modelldatei. Sobald der Modellstatus die Installation meldet, aktiviere **ArcFace für Kameras freigeben** und prüfe die Verbindung. Bei **SFace und ArcFace geprüft** kannst du speichern, Referenzfotos einlernen und die Engine pro Kamera wählen. Alternativ erkennt der integrierte Worker eine manuell abgelegte `w600k_r50.onnx` unter `ai/models` im Projektordner. [Modell und Lizenz](raspberry-pi.md)

### Worker separat betreiben

Für einen manuell gestarteten Worker wähle im Panel **Separat im Heimnetz**. Auch eine externe Worker-Instanz auf demselben PC ist möglich.

### 1. Token hinterlegen und Worker starten

Öffne ein zweites PowerShell-Fenster und wechsle in den Türwache-Projektordner. Die Datei `.env` gehört direkt in diesen Ordner neben `package.json`. Der Starter `scripts/start-face-worker.mjs` ist bereits vorhanden.

```powershell
Set-Location 'C:\Pfad\zu\Tuerwache'
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
if (-not (Test-Path -LiteralPath '.env')) { New-Item -ItemType File -Path '.env' | Out-Null }
notepad .env
```

Füge in `.env` die Zeile `FACE_WORKER_TOKEN=DEIN_ERZEUGTER_TOKEN` hinzu und ersetze den Platzhalter durch den ausgegebenen Wert. Gibt es den Eintrag schon, verwende den vorhandenen Wert. Wenn du den Windows-Installer mit `-WithAI` verwendet hast, ergänze bei Bedarf `AI_PYTHON=.venv/Scripts/python.exe`, damit auch der Worker die virtuelle Umgebung nutzt.

```powershell
node --env-file=.env scripts/start-face-worker.mjs
```

Sobald **Gesichts-Worker läuft auf HTTP an Port 3211.** erscheint, lass das Fenster offen. Türwache läuft parallel auf Port 3210.

### 2. Worker in Türwache verbinden

- Öffne als Administrator **KI-Anbieter → Gesichts-Worker**. Gib bei **Worker-Adresse** `http://127.0.0.1:3211` ein.
- Füge bei **Worker-Token** den Wert aus `.env` ein. Trage nur den Wert hinter dem Gleichheitszeichen ein.
- Lass **ArcFace für Kameras freigeben** für den ersten SFace-Test aus. Klicke auf **Worker-Verbindung prüfen**. Wenn SFace erfolgreich geprüft wurde, schalte **Gesichts-Worker freigeben** ein und speichere.
- Aktiviere pro gewünschter Kamera die Gesichtserkennung und wähle unter **Standorte → Privatzonen & KI → Gesichts-Engine** den **Gesichts-Worker im Heimnetz**. Bei aktiven Privatzonen bleibt die Gesichtsauswertung auf Türwache.

Für ArcFace ergänze in `.env` `FACE_WORKER_ARCFACE_MODEL=C:/Pfad/zu/w600k_r50.onnx` mit dem geprüften Modell, starte den Worker erneut und schalte im Panel **ArcFace für Kameras freigeben** ein. Prüfe und speichere die Verbindung. Lerne unter **Gesichter** mindestens ein Referenzfoto pro Person ein und wähle an der Kamera **ArcFace im Heimnetz**. Hinweise zu Modell, Lizenz und Betrieb auf einem zweiten Gerät stehen in der [Heimnetz-Anleitung](raspberry-pi.md).

## Ollama optional

`scripts/Start-Ollama.ps1 -Install` installiert den optionalen lokalen Modellserver. Dies ist unabhängig von der lokalen OpenCV-Erkennung. Ein bildfähiges Modell installieren, unter KI-Anbieter konfigurieren und gezielt einer Kamera zuordnen. Große VLMs können ohne GPU langsam sein.

## Autostart

Für einen ersten privaten Betrieb kann die Windows-Aufgabenplanung `powershell.exe -NoProfile -File C:\Pfad\Tuerwache\scripts\Start-Tuerwache.ps1` bei der Benutzeranmeldung starten. Arbeitsverzeichnis auf den Projektordner setzen, keine parallelen Instanzen erlauben und unter einem normalen Benutzer ausführen. Dieser Autostart wird nicht ungefragt eingerichtet. Für einen dauerhaft unbeaufsichtigten Server ist der dokumentierte Linux-systemd-Weg vorzuziehen.
