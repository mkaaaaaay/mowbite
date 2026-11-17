import {fromBase64, toBase64} from './base64';
import {outlineOf} from './mowerBody';
import {onTopic} from './mqttClient';
import {RPC, TOPIC} from './openmower';
import {callCommand, callRpc} from './rpc';
import {sha256Hex} from './sha256';

// MowBite OS's setup program (setup.*, api 42): the OS keeps the steps of the platform, their state and their texts,
// the app shows them and passes on what the user does. Every call answers with the whole state, as setup/json

export type StepState = 'locked' | 'open' | 'running' | 'ok' | 'failed' | 'skipped' | 'stale';
export type PartState = 'open' | 'waiting' | 'ok' | 'failed';
export interface Words {
  name: string;
  help: string;
  fix: string;
}
// by language, en to fall back to
export type Texts = Record<string, Partial<Words> | undefined>;
export interface Named {
  id: string;
  texts: Texts;
}
export interface SetupPart extends Named {
  state: PartState;
}
export interface SetupValue extends Named {
  value: unknown;
  unit: string;
  min: number | null;
  max: number | null;
  ok: boolean | null;
}
export interface SetupInput {
  name: string;
  type: 'choice' | 'number';
  ask: boolean;
  value: unknown;
  texts: Texts;
  min?: number;
  max?: number;
  unit?: string;
  values?: Named[];
}
export interface ImageRef {
  name: string;
  sha256: string;
  bytes: number;
}
export interface SetupImage extends ImageRef {
  type: string;
  accent: ImageRef | null;
}
export interface SetupResult {
  ok: boolean;
  reason: string | null;
  message: string | null;
  part: string | null;
  skip: string | null;
  note: string | null;
  t: number;
  attempt: number;
  firmware: string;
}
// a line of the board's inputs as the step sees it now (api 43)
export interface SetupLine {
  name: string;
  role: string | null;
  reason: string | null;
  active: boolean;
  assigned: boolean;
  held: boolean;
  delay_ms: number | null;
}
export interface SetupStep {
  id: string;
  stage: string;
  check: string;
  kind: string;
  state: StepState;
  attempt: number;
  needs: string[];
  blocked: {reason: string; message: string}[];
  motion: Record<string, unknown> | null;
  confirm: Named[];
  start: boolean;
  auto: boolean;
  skippable: boolean;
  skip_reasons: Named[];
  inputs: SetupInput[];
  values: SetupValue[];
  parts: SetupPart[];
  progress: {n: number; of: number} | null;
  ends_at: number | null;
  open: OpenScreen | null;
  image: SetupImage | null;
  symbol: string | null;
  mark: string[];
  texts: Texts;
  result: SetupResult | null;
  restart: boolean;
  lines?: SetupLine[];
}
export interface Setup {
  version: number;
  platform: string;
  catalog: number;
  stage: string | null;
  current: string | null;
  complete: boolean;
  safety: {open: boolean; date: string | null; firmware: string | null; why: string | null};
  restart_pending: boolean;
  stages: (Named & {state: StepState})[];
  steps: SetupStep[];
}

// the item's words in the language shown, each one missing there in english
export function words(texts: Texts | undefined, lang: string): Words {
  const own = texts?.[lang];
  const en = texts?.en;
  const pick = (k: keyof Words) => own?.[k] || en?.[k] || '';
  return {name: pick('name'), help: pick('help'), fix: pick('fix')};
}

const isSetup = (v: unknown): v is Setup =>
  !!v && typeof v === 'object' && typeof (v as Setup).version === 'number' && Array.isArray((v as Setup).steps) && Array.isArray((v as Setup).stages);

// setup/json, retained where the platform has a step list and sent with every change, and the answers of the calls:
// the one that came last
let now: Setup | null = null;
let listening = false;
const listeners = new Set<() => void>();
function take(s: unknown): Setup {
  if (!isSetup(s)) throw new Error('no state of the setup program');
  now = s;
  listeners.forEach((l) => l());
  return s;
}
export const setupNow = () => now;
export function subscribeSetup(l: () => void) {
  if (!listening) {
    listening = true;
    onTopic(TOPIC.setup, (payload) => {
      try {
        take(JSON.parse(payload.toString()));
      } catch {}
    });
  }
  listeners.add(l);
  return () => void listeners.delete(l);
}

