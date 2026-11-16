import {fromBase64} from './base64';
import type {MowerEvent} from './events';
import {PIECE_BYTES} from './incidentLimits';
import {RPC} from './openmower';
import {callRpc} from './rpc';
import type {RosLogLine} from './roslog';
import {sha256Hex} from './sha256';

// MowBite OS's journal and its incidents (journal.status, incidents.*): what its processes did around an emergency
// stop, a failed docking, a crash or a moment the user marked, kept on the mower to look into and to download


export interface Incident {
  id: string;
  created: number; // unix s of its first trigger
  state: 'collecting' | 'sealing' | 'done';
  safety: boolean;
  triggers: string[]; // their kinds in order, each once (EMERGENCY, DOCKING_FAILED, CRASH, MARK …)
  reason: string; // of the first trigger: the event's reason, the emergency bits or the note of a mark
  bytes?: number;
  replay: 'from_start' | 'window';
}

export interface JournalStatus {
  enabled: boolean;
  problem: string; // why no incident is kept right now, empty while they are
  bytes?: number;
  max_bytes?: number;
  max_days?: number;
  incidents: {count?: number; bytes?: number; max_bytes?: number; max_days?: number; max_days_safety?: number; throttled: {kind: string; count?: number}[]};
}

export interface Trigger {
  kind: string;
  reason: string;
  safety: boolean;
  t: number; // unix s
}

// what incidents.get gives, put in wall time
export interface IncidentDetail {
  triggers: Trigger[];
  more: number; // triggers after the ones listed
  from: number;
  to: number;
  processes: number;
  log: RosLogLine[];
  timeline: {t: number; process: string; text: string}[];
  left: number; // lines of the timeline the mower left out
}

export const loadJournal = () => callRpc<JournalStatus>(RPC.journalStatus);
export const loadIncidents = () => callRpc<Incident[]>(RPC.incidentsList).then((l) => (Array.isArray(l) ? l : []));
export const markIncident = (note: string) => callRpc<{id: string}>(RPC.incidentsMark, {client: 'app', note});
// without an id all of them
export const deleteIncidents = (id?: string) => callRpc<{deleted: number}>(RPC.incidentsDelete, id ? {client: 'app', id} : {client: 'app'});

// rcl's levels as numbers, the names as the log of the app shows them
const LEVELS: Record<number, RosLogLine['level']> = {30: 'WARN', 40: 'ERROR', 50: 'FATAL'};

type Json = Record<string, unknown>;
const obj = (v: unknown): Json => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : {});
const list = (v: unknown): Json[] => (Array.isArray(v) ? v.map(obj) : []);
const num = (v: unknown) => (typeof v === 'number' ? v : 0);
const str = (v: unknown) => (typeof v === 'string' ? v : '');
const short = (v: unknown) => {
  const s = JSON.stringify(v) ?? '';
  return s.length > 160 ? `${s.slice(0, 159)}…` : s;
};

// a line of the timeline in short; the counts of a raw stream each second say nothing to read
function lineText(e: Json): string {
  if ('method' in e) return `${str(e.stream)} ${str(e.method)}()`;
  if ('end' in e) return `ended: ${str(e.end)}`;
  if ('gap' in e) return `gap: ${str(obj(e.gap).why)}`;
  if ('view' in e) return `${str(e.stream)} ${short(e.view)}`;
  return '';
}

// the window and the timeline count on the mower's monotonic clock, the triggers have both: the first one sets the
// wall time of the rest
export function readIncident(answer: unknown): IncidentDetail {
  const manifest = obj(obj(answer).manifest);
  const raw = list(manifest.triggers);
  const first = raw[0];
  const created = num(manifest.created);
  const offset = first ? (Date.parse(str(first.utc)) / 1000 || created) - num(first.t_ns) / 1e9 : created;
  const wall = (ns: unknown) => offset + num(ns) / 1e9;
  const triggers = raw.map((t) => ({kind: str(t.kind), reason: str(t.reason), safety: t.safety === true, t: wall(t.t_ns)}));
  const window = obj(manifest.window);
  const log = list(manifest.log)
    .filter((l) => LEVELS[num(l.level)])
    .map((l) => ({level: LEVELS[num(l.level)], t: num(l.t), text: `${str(l.name)}: ${str(l.msg)}`}));
  let left = 0;
  const timeline: IncidentDetail['timeline'] = [];
  for (const e of list(obj(answer).timeline)) {
    if (typeof e.truncated === 'number') {
      left += e.truncated;
      continue;
    }
    const text = lineText(e);
    if (text) timeline.push({t: wall(e.t_ns), process: str(e.process), text});
  }
  return {
    triggers,
    more: num(manifest.more_triggers),
    from: wall(window.from_ns),
    to: wall(window.to_ns),
    processes: list(manifest.runs).length,
    log,
    timeline,
    left,
  };
}

export const loadIncident = (id: string) => callRpc(RPC.incidentsGet, {id}).then(readIncident);

// the incident an event of the day set off: the INCIDENT the OS sent within a few seconds of it
export function incidentOf(e: MowerEvent, events: readonly MowerEvent[]): string | undefined {
  if (e.type === 'INCIDENT') return e.incident;
  return events.find((i) => i.type === 'INCIDENT' && i.incident && Math.abs(i.t - e.t) <= 5)?.incident;
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

// the archive piece by piece; the first call has the mower pack it, until then it answers ready: false. place: with the
// mower's position and the real date, else without them
export async function downloadIncident(id: string, place: boolean, progress: (done: number, size: number) => void): Promise<Uint8Array<ArrayBuffer>> {
  let out: Uint8Array<ArrayBuffer> | null = null;
  let offset = 0;
  let whole = '';
  for (let waited = 0; !out || offset < out.length; ) {
    const r = await callRpc<{ready: boolean; data: string; sha256: string; archive_sha256: string; size?: number}>(
      RPC.incidentsDownload,
      {client: 'app', id, offset, size: PIECE_BYTES, location: place},
      30000,
    );
    if (!r.ready) {
      if (++waited > 120) throw new Error('timeout');
      await wait(1000);
      continue;
    }
    out ??= new Uint8Array(r.size ?? 0);
    whole = r.archive_sha256;
    if (!r.data) break;
    const piece = fromBase64(r.data);
    if (offset + piece.length > out.length || (await sha256Hex(piece)) !== r.sha256) throw new Error('checksum');
    out.set(piece, offset);
    offset += piece.length;
    progress(offset, out.length);
  }
  if (offset !== out.length || (await sha256Hex(out)) !== whole) throw new Error('checksum');
  return out;
}
