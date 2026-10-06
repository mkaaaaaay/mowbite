import {describe, expect, it} from 'vitest';
import {appendPoint, chunked, keepsTrail, thin, trackPoints, type Point, type TrackChunks} from './useMowerTrack';

// a mowing pattern with turns, blade changes and jitter, so plenty of points survive the thinning
function drive(n: number): Point[] {
  const out: Point[] = [];
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 0.04;
  for (let i = 0; i < n; i++) {
    const lane = Math.floor(i / 60);
    const along = i % 60;
    out.push({x: (lane % 2 ? 59 - along : along) * 0.05 + rnd(), y: lane * 0.18 + rnd(), b: i % 500 < 450});
  }
  return out;
}

const flat = (chunks: TrackChunks) => chunks.flatMap((c, i) => (i ? c.slice(1) : c));

describe('live trail in pieces', () => {
  it('draws the same as the old single list, piece by piece', () => {
    const raw = drive(12000);
    let chunks: TrackChunks = [];
    for (const p of raw) chunks = appendPoint(chunks, p) ?? chunks;
    const old = thin(raw);
    expect(old.length).toBeGreaterThan(2000);
    expect(flat(chunks)).toEqual(old);
    expect(trackPoints(chunks)).toBe(old.length);
  });

  it('pieces stay small and join up', () => {
    let chunks: TrackChunks = [];
    for (const p of drive(8000)) chunks = appendPoint(chunks, p) ?? chunks;
    expect(chunks.length).toBeGreaterThan(3);
    for (let i = 0; i < chunks.length; i++) {
      expect(chunks[i].length).toBeLessThanOrEqual(400);
      if (i) expect(chunks[i][0]).toBe(chunks[i - 1][chunks[i - 1].length - 1]);
    }
  });

  it('finished pieces keep their identity when a point is added', () => {
    let chunks: TrackChunks = [];
    for (const p of drive(8000)) chunks = appendPoint(chunks, p) ?? chunks;
    const next = appendPoint(chunks, {x: 50, y: 50, b: true})!;
    for (let i = 0; i < chunks.length - 1; i++) expect(next[i]).toBe(chunks[i]);
  });

  it('drops the oldest pieces past the limit', () => {
    let chunks: TrackChunks = [];
    for (const p of drive(12000)) chunks = appendPoint(chunks, p, 1500) ?? chunks;
    expect(trackPoints(chunks)).toBeLessThanOrEqual(1500);
    expect(flat(chunks)).toEqual(thin(drive(12000)).slice(-trackPoints(chunks)));
  });

  it('cuts a loaded trail the same way', () => {
    const old = thin(drive(9000));
    const chunks = chunked(old);
    expect(flat(chunks)).toEqual(old);
    expect(chunked([])).toEqual([]);
    expect(flat(chunked(old.slice(0, 1)))).toEqual(old.slice(0, 1));
  });
});

// how far the farthest of the points is from the thinned line through them
function offLine(points: Point[], line: Point[]) {
  const toSegment = (p: Point, a: Point, b: Point) => {
    const dx = b.x - a.x, dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    const t = len2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)) : 0;
    return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
  };
  return Math.max(...points.map((p) => Math.min(...line.slice(1).map((b, i) => toSegment(p, line[i], b)))));
}

describe('thinning the trail', () => {
  // a position every 150 ms at 0.45 m/s, along a bend of radius r
  const bend = (r: number) =>
    Array.from({length: Math.floor((r * Math.PI) / 0.0675)}, (_, i) => ({x: r * Math.cos((i * 0.0675) / r), y: r * Math.sin((i * 0.0675) / r), b: true}));

  it('keeps a curve within half a centimetre of where the mower drove', () => {
    for (const r of [1, 3, 10]) {
      const raw = bend(r);
      const line = thin(raw);
      expect(offLine(raw, line)).toBeLessThan(0.0055);
      expect(line.length).toBeLessThan(raw.length / 2);
    }
  });

  it('needs only the ends of a straight lane', () => {
    const raw = Array.from({length: 200}, (_, i) => ({x: i * 0.0675, y: 0, b: true}));
    expect(thin(raw)).toEqual([raw[0], raw[199]]);
  });

  it('thins the same live, point by point', () => {
    const raw = bend(3);
    let chunks: TrackChunks = [];
    for (const p of raw) chunks = appendPoint(chunks, p) ?? chunks;
    expect(flat(chunks)).toEqual(thin(raw));
  });
});

describe('whose trail it is', () => {
  it('keeps the trail of the job going on, also the last run shown while idle', () => {
    // nothing known yet: the live points stay, the recorded track replaces them
    expect(keepsTrail(null, 'a')).toBe(true);
    // the same job again, e.g. resumed after rain
    expect(keepsTrail('a', 'a')).toBe(true);
    // a new job: the trail of the last one goes
    expect(keepsTrail('a', 'b')).toBe(false);
  });
});
