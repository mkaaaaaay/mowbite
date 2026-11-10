import {reasonText} from './events';
import {tr} from './i18n';
import {RPC} from './openmower';
import {callRpc} from './rpc';

// the cameras of a mower with MowBite OS (camera.*, masterplan 3.9): a list with whether each one can show a picture
// now and why not, and a stream of one for a single connection. at most two watch at a time over all cameras, the
// mower only streams while someone does

export type CameraPosition = 'front' | 'rear' | 'left' | 'right';
export interface Camera {
  id: string;
  name: string;
  // what it is for (stereo, obstacle, ...), not shown
  kind: string;
  // where it sits on the mower, null or missing when that isn't fixed or known
  position?: string | null;
  width: number;
  height: number;
  protocols: string[];
  available: boolean;
  // why not, the names of CAMERA_REFUSED
  reason?: string;
  detail?: string;
}
export interface Stream {
  url: string;
  protocol: string;
  // until when the url can be connected to (unix s), once connected it holds until the connection ends
  expires: number;
}

export const loadCameras = () => callRpc<Camera[]>(RPC.cameraList);
export const openStream = (id: string, protocol: string) => callRpc<Stream>(RPC.cameraStream, {id, protocol});

const POSITIONS: Record<CameraPosition, string> = {
  front: 'Front camera',
  left: 'Left side camera',
  right: 'Right side camera',
  rear: 'Rear camera',
};
// the same in a few letters, for the buttons to switch between them
const SHORT: Record<CameraPosition, string> = {front: 'Front', left: 'Left', right: 'Right', rear: 'Rear'};
const ORDER = Object.keys(POSITIONS);
const placed = (c: Camera): CameraPosition | null => (c.position && c.position in POSITIONS ? (c.position as CameraPosition) : null);
const rank = (c: Camera) => {
  const p = placed(c);
  return p ? ORDER.indexOf(p) : ORDER.length;
};

// front, the sides, the back, then those without a fixed place by name
export const sortCameras = (list: readonly Camera[]) => [...list].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));

// where it sits, by the mower's name for it when that isn't known or two sit there
export function cameraLabel(c: Camera, all: readonly Camera[], short = false): string {
  const p = placed(c);
  return p && all.filter((o) => placed(o) === p).length === 1 ? tr((short ? SHORT : POSITIONS)[p]) : c.name || c.id;
}

// the cameras to switch between: short where each sits, the whole name for screen readers, one alone just the camera
export const cameraParts = (list: readonly Camera[]) =>
  list.map((c) => ({key: c.id, text: list.length > 1 ? cameraLabel(c, list, true) : tr('Camera'), name: cameraLabel(c, list)}));

// width to height of the place for their pictures: the highest of them fits, so switching moves nothing
export function pictureRatio(list: readonly Camera[]): number {
  const ratios = list.filter((c) => c.width > 0 && c.height > 0).map((c) => c.width / c.height);
  return ratios.length ? Math.max(1, Math.min(...ratios)) : 4 / 3;
}

// why it shows no picture, in words on their own line
export function cameraReason(reason?: string, message?: string): string {
  const text = reasonText({id: '', t: 0, type: 'CAMERA_REFUSED', reason: reason || 'NO_SIGNAL', ...(message ? {message} : {})});
  return text.charAt(0).toUpperCase() + text.slice(1);
}

// the first the mower offers that this app plays: webrtc needs RTCPeerConnection (in browsers and the app's webview)
export const PLAYS = ['webrtc', 'mjpeg'];
export function pickProtocol(protocols: readonly string[], webrtc = typeof RTCPeerConnection !== 'undefined'): string | null {
  return protocols.find((p) => PLAYS.includes(p) && (p !== 'webrtc' || webrtc)) ?? null;
}

// the stream's address with the broker's host: MowBite OS puts its address in the home network there, which a phone
// over a VPN or the mower's name may not reach while it reaches the broker that runs on the mower (masterplan 3.9 M2).
// a broker on this computer itself (a tunnel) leaves it as it is
export function streamUrl(url: string, broker: string): string {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return url;
  }
  if ((u.protocol !== 'http:' && u.protocol !== 'https:') || !broker || /^(localhost|127\.|\[::1\]$|::1$)/.test(broker)) return url;
  u.hostname = broker;
  return u.toString();
}

// a page served over https may not load a stream over plain http
export const blockedHere = (url: string, page = typeof location === 'undefined' ? '' : location.protocol) =>
  page === 'https:' && url.startsWith('http:');

// one stream at a time from here: the last one is closed before the next one connects, else switching cameras could
// take both of the two places for a moment
let closing: Promise<void> = Promise.resolve();
export const afterClosed = () => closing;
export function closed(close: () => Promise<void>) {
  closing = closing.then(close, close).catch(() => {});
}

// WebRTC over WHEP: an offer for video only to the url, its answer back, the session deleted at its address (the
// Location header) when done. no ice servers: in the home network the mower's own candidates reach it
export async function playWhep(url: string, video: HTMLVideoElement, ended: () => void): Promise<() => Promise<void>> {
  const pc = new RTCPeerConnection();
  let session: string | null = null;
  const close = async () => {
    pc.close();
    if (!session) return;
    const at = new URL(session, url);
    if (!at.search) at.search = new URL(url).search;
    await fetch(at, {method: 'DELETE'}).catch(() => {});
  };
  try {
    pc.addTransceiver('video', {direction: 'recvonly'});
    pc.ontrack = (e) => {
      video.srcObject = e.streams[0] ?? new MediaStream([e.track]);
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed') ended();
    };
    await pc.setLocalDescription(await pc.createOffer());
    await gathered(pc, 2000);
    const res = await fetch(url, {method: 'POST', headers: {'Content-Type': 'application/sdp'}, body: pc.localDescription!.sdp});
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    session = res.headers.get('Location');
    await pc.setRemoteDescription({type: 'answer', sdp: await res.text()});
  } catch (e) {
    await close();
    throw e;
  }
  return close;
}

// the offer goes with all its candidates at once, the mower takes no later ones
function gathered(pc: RTCPeerConnection, ms: number): Promise<void> {
  if (pc.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise((done) => {
    const timer = setTimeout(done, ms);
    pc.onicegatheringstatechange = () => {
      if (pc.iceGatheringState !== 'complete') return;
      clearTimeout(timer);
      done();
    };
  });
}
