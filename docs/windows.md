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

## Ollama optional

`scripts/Start-Ollama.ps1 -Install` installiert den optionalen lokalen Modellserver. Dies ist unabhängig von der lokalen OpenCV-Erkennung. Ein bildfähiges Modell installieren, unter KI-Anbieter konfigurieren und gezielt einer Kamera zuordnen. Große VLMs können ohne GPU langsam sein.

## Autostart

Für einen ersten privaten Betrieb kann die Windows-Aufgabenplanung `powershell.exe -NoProfile -File C:\Pfad\Tuerwache\scripts\Start-Tuerwache.ps1` bei der Benutzeranmeldung starten. Arbeitsverzeichnis auf den Projektordner setzen, keine parallelen Instanzen erlauben und unter einem normalen Benutzer ausführen. Dieser Autostart wird nicht ungefragt eingerichtet. Für einen dauerhaft unbeaufsichtigten Server ist der dokumentierte Linux-systemd-Weg vorzuziehen.
