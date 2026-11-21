# Kameras, KI und Fehler finden

## Aufnahmen

Türwache- und Ring-Konto sind getrennt. Unter Kameras pro Gerät Überwachung, Bewegung/Klingeln, Dauer, Mindestabstand, Erkennung, Beschreibungsmodell und Discord wählen. Ein gespeichertes Modell allein aktiviert keine Kameraanalyse.

Eine manuelle Aufnahme unter Übersicht prüfen. Unter Clips stehen gespeicherte Videos; der Zeitstrahl verbindet Ereignisse, Aufnahmezustand und Beschreibungen. Bewegungsmeldung bedeutet nicht automatisch gespeicherte Aufnahme.

## Warum fehlt ein Clip oder ein Teil des Besuchs?

Neue Clips werden vor Veröffentlichung vollständig auf Decoderfehler und größere Zeitlücken geprüft. Eine Warnung im Cliparchiv weist auf beeinträchtigte Aufnahmen hin. Größere Empfangspuffer, längere Paket-Nachforderungen und eine normale MP4-Datei mit vorangestelltem Index verbessern die Übertragung und Wiedergabe; sie erzeugen keine verlorenen Kamerabilder und erhöhen nicht die tatsächliche Kamerabildrate.

Aufnahmen und Web-Livebild kopieren jetzt das empfangene H.264-Videobild ohne lokale Verkleinerung oder FPS-Filter. Im Livebild wird die gemessene Auflösung und ungefähre Bildrate angezeigt. Die vom Ring-Dienst tatsächlich gelieferte Qualität kann je Sitzung abweichen. Kameraton wird für kompatible Wiedergabe weiterhin nach AAC umgewandelt. Die frühere feste Live-Begrenzung auf 720 Pixel und 15 FPS ist entfernt. HLS hat weiterhin einen Wiedergabepuffer und damit mehr Verzögerung als eine direkte WebRTC-Verbindung.

Die FPS-Anzeige wird aus dekodierten Bildern des ersten Live-Segments berechnet. Eine im Transport-Header angekündigte Bildrate kann davon abweichen und ist kein Nachweis tatsächlich gelieferter Bilder.

- Aufnahme ausgeschaltet oder Server beim Ereignis nicht aktiv.
- Mindestabstand seit letztem Aufnahmestart noch nicht erreicht.
- Eine andere Aufnahme läuft: aktuell höchstens eine gleichzeitig.
- Akku-Kamera wacht verspätet auf, Live-Verbindung scheitert oder Speicher fehlt.
- Der spätere Teil des Besuchs liegt nach Clipende, ohne weiteres verwertbares Ereignis.

Ereignisdetails und Aufnahme-/KI-Zustand lesen. Dauer/Abstand pro Kamera ändern; dies kann Akku kosten. Nicht aufgenommene Bilder sind nicht rückwirkend verfügbar. Alte tonlose Clips bekommen keinen Ton. Neue Clips und Livebild verwenden Kameraton, sofern Ring ihn liefert; Playerlautstärke prüfen.

## Gesichter und VLM

OpenCV erkennt Personen und Gesichter lokal. Pro Person bis zu zwölf Fotos mit verschiedenen Blickwinkeln/Lichtbedingungen einlernen, jeweils genau ein klares Gesicht und Einverständnis der Person. Unter Gesichter Vorlagen ergänzen/entfernen oder unbekannte Vorschläge selbst zuordnen.

Wenn Türwache ein Gesicht findet, aber den Namen selten bestätigt, ergänze eine scharfe Vorlage aus demselben Kamerawinkel. Wähle dafür einen sichtbaren Ausschnitt unter **Unbekannte Gesichter zuordnen** und verwende den vorhandenen Namen. Starte danach im Clip die KI-Auswertung erneut. Türwache nutzt beim Ausschneiden die Originalauflösung und passt bei dunklen Ausschnitten lokal die Helligkeit an. Mehr Licht und eine kurze Sicht von vorn helfen besonders bei kleinen oder unscharfen Gesichtern.

Automatische Namen erfordern konsistente Bestätigung in mindestens drei verschiedenen Frames mit zeitlichem Abstand. Unsichere oder widersprüchliche Treffer bleiben unbestätigt. Ähnlichkeit ist keine Wahrscheinlichkeit. Ein dauerhafter Python-Worker hält Modelle geladen und verarbeitet Aufträge nacheinander.

