# Mowmate

A web app for [OpenMower](https://github.com/ClemensElflein/OpenMower) robot mowers. It runs on the
mower itself as a small container (about 5 MB) and talks to OpenMower over MQTT, no cloud involved.
Works on phones and desktops.

Mowmate is a community project and not affiliated with the OpenMower project.

## What it does

- **Dashboard**: state, battery, GPS, controls, and a map that follows the mower while it drives.
- **Map editor**: zoom and pan, move, add and delete outline points (with a loupe on touch screens),
  reduce the points of recorded outlines, split and merge areas, rename areas and change their type,
  undo. Changes are only sent to the mower when you save.
- **Mowing settings per area**: outline passes, overlap, offset and mow angle, with a preview of the
  mowing direction. The preview follows the same rules as the mower, including `mow_angle_offset`.
- **Mowing order** of the areas.
- **Tracks**: the trail of the current mow and of past mows, read from the mower's own history.
- **Aerial imagery** under the map, optional: Esri World Imagery everywhere, and the official
  20 cm orthophotos of LGLN when the mower is in Lower Saxony, Germany.
- **Sensors** with a one hour history.
- **Colors and icons** of the map, shared between all your devices.

Works with OpenMower v1 and v2 hardware.

## Install on the mower

You need a running OpenMower with the MQTT websocket on port 9001, which is the default.

```bash
git clone https://github.com/mkaaaaay/mowmate.git
cd mowmate
docker compose up -d --build
```

Then open `http://<your-mower>:8082`. Port 8082 is used because OpenMower already uses 3000 and
8080; change it in `compose.yaml` if you like.

Building on the mower needs about 1 GB of free space for a while. If yours is short on space, build
on a PC and copy the image over:

```bash
docker buildx build --platform linux/arm64 -t mowmate --load .
docker save mowmate | ssh openmower@<your-mower> docker load
```

and on the mower run `docker compose up -d` without `--build`.

### Update

```bash
cd mowmate
git pull
docker compose up -d --build
```

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

Everything is optional. Set these in `compose.yaml`:

| Variable | Default | |
|---|---|---|
| `MOWER_MQTT_WS_URL` | `ws://<host the app is opened from>:9001` | set it when the app doesn't run on the mower |
| `MOWER_MQTT_PREFIX` | empty | topic prefix, if your OpenMower uses one |
| `PORT` | `8080` | port inside the container |

Settings made in the app (colors, icons) are stored in the `settings` volume.

## Development

```bash
npm install
echo "NEXT_PUBLIC_MOWER_MQTT_WS_URL=ws://<your-mower>:9001" > .env.local
npm run dev
```

To open the dev server from a phone, allow its host: `DEV_ORIGINS=<pc-name>,<pc-ip> npm run dev -- -H 0.0.0.0`.

## License

GPL-3.0, see [LICENSE](LICENSE).

Aerial imagery: Esri, Maxar, Earthstar Geographics; LGLN, CC BY 4.0. The app shows the attribution
while imagery is on.
