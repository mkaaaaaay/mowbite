import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {describe, expect, it} from 'vitest';
import de from './i18n/de';
import {onOs, PARAM_FIELDS, paramField} from './mowerParams';
import {COMMAND, RPC} from './openmower';
import {EMERGENCY_BITS, EMERGENCY_HIDE, EMERGENCY_TEXT, EVENTS, REASONS, pick} from './reasonTexts';

// MowBite OS's interface (system.api) as its owner has it, copied from the commit below. a newer one: copy it from
// there over os-api.schema.json and put its commit and checksum here, the tests then say which words are missing
const PINNED = {
  repo: 'mkaaaaaay/mowbite-os',
  path: 'src/mowbite_api/api.schema.json',
  commit: 'f5d6e5dcc20fdc9a234bf04f676e8144bab8ae8c',
  sha256: 'd82469e43fdb4cafa2cebfd91107f096d004dbf2362fa83751dafff899b0b27b',
};
const raw = readFileSync(join(__dirname, 'os-api.schema.json'));
// a reason's rating, when: another one for these values of the event's fields
type Rating = {severity: string; resume: string; when?: Record<string, string | number | boolean>[]};
const api = JSON.parse(raw.toString()) as {
  'x-api': number;
  'x-reasons': Record<string, Record<string, Rating>>;
  'x-emergency-bits': {bit: number; name: string}[];
  'x-methods': Record<string, unknown>;
  'x-sensors': Record<string, {name: string}>;
  'x-settings': Record<string, {default: number; min: number; max: number; unit: string}>;
  $defs: Record<string, unknown>;
};

// the OS's methods the app doesn't offer (yet), each with why. a new method in the contract stays red until the app
// calls it or it is put here
const NOT_OFFERED: Record<string, string> = {
  'calibration.start': "to come: the OS's calibration assistant (masterplan 40 (6), after the way home without planner)",
  'calibration.check': 'as calibration.start',
  'calibration.abort': 'as calibration.start',
  'calibration.result': 'as calibration.start',
  'docking.start': 'to come: home for a mower idle away from the dock, with the way home without planner (40 (1), api 12)',
  'host.restart_os': "to come: MowBite OS's updates in the app (update.status, FP15)",
  'events.history.delete': 'as position.history.delete',
  'position.history.delete': 'to come: deleting the track (location data) and the events in the settings, low priority',
  'ntrip.get': 'to come: NTRIP set up without a terminal (masterplan 20, E1), the access never in logs or diagnosis files',
  'ntrip.set': 'as ntrip.get',
  'ntrip.delete': 'as ntrip.get',
  'sensors.list': 'the sensors come over MQTT (sensor_infos/json)',
  'rpc.ping': 'rpc.methods already tells whether it answers',
  'system.api': "the app has its copy of the contract here and reads the api's number from system.info",
  'system.hold': "the updater's, it holds restarts while it works",
  'update.abort': 'as host.restart_os',
  'update.check': 'as host.restart_os',
  'update.rollback': 'as host.restart_os',
  'update.set_auto': 'as host.restart_os',
  'update.start': 'as host.restart_os',
  'update.status': 'as host.restart_os',
};
// what the app calls on a mower; planner.* is the MowBite Planner's, not the OS's
const appMethods = new Set([...Object.values(RPC), ...Object.values(COMMAND).map((c) => c.method)].filter((m) => !m.startsWith('planner.')));
const osMethods = Object.keys(api['x-methods']);

// decided for a later api and in the app already, not in the pinned copy yet: TOO_SHORT (a sound under 0.2 s, the
// phone says it). one the copy has is red until it's taken out here
const AHEAD: Record<'reasons' | 'events' | 'methods' | 'variants', string[]> = {
  reasons: ['TOO_SHORT'],
  events: [],
  methods: [],
  // a reason's variant for one event, as 'EVENT REASON'
  variants: [],
};

// events only OpenMower or the planner send
const NOT_OS = ['GPS', 'FULLY_CHARGED', 'NAVIGATION_ERROR', 'LEFTOVERS_ARMED'];

const groups = api['x-reasons'];
const eventTypes = [
  ...new Set([
    ...Object.keys(api.$defs)
      .filter((k) => k.startsWith('event.') && k !== 'event.other')
      .map((k) => k.slice('event.'.length)),
    ...Object.keys(groups),
  ]),
];
const reasonNames = new Set(Object.values(groups).flatMap((r) => Object.keys(r)));

