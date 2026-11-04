import {describe, expect, it} from 'vitest';
import {antennaOf, JUMP, standOn, standPoint, stationChange, stationFrom, type Stand} from './dockGuide';

// the demo's station: its way in goes to -x
const station = {position: {x: -1.1, y: 3.5}, heading: Math.PI};
// the NX60i's antenna, 7.8 cm behind the middle of the wheels
const o = {x: -0.078, y: 0};

describe('the docking station from where the antenna stood', () => {
  it('in the station and a metre and a half out: its place and the way in', () => {
    const inside = antennaOf({...station.position, heading: Math.PI}, o);
    // (behind the middle: towards +x here)
    expect(inside.x).toBeCloseTo(-1.022);
    const outside = antennaOf({x: 0.4, y: 3.5, heading: Math.PI}, o);
    const s = stationFrom(inside, outside, o);
    expect(s.position.x).toBeCloseTo(-1.1);
    expect(s.position.y).toBeCloseTo(3.5);
    expect(Math.cos(s.heading)).toBeCloseTo(-1);
  });

  it("doesn't go by the pose's heading: a wrong one shifts the pose, the antenna stays where it is", () => {
    // OpenMower 40° off: its pose lies where the antenna is less the offset turned the wrong way
    const wrong = 0.7;
    const truth = antennaOf({...station.position, heading: Math.PI}, o);
    const pose = (a: {x: number; y: number}) => ({x: a.x - Math.cos(Math.PI + wrong) * o.x, y: a.y - Math.sin(Math.PI + wrong) * o.x, heading: Math.PI + wrong});
    const out = antennaOf({x: 0.4, y: 3.5, heading: Math.PI}, o);
    // (the pose some 5 cm off the station)
    expect(Math.hypot(pose(truth).x - station.position.x, pose(truth).y - station.position.y)).toBeGreaterThan(0.05);
    const s = stationFrom(antennaOf(pose(truth), o), antennaOf(pose(out), o), o);
    expect(stationChange(station, s).moved).toBeLessThan(1e-9);
    expect(stationChange(station, s).turned).toBeLessThan(1e-9);
  });

  it('an antenna to the side', () => {
    const side = {x: -0.1, y: 0.03};
    const s = stationFrom(antennaOf({x: 2, y: 1, heading: Math.PI / 2}, side), antennaOf({x: 2, y: -0.5, heading: Math.PI / 2}, side), side);
    expect(s.position.x).toBeCloseTo(2);
    expect(s.position.y).toBeCloseTo(1);
    expect(s.heading).toBeCloseTo(Math.PI / 2);
  });

  it('how far the station recorded again moved and turned', () => {
    const c = stationChange(station, {position: {x: -1.07, y: 3.54}, heading: -Math.PI + 0.02});
    expect(c.moved).toBeCloseTo(0.05);
    expect(c.turned).toBeCloseTo(0.02);
  });
});

describe('a stand', () => {
  // samples 0.15 s apart around a point, a few cm of noise
  const noise = (i: number) => 0.012 * Math.sin(i * 1.7) + 0.008 * Math.cos(i * 0.9);
  const around = (x: number, y: number, from: number, n: number) => Array.from({length: n}, (_, i) => ({t: from + i * 0.15, x: x + noise(i), y: y + noise(i + 3)}));
  const add = (stand: Stand | null, samples: {t: number; x: number; y: number}[]) => samples.reduce<Stand | null>(standOn, stand)!;

  it('where it stood, a jump of the gps left out', () => {
    const samples = around(1, 2, 0, 40);
    // multipath: one sample 25 cm off
    samples[20] = {...samples[20], x: 1.25};
    const stand = add(null, samples);
    expect(stand.t0).toBe(0);
    const p = standPoint(stand.points, 1)!;
    expect(p.x).toBeCloseTo(1, 2);
    expect(p.y).toBeCloseTo(2, 2);
    expect(p.of - p.used).toBe(1);
  });

  it('moved: a new stand from where it went to', () => {
    let stand = add(null, around(1, 2, 0, 20));
    // backed out at 0.25 m/s
    stand = add(
      stand,
      Array.from({length: 40}, (_, i) => ({t: 3 + i * 0.15, x: 1 + (i + 1) * 0.0375, y: 2})),
    );
    stand = add(stand, around(2.5, 2, 9, 40));
    expect(stand.t0).toBeGreaterThan(3);
    const p = standPoint(stand.points, stand.t0 + 1)!;
    expect(p.x).toBeCloseTo(2.5, 2);
    expect(p.used).toBeGreaterThan(30);
  });

  it('driven all at once (the demo in a test): the stand begins where it stopped', () => {
    let stand = add(null, around(1, 2, 0, 20));
    stand = add(
      stand,
      Array.from({length: 30}, (_, i) => ({t: 3, x: 1 + (i + 1) * 0.05, y: 2})),
    );
    stand = add(stand, around(2.5, 2, 3.2, 40));
    const p = standPoint(stand.points, stand.t0 + 1)!;
    expect(Math.hypot(p.x - 2.5, p.y - 2)).toBeLessThan(JUMP / 2);
  });
});