Das VLM bekommt keine lokale Namensliste oder Gesichtsvektoren. Verifizierte Namen werden separat aus der lokalen Mehrbilderkennung ergänzt; dies beweist keine vom Modell beschriebene Handlung. KI-Texte können falsch sein. Referenzänderungen machen ältere automatische Identitätsbelege ungültig. Bereits versandte Discord-Nachrichten werden dadurch nicht zurückgerufen.

## Modelle auswählen

Unter KI-Anbieter Modelle hinzufügen, bearbeiten, prüfen und entfernen. Lokale Server: Ollama, LM Studio, llama.cpp, LocalAI und vLLM. Cloud: gängige Anbieter und OpenAI-kompatible Schnittstellen. Ein bildfähiges Modell ist nötig.

Mehrere Modelle können gespeichert sein; jede Kamera verwendet genau ihr gewähltes Beschreibungsmodell, ohne automatischen Cloud-Fallback. Lokale Gesichtserkennung kann parallel laufen: Sie bestimmt Identitäten, das VLM beschreibt Bilder.

Cloud-Aufrufe übertragen ausgewählte Frames und die Ortsbeschreibung. Alle Cloud-Anbieter teilen ein konfigurierbares tägliches Anfragelimit in UTC, inklusive Fehlern. Dies ist kein Geldlimit. Anbieterpreise/Datenbedingungen selbst prüfen.

## Discord und Speicher

Eigenen Webhook hinterlegen und Kamera-Schalter für Klingeln, Clip und Personen-/Zusammenfassungsbild aktivieren. Ein Personenbild braucht erfolgreiche Personenerkennung, ein Zusammenfassungsbild eine erfolgreiche Beschreibung. Dateigrößenlimits und Webhook-Fehler können Anhänge verhindern. Alte Ereignisse werden nicht automatisch erneut gesendet. Manuelle Analysen lösen keine automatischen Meldungen aus.

Clips bleiben lokal oder in einem anderen beschreibbaren Ordner; optional private R2-/S3-Kopie aktivieren. Cloudvideos ersetzen kein vollständiges App-Backup. Zugangsschlüssel nur auf dem eigenen Server eingeben.

## Standorte und Benutzer

Unter **Ring-Konten** kannst du weitere Konten mit eigener Anmeldung und eigener 2FA verbinden. Geteilte Ring-Kameras erscheinen einmal in Türwache. Unter **Standorte** kannst du die übernommenen Ring-Standorte umbenennen, eigene Standorte anlegen und Kameras zuordnen. Hier stehen Kamerastatus und letztes Klingel- oder Bewegungsereignis. Alte Aufnahmen bleiben beim Trennen eines Kontos verfügbar.

Unter **Benutzer** öffnest du **Rechte bearbeiten** bei einer Rolle oder **Konto & Rechte** bei einem Benutzer. Wähle unter **Kamerazugriff** die Standorte und Kameras aus und öffne **Rechte** neben dem jeweiligen Namen. Clips ansehen, exportieren, schützen und löschen lassen sich einzeln einstellen. Aktionen an einem Clip setzen das Recht **Clips ansehen** voraus. Benutzerspezifische Regeln haben Vorrang vor der Rolle. Bei mehreren passenden Regeln derselben Ebene gilt die Sperre. Die Administratorrolle hat Vollzugriff.

Unter **Handy-App → Push-Ruhezeiten** oder **Mein Handy** in der App stellst du ein Zeitfenster und die Zeitzone ein. Die Einstellung gilt pro Benutzer für dessen Geräte. Klingeln kann als Ausnahme zugelassen werden.

## Privatzonen und Gesichts-Engine

Im Standort bei der Kamera **Privatzonen & KI** öffnen und Rechtecke zeichnen oder ihre Position in Prozent eingeben. Der explizite Clip-Download und Discord-Anhänge decken die Bereiche schwarz ab. Einzelbilder für Szenenbeschreibungen erhalten dieselben Masken. Das Original mit Ton steht weiterhin den Benutzern offen, die Clip-Wiedergabe für diese Kamera dürfen. Geschützte Backups und private R2-/S3-Speicherkopien archivieren das Original. Bereits versandte Anhänge behalten ihren damaligen Stand.

Die Gesichtsprüfung liest am Clipanfang und in der Nähe von Personensichtungen zusätzliche Bilder. Ein Name braucht weiterhin drei verschiedene, übereinstimmende Bilder. Bei Bedarf kann ein [Gesichts-Worker im Heimnetz](raspberry-pi.md) die Bildmerkmale berechnen. Kameras mit Privatzonen verwenden für Gesichter die lokale Engine.
