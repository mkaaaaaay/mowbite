// events from the mower's event history (events.history rpc), grouped into runs for the activity page

export interface MowerEvent {
  id: string;
  type: string;
  t: number; // unix seconds
  job_id?: string;
  session_id?: string;
  x?: number;
  y?: number;
  state?: string;
  available?: boolean;
  enabled?: boolean;
  area_id?: string;
  area_name?: string;
  reason?: string;
  attempts?: number;
  emergency?: boolean;
}

export type Severity = 'error' | 'warning' | 'info';

const STATES: Record<string, string> = {
  IDLE: 'Idle',
  MOWING: 'Mowing',
  DOCKING: 'Heading home',
  UNDOCKING: 'Leaving the dock',
  PAUSED: 'Paused',
  AREA_RECORDING: 'Recording an area',
};

const REASONS: Record<string, string> = {
  path_failed: 'no path found',
  approach_failed: 'approach failed',
  dock_failed: "couldn't connect to the dock",
};

const reason = (r?: string) => (r ? REASONS[r] ?? r.replace(/_/g, ' ').toLowerCase() : '');

// state is what the mower was doing when the event happened, gps is switched off on purpose outside
// of mowing, so losing it only counts as a problem while mowing
export function describe(e: MowerEvent, state?: string): {text: string; severity: Severity} {
  switch (e.type) {
    case 'STATE':
      return {text: STATES[e.state ?? ''] ?? e.state ?? 'State changed', severity: 'info'};
    case 'GPS':
      if (e.available) return {text: 'GPS fix', severity: 'info'};
      return state === 'MOWING' ? {text: 'GPS lost', severity: 'warning'} : {text: 'GPS off', severity: 'info'};
    case 'BLADES':
      return {text: e.enabled ? 'Blades on' : 'Blades off', severity: 'info'};
    case 'AREA':
      return {text: `Mowing "${e.area_name || 'unnamed'}"`, severity: 'info'};
    case 'AREA_SKIPPED':
      return {text: 'Area skipped', severity: 'warning'};
    case 'UNDOCKED':
      return {text: 'Left the dock', severity: 'info'};
    case 'UNDOCKING_FAILED':
      return {text: `Leaving the dock failed${e.reason ? ` (${reason(e.reason)})` : ''}`, severity: 'error'};
    case 'DOCKING':
      return {text: `Heading home${e.reason ? `: ${reason(e.reason)}` : ''}`, severity: 'info'};
    case 'DOCKING_RETRY':
      return {text: `Docking retry ${e.attempts ?? ''} (${reason(e.reason)})`.replace('  ', ' '), severity: 'warning'};
    case 'DOCKING_FAILED':
      return {text: `Docking failed after ${e.attempts ?? '?'} tries (${reason(e.reason)})`, severity: 'error'};
    case 'DOCKED':
      return {text: 'Docked', severity: 'info'};
    case 'JOB_COMPLETE':
      return {text: 'All areas done', severity: 'info'};
    case 'EMERGENCY':
      return e.emergency
        ? {text: `Emergency stop${e.reason && e.reason !== '0' ? ` (code ${e.reason})` : ''}`, severity: 'error'}
        : {text: 'Emergency cleared', severity: 'info'};
    case 'NAVIGATION_ERROR':
      return {text: 'Navigation error', severity: 'error'};
    case 'BOOTED':
      return {text: 'Mower started', severity: 'info'};
    case 'SHUTDOWN':
      return {text: 'Shut down', severity: 'info'};
    default:
      return {text: e.type.replace(/_/g, ' ').toLowerCase(), severity: 'info'};
  }
}

export type Outcome = 'done' | 'paused' | 'undock_failed' | 'dock_failed' | 'emergency' | 'returned' | 'running';

export interface Run {
  start: number;
  end: number;
  events: MowerEvent[];
  areas: string[];
  bladeSeconds: number;
  problems: number;
  outcome: Outcome;
  jobId?: string;
}

export type Entry = {kind: 'run'; run: Run} | {kind: 'event'; event: MowerEvent};

// each event with the state the mower was in at that moment
export function withState(events: MowerEvent[]): {event: MowerEvent; state?: string}[] {
  let state: string | undefined;
  return events.map((event) => {
    const before = state;
    if (event.type === 'STATE') state = event.state;
    return {event, state: before};
  });
}

// A run starts when the mower leaves the dock and ends when it's docked again (or idle/off). Everything
// in between belongs to it, the rest (boot, shutdown, gps while parked) stays a loose event.
export function groupRuns(events: MowerEvent[], live: boolean): Entry[] {
  const sorted = [...events].sort((a, b) => a.t - b.t);
  const out: Entry[] = [];
  let run: MowerEvent[] | null = null;

  const close = (finished: boolean) => {
    if (run?.length) out.push({kind: 'run', run: summarize(run, finished || !live)});
    run = null;
  };

  for (const e of sorted) {
    const starts = e.type === 'STATE' && (e.state === 'UNDOCKING' || e.state === 'MOWING');
    if (!run && starts) run = [];
    if (!run) {
      out.push({kind: 'event', event: e});
      continue;
    }
    run.push(e);
    const ends =
      e.type === 'DOCKED' ||
      e.type === 'SHUTDOWN' ||
      (e.type === 'STATE' && e.state === 'IDLE' && run.some((r) => r.type === 'UNDOCKING_FAILED'));
    if (ends) close(true);
  }
  close(false);
  return out;
}

function summarize(events: MowerEvent[], finished: boolean): Run {
  const areas: string[] = [];
  let bladeSeconds = 0;
  let bladesSince: number | null = null;
  let problems = 0;
  for (const {event: e, state} of withState(events)) {
    if (e.type === 'AREA' && e.area_name && !areas.includes(e.area_name)) areas.push(e.area_name);
    if (e.type === 'BLADES') {
      if (e.enabled && bladesSince === null) bladesSince = e.t;
      if (!e.enabled && bladesSince !== null) {
        bladeSeconds += e.t - bladesSince;
        bladesSince = null;
      }
    }
    if (describe(e, state).severity !== 'info') problems++;
  }
  const end = events[events.length - 1].t;
  if (bladesSince !== null) bladeSeconds += end - bladesSince;

  const has = (type: string) => events.some((e) => e.type === type);
  let outcome: Outcome = 'returned';
  if (!finished) outcome = 'running';
  else if (has('JOB_COMPLETE')) outcome = 'done';
  else if (events.some((e) => e.type === 'EMERGENCY' && e.emergency)) outcome = 'emergency';
  else if (has('DOCKING_FAILED')) outcome = 'dock_failed';
  else if (has('UNDOCKING_FAILED') && !has('UNDOCKED')) outcome = 'undock_failed';
  else if (events.some((e) => e.type === 'DOCKING' && e.reason === 'Manual pause')) outcome = 'paused';

  return {
    start: events[0].t,
    end,
    events,
    areas,
    bladeSeconds,
    problems,
    outcome,
    jobId: events.find((e) => e.job_id)?.job_id,
  };
}

export const OUTCOMES: Record<Outcome, {label: string; tone: 'good' | 'neutral' | 'bad' | 'live'}> = {
  done: {label: 'Finished', tone: 'good'},
  paused: {label: 'Paused by you', tone: 'neutral'},
  returned: {label: 'Back in the dock', tone: 'neutral'},
  undock_failed: {label: "Couldn't leave the dock", tone: 'bad'},
  dock_failed: {label: 'Docking failed', tone: 'bad'},
  emergency: {label: 'Emergency stop', tone: 'bad'},
  running: {label: 'Running', tone: 'live'},
};
