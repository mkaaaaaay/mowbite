import {describe, expect, it} from 'vitest';
import {motionTracker} from './calibMotion';

// poses 7 a second as position/json brings them
const drive = (track: ReturnType<typeof motionTracker>, from: number, s: number, at: (t: number) => {x: number; y: number; heading: number}) => {
  let m = track(from, at(0));
  for (let t = 1 / 7; t <= s; t += 1 / 7) m = track(from + t, at(t));
  return m;
};

describe("what the mower does while it's calibrated", () => {
  it('stands, then goes straight from where it started, then turns left round', () => {
    const track = motionTracker();
    let m = drive(track, 0, 3, () => ({x: 1, y: 2, heading: 0.5}));
    expect(m.doing).toBe('still');
    expect(m.stood).toBeGreaterThan(2);
    m = drive(track, 3, 10, (t) => ({x: 1 + Math.cos(0.5) * 0.3 * t, y: 2 + Math.sin(0.5) * 0.3 * t, heading: 0.5}));
    expect(m.doing).toBe('straight');
    expect(m.run).toBeGreaterThan(2.6);
    expect(m.run).toBeLessThan(3.01);
    const end = m.pose!;
    m = drive(track, 13, 6, (t) => ({...end, heading: 0.5 + 0.8 * t}));
    expect(m.doing).toBe('turn');
    expect(m.turned).toBeGreaterThan(4);
    // a stop in the middle of a turn: what it turned stays, it goes on from there
    const turned = m.turned;
    const at = m.pose!;
    m = drive(track, 19, 2, () => at);
    expect(m.doing).toBe('still');
    expect(m.turned).toBeCloseTo(turned, 1);
    m = drive(track, 21, 2, (t) => ({...at, heading: at.heading + 0.8 * t}));
    expect(m.turned).toBeGreaterThan(turned + 1.4);
    // the next run starts it again
    const back = m.pose!;
    m = drive(track, 23, 4, (t) => ({x: back.x + Math.cos(back.heading) * 0.3 * t, y: back.y + Math.sin(back.heading) * 0.3 * t, heading: back.heading}));
    expect(m.doing).toBe('straight');
    expect(m.turned).toBe(0);
  });

  it('counts a wide curve as straight, a tight one not', () => {
    const arc = (r: number) => (t: number) => ({x: r * Math.sin((0.3 * t) / r), y: r - r * Math.cos((0.3 * t) / r), heading: (0.3 * t) / r});
    expect(drive(motionTracker(), 0, 5, arc(4)).doing).toBe('straight');
    expect(drive(motionTracker(), 0, 5, arc(1)).doing).not.toBe('straight');
  });
});
