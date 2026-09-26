# Mowmate

A web app for [OpenMower](https://github.com/ClemensElflein/OpenMower) robot mowers. It runs on the
mower itself as a small container (about 5 MB) and talks to OpenMower over MQTT, no cloud involved.
Works on phones and desktops.

Mowmate is a community project and not affiliated with the OpenMower project.

## What it does

- **Dashboard**: what the mower is doing in plain words, battery, the important sensor values,
  controls, today's runs, and a map that follows the mower while it drives (or always, if you like).
- **Map editor**: zoom and pan, move, add and delete outline points (with a loupe on touch screens),
  reduce the points of recorded outlines, split and merge areas, rename areas and change their type,
  undo. Changes are only sent to the mower when you save.
- **Mowing settings per area**: outline passes, overlap, offset and mow angle, with a preview of the
  mowing direction. The preview follows the same rules as the mower, including `mow_angle_offset`.
- **Mowing order** of the areas.
- **Tracks**: the trail of the current mow and of past mows, read from the mower's own history.
- **Activity**: every day's runs from the mower's event history, with the result, the areas, the
  mowing time and a timeline. Problems come with an explanation, the circumstances and the raw
  entry from the history file.
- **Aerial imagery** under the map, optional: in Germany the official orthophotos of the state the
  mower is in (open data, every state except Saarland), anywhere else an XYZ tile source you add in
  the settings.
- **Sensors** with lowest and highest values of the last 24 hours. The container records them, so
  it doesn't matter whether a browser was open.
- **Colors, icons and icon sizes** of the map, shared between all your devices.

Works with OpenMower v1 and v2 hardware.

## Install on the mower

You need a running OpenMower with the MQTT websocket on port 9001, which is the default. On the
mower:

```bash
mkdir mowmate && cd mowmate
curl -O https://raw.githubusercontent.com/mkaaaaaay/mowmate/main/compose.yaml
docker compose pull
docker compose up -d
```

Then open `http://<your-mower>:8082`. Port 8082 is used because OpenMower already uses 3000 and
8080; change it in `compose.yaml` if you like. The image is about 5 MB and exists for arm64 (the
mower) and amd64.

### Build it yourself

```bash
git clone https://github.com/mkaaaaaay/mowmate.git
cd mowmate
docker compose up -d --build
```

Building on the mower needs about 1 GB of free space for a while. If yours is short on space, build
on a PC and copy the image over:

```bash
docker buildx build --platform linux/arm64 -t ghcr.io/mkaaaaaay/mowmate:latest --load .
docker save ghcr.io/mkaaaaaay/mowmate:latest | ssh openmower@<your-mower> docker load
```

### Update

```bash
cd mowmate
docker compose pull
docker compose up -d
```

(or `git pull` and `docker compose up -d --build` if you build it yourself)

Your settings stay, they live in the `settings` volume. Reload the page afterwards, phones like to
keep the old version for a while.

### Remove

```bash
cd mowmate
docker compose down -v
```

`-v` also deletes the saved settings, leave it out to keep them. Nothing else on the mower is
touched, Mowmate doesn't change any OpenMower files.

### Troubleshooting

- **"waiting for map..." forever**: the browser can't reach MQTT. Check that
  `ws://<your-mower>:9001` is reachable from the device you're using, and set `MOWER_MQTT_WS_URL`
  if the app isn't running on the mower.
- **No data but the connection works**: your OpenMower may use a topic prefix, set
  `MOWER_MQTT_PREFIX`.
- **Saving the map fails**: OpenMower needs to be running (the map is saved through its RPC), and
  it's best to save while the mower is docked.
- **Colors and icons aren't shared between devices**: that only works when the app is served by the
  container, not with `npm run dev`.

## Configuration

The port you open in the browser is the first number under `ports` in `compose.yaml` (`8082`).
Change only that one, the `8080` behind it is the port inside the container.

Optional settings go under `environment` in `compose.yaml`:

- `MOWER_MQTT_WS_URL`: where the browser finds OpenMower's MQTT websocket. Without it the app uses
  `ws://<host the app is opened from>:9001`, which is right when it runs on the mower.
- `MOWER_MQTT_PREFIX`: topic prefix, only if your OpenMower uses one.
- `MOWER_MQTT_HOST`, `MOWER_MQTT_PORT` (default 1883), `MOWER_MQTT_USER`, `MOWER_MQTT_PASSWORD`:
  the broker the sensor recorder listens to. On the mower it finds it by itself, set these only if
  the broker runs somewhere else or needs a login.

Settings made in the app (colors, icons) and the recorded sensor values are stored in the
`settings` volume.

If you run the [OpenMower start page](https://github.com/xtech/web-openmower-entrypoint), Mowmate
shows up there by itself (labels in `compose.yaml`). Change `openmower.ui.port` too if you change
the port.

## Development

```bash
npm install
echo "NEXT_PUBLIC_MOWER_MQTT_WS_URL=ws://<your-mower>:9001" > .env.local
npm run dev
```

To open the dev server from a phone, allow its host: `DEV_ORIGINS=<pc-name>,<pc-ip> npm run dev -- -H 0.0.0.0`.

## License

GPL-3.0, see [LICENSE](LICENSE).

Built-in aerial imagery comes from the surveying offices of the German states under their open
data licenses (CC BY 4.0, dl-de/by-2-0 or dl-de/zero-2-0). The app shows the required attribution
while imagery is on. For a tile source you add yourself, you're responsible for its terms.
