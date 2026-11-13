import type {Camera} from '../camera';
import {RPC, TOPIC} from '../openmower';
import {demoFlags} from './flags';

// The cameras of a mower with MowBite OS for the click tests (camera.*), like MowBite OS answers them: none shows a
// picture while the blade runs. The demo is an OpenMower and has none, a test switches them on before the page loads
// (window.mowbiteDemoCameras). Each picture is a drawing with a leaf moving across, sent as an mjpeg stream from an
// address only the demo answers (demoStream). A test sets window.mowbiteDemoCameraRefuse to a reason to have the next
// stream turned down with it, window.mowbiteDemoCameraStatus to the HTTP status its address answers once

const CAMERAS: Camera[] = [
  {id: 'stereo', name: 'Stereo camera', kind: 'stereo', position: 'front', width: 640, height: 480, protocols: ['mjpeg'], available: true},
  {id: 'oa_left', name: 'Obstacle camera left', kind: 'obstacle', position: 'left', width: 640, height: 400, protocols: ['mjpeg'], available: true},
  {id: 'oa_right', name: 'Obstacle camera right', kind: 'obstacle', position: 'right', width: 640, height: 400, protocols: ['mjpeg'], available: true},
  {id: 'rear', name: 'Rear camera', kind: 'rear', position: 'rear', width: 640, height: 480, protocols: ['mjpeg'], available: true},
];

// a lawn up to a hedge, the stripes and a leaf that crosses in 7 s (t in s); the side and the back a little different
function picture(c: Camera, t: number): string {
  const hue = c.position === 'rear' ? 95 : c.position === 'left' ? 110 : c.position === 'right' ? 105 : 120;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${c.width}" height="${c.height}" viewBox="0 0 ${c.width} ${c.height}">
<rect width="100%" height="45%" fill="#9cc9e8"/>
<rect y="30%" width="100%" height="18%" fill="hsl(${hue - 20},35%,28%)"/>
<rect y="45%" width="100%" height="55%" fill="hsl(${hue},40%,38%)"/>
${[0, 1, 2, 3].map((i) => `<path d="M${c.width * (0.2 + 0.2 * i)} ${c.height * 0.45} L${c.width * (-0.4 + 0.6 * i)} ${c.height} L${c.width * (-0.1 + 0.6 * i)} ${c.height} Z" fill="hsl(${hue},45%,44%)"/>`).join('')}
<ellipse cx="${Math.round(((t % 7) / 7) * (c.width + 40) - 20)}" cy="${c.height * 0.7}" rx="14" ry="7" fill="#c98a2b"/>
<text x="16" y="${c.height - 16}" font-family="sans-serif" font-size="22" fill="#fff" opacity="0.8">Demo · ${c.name}</text>
</svg>`;
}

// the places given out by camera.stream and not connected to yet, each for one connection, and the streams that run
const places = new Map<string, Camera>();
const streams = new Set<{camera: Camera; end: () => void}>();
const FRAME_MS = 200;

// what the address of a demo stream answers: the camera's pictures like MowBite OS sends them (multipart, each part
// with its length) until either side ends it, 401 without a place for the token
export function demoStream(url: string, init: RequestInit): Response {
  const flags = demoFlags();
  const status = flags.mowbiteDemoCameraStatus as number | undefined;
  delete flags.mowbiteDemoCameraStatus;
  const token = new URL(url).searchParams.get('t') ?? '';
  const camera = places.get(token);
  places.delete(token);
  if (status || !camera) return new Response('no place for this token\n', {status: status ?? 401});
  const text = new TextEncoder();
  let timer: ReturnType<typeof setInterval>;
  const stream = {camera, end: () => {}};
  const off = () => {
    clearInterval(timer);
    streams.delete(stream);
  };
  const body = new ReadableStream<Uint8Array>({
    start(out) {
      // (a stream given up by its reader takes nothing more)
      const quietly = (act: () => void) => {
        off();
        try {
          act();
        } catch {}
      };
      const send = () => {
        const svg = text.encode(picture(camera, Date.now() / 1000));
        out.enqueue(text.encode(`--frame\r\nContent-Type: image/svg+xml\r\nContent-Length: ${svg.length}\r\n\r\n`));
        out.enqueue(svg);
        out.enqueue(text.encode('\r\n'));
      };
      stream.end = () => quietly(() => out.close());
      streams.add(stream);
      send();
      timer = setInterval(send, FRAME_MS);
      init.signal?.addEventListener('abort', () => quietly(() => out.error(new DOMException('aborted', 'AbortError'))));
    },
    cancel: off,
  });
  return new Response(body, {headers: {'content-type': 'multipart/x-mixed-replace; boundary=frame'}});
}

// a refusal as the mower sends it: -32600 with the event in its data
class Refused extends Error {
  code = -32600;
  data: Record<string, unknown>;
  constructor(reason: string) {
    super(`Camera refused: ${reason}`);
    this.data = {event: 'CAMERA_REFUSED', reason, message: this.message, severity: 'info', resume: 'auto'};
  }
}

// blade: what the demo's blade does now, each change of a camera sent as CAMERA_CHANGED and its viewers cut off
export function demoCameras(deliver: (topic: string, text: string) => void) {
  const cameras = CAMERAS.map((c) => ({...c}));
  let n = 0;
  return {
    methods: {
      [RPC.cameraList]: () => cameras,
      [RPC.cameraStream]: (params: unknown) => {
        const {id, protocol} = (params ?? {}) as {id?: string; protocol?: string};
        const c = cameras.find((x) => x.id === id);
        if (!c) throw new Error(`no camera ${id}`);
        if (protocol && !c.protocols.includes(protocol)) throw new Error(`${id} has no ${protocol}`);
        const flags = demoFlags();
        const refuse = flags.mowbiteDemoCameraRefuse as string | undefined;
        if (refuse) {
          delete flags.mowbiteDemoCameraRefuse;
          throw new Refused(refuse);
        }
        if (!c.available) throw new Refused(c.reason ?? 'NO_SIGNAL');
        const token = `demo${++n}`;
        places.set(token, c);
        return {url: `http://demo.invalid:8890/camera/${c.id}.mjpg?t=${token}`, protocol: 'mjpeg', expires: Math.floor(Date.now() / 1000) + 30};
      },
    } as Record<string, (params: unknown) => unknown>,
    blade(on: boolean) {
      for (const c of cameras) {
        if (c.available === !on) continue;
        c.available = !on;
        if (on) c.reason = 'BLADE_RUNNING';
        else delete c.reason;
        const {id, available, reason, protocols, width, height} = c;
        const event = {id: `cam${++n}`, t: Date.now() / 1000, type: 'CAMERA_CHANGED', camera_id: id, available, reason, protocols, width, height, severity: 'info', resume: 'auto'};
        deliver(TOPIC.events, JSON.stringify(event));
        if (!c.available) [...streams].filter((s) => s.camera === c).forEach((s) => s.end());
      }
    },
    // their process ended: nobody watches any more
    stop() {
      [...streams].forEach((s) => s.end());
      places.clear();
    },
  };
}
