import {describe, expect, it} from 'vitest';
import {trackSpeed, type SpeedTrack} from './useComputedSpeed';

type At = [number, number, number];

// the speed after each pose, given as [ms, x, y]
function speeds(poses: At[]) {
  let track: SpeedTrack | null = null;
  return poses.map(([t, x, y]) => {
    track = trackSpeed(track, {x, y}, t);
    return track.speed;
  });
}
// along x at 0.3 m/s, a pose every 150 ms
const driving = Array.from({length: 21}, (_, i): At => [1000 + i * 150, i * 0.045, 0]);

describe('trackSpeed', () => {
  it('starts at 0 and is halfway to the speed between two poses after 400 ms', () => {
    // 0.2 m in 400 ms: 0.5 m/s
    expect(speeds([[1000, 0, 0], [1400, 0.12, 0.16]])).toEqual([0, 0.25]);
  });

  it('leaves out a pose within 50 ms of the one before', () => {
    const first = trackSpeed(null, {x: 1, y: 2}, 1000);
    expect(first).toEqual({x: 1, y: 2, at: 1000, speed: 0});
    expect(trackSpeed(first, {x: 1.5, y: 2}, 1050)).toBe(first);
    // 0.5 m in 51 ms: so short a step counts for little
    expect(trackSpeed(first, {x: 1.5, y: 2}, 1051).speed).toBeCloseTo(0.8292512519979665, 12);
  });

  it('comes up to a steady speed and goes down again once the mower stands', () => {
    const v = speeds(driving);
    for (let i = 1; i < v.length; i++) expect(v[i]).toBeGreaterThan(v[i - 1]);
    // 2.4 s on, six half-lives: 1/64 short of it
    expect(v[16]).toBeCloseTo(0.3 * (63 / 64), 12);
    expect(v[20]).toBeCloseTo(0.29834271848159394, 12);
    const standing = speeds([...driving, ...[1, 2, 3, 4].map((i): At => [4000 + i * 150, 0.9, 0])]).slice(driving.length);
    expect(standing[0]).toBeCloseTo(0.23005368506197416, 12);
    expect(standing[3]).toBeCloseTo(0.10548007967798223, 12);
    for (let i = 1; i < standing.length; i++) expect(standing[i]).toBeLessThan(standing[i - 1]);
  });
});
