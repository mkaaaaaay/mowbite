import {useEffect, useRef, useState} from 'react';

// where the mower was at a time (ms) and the speed it had come to there (m/s)
export interface SpeedTrack {
  x: number;
  y: number;
  at: number;
  speed: number;
}

// the speed eases toward the one between two poses, halfway there after this long (s)
const HALF_LIFE = 0.4;
const ease = (from: number, to: number, s: number) => from + (to - from) * (1 - 0.5 ** (s / HALF_LIFE));

// the track taken on to a pose seen at a time (ms). a pose within 50 ms of the last one is left out, the same track
// comes back
export function trackSpeed(last: SpeedTrack | null, pose: {x: number; y: number}, now: number): SpeedTrack {
  if (!last) return {x: pose.x, y: pose.y, at: now, speed: 0};
  if (now - last.at <= 50) return last;
  const s = (now - last.at) / 1000;
  const between = Math.hypot(pose.x - last.x, pose.y - last.y) / s;
  return {x: pose.x, y: pose.y, at: now, speed: ease(last.speed, between, s)};
}

// no speed on the wire, so estimate m/s from pose updates (smoothed, gps jitter is noisy)
export function useComputedSpeed(pose: {x: number; y: number} | null | undefined): number {
  const [speed, setSpeed] = useState(0);
  const track = useRef<SpeedTrack | null>(null);

  useEffect(() => {
    if (!pose) return;
    const last = track.current;
    track.current = trackSpeed(last, pose, performance.now());
    if (last && track.current !== last) setSpeed(track.current.speed);
    // standing still nothing more comes (the position is sent on 2 cm or 2° only): back to 0 after a while
    const still = setTimeout(() => {
      if (track.current) track.current = {...track.current, speed: 0};
      setSpeed(0);
    }, 1500);
    return () => clearTimeout(still);
  }, [pose]);

  return speed;
}