describe(`MowBite OS's interface (${PINNED.repo} ${PINNED.commit.slice(0, 7)}, api ${api['x-api']})`, () => {
  it('is the pinned copy', () => {
    expect(createHash('sha256').update(raw).digest('hex')).toBe(PINNED.sha256);
  });

  it('lies in the api range public/app.json gives (osApi in package.json)', () => {
    const {min, max} = JSON.parse(readFileSync(join(__dirname, '../../package.json'), 'utf8')).osApi;
    expect(min).toBeLessThanOrEqual(api['x-api']);
    expect(max).toBeGreaterThanOrEqual(api['x-api']);
  });

  // (the german for all of them: reasons.test.ts)
  it('has words for every event', () => {
    for (const type of eventTypes) expect(EVENTS[type], type).toBeDefined();
  });

  it('has words for every reason of every event', () => {
    for (const [type, reasons] of Object.entries(groups))
      for (const reason of Object.keys(reasons)) expect(pick(REASONS[reason], {type, reason}), `${type} ${reason}`).toBeDefined();
  });

  it('names the emergency bits as the OS does, each with its words', () => {
    const bits = api['x-emergency-bits'];
    expect(new Map(EMERGENCY_BITS.flatMap((name, bit) => (name ? [[bit, name]] : [])))).toEqual(new Map(bits.map((b) => [b.bit, b.name])));
    for (const {name} of bits) if (!EMERGENCY_HIDE.includes(name)) expect(EMERGENCY_TEXT[name], name).toBeDefined();
  });

  it('has its own words where the OS rates field values apart', () => {
    for (const [type, reasons] of Object.entries(groups))
      for (const [reason, rating] of Object.entries(reasons))
        for (const w of rating.when ?? []) {
          // eslint-disable-next-line @typescript-eslint/no-unused-vars -- the rest are the fields
          const {severity, resume, ...fields} = w;
          const props = (api.$defs[`event.${type}`] as {properties?: Record<string, unknown>} | undefined)?.properties ?? {};
          const e = {type, reason, ...fields};
          for (const k of Object.keys(fields)) expect(props[k], `${type} ${reason} ${k}`).toBeDefined();
          // the event's head or the reason is picked by those fields
          const named = [pick(EVENTS[type]?.variants, e), pick(REASONS[reason], e)].some((v) => v?.when && Object.keys(fields).every((k) => k in v.when!));
          expect(named, `${type} ${reason} ${JSON.stringify(fields)}`).toBe(true);
        }
  });

  it('has every method the app calls', () => {
    expect([...appMethods].filter((m) => !osMethods.includes(m) && !AHEAD.methods.includes(m))).toEqual([]);
  });

  it('either calls each of its methods or says why not', () => {
    expect(osMethods.filter((m) => !appMethods.has(m) && !(m in NOT_OFFERED)), 'call them or add them to NOT_OFFERED').toEqual([]);
    expect(Object.keys(NOT_OFFERED).filter((m) => appMethods.has(m) || !osMethods.includes(m)), 'used or gone, take them out of NOT_OFFERED').toEqual([]);
  });

  it("has every setting the app shows on it without asking the mower's list, and a field for each", () => {
    const settings = api['x-settings'];
    // the mowing group isn't shown on MowBite OS, its planner has the lanes
    const shown = PARAM_FIELDS.filter((f) => f.group !== 'mowing' && !f.reported).map((f) => f.key);
    expect(shown.filter((k) => !(k in settings))).toEqual([]);
    expect(Object.keys(settings).filter((k) => !paramField(k))).toEqual([]);
  });

  it('has the range and default of each setting as the app has them on it', () => {
    // the app's unit is what it shows, the mower's value times scale
    const osUnit = (unit = '', scale = 1) => (unit === 'cm' && scale === 100 ? 'm' : unit === '°C' ? 'deg.C' : unit);
    for (const [key, s] of Object.entries(api['x-settings'])) {
      const f = onOs(paramField(key)!, true);
      const range = f.type === 'choice' ? {min: 0, max: f.choices!.length - 1} : {min: f.min, max: f.max};
      expect({...range, def: Number(f.def), unit: osUnit(f.unit, f.scale)}, key).toEqual({min: s.min, max: s.max, def: s.default, unit: s.unit});
    }
  });

  it('has every sensor name in german, a name without small letters (NTRIP) stays as it is', () => {
    const names = Object.values(api['x-sensors']).map((s) => s.name);
    expect(names.filter((n) => /[a-z]/.test(n) && !de[n])).toEqual([]);
  });

  it("has no words for events, reasons or bits the OS doesn't know", () => {
    expect(Object.keys(EVENTS).filter((t) => !eventTypes.includes(t) && !NOT_OS.includes(t) && !AHEAD.events.includes(t))).toEqual([]);
    expect(Object.keys(REASONS).filter((r) => !reasonNames.has(r) && !AHEAD.reasons.includes(r))).toEqual([]);
    // a variant for one event only names one that has this reason
    for (const [reason, list] of Object.entries(REASONS))
      for (const v of list)
        if (typeof v.when?.type === 'string' && !AHEAD.variants.includes(`${v.when.type} ${reason}`))
          expect(groups[v.when.type]?.[reason], `${v.when.type} ${reason}`).toBeDefined();
  });

  it('has nothing ahead the pinned copy has by now', () => {
    expect(AHEAD.reasons.filter((r) => reasonNames.has(r)), 'take them out of AHEAD').toEqual([]);
    expect(AHEAD.events.filter((t) => eventTypes.includes(t)), 'take them out of AHEAD').toEqual([]);
    expect(AHEAD.methods.filter((m) => osMethods.includes(m)), 'take them out of AHEAD').toEqual([]);
    expect(AHEAD.variants.filter((v) => groups[v.split(' ')[0]]?.[v.split(' ')[1]]), 'take them out of AHEAD').toEqual([]);
  });
});
