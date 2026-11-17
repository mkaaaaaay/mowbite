import {createHash} from 'node:crypto';
import {describe, expect, it} from 'vitest';
import {DEMO_IMAGES} from './demo/setup';
import {derivedParts, robotShape, shapePath, words} from './setup';
import {TRON_SHAPE} from './tronShape';

describe('the setup program', () => {
  it('says each word in the language shown, a missing one in english', () => {
    const t = {en: {name: 'Lifting', help: 'Lift it.', fix: 'Check it.'}, de: {name: 'Anheben', help: '', fix: 'Prüfen.'}};
    expect(words(t, 'de')).toEqual({name: 'Anheben', help: 'Lift it.', fix: 'Prüfen.'});
    expect(words(t, 'fr').name).toBe('Lifting');
    expect(words(undefined, 'de')).toEqual({name: '', help: '', fix: ''});
  });

  it("takes the mower's shape only within the limits, else none", () => {
    const part = (id: string, n = 4) => ({id, kind: 'body', points: Array.from({length: n}, (_, i) => [i / 10, 0]), closed: true});
    expect(robotShape([part('a')])).toHaveLength(1);
    expect(robotShape([])).toBeNull();
    expect(robotShape([{...part('a'), kind: 'rocket'}])).toBeNull();
    expect(robotShape([part('a', 201)])).toBeNull();
    expect(robotShape(Array.from({length: 33}, (_, i) => part(`p${i}`)))).toBeNull();
    expect(robotShape(Array.from({length: 6}, (_, i) => part(`p${i}`, 170)))).toBeNull();
    expect(robotShape([{...part('a'), points: [[0, 0], [0, NaN]]}])).toBeNull();
    expect(robotShape(TRON_SHAPE)).toEqual(TRON_SHAPE);
  });

  it('draws from above with the front up', () => {
    expect(shapePath([[0.6, 0.2], [-0.1, -0.2]], true)).toBe('M-0.2000 -0.6000 L0.2000 0.1000 Z');
  });

  it('puts the parts a step can mark where the sizes say', () => {
    const settings = Object.fromEntries(
      Object.entries({track: 0.4, wheel_radius: 0.1, wheel_width: 0.05, blade_ahead: 0.2, mower_width: 0.3, robot_front: 0.6, robot_rear: 0.1, robot_width: 0.5}).map(
        ([k, value]) => [k, {value}],
      ),
    );
    const d = derivedParts({settings});
    expect(d.wheel_left).toContainEqual([0.1, 0.225]);
    expect(d.outline).toContainEqual([0.6, 0.25]);
    expect(Math.max(...d.blade.map(([x]) => x))).toBeCloseTo(0.35);
    expect(d.antenna).toBeUndefined();
  });

  it("gives the demo's images with their checksum", () => {
    for (const [name, img] of Object.entries(DEMO_IMAGES)) expect(createHash('sha256').update(img.svg).digest('hex'), name).toBe(img.sha256);
  });
});
