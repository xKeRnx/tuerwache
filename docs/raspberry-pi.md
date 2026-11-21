# Raspberry Pi

Unter emuliertem Linux/ARM64 wurden der Serverstart, der FFmpeg-Start und das Einlernen sowie Wiedererkennen eines Testgesichts geprüft. Auf einem echten Pi stehen der Test mit Ring-Kameras und die Messung von Kameraanzahl, KI-Laufzeit und Temperatur noch aus.

Als Ausgangspunkt für einen Versuch: Pi 5 mit 8 GB RAM, 64-Bit-OS, aktiver Kühlung und SSD. Dies ist eine Einschätzung, keine gemessene Mindestanforderung. [Offizielle Pi-5-Daten](https://www.raspberrypi.com/products/raspberry-pi-5/) bestätigen die 64-Bit-Plattform.

## Sinnvolle Aufteilung

- Pi: Ereignisse, kurze Clips, Website und Benachrichtigungen.
- OpenCV-Personen-/Gesichtserkennung: erst eine Kamera testen; Laufzeit, Temperatur und Warteschlange beobachten.
- VLM-Beschreibungen: vorzugsweise anderer Rechner im privaten Netz mit Ollama/LM Studio/llama.cpp oder bewusst gewählter Cloud-Anbieter.

Ein großes VLM direkt auf dem Pi ist keine Voraussetzung. Daueraufnahme mit Akku-Ring-Geräten ist nicht vorgesehen. Unter **Betrieb** lässt sich das Limit für gleichzeitig genutzte Kamerastreams auf 1 bis 8 einstellen, mit 4 als Standard. Auf dem Pi zuerst mit einem Stream testen und erst nach Messung erhöhen.

## Installation und Test

[Linux-Anleitung](linux.md) verwenden. Bei diesem Ziel muss `uname -m` aarch64 zeigen. Ein 32-Bit-System ist nicht unterstützt. FFmpeg und die fixierten Python-Binärpakete müssen verfügbar sein; ansonsten abbrechen und Plattform prüfen.

Eine Kamera verbinden, Bewegung und Klingeln einzeln testen, Clip mit Ton abspielen und nach Neustart erneut prüfen. Erst dann lokale KI einschalten. Für den Umzug vom Windows-Server eine verschlüsselte Sicherung verwenden. Die [Wiederherstellung](operations.md) schreibt absolute Clip-Pfade für den neuen Datenordner um.

## Gesichts-Worker im Heimnetz

Auf dem zweiten Rechner Türwache samt OpenCV-Modellen installieren. Einen zufälligen Schlüssel erzeugen (`node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`) und auf beiden Rechnern als `FACE_WORKER_TOKEN` setzen. Auf dem Rechner für den Worker in `.env` die folgenden Werte setzen:

```dotenv
FACE_WORKER_HOST=192.168.1.10
FACE_WORKER_PORT=3211
FACE_WORKER_CERT=/path/to/cert.pem
FACE_WORKER_KEY=/path/to/key.pem
# AI_PYTHON=/opt/tuerwache/.venv/bin/python
```

Den Worker mit `node --env-file=.env scripts/start-face-worker.mjs` starten. Auf dem Pi in `.env` `FACE_WORKER_URL=https://ki.home.arpa:3211` auf die tatsächliche Worker-Adresse setzen und Türwache neu starten. Das Zertifikat muss zur Adresse passen und in der Python-Umgebung des Pi vertrauenswürdig sein. In **Standorte → Privatzonen & KI** die Engine für die gewünschten Kameras wählen.

Übertragen werden ausgerichtete Gesichtsausschnitte an den eigenen Worker. Die gespeicherten Vorlagen, Namen und der Abgleich bleiben auf Türwache. Ist der Worker nicht erreichbar oder sind für die Kamera Privatzonen gesetzt, berechnet Türwache die Merkmale lokal. Auf Loopback ist für einen Test auch HTTP möglich.

## ONVIF und RTSP

- Raspberry Pi OS 64 Bit und Node.js 24 verwenden. In Docker wird für die ONVIF-Suche unter Linux das Host-Netzwerk genutzt. Mit der manuellen Adresse funktioniert RTSP auch ohne Multicast.
- Im Kameramenü H.264 und nach Möglichkeit einen Schlüsselbildabstand von rund zwei Sekunden wählen. Damit speichert Türwache den Videostream ohne erneute Kodierung. H.265-Umwandlung und Bewegungserkennung je Kamera bei Bedarf aktivieren und die CPU-Auslastung prüfen.
- Den Pufferordner und die Clips auf einer SSD ablegen. Das Netzwerkkamera-Limit steht unter **Betrieb**. [Netzwerkkameras einrichten](network-cameras.md)
