import {afterEach, describe, expect, it, vi} from 'vitest';
import {createEaser, type Pose} from './poseEaser';

let clock = 0;
vi.spyOn(performance, 'now').mockImplementation(() => clock);
afterEach(() => {
  clock = 0;
});

// poses sent every 150 ms, pushed when they come (ms after sending) and played back at 120 Hz from..to
function play(poses: {pose: Pose; came: number}[], from: number, to: number) {
  const easer = createEaser();
  const shown: Pose[] = [];
  const order = [...poses].sort((a, b) => a.came - b.came);
  let k = 0;
  for (let now = 0; now <= to; now += 1000 / 120) {
    while (k < order.length && order[k].came <= now) {
      clock = order[k].came;
      easer.push(order[k].pose);
      k++;
    }
    clock = now;
    const p = easer.at(now);
    if (now >= from && p) shown.push(p);
  }
  return shown;
}

const steps = (shown: Pose[]) => shown.slice(1).map((p, i) => Math.hypot(p.x - shown[i].x, p.y - shown[i].y));

describe('createEaser', () => {
  it('moves on in every frame at an even speed, also with poses a little late or two at once', () => {
    // 0.3 m/s along x, wifi delays of a few ms and poses 20 and 21 coming together
    const late = [0, 6, 2, 11, 4, 9, 1, 14];
    const poses = Array.from({length: 40}, (_, i) => ({
      pose: {x: i * 0.045, y: 0, heading: 0},
      came: (i === 20 ? 21 * 150 : i * 150) + late[i % late.length],
    }));
    const moved = steps(play(poses, 1500, 5500));
    const median = [...moved].sort((a, b) => a - b)[moved.length >> 1];
    expect(Math.min(...moved)).toBeGreaterThan(median * 0.85);
    expect(Math.max(...moved)).toBeLessThan(median * 1.15);
  });

  it('stands while the poses stay the same and goes on smoothly after', () => {
    const poses = Array.from({length: 30}, (_, i) => ({pose: {x: Math.max(0, i - 15) * 0.045, y: 0, heading: 0}, came: i * 150}));
    const shown = play(poses, 1000, 4000);
    const moved = steps(shown);
    expect(moved.slice(0, 60).every((d) => d === 0)).toBe(true);
    expect(Math.max(...moved)).toBeLessThan(0.045 / 18 * 1.3);
  });

  it('turns the short way round over +-pi', () => {
    const headings = [2.9, 3.0, 3.1, -3.1, -3.0, -2.9, -2.8, -2.7];
    const poses = headings.map((heading, i) => ({pose: {x: 0, y: 0, heading}, came: i * 150}));
    for (const p of play(poses, 400, 1100)) expect(Math.cos(p.heading)).toBeLessThan(-0.9);
  });

  it('snaps to a pose far away', () => {
    const easer = createEaser();
    for (let i = 0; i < 5; i++) {
      clock = i * 150;
      easer.push({x: i * 0.045, y: 0, heading: 0});
    }
    clock = 900;
    easer.push({x: 20, y: 0, heading: 0});
    expect(easer.at(900)?.x).toBe(20);
  });
  it('is still once the curve has passed the last pose that moved, and calls when one moves again', () => {
    const easer = createEaser();
    let woken = 0;
    easer.listen(() => woken++);
    const push = (i: number) => {
      clock = i * 150;
      easer.push({x: Math.min(i, 5) * 0.045, y: 0, heading: 0});
    };
    for (let i = 0; i < 6; i++) push(i);
    // still on its way to the last pose
    expect(easer.still(clock)).toBe(false);
    for (let i = 6; i < 20; i++) push(i);
    // the same pose again and again doesn't call
    expect(woken).toBe(6);
    expect(easer.still(clock)).toBe(true);
    clock = 20 * 150;
    easer.push({x: 0.3, y: 0, heading: 0});
    expect(woken).toBe(7);
    expect(easer.still(clock)).toBe(false);
  });

  it('is still once the curve has reached the last pose when no more come while it drives', () => {
    const easer = createEaser();
    for (let i = 0; i < 8; i++) {
      clock = i * 150;
      easer.push({x: i * 0.045, y: 0, heading: 0});
    }
    // the wifi drops: the curve plays on up to the last pose and stays there
    expect(easer.still(clock)).toBe(false);
    const end = clock + 1000;
    expect(easer.at(end)).toEqual({x: 7 * 0.045, y: 0, heading: 0});
    expect(easer.still(end)).toBe(true);
  });
});
