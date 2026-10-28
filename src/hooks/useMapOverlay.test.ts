import {describe, expect, it} from 'vitest';
import {parseOverlay} from './useMapOverlay';

describe('map overlay', () => {
  it("reads the lines as OpenMower's xbot_monitoring sends them", () => {
    const text = JSON.stringify({
      polygons: [
        {poly: [{x: 0, y: 0}, {x: 4, y: 0}, {x: 4, y: 3}], is_closed: 1, line_width: 0.1, color: 'green'},
        {poly: [{x: 21.87, y: -1.38}, {x: 21.98, y: -1.33}], is_closed: 0, line_width: 0.1, color: 'blue'},
      ],
    });
    expect(parseOverlay(text)).toEqual([
      {points: [{x: 0, y: 0}, {x: 4, y: 0}, {x: 4, y: 3}], color: 'green', closed: true},
      {points: [{x: 21.87, y: -1.38}, {x: 21.98, y: -1.33}], color: 'blue', closed: false},
    ]);
  });

  it('has none once the recording is over', () => {
    expect(parseOverlay('{"polygons":null}')).toEqual([]);
    expect(parseOverlay('{"polygons":[]}')).toEqual([]);
  });
});
