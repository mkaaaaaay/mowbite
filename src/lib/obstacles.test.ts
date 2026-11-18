import {describe, expect, it} from 'vitest';
import {justSeen, mergeObstacles, obstacleName, sinceOf, withoutObstacle, type Obstacle} from './obstacles';

const seen = (id: number, last_t: number, more: Partial<Obstacle> = {}): Obstacle => ({
  id,
  t: last_t,
  last_t,
  count: 1,
  x: 0,
  y: 0,
  r: 0.2,
  kind: 'OBJECT',
  class: 'sports ball',
  confidence: 0.9,
  camera_id: 'stereo',
  action: 'seen',
  image: null,
  ...more,
});

describe('obstacles', () => {
  it('puts the ones seen anew over the known, last seen first', () => {
    const known = [seen(2, 200), seen(1, 100)];
    const merged = mergeObstacles(known, [seen(1, 300, {count: 2}), seen(3, 250)]);
    expect(merged.map((o) => [o.id, o.count])).toEqual([
      [1, 2],
      [3, 1],
      [2, 1],
    ]);
  });

  it('asks from a second before the newest, nothing known: all', () => {
    expect(sinceOf([seen(1, 100), seen(2, 250)])).toBe(249);
    expect(sinceOf([])).toBeUndefined();
  });

  it('forgets one or all', () => {
    const list = [seen(2, 200), seen(1, 100)];
    expect(withoutObstacle(list, 2).map((o) => o.id)).toEqual([1]);
    expect(withoutObstacle(list, null)).toEqual([]);
  });

  it('is there now for 10 s after it was seen last', () => {
    expect(justSeen(seen(1, 100), 109)).toBe(true);
    expect(justSeen(seen(1, 100), 110)).toBe(false);
  });

  it("names what the model saw in the app's words, else as the mower does, else by its kind", () => {
    expect(obstacleName({kind: 'OBJECT', class: 'sports ball'})).toBe('Sports ball');
    expect(obstacleName({kind: 'OBJECT', class: 'bicycle'})).toBe('bicycle');
    expect(obstacleName({kind: 'UNKNOWN', class: ''})).toBe('Something');
  });
});
