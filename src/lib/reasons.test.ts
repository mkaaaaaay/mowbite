import {readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {describe, expect, it} from 'vitest';
import {EVENTS, REASONS, reasonsFile} from './reasonTexts';

// src/lib/reasons.json is made from reasonTexts.ts and de.ts: npm run reasons writes it again
const FILE = join(__dirname, 'reasons.json');

describe('reasons.json for MowBite for Home Assistant', () => {
  const made = JSON.stringify(reasonsFile(), null, 1) + '\n';

  it('is what the app says', () => {
    if (process.env.UPDATE_REASONS === '1') writeFileSync(FILE, made);
    expect(readFileSync(FILE, 'utf8'), 'src/lib/reasons.json is out of date: npm run reasons').toBe(made);
  });

  it('has english and german for every variant', () => {
    const file = JSON.parse(made);
    expect(file.reasons.BATTERY_LOW[1].de).toBe('Akku niedrig ({battery_voltage:1} V, mindestens {limit:1} V nötig)');
    // all in german but a field put in as it is ({state})
    for (const [name, list] of Object.entries(file.reasons) as [string, {de?: string}[]][]) for (const v of list) expect(v.de, name).toBeTruthy();
    for (const [type, t] of Object.entries(file.events) as [string, {variants: {en: string; de?: string}[]}][])
      for (const v of t.variants) {
        expect(v.en, type).toBeTruthy();
        if (!/^\{\w+\}$/.test(v.en)) expect(v.de, type).toBeTruthy();
      }
    expect(file.events.MOWING_REFUSED.variants[0]).toEqual({en: 'Mowing not started', de: 'Mähen nicht gestartet'});
    expect(file.emergency_bits['2']).toBe('STOP');
    expect(file.emergency_hide_with.LIFT).toBe('LIFT_MULTIPLE');
  });

  it("names MowBite OS's emergency bits once a node sets them, any other bit is said as bit N", () => {
    const file = JSON.parse(made);
    expect(file.emergency_bits['18']).toBe('WHEEL_RUNAWAY');
    expect(file.emergency_bits['15']).toBe('STUCK');
    expect(file.emergency_bits['21']).toBeUndefined();
    expect(file.fallback.emergency_bit).toEqual({en: 'bit {n}', de: 'Bit {n}'});
    for (const [name, t] of Object.entries(file.emergency_text) as [string, {de?: string}][]) expect(t.de, name).toBeTruthy();
  });

  it('ends every list with a variant that always fits, the reasons that only fit with a field excepted', () => {
    for (const [type, t] of Object.entries(EVENTS)) expect(t.variants.at(-1)?.when, type).toBeUndefined();
    // SAVE_FAILED with an unknown code says the mower's text
    for (const [name, list] of Object.entries(REASONS)) if (name !== 'SAVE_FAILED') expect(list.at(-1)?.when, name).toBeUndefined();
  });
});
