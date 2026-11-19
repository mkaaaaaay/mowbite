import {nearClock} from './dates';
import {tr} from './i18n';
import {OBSTACLE_MODES, RPC} from './openmower';
import {callRpc} from './rpc';
import {rpcImage, type ImageRef} from './rpcImage';

// What MowBite OS's obstacle sensors saw (vision.obstacles.*, api 50, only where the platform has such a sensor): a list
// kept on the mower, each entry with a photo where obstacle_photos is on. x, y and r in meters like map/json

type ObstacleKind = 'PERSON' | 'ANIMAL' | 'OBJECT' | 'UNKNOWN';
type ObstacleAction = 'seen' | 'slowed' | 'would_stop' | 'stopped' | 'avoided';
export interface ObstacleImage extends ImageRef {
  width: number;
  height: number;
  // in pixels from the top left
  box: {x: number; y: number; w: number; h: number};
}
export interface Obstacle {
  id: number;
  t: number;
  last_t: number;
  count: number;
  x: number;
  y: number;
  r: number;
  kind: ObstacleKind;
  // as the mower's model names it, english
  class: string;
  confidence: number;
  camera_id: string;
  action: ObstacleAction;
  image: ObstacleImage | null;
  // while the mower keeps out of a circle around it (avoided, api 52): its radius, the circle stays unmowed
  keep_out_r?: number | null;
}
interface Sight {
  ok: boolean;
  reason: string | null;
}
export interface ObstacleList {
  // the one in effect, and the highest this platform can do (api 51)
  mode: string;
  mode_max?: string;
  photos: boolean;
  sight: Sight;
  limit: {entries: number; bytes: number; days: number};
  // last seen first
  obstacles: Obstacle[];
}

// at most this much of a photo in one answer of vision.obstacles.image
export const PHOTO_PIECE = 65536;
// a photo is a whole camera picture of about 100 KB, a larger one isn't taken
const PHOTO_BYTES = 1 << 20;
// seen this recently, it's there now
const JUST_SEEN_S = 10;

// the highest obstacle_mode to offer: show before api 51
export const modeMax = (list: Pick<ObstacleList, 'mode_max'> | undefined) => Math.max(1, OBSTACLE_MODES.indexOf(list?.mode_max ?? 'show'));
// the entries it would have stopped for, had it been set to stop
export const wouldStop = (list: Obstacle[]) => list.filter((o) => o.action === 'would_stop').length;

export const loadObstacles = (since?: number) => callRpc<ObstacleList>(RPC.obstaclesList, since === undefined ? {} : {since});
export const clearObstacles = (id?: number) => callRpc<{removed: number}>(RPC.obstaclesClear, id === undefined ? {} : {id});
export const obstaclePhoto = (image: ObstacleImage) => rpcImage(RPC.obstaclesImage, image, 'image/jpeg', PHOTO_PIECE, PHOTO_BYTES);

const newestFirst = (a: Obstacle, b: Obstacle) => b.last_t - a.last_t || b.id - a.id;

// the entries seen anew put over the ones known
export function mergeObstacles(known: Obstacle[], newer: Obstacle[]): Obstacle[] {
  const ids = new Set(newer.map((o) => o.id));
  return [...newer, ...known.filter((o) => !ids.has(o.id))].sort(newestFirst);
}

// one gone, or all of them for null
export const withoutObstacle = (list: Obstacle[], id: number | null) => (id === null ? [] : list.filter((o) => o.id !== id));

// what to ask for next (last seen first): the ones seen since the newest known, a second earlier for one seen again in
// that same second
export const sinceOf = (list: Obstacle[]) => (list.length ? list[0].last_t - 1 : undefined);

// nothing new to show: the same entries, each seen as often and as last as before
export const sameObstacles = (a: Obstacle[], b: Obstacle[]) =>
  a.length === b.length &&
  a.every((o, i) => o.id === b[i].id && o.last_t === b[i].last_t && o.count === b[i].count && o.action === b[i].action && o.keep_out_r === b[i].keep_out_r && o.image?.sha256 === b[i].image?.sha256);

export const justSeen = (o: Pick<Obstacle, 'last_t'>, now = Date.now() / 1000) => now - o.last_t < JUST_SEEN_S;

export const KIND_NAMES: Record<ObstacleKind, string> = {PERSON: 'Person', ANIMAL: 'Animal', OBJECT: 'Object', UNKNOWN: 'Something'};
const ACTION_NAMES: Record<ObstacleAction, string> = {seen: 'Only seen', slowed: 'Slowed down', would_stop: 'Would have stopped', stopped: 'Stopped', avoided: 'Drove around it'};
// the model's classes said in the app's language, the others as the mower names them
const CLASS_NAMES: Record<string, string> = {person: 'Person', hedgehog: 'Hedgehog', cat: 'Cat', dog: 'Dog', 'sports ball': 'Sports ball'};

export function obstacleName(o: Pick<Obstacle, 'kind' | 'class'>): string {
  const own = CLASS_NAMES[o.class];
  return own ? tr(own) : o.class || tr(KIND_NAMES[o.kind] ?? KIND_NAMES.UNKNOWN);
}

// when, how often and what the mower did
export function obstacleLine(o: Obstacle): string {
  const when = o.count > 1 ? tr('{n} times, last {when}', {n: o.count, when: nearClock(o.last_t)}) : nearClock(o.last_t);
  return [when, tr(ACTION_NAMES[o.action] ?? o.action)].join(' · ');
}
