import type {Camera} from '../camera';
import {RPC, TOPIC} from '../openmower';

// The cameras of a mower with MowBite OS for the click tests (camera.*), like MowBite OS answers them: none shows a
// picture while the blade runs. The demo is an OpenMower and has none, a test switches them on before the page loads
// (window.mowbiteDemoCameras). Each picture is a drawing that moves a little, sent as mjpeg. A test sets
// window.mowbiteDemoCameraRefuse to a reason to have the next stream turned down with it

type Flags = {mowbiteDemoCameras?: boolean; mowbiteDemoCameraRefuse?: string};
const flags = (): Flags => (typeof window === 'undefined' ? {} : (window as Flags));
export const demoCamerasOn = () => !!flags().mowbiteDemoCameras;

const CAMERAS: Camera[] = [
  {id: 'stereo', name: 'Stereo camera', kind: 'stereo', position: 'front', width: 640, height: 480, protocols: ['mjpeg'], available: true},
  {id: 'oa_left', name: 'Obstacle camera left', kind: 'obstacle', position: 'left', width: 640, height: 400, protocols: ['mjpeg'], available: true},
  {id: 'oa_right', name: 'Obstacle camera right', kind: 'obstacle', position: 'right', width: 640, height: 400, protocols: ['mjpeg'], available: true},
  {id: 'rear', name: 'Rear camera', kind: 'rear', position: 'rear', width: 640, height: 480, protocols: ['mjpeg'], available: true},
];

// a lawn up to a hedge, the stripes and a leaf moving across; the side and the back a little different
function picture(c: Camera): string {
  const hue = c.position === 'rear' ? 95 : c.position === 'left' ? 110 : c.position === 'right' ? 105 : 120;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${c.width} ${c.height}">
<rect width="100%" height="45%" fill="#9cc9e8"/>
<rect y="30%" width="100%" height="18%" fill="hsl(${hue - 20},35%,28%)"/>
<rect y="45%" width="100%" height="55%" fill="hsl(${hue},40%,38%)"/>
${[0, 1, 2, 3].map((i) => `<path d="M${c.width * (0.2 + 0.2 * i)} ${c.height * 0.45} L${c.width * (-0.4 + 0.6 * i)} ${c.height} L${c.width * (-0.1 + 0.6 * i)} ${c.height} Z" fill="hsl(${hue},45%,44%)"/>`).join('')}
<ellipse cx="0" cy="${c.height * 0.7}" rx="14" ry="7" fill="#c98a2b"><animate attributeName="cx" values="-20;${c.width + 20}" dur="7s" repeatCount="indefinite"/></ellipse>
<text x="16" y="${c.height - 16}" font-family="sans-serif" font-size="22" fill="#fff" opacity="0.8">Demo · ${c.name}</text>
</svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
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

// blade: what the demo's blade does now, each change of a camera sent as CAMERA_CHANGED
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
        const refuse = flags().mowbiteDemoCameraRefuse;
        if (refuse) {
          delete flags().mowbiteDemoCameraRefuse;
          throw new Refused(refuse);
        }
        if (!c.available) throw new Refused(c.reason ?? 'NO_SIGNAL');
        return {url: picture(c), protocol: 'mjpeg', expires: Date.now() / 1000 + 30};
      },
    } as Record<string, (params: unknown) => unknown>,
    blade(on: boolean) {
      for (const c of cameras) {
        if (c.available === !on) continue;
        c.available = !on;
        if (on) c.reason = 'BLADE_RUNNING';
        else delete c.reason;
        const t = Date.now() / 1000;
        deliver(TOPIC.events, JSON.stringify({id: `cam${++n}`, t, type: 'CAMERA_CHANGED', camera_id: c.id, available: c.available, reason: c.reason ?? null}));
      }
    },
  };
}
