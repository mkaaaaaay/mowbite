# MowBite

A web app for [OpenMower](https://github.com/ClemensElflein/OpenMower) robot mowers. It runs on the mower as a small
container and talks to OpenMower over MQTT, no cloud involved. Open it in the browser on a phone or computer, or use the
Android app.

MowBite is a community project and not affiliated with the OpenMower project.

## What it does

- **Dashboard**: what the mower is doing in plain words, battery, sensors and weather, the mowing plan with progress and
  time left, and the buttons to start, pause and send it home.
- **Map editor**: move, add and delete points, split and merge areas, snap to other areas, undo and redo, mow angle and
  mowing order, with a preview of the mowing plan. Every save makes a backup first, maps also load and save as GeoJSON.
- **Recording** new areas by driving the mower with a thumb stick, or with the phone held sideways as a remote.
- **Aerial imagery** under the map: the official open photos of Germany (not Saarland), Austria, Switzerland, the
  Netherlands, Belgium, Luxembourg, France, Spain, Czechia, Finland and the USA, Esri with an ArcGIS key of your own, or
  a source you add.
- **Garden style** for the map: lawn stripes along the mow angle, trees, beds, a pool and lots more pictures.
- **Activity**: every run with its result and track, problems explained in plain words, mowing hours, reminders for new
  blades and cleaning, and a diagnosis file per run to post when something goes wrong.
- **Push messages** through [ntfy](https://ntfy.sh) when the mower needs you: emergency stop, docking given up, standing
  still, done, rain, maintenance. The container sends them, so no app has to be open, the mower just needs internet.
- **Schedule**: days and start times with their areas. Skips rain and cold if you like, waits for the battery, and
  doesn't start in the dark unless you confirm it, hedgehogs are out then.
- **Sensors** over the last 24 hours, the battery over the weeks, GPS and Wi-Fi coverage on the map.
- **OpenMower's settings** in the app: lanes, outline passes, GPS, docking, rain and more.
- **Updates from the app** for MowBite, OpenMower and the MowBite Planner, with the
  [MowBite Updater](https://github.com/mkaaaaaay/mowbite-updater).
- **[MowBite Planner](https://github.com/mkaaaaaay/mowbite-planner)**: its menus show up when it runs on the mower.
- **[Home Assistant](https://github.com/mkaaaaaay/mowbite-ha)**: an integration with MowBite's card and map.
- More than one mower, a demo mower to look around, guides with moving pictures, several designs in light and dark,
  English and German.

Works with OpenMower v1 and v2. Some things need a newer OpenMower: MowBite asks the mower what it can do and leaves out
what yours doesn't have yet.

Ideas, wishes and translations are welcome as [issues](https://github.com/mkaaaaaay/mowbite/issues).

## Install

You need OpenMower running on the mower, with its MQTT websocket on port 9001 (the default).

In Dockge on the mower (OpenMowerOS has it on port 5001):

1. "+ Compose", name it `mowbite`
2. paste [compose.yaml](compose.yaml)
3. "Deploy"

Then open `http://<your-mower>:8082`. The MowBite Updater comes with it, its page is on port 8083.

<details>
<summary>Or in a terminal on the mower</summary>

```bash
mkdir -p /opt/stacks/mowbite && cd /opt/stacks/mowbite
curl -O https://raw.githubusercontent.com/mkaaaaaay/mowbite/main/compose.yaml
docker compose pull
docker compose up -d
```

</details>

### MowBite in a folder of its own

Older versions of this readme had you start MowBite in a folder of its own (`mkdir mowbite`). Dockge can't manage it
there and the updater doesn't find it. To move it over:

1. in a terminal on the mower: `cd ~/mowbite && docker compose down` (your settings stay)
2. in Dockge: "+ Compose" with the same name as that folder (`mowbite`), paste [compose.yaml](compose.yaml), "Deploy"
3. "Update" once, that gets the newest version

Changed something in the old `compose.yaml` (port, environment)? Do the same in the new one.

### Update

In the app under Settings, Updates, or in Dockge with "Update". Your settings stay. Reload the page afterwards, phones
like to keep the old version for a while.

Installed before 1.4.0-beta.12? Then the updater is still missing: in Dockge tap "Update" once, then the app shows the
lines to add under Settings, Updates, with a button to copy them.

<details>
<summary>Or in a terminal on the mower</summary>

```bash
cd /opt/stacks/mowbite
docker compose pull
docker compose up -d
```

</details>

### Versions

`latest` is always the newest version, betas included. Every version also has a tag of its own, e.g. `1.3.0` or
`1.4.0-beta.12`: put it in the image line of `compose.yaml` to stay on it. The settings page shows which version you
have. The images are for arm64 (the mower) and amd64.

### Build it yourself

```bash
git clone https://github.com/mkaaaaaay/mowbite.git
cd mowbite
docker compose up -d --build
```

Building on the mower needs about 1 GB of free space for a while. Short on space? Build it on a PC and copy it over:

```bash
docker buildx build --platform linux/arm64 -t ghcr.io/mkaaaaaay/mowbite:latest --load .
docker save ghcr.io/mkaaaaaay/mowbite:latest | ssh openmower@<your-mower> docker load
```

### Remove

```bash
cd /opt/stacks/mowbite
docker compose down
```

That removes MowBite and the updater. With `-v` the saved settings and map backups go too. MowBite doesn't change
OpenMower's files, the updater only writes the version you pick (`VERSION` in OpenMower's `.env`, the image line of an
app's `compose.yaml`).

### Troubleshooting

- **"waiting for map..." forever**: the browser can't reach MQTT. Check that `ws://<your-mower>:9001` is reachable from
  your device, and set `MOWER_MQTT_WS_URL` if MowBite doesn't run on the mower.
- **No data but the connection works**: your OpenMower may use a topic prefix, set `MOWER_MQTT_PREFIX`.
- **Saving the map fails**: OpenMower has to be running, the map is saved through it.
- **The updater doesn't list MowBite or OpenMower**: their stacks have to be in `/opt/stacks`, Dockge's folder (see
  above).

## Android app

The same app for your phone, no address to type each time: `MowBite.apk` comes with every
[release](https://github.com/mkaaaaaay/mowbite/releases), the newest is at the top.

Android asks once whether it may install apps from your browser. On the first start the app asks for your mower's
address. MowBite has to run on the mower too, the app talks to it over your home network. New versions install over the
old one and keep your settings.

## Configuration

The port you open is the first number under `ports` in `compose.yaml` (`8082`), change only that one. Then change
`openmower.ui.port` too: with the [OpenMower start page](https://github.com/xtech/web-openmower-entrypoint), MowBite
shows up there by itself.

Optional, under `environment` in `compose.yaml`:

- `MOWER_MQTT_WS_URL`: where the browser finds OpenMower's MQTT websocket. Without it the app takes
  `ws://<host it's opened from>:9001`, which is right when it runs on the mower.
- `MOWER_MQTT_PREFIX`: topic prefix, only if your OpenMower uses one.
- `MOWER_MQTT_HOST`, `MOWER_MQTT_PORT` (1883), `MOWER_MQTT_USER`, `MOWER_MQTT_PASSWORD`: the broker the container
  listens to. On the mower it finds it by itself, set these only for a broker somewhere else or with a login.
- `MOWBITE_SCHEDULER`: `off` on a second copy (e.g. on a PC), so only the one on the mower starts it by schedule.
- `UPDATER_URL`: where the updater runs, e.g. `http://openmower:8083`. Only needed when MowBite doesn't run on the mower
  and `MOWER_MQTT_HOST` isn't the mower.
- `MOWBITE_ORIGINS`: addresses that may start updates besides MowBite itself, comma separated. For MowBite's files on a
  web server of your own (`MowBite-web.zip` in the releases) or behind a proxy with another name.

The settings shared by all devices, the map backups and the recorded sensor values live in the `settings` volume. Other
apps can use the updates through MowBite (`/cgi-bin/update` on port 8082) or the updater directly (port 8083).

## Development

```bash
npm install
echo "NEXT_PUBLIC_MOWER_MQTT_WS_URL=ws://<your-mower>:9001" > .env.local
npm run dev
```

To open the dev server from a phone, allow its host: `DEV_ORIGINS=<pc-name>,<pc-ip> npm run dev -- -H 0.0.0.0`.

The Android app is the same build packed with [Capacitor](https://capacitorjs.com). With the Android
SDK and a JDK 21 installed:

```bash
npm run build
npx cap sync android
cd android && ./gradlew assembleDebug
```

## License

Copyright (C) 2026 mkay

GPL-3.0, see [LICENSE](LICENSE). MowBite comes without any warranty. On top of the GPL, these terms
under its section 7 apply to versions that are passed on with changes:

- The license doesn't cover the name MowBite or its logo (7e). A changed version needs a name and
  logo of its own and mustn't pass itself off as MowBite or as made by its author (7c).
- "© 2026 mkay" stays in the legal notices the app shows, next to the changed version's own (7b).

Built-in aerial imagery comes from the official surveying and mapping agencies under their open
data licenses (CC BY 4.0, CC0, dl-de/by-2-0, dl-de/zero-2-0, Etalab 2.0, the Flemish free reuse
license, swisstopo's free use terms, US public domain). Finland's comes from the National Land Survey
through the servers of Kapsi, a Finnish non-profit (CC BY 4.0). The app shows the required attribution
while imagery is on. Esri World Imagery only comes with an ArcGIS key of your own, under Esri's terms.
For a tile source you add yourself, you're responsible for its terms.
