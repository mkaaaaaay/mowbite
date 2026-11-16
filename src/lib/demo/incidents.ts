import {toBase64} from '../base64';
import {emergencyFlags} from '../events';
import type {Trigger} from '../incidents';
import {MAX_NOTE, PIECE_BYTES} from '../incidentLimits';
import {RPC} from '../openmower';
import {sha256Js} from '../sha256';

// The journal and the incidents of a mower with MowBite OS for the click tests (journal.status, incidents.*), like the
// Tron answers them. The demo is an OpenMower and has none, a test switches them on before the page loads
// (window.mowbiteDemoIncidents). Its problems open incidents, one from yesterday (a crash) is there from the start

interface Kept {
  id: string;
  triggers: Trigger[];
  until: number; // collecting until then (unix s)
  log: {t: number; level: number; name: string; msg: string}[];
}

// what opens one: the event's type, the emergency only when it's set
const TRIGGERS = ['EMERGENCY', 'DOCKING_FAILED', 'UNDOCKING_FAILED', 'MOW_MOTOR_SPINUP_FAILED', 'CALIBRATION_FAILED', 'POSITION_JUMP', 'UNEXPECTED_RESTART'];
const SAFETY = new Set(['EMERGENCY', 'CRASH']);
const COLLECTING = 3;
const BEFORE = 120;

type Event = {id: string; type: string; t: number; [key: string]: unknown};

