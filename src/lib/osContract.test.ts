import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {describe, expect, it} from 'vitest';
import de from './i18n/de';
import {EMERGENCY_BITS, EMERGENCY_HIDE, EMERGENCY_TEXT, EVENTS, REASONS, pick} from './reasonTexts';

// MowBite OS's interface (system.api) as its owner has it, copied from the commit below. a newer one: copy it from
// there over os-api.schema.json and put its commit and checksum here, the tests then say which words are missing
const PINNED = {
  repo: 'mkaaaaaay/mowbite-os',
  path: 'src/mowbite_api/api.schema.json',
  commit: '40e9788f29fa3c43347fbba129d633a3274329b9',
  sha256: '316dc7d05fc41b4e0fd61a81f70b88e17b63b01c1e1a173f8dc38ab58921466b',
};
const raw = readFileSync(join(__dirname, 'os-api.schema.json'));
const api = JSON.parse(raw.toString()) as {
  'x-api': number;
  'x-reasons': Record<string, Record<string, unknown>>;
  'x-emergency-bits': {bit: number; name: string}[];
  $defs: Record<string, unknown>;
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
// the english texts without german, one that is only fields ({state}) needs none
const german = (list: {en: string}[]) =>
  list.filter((v) => !de[v.en] && /[a-z]/i.test(v.en.replace(/\{\w+(:\d)?\}/g, ''))).map((v) => v.en);

describe(`MowBite OS's interface (${PINNED.repo} ${PINNED.commit.slice(0, 7)}, api ${api['x-api']})`, () => {
  it('is the pinned copy', () => {
    expect(createHash('sha256').update(raw).digest('hex')).toBe(PINNED.sha256);
  });

  it('has words in english and german for every event', () => {
    for (const type of eventTypes) {
      expect(EVENTS[type], type).toBeDefined();
      expect(german(EVENTS[type].variants), type).toEqual([]);
    }
  });

  it('has words in english and german for every reason of every event', () => {
    for (const [type, reasons] of Object.entries(groups))
      for (const reason of Object.keys(reasons)) {
        expect(pick(REASONS[reason], {type, reason}), `${type} ${reason}`).toBeDefined();
        expect(german(REASONS[reason]), reason).toEqual([]);
      }
  });

  it('names every emergency bit as the OS does, with its words', () => {
    for (const {bit, name} of api['x-emergency-bits']) {
      expect(EMERGENCY_BITS[bit], `bit ${bit}`).toBe(name);
      if (EMERGENCY_HIDE.includes(name)) continue;
      expect(EMERGENCY_TEXT[name], name).toBeDefined();
      expect(de[EMERGENCY_TEXT[name]], name).toBeDefined();
    }
  });

  it("has no words for events, reasons or bits the OS doesn't know", () => {
    expect(Object.keys(EVENTS).filter((t) => !eventTypes.includes(t) && !NOT_OS.includes(t))).toEqual([]);
    const known = new Set(Object.values(groups).flatMap((r) => Object.keys(r)));
    expect(Object.keys(REASONS).filter((r) => !known.has(r))).toEqual([]);
    const bits = new Map(api['x-emergency-bits'].map((b) => [b.bit, b.name]));
    EMERGENCY_BITS.forEach((name, bit) => name && expect(bits.get(bit), name).toBe(name));
    // a variant for one event only names one that has this reason
    for (const [reason, list] of Object.entries(REASONS))
      for (const v of list)
        if (typeof v.when?.type === 'string') expect(groups[v.when.type]?.[reason], `${v.when.type} ${reason}`).toBeDefined();
  });
});
