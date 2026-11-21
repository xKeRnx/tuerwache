# Türwache Dokumentation

Türwache ist ein privater Kameraserver für Ring und Netzwerkkameras. Die Weboberfläche bündelt Clips, Zeitstrahl, lokale KI und Benachrichtigungen. Wähle Deutsch oder Englisch in der Kopfzeile.

## Beginnen

- [Windows installieren](windows.md)
- [Linux und Server installieren](linux.md)
- [Raspberry Pi einordnen](raspberry-pi.md)
- [Bedienung, KI und Fehler finden](usage.md)
- [Netzwerkkameras per ONVIF und RTSP verbinden](network-cameras.md)
- [Sicherheit, Backup und Updates](operations.md)
- [Handy-Apps und Architektur](architecture.md)
- [Lokaler Betrieb und Hilfe](saas.md)
- [GitHub, Lizenz und Geschäftsmodell](github.md)

## Ehrlicher Entwicklungsstand

Windows und die eigene Ring Battery Doorbell Pro wurden praktisch getestet. Livebild und neue Aufnahmen enthalten Ton, sofern die Kamera ihn liefert. Der private Kameratest funktionierte ohne Ring-Abo und laut Nutzer ohne Probeabo. Das ist keine Garantie für jedes Ring-Gerät oder eine dauerhafte, offiziell zugesicherte API-Funktion.

Ring-Konto, Internet und Ring-Cloud bleiben nötig. Das Projekt ersetzt weder die Firmware noch den Cloud-Verbindungsaufbau der Kamera. Ein Akku-Gerät wacht erst auf: Der Beginn eines Ereignisses kann fehlen. Mehrere Kameras können gleichzeitig aufnehmen; pro Kamera teilen Livebild und Aufnahme eine Verbindung. Das Gesamtlimit steht unter Betrieb.

Der Linux-x86_64-Container wurde einschließlich HTTP-Server, Modelldownload und dauerhaftem Python-Worker getestet. Echte Raspberry-Pi-Hardware, systemd-Dienstbetrieb und iOS-Installation sind noch nicht getestet. KI kann Ereignisse falsch beschreiben oder Personen übersehen. Es gibt keine Zusage von 100 % Sicherheit oder Erkennungsgenauigkeit.
