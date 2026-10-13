# MowBite privacy policy

MowBite is an app for OpenMower robot mowers. It talks directly to your mower in your own network.

- **No account, no cloud, no tracking.** The app has no analytics, no ads and no server of its own. The developer receives no data from the app.
- **Mower data stays local.** The map, position, tracks, sensor values, schedule and settings are exchanged only between the app and the MowBite container on your mower. The mower's address and your settings are stored on your device.
- **Optional services you switch on yourself.** Each of them receives your IP address, as with any internet request:
  - Aerial imagery under the map: map tiles are loaded from the public imagery service you choose (state or national survey offices, or a source you enter). The service sees which map section is requested, which is roughly where your garden is.
  - Weather and rain forecast: Open-Meteo receives the mower's position, rounded to about a kilometer.
  - Update check: asks GitHub for the newest MowBite release.
  - Notifications: sent by the container on your mower to the ntfy server you enter, not by the app.
- **Deleting data:** uninstalling the app removes everything it stored on your device.

Questions about privacy: open an issue at https://github.com/mkaaaaaay/mowbite/issues

## Datenschutzerklärung (Deutsch)

MowBite ist eine App für Mähroboter mit OpenMower. Sie spricht direkt mit deinem Mäher im eigenen Netz.

- **Kein Konto, keine Cloud, kein Tracking.** Die App hat keine Analyse, keine Werbung und keinen eigenen Server. Der Entwickler erhält keine Daten aus der App.
- **Mäherdaten bleiben lokal.** Karte, Position, Spuren, Sensorwerte, Zeitplan und Einstellungen werden nur zwischen der App und dem MowBite-Container auf deinem Mäher ausgetauscht. Die Adresse des Mähers und deine Einstellungen liegen auf deinem Gerät.
- **Dienste, die du selbst einschaltest.** Jeder davon erfährt deine IP-Adresse, wie bei jeder Anfrage im Internet:
  - Luftbilder unter der Karte: Die Kacheln kommen vom gewählten öffentlichen Bilddienst (Landes- oder Staatsvermessung oder eine eigene Quelle). Der Dienst sieht den angefragten Kartenausschnitt, also ungefähr, wo dein Garten liegt.
  - Wetter und Regenvorhersage: Open-Meteo erhält die auf etwa einen Kilometer gerundete Position des Mähers.
  - Update-Prüfung: fragt GitHub nach der neuesten MowBite-Version.
  - Benachrichtigungen: verschickt der Container auf deinem Mäher an den ntfy-Server, den du einträgst, nicht die App.
- **Daten löschen:** Mit der Deinstallation ist alles weg, was die App auf deinem Gerät gespeichert hat.

Fragen zum Datenschutz: ein Issue auf https://github.com/mkaaaaaay/mowbite/issues anlegen
