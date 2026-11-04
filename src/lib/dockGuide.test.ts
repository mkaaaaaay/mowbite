import {describe, expect, it} from 'vitest';
import {firstPointOff, inFront, OUT, SIDE, standing, stationChange, TURN} from './dockGuide';

// the demo's station: its way in goes to -x
const station = {position: {x: -1.1, y: 3.5}, heading: Math.PI};

describe('where the mower stands for the docking station', () => {
  it('a metre out on the line, facing it', () => {
    const s = standing(station, {x: -0.1, y: 3.5, heading: Math.PI});
    expect(s.out).toBeCloseTo(1);
    expect(s.side).toBeCloseTo(0);
    expect(s.turn).toBeCloseTo(0);
    expect(firstPointOff(s)).toBeNull();
  });

  it('beside the line to the left looking in, turned to face it to the left', () => {
    const at = inFront(station, 1.2, 0.05);
    // looking in (to -x), left is -y
    expect(at.x).toBeCloseTo(0.1);
    expect(at.y).toBeCloseTo(3.45);
    const s = standing(station, {...at, heading: Math.PI - 0.1});
    expect(s.out).toBeCloseTo(1.2);
    expect(s.side).toBeCloseTo(0.05);
    expect(s.turn).toBeCloseTo(0.1);
  });

  it('turns the short way round over ±180°', () => {
    expect(standing(station, {x: 0, y: 3.5, heading: -Math.PI + 0.05}).turn).toBeCloseTo(-0.05);
    expect(standing({position: {x: 0, y: 0}, heading: 0.1}, {x: -1, y: 0, heading: 2 * Math.PI}).turn).toBeCloseTo(0.1);
  });

  it('says what is off first: somewhere else, not out yet, turned, beside, too far', () => {
    expect(firstPointOff({out: 1, side: 0.6, turn: 0})).toBe('away');
    expect(firstPointOff({out: 2.2, side: 0, turn: 0})).toBe('away');
    expect(firstPointOff({out: -0.6, side: 0, turn: 0})).toBe('away');
    // still backing out: how it's turned or aside waits until it's out
    expect(firstPointOff({out: 0, side: 0, turn: TURN * 3})).toBe('short');
    expect(firstPointOff({out: 0.5, side: SIDE * 2, turn: TURN * 2})).toBe('short');
    expect(firstPointOff({out: OUT, side: SIDE * 2, turn: TURN * 2})).toBe('turn');
    expect(firstPointOff({out: OUT, side: -SIDE * 2, turn: -TURN / 2})).toBe('side');
    expect(firstPointOff({out: 1.7, side: 0.02, turn: 0})).toBe('far');
    expect(firstPointOff({out: OUT, side: SIDE * 0.9, turn: -TURN * 0.9})).toBeNull();
    expect(firstPointOff({out: 0.76, side: 0, turn: 0})).toBeNull();
    expect(firstPointOff({out: 1.49, side: 0, turn: 0})).toBeNull();
  });

  it('how far the station recorded again moved and turned', () => {
    const c = stationChange(station, {position: {x: -1.07, y: 3.54}, heading: -Math.PI + 0.02});
    expect(c.moved).toBeCloseTo(0.05);
    expect(c.turned).toBeCloseTo(0.02);
  });
});