// only where the mower lists the program (a platform with a step list)
export const offersSetup = (methods: Set<string> | null | undefined) => !!methods?.has(RPC.setupGet);

export const loadSetup = () => callRpc<Setup>(RPC.setupGet, {}).then(take);

// the calls that change it go out once, never again by themselves; each needs the version read last
const command = (method: string, params: object) => callCommand<Setup>(method, params, 10000).then(take);
export const startStep = (s: Setup, step: string, confirm: string[] = []) =>
  command(RPC.setupStart, {step, version: s.version, ...(confirm.length ? {confirm} : {})});
export const answerStep = (s: Setup, step: string, values: Record<string, unknown>) => command(RPC.setupAnswer, {step, version: s.version, values});
export const skipStep = (s: Setup, step: string, reason: string, note?: string) =>
  command(RPC.setupSkip, {step, version: s.version, reason, ...(note ? {note} : {})});
export const abortStep = (step?: string) => command(RPC.setupAbort, step ? {step} : {});
export const resetSetup = (s: Setup) => command(RPC.setupReset, {version: s.version});

// at most this much of an image in one answer of setup.image, and at most this large (x-setup.limits.image_bytes)
export const IMAGE_BYTES = 65536;
// a step's text of setup.skip with other, at most (x-setup.limits.skip_text)
export const SKIP_TEXT = 200;

// an image of a step as a data url to use as a css mask, never put into the page as markup: fetched in pieces, kept by
// its checksum, refused when the checksum or the type doesn't fit
const images = new Map<string, Promise<string>>();
export function setupImage(ref: ImageRef): Promise<string> {
  let p = images.get(ref.sha256);
  if (!p) {
    p = fetchImage(ref);
    images.set(ref.sha256, p);
    p.catch(() => images.delete(ref.sha256));
  }
  return p;
}

async function fetchImage(ref: ImageRef): Promise<string> {
  if (ref.bytes > IMAGE_BYTES) throw new Error(`image ${ref.name} too large`);
  const pieces: Uint8Array[] = [];
  let got = 0;
  for (;;) {
    const r = await callRpc<{size: number; offset: number; data: string; sha256: string; type: string}>(RPC.setupImage, {
      name: ref.name,
      offset: got,
      size: IMAGE_BYTES,
    });
    if (r.type !== 'image/svg+xml' || r.size > IMAGE_BYTES || r.offset !== got) throw new Error(`image ${ref.name} unusable`);
    const piece = fromBase64(r.data);
    if (!piece.length) break;
    pieces.push(piece);
    got += piece.length;
    if (got >= r.size) break;
  }
  const bytes = new Uint8Array(got);
  let at = 0;
  for (const piece of pieces) {
    bytes.set(piece, at);
    at += piece.length;
  }
  if ((await sha256Hex(bytes)) !== ref.sha256) throw new Error(`image ${ref.name} damaged`);
  return `data:image/svg+xml;base64,${toBase64(bytes)}`;
}

// The screen of the app a step asks for (open): where it is, and its link's words
export type OpenScreen = 'ntrip' | 'geometry' | 'recording' | 'dock' | 'map' | 'dock_test' | 'mow';
export const OPEN_SCREENS: Record<OpenScreen, {href: string; label: string}> = {
  ntrip: {href: '/settings#ntrip', label: 'Enter the correction service'},
  geometry: {href: '/settings#sizes', label: 'Check the sizes'},
  recording: {href: '/record', label: 'Record an area'},
  dock: {href: '/record?station=1', label: 'Record the docking station'},
  map: {href: '/map', label: 'Open the map'},
  dock_test: {href: '/', label: 'Test docking'},
  mow: {href: '/', label: 'Start mowing'},
};

