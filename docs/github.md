# GitHub, Lizenz und Geschäftsmodell

## Was öffentlich ist

Türwache lässt sich kostenlos im eigenen Haushalt betreiben. Der Quellcode kann öffentlich gelesen und unter der Privatnutzungslizenz unentgeltlich geteilt werden. Wer eine Fassung ändert, veröffentlicht auch bei rein privatem Einsatz den zugehörigen Quellcode unter derselben Lizenz. Verkauf, entgeltliches Hosting, kommerzielle Nutzung und Weitergabe in bezahlten Paketen sind ausgeschlossen. Die genauen Bedingungen stehen im [Lizenztext](../LICENSE.md).

Auf GitHub eignet sich die Bezeichnung „öffentlich einsehbarer Quellcode für private Nutzung“. Die [Open Source Initiative](https://opensource.org/definition-annotated) verlangt, dass auch kommerzielle Verwendung erlaubt ist. Ein öffentliches GitHub-Repository erlaubt das Anzeigen und Forken über GitHub. [GitHub-Lizenzdokumentation](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/licensing-a-repository)

Für Privatnutzer gibt es Anleitungen zum [lokalen Betrieb und zum Einrichtungsservice](saas.md).

## Veröffentlichung vorbereiten

- Rechteinhaber und Lizenzkontakt eindeutig angeben. Vor der Veröffentlichung die eigene Lizenz juristisch prüfen lassen, insbesondere die Veröffentlichungspflicht bei ausschließlich privaten Änderungen und die Einbeziehung der Lizenzbedingungen. [§ 31 UrhG](https://www.gesetze-im-internet.de/urhg/__31.html) · [§§ 305](https://www.gesetze-im-internet.de/bgb/__305.html), [307 BGB](https://www.gesetze-im-internet.de/bgb/__307.html)
- Bei Fremdbeiträgen festhalten, unter welchen Bedingungen sie übernommen werden dürfen. Bestehende Rechte aus früheren Veröffentlichungen gelten nach ihren ursprünglichen Bedingungen fort.
- Drittanbieterhinweise erhalten. Expo-Vorlagen, FFmpeg, KI-Modelle und andere Abhängigkeiten haben eigene Bedingungen. Vor dem Verteilen vorkompilierter Pakete die Distributionsbedingungen prüfen.
- Einen bereinigten GitHub-Export in einen neuen, leeren Ordner erstellen. Das Skript filtert Laufzeitdaten, private Konfiguration und Schlüssel. Den Export zusätzlich auf Zugangsdaten und private Dateien prüfen.

```sh
node scripts/prepare-repository.mjs --public --destination /pfad/zum/neuen/github-export
```

Der öffentliche Export enthält die beispielhaften Doku-Screenshots. Die Fotos der optionalen KI-Tests bleiben außerhalb des Exports. Die Anleitungen sind in der App unter **System → Dokumentation** erreichbar. Die Türwache-Website bindet dieselben Inhalte unter `/dokumentation/` ein.