export function demoIncidents(now: () => number, emit: (e: Event) => void) {
  const kept: Kept[] = [];
  let ids = 0;
  // downloads asked for once: the next call has the archive ready
  const packed = new Set<string>();

  const open = (kind: string, reason: string, t: number, until = t + COLLECTING): Kept => {
    const k: Kept = {
      id: `demo${String(++ids).padStart(4, '0')}${Math.round(t).toString(36)}`,
      triggers: [{kind, reason, safety: SAFETY.has(kind), t}],
      until,
      log: [{t: t - 0.4, level: 30, name: 'mowbite_logic', msg: `trigger ${kind}${reason ? `: ${reason}` : ''}`}],
    };
    kept.unshift(k);
    emit({id: `incident${ids}`, t, type: 'INCIDENT', incident: k.id, reason: kind, detail: reason, safety: SAFETY.has(kind), severity: 'info', resume: 'auto'});
    return k;
  };
  const yesterday = now() - 26 * 3600;
  open('CRASH', 'mowbite_planner ended by itself (signal 11)', yesterday, yesterday).log.push({
    t: yesterday - 1.2,
    level: 40,
    name: 'mowbite_planner',
    msg: 'lane 14: no way around the obstacle',
  });

  const stateOf = (k: Kept) => (now() < k.until ? 'collecting' : 'done');
  const find = (id: unknown) => {
    const k = kept.find((x) => x.id === id);
    if (!k) throw new Error('no incident with this id');
    return k;
  };
  // the archive as text, long enough for two pieces, with its checksum
  const archives = new Map<string, {bytes: Uint8Array; sha256: string}>();
  const archive = (k: Kept) => {
    let a = archives.get(k.id);
    if (!a) {
      const bytes = new TextEncoder().encode(JSON.stringify({id: k.id, triggers: k.triggers, log: k.log}).padEnd(300000, ' '));
      archives.set(k.id, (a = {bytes, sha256: sha256Js(bytes)}));
    }
    return a;
  };
  const bytes = (k: Kept) => (stateOf(k) === 'done' ? 300000 : 0);

  return {
    trigger(e: Event) {
      if (!TRIGGERS.includes(e.type) || (e.type === 'EMERGENCY' && !e.emergency)) return;
      const reason = e.type === 'EMERGENCY' ? emergencyFlags(e.reason).join(', ') : String(e.reason ?? '');
      open(e.type, reason, e.t);
    },
    methods: {
      [RPC.journalStatus]: () => ({
        enabled: true,
        problem: '',
        bytes: 412e6,
        max_bytes: 2048e6,
        max_days: 14,
        free: 9e9,
        reserve: 1024e6,
        runs: 41,
        active: 12,
        incidents: {
          count: kept.length,
          bytes: kept.reduce((s, k) => s + bytes(k), 0),
          max_bytes: 512e6,
          max_days: 30,
          max_days_safety: 90,
          throttled: [{kind: 'POSITION_JUMP', count: 3}],
        },
      }),
      [RPC.incidentsList]: () =>
        kept.map((k) => ({
          id: k.id,
          created: Math.floor(k.triggers[0].t),
          state: stateOf(k),
          safety: k.triggers.some((t) => t.safety),
          triggers: [...new Set(k.triggers.map((t) => t.kind))],
          reason: k.triggers[0].reason,
          bytes: bytes(k),
          replay: 'window',
        })),
      [RPC.incidentsGet]: (params: unknown) => {
        const k = find((params as {id?: string})?.id);
        const t0 = k.triggers[0].t;
        // the monotonic clock of the demo is its wall clock
        const ns = (t: number) => Math.round(t * 1e9);
        return {
          manifest: {
            id: k.id,
            state: stateOf(k),
            created: Math.floor(t0),
            window: {from_ns: ns(t0 - BEFORE), to_ns: ns(t0 + 60)},
            triggers: k.triggers.map((t) => ({kind: t.kind, reason: t.reason, safety: t.safety, t_ns: ns(t.t), utc: new Date(t.t * 1000).toISOString()})),
            more_triggers: 0,
            runs: [
              {name: 'mowbite_logic', process: 'mowbite_logic', revision: 'demo'},
              {name: 'mowbite_planner', process: 'mowbite_planner', revision: 'demo'},
            ],
            log: k.log,
          },
          timeline: [
            {t_ns: ns(t0 - 30), process: 'mowbite_logic', stream: 'state', view: {state: 'MOWING'}},
            {t_ns: ns(t0 - 2), process: 'mowbite_planner', stream: 'rpc', method: 'mowing.plan'},
            {t_ns: ns(t0), process: 'mowbite_logic', stream: 'state', view: {state: 'PAUSED'}},
            {t_ns: ns(t0), process: 'mowbite_hw', stream: 'imu', records: 100, bytes: 6400},
            {truncated: 12},
          ],
        };
      },
      [RPC.incidentsDownload]: (params: unknown) => {
        const {id, offset = 0, size} = (params ?? {}) as {id?: string; offset?: number; size?: number};
        const k = find(id);
        if (stateOf(k) !== 'done') throw new Error('the incident is still collecting');
        if (!size || size < 1 || size > PIECE_BYTES) throw new Error(`size: 1 to ${PIECE_BYTES}`);
        if (!packed.has(k.id)) {
          packed.add(k.id);
          return {ready: false, size: 0, offset, data: '', sha256: '', archive_sha256: ''};
        }
        const all = archive(k);
        const piece = all.bytes.subarray(offset, offset + size);
        return {ready: true, size: all.bytes.length, offset, data: toBase64(piece), sha256: sha256Js(piece), archive_sha256: all.sha256};
      },
      [RPC.incidentsMark]: (params: unknown) => {
        const note = (params as {note?: unknown})?.note;
        if (typeof note !== 'string' || [...note].length > MAX_NOTE) throw new Error(`note: a text of at most ${MAX_NOTE} characters`);
        return {id: open('MARK', note, now()).id};
      },
      [RPC.incidentsDelete]: (params: unknown) => {
        const id = (params as {id?: string})?.id;
        if (id === undefined) return {deleted: kept.splice(0).length};
        const k = find(id);
        if (stateOf(k) !== 'done') throw new Error('the incident is still collecting');
        kept.splice(kept.indexOf(k), 1);
        return {deleted: 1};
      },
    } as Record<string, (params: unknown) => unknown>,
  };
}
