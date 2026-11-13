import {reasonText, type MowerEvent} from './events';
import {tr} from './i18n';
import {isDemo} from './mowers';
import {RPC} from './openmower';
import {callRpc} from './rpc';

// the cameras of a mower with MowBite OS (camera.*, masterplan 3.9): a list with whether each one can show a picture
// now and why not, and a stream of one for a single connection. at most two watch at a time over all cameras, the
// mower only streams while someone does

type CameraPosition = 'front' | 'rear' | 'left' | 'right';
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
interface Stream {
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
export const SHORT: Record<CameraPosition, string> = {front: 'Front', left: 'Left', right: 'Right', rear: 'Rear'};
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

// the list with what a CAMERA_CHANGED says about its camera, null for one the list doesn't have
type Change = Pick<MowerEvent, 'camera_id' | 'available' | 'reason' | 'message' | 'protocols' | 'width' | 'height'>;
export function withChange(list: readonly Camera[], e: Change): Camera[] | null {
  const {camera_id: id, available} = e;
  if (typeof available !== 'boolean' || !list.some((c) => c.id === id)) return null;
  const why = available ? {reason: undefined, detail: undefined} : {reason: e.reason, detail: e.message};
  // since api 24 with its protocols and size (before: as the list has them)
  const now = {
    ...(Array.isArray(e.protocols) && {protocols: e.protocols}),
    ...(typeof e.width === 'number' && typeof e.height === 'number' && {width: e.width, height: e.height}),
  };
  return list.map((c) => (c.id === id ? {...c, available, ...why, ...now} : c));
}

// whether a stream of the camera has to be opened anew: it can stream again or no longer, or with other protocols. another
// size alone keeps it
export const streamChanged = (before: Camera, after: Camera) =>
  before.available !== after.available || before.protocols.join() !== after.protocols.join();

// why it shows no picture, in words on their own line
export function cameraReason(reason?: string, message?: string): string {
  const text = reasonText({id: '', t: 0, type: 'CAMERA_REFUSED', reason: reason || 'NO_SIGNAL', ...(message ? {message} : {})});
  return text.charAt(0).toUpperCase() + text.slice(1);
}

// the first the mower offers that this app plays: webrtc needs RTCPeerConnection (in browsers and the app's webview)
const PLAYS = ['webrtc', 'mjpeg'];
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

// how long a stream's address may take to answer: MowBite OS's stream server holds a no back for up to 4 s and says
// only after 10 s that the camera sends no picture
export const ANSWER_MS = 15000;
// the mower ends an mjpeg stream after 10 s without a picture, one silent for longer than this has broken off
export const STALL_MS = 15000;
// (the next stream waits for the last one's end, not longer than this)
const CLOSE_MS = 3000;

// a stream's address gave no picture: the HTTP status it answered, 'timeout' for none in time, 0 when it wasn't
// reached. at: its host and port, said: the address's own words with its no
export class StreamError extends Error {
  constructor(
    public status: number | 'timeout',
    public at: string,
    said = '',
  ) {
    super(typeof status === 'number' && status > 0 ? `HTTP ${status}${said && `: ${said}`}` : at);
  }
}

// a stream that failed in words, with what the address answered for the small print. a place is for one connection
// and has to be taken within half a minute (401 after that), trying again asks the mower for a new one. 400 is the
// stream server's no for a camera that sends it no picture within 10 s, and for whatever else keeps it from starting
export function streamFailure(e: unknown): {text: string; detail?: string} {
  const s = e instanceof StreamError ? e : null;
  if (s?.status === 'timeout') return {text: tr("The camera didn't answer in time."), detail: s.at};
  if (s?.status === 0) return {text: tr("Couldn't reach the camera at {address}.", {address: s.at})};
  return {
    text: tr(s?.status === 401 ? "The mower didn't accept the connection." : s?.status === 400 ? 'The camera gave no picture.' : "Couldn't connect to the camera"),
    detail: String((e as Error | null)?.message ?? e),
  };
}

// what an address says with its no, cut short: the stream server as json with the words in error, the mower's own
// mjpeg address as a line of text
async function words(res: Response): Promise<string> {
  let said = (await res.text().catch(() => '')).trim();
  try {
    const error = (JSON.parse(said) as {error?: unknown} | null)?.error;
    if (typeof error === 'string') said = error;
  } catch {}
  return said.split('\n')[0].slice(0, 120);
}

// a request to a stream's address (the demo mower answers for its own): its answer, anything but a success within
// ANSWER_MS as a StreamError. stop ends the request and what's read of its answer later
async function ask(url: string, init: RequestInit, stop = new AbortController()): Promise<Response> {
  let at = '';
  try {
    at = new URL(url).host;
  } catch {}
  let late = false;
  const timer = setTimeout(() => {
    late = true;
    stop.abort();
  }, ANSWER_MS);
  try {
    // (without credentials: a 401 never brings up the browser's own question for a password)
    const request: RequestInit = {...init, credentials: 'omit', signal: stop.signal};
    const res = await (isDemo() ? (await import('./demo/camera')).demoStream(url, request) : fetch(url, request));
    if (!res.ok) throw new StreamError(res.status, at, await words(res));
    return res;
  } catch (e) {
    throw e instanceof StreamError ? e : new StreamError(late ? 'timeout' : 0, at);
  } finally {
    clearTimeout(timer);
  }
}

// WebRTC over WHEP: an offer for video only to the url, its answer back, the session ended at its address (the
// Location header) when done. no ice servers: in the home network the mower's own candidates reach it. ended: the
// connection is over without having been closed from here
export async function playWhep(url: string, video: HTMLVideoElement, ended: () => void): Promise<() => Promise<void>> {
  const pc = new RTCPeerConnection();
  let session: string | null = null;
  let over = false;
  // (the session first: the connection closed before it, its address has nothing left to end and says 404)
  const close = async () => {
    over = true;
    if (session) {
      const at = new URL(session, url);
      if (!at.search) at.search = new URL(url).search;
      await fetch(at, {method: 'DELETE', credentials: 'omit', signal: AbortSignal.timeout(CLOSE_MS)}).catch(() => {});
    }
    pc.close();
  };
  const gone = () => {
    if (over) return;
    over = true;
    ended();
  };
  try {
    pc.addTransceiver('video', {direction: 'recvonly'});
    pc.ontrack = (e) => {
      video.srcObject = e.streams[0] ?? new MediaStream([e.track]);
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed') gone();
    };
    await pc.setLocalDescription(await pc.createOffer());
    await gathered(pc, 2000);
    const res = await ask(url, {method: 'POST', headers: {'Content-Type': 'application/sdp'}, body: pc.localDescription!.sdp});
    session = res.headers.get('Location');
    await pc.setRemoteDescription({type: 'answer', sdp: await res.text()});
    // the mower ending the session closes its side at once, the connection counts as failed only a quarter of a
    // minute later
    const secured = pc.getReceivers()[0]?.transport;
    if (secured)
      secured.onstatechange = () => {
        if (secured.state === 'closed') gone();
      };
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

const HEAD_END = [13, 10, 13, 10];
const MAX_HEAD = 4096;
const MAX_PICTURE = 16 << 20;

// the pictures of a multipart/x-mixed-replace stream as MowBite OS sends it, each part its headers with the picture's
// length and then the picture. returns when the stream ends, throws on one that isn't such a stream
export async function readPictures(body: ReadableStream<Uint8Array>, got: (picture: Blob) => void): Promise<void> {
  const reader = body.getReader();
  let buf = new Uint8Array(0);
  const more = async () => {
    const {done, value} = await reader.read();
    if (done) return false;
    const next = new Uint8Array(buf.length + value.length);
    next.set(buf);
    next.set(value, buf.length);
    buf = next;
    return true;
  };
  for (;;) {
    let end: number;
    while ((end = buf.findIndex((_, i) => HEAD_END.every((b, k) => buf[i + k] === b))) < 0) {
      if (buf.length > MAX_HEAD) throw new Error('no part of a picture stream');
      if (!(await more())) return;
    }
    const head = new TextDecoder().decode(buf.subarray(0, end));
    const length = Number(/^content-length:\s*(\d+)\s*$/im.exec(head)?.[1]);
    if (!(length > 0 && length <= MAX_PICTURE)) throw new Error('a part without its length');
    const from = end + HEAD_END.length;
    while (buf.length < from + length) if (!(await more())) return;
    const type = /^content-type:\s*([^;\s]+)/im.exec(head)?.[1] ?? 'image/jpeg';
    got(new Blob([buf.slice(from, from + length)], {type}));
    buf = buf.subarray(from + length);
  }
}

// mjpeg, read by the app itself: that way it knows what the address answered and when the pictures end. each picture
// goes into img once the one before is drawn, the newest of those that came meanwhile (shown tells each one drawn).
// ended once the stream is over or no picture could be drawn for STALL_MS
export async function playMjpeg(url: string, img: HTMLImageElement, shown: () => void, ended: () => void): Promise<() => Promise<void>> {
  const stop = new AbortController();
  const res = await ask(url, {}, stop);
  let drawn = '';
  let next: Blob | null = null;
  let drawing = false;
  let over = false;
  let stall: ReturnType<typeof setTimeout>;
  const wait = () => {
    clearTimeout(stall);
    stall = setTimeout(() => stop.abort(), STALL_MS);
  };
  const draw = () => {
    if (over || drawing || !next) return;
    drawing = true;
    const last = drawn;
    img.src = drawn = URL.createObjectURL(next);
    next = null;
    if (last) URL.revokeObjectURL(last);
  };
  // (a part that is no picture counts for nothing, the next one is tried)
  const done = (fine: boolean) => {
    drawing = false;
    if (over) return;
    if (fine) {
      wait();
      shown();
    }
    draw();
  };
  const got = (picture: Blob) => {
    next = picture;
    draw();
  };
  const end = () => {
    clearTimeout(stall);
    if (!over) ended();
  };
  img.onload = () => done(true);
  img.onerror = () => done(false);
  wait();
  void (res.body ? readPictures(res.body, got) : Promise.resolve()).then(end, end);
  return async () => {
    over = true;
    clearTimeout(stall);
    stop.abort();
    if (drawn) URL.revokeObjectURL(drawn);
  };
}