// How the mower looks from above (robot_shape of robot.geometry, api 42), in m of base_link: shown only, never a
// distance from it (robot_outline stays the body). null where it has none or it's beyond the limits of the interface
export const SHAPE_KINDS = ['body', 'wheel', 'caster', 'bumper', 'button', 'sensor', 'handle'] as const;
export type ShapeKind = (typeof SHAPE_KINDS)[number];
export interface ShapePart {
  id: string;
  kind: ShapeKind;
  points: [number, number][];
  closed: boolean;
}
export const SHAPE_LIMITS = {parts: 32, partPoints: 200, points: 1000};

export function robotShape(v: unknown): ShapePart[] | null {
  if (!Array.isArray(v) || !v.length || v.length > SHAPE_LIMITS.parts) return null;
  let all = 0;
  const parts: ShapePart[] = [];
  for (const p of v) {
    const {id, kind, points, closed = true} = (p ?? {}) as Partial<ShapePart>;
    if (typeof id !== 'string' || !SHAPE_KINDS.includes(kind as ShapeKind) || !Array.isArray(points) || typeof closed !== 'boolean') return null;
    if (points.length < 2 || points.length > SHAPE_LIMITS.partPoints) return null;
    if (!points.every((q) => Array.isArray(q) && q.length === 2 && q.every((n) => typeof n === 'number' && Number.isFinite(n)))) return null;
    all += points.length;
    parts.push({id, kind: kind as ShapeKind, points, closed});
  }
  return all > SHAPE_LIMITS.points ? null : parts;
}

// the parts a step can mark that come from the sizes rather than from robot_shape, drawn the same way
export const DERIVED = ['wheel_left', 'wheel_right', 'blade', 'antenna', 'contacts', 'outline'] as const;
type Sizes = {settings: Record<string, {value: unknown}>};

export function derivedParts(g: Sizes | null | undefined): Record<string, [number, number][]> {
  const n = (k: string) => {
    const v = g?.settings[k]?.value;
    return typeof v === 'number' && Number.isFinite(v) ? v : null;
  };
  const out: Record<string, [number, number][]> = {};
  const box = (x0: number, x1: number, y0: number, y1: number): [number, number][] => [[x1, y1], [x0, y1], [x0, y0], [x1, y0]];
  const [track, radius, width] = [n('track'), n('wheel_radius'), n('wheel_width')];
  if (track !== null && radius !== null && width !== null) {
    out.wheel_left = box(-radius, radius, track / 2 - width / 2, track / 2 + width / 2);
    out.wheel_right = box(-radius, radius, -track / 2 - width / 2, -track / 2 + width / 2);
  }
  const [ahead, offset, cut] = [n('blade_ahead'), n('blade_offset') ?? 0, n('mower_width')];
  if (ahead !== null && cut !== null)
    out.blade = Array.from({length: 24}, (_, i): [number, number] => [ahead + (cut / 2) * Math.cos((i * Math.PI) / 12), offset + (cut / 2) * Math.sin((i * Math.PI) / 12)]);
  const [ax, ay] = [n('antenna_x'), n('antenna_y')];
  if (ax !== null && ay !== null) out.antenna = box(ax - 0.015, ax + 0.015, ay - 0.015, ay + 0.015);
  const contacts = n('dock_contact_x');
  if (contacts !== null) out.contacts = [[contacts, 0.05], [contacts, -0.05]];
  const outline = outlineOf(g?.settings.robot_outline?.value);
  const [front, rear, bodyWidth] = [n('robot_front'), n('robot_rear'), n('robot_width')];
  if (outline) out.outline = outline;
  else if (front !== null && rear !== null && bodyWidth !== null) out.outline = box(-rear, front, -bodyWidth / 2, bodyWidth / 2);
  return out;
}

// an svg path of points in m of base_link, seen from above with the front up: x ahead goes up, y left goes left
export const shapePath = (points: [number, number][], closed: boolean) =>
  points.map(([x, y], i) => `${i ? 'L' : 'M'}${(-y).toFixed(4)} ${(-x).toFixed(4)}`).join(' ') + (closed ? ' Z' : '');
