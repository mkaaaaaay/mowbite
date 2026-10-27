'use client';

import {useComputedSpeed} from '@/hooks/useComputedSpeed';
import {useSensorValue} from '@/hooks/useMowerSensors';
import {useTrailingPose} from '@/hooks/useTrailingPose';
import {stillPreferred} from '@/lib/eggs';
import {bladeSeconds, bodyShape, type MowerBody} from '@/lib/mowerBody';
import {createEaser, type Easer, type Pose} from '@/lib/poseEaser';
import type {Settings} from '@/lib/settings';
import {useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode} from 'react';
import {MapCostume} from './Costumes';
import type {Cover} from './gardenLife';
import {MapGhost} from './Halloween';
import {drawMower, mowerIcon} from './mapIcons';
import {HEIGHT, MOWER_SIZE, WIDTH, type Fit} from './mapFrame';
import styles from './MapView.module.css';

// what tells where the mower is at a time: the live poses, a simulated drive played back
type Glide = Pick<Easer, 'at' | 'still' | 'listen'>;

// the mower. It glides between the poses that come in and moves itself every frame for that without drawing again:
// its parts are drawn once around its position and the frame loop only moves and turns the groups they sit in. The rest
// of the map stays as it is meanwhile
export function MowerMarker({
  mower,
  poses,
  fit,
  k,
  icons,
  body,
  outline,
  showIcon,
  emergency,
  blades,
  ghost,
  costume,
  cover,
  covers,
  coverId,
}: {
  mower: Pose;
  // the live poses as they came (useMowerPosition) or a simulated drive's clock, else it eases along mower on its own
  poses: Glide | null;
  fit: Fit;
  k: number;
  icons: Settings['icons'];
  // the mower's sizes when set, its outline and blade drawn with outline
  body: MowerBody | null;
  outline: boolean;
  showIcon: boolean;
  emergency?: boolean;
  blades: boolean;
  // halloween night: a little ghost follows a moment behind while it drives
  ghost?: boolean;
  costume?: {hat?: boolean; towel?: boolean; umbrella?: boolean};
  // the crowns and parasols over it, where they hide it (circles in svg units) it shows as its outline. coverId starts
  // the ids for that
  cover?: ReactNode;
  covers?: Cover[];
  coverId?: string;
}) {
  const [own] = useState(createEaser);
  useEffect(() => {
    own.push(poses ? null : mower);
  }, [own, poses, mower]);
  // the blade turning the way the mow motor does, drawn only with the outline
  const rpm = useSensorValue('om_mow_motor_rpm', (v) => (outline && body?.blade ? Math.round(parseFloat(v ?? '') || 0) : 0));
  const speed = useComputedSpeed(mower);
  // which way a side view faces. it only turns once the mower clearly heads the other way, so it doesn't flicker while
  // the mower drives up or down the map
  const [facing, setFacing] = useState(1);
  const across = Math.cos(mower.heading);
  if (across > 0.3 && facing !== 1) setFacing(1);
  if (across < -0.3 && facing !== -1) setFacing(-1);
  const {scale} = fit;
  // the parts around the mower's position with it heading along x, in svg units (svg's y points down)
  const shape = body ? bodyShape(body, 0, 0, 0) : null;
  const local = (p: {x: number; y: number}): [number, number] => [p.x * scale, -p.y * scale];
  // at its real size with the sizes set the icon sits in the middle of the body, as long as it
  const real = icons?.mowerRealSize ? shape : null;
  // same size on screen like the dock, or its real size (never smaller than a few pixels)
  const realSize = body && real ? ((body.front + body.rear) / 2) * scale : MOWER_SIZE * scale;
  const base = icons?.mowerRealSize ? Math.max(realSize, 7 * k) : 8 * k;
  const size = base * (real ? 1 : (icons?.mowerSize ?? 1));
  const icon = mowerIcon(icons?.mower);
  // a real mower at its real size: on the body, exactly as long and wide as set (a few pixels at least). at the same size
  // on screen it's drawn like the other icons
  const fitted = showIcon && icon.fit && !!body && !!real;
  const long = body ? (body.front + body.rear) / 2 : 1;
  const fitX = fitted ? Math.max(long * scale, 7 * k) : 0;
  const fitY = body ? (fitX * body.width) / 2 / long : 0;
  // where the icon sits: the body's middle at real size, else the mower's position
  const [mx, my] = shape && real ? local(shape.middle) : [0, 0];
  // a side view heading left would stand on its head, mirrored it keeps its feet on the ground. a figure
  // isn't turned with the heading at all, it only looks left or right. css, so it turns around instead of
  // flipping over at once
  const turn = !icon.side ? undefined : icon.upright ? `scaleX(${facing})` : `scaleY(${facing})`;
  const points = (list: {x: number; y: number}[]) => list.map((c) => local(c).join(',')).join(' ');
  const [bx, by] = shape ? local(shape.blade) : [0, 0];
  const r = body ? (body.blade / 2) * scale : 0;
  // OpenMower's rpm is negative when the motor turns the other way round (randomize_mow_motor_direction), forwards is
  // drawn clockwise
  const spin = Math.sign(rpm);
  const still = stillPreferred();

  // moved to the eased pose: all of it, the parts that turn with the heading (under the icon and over it), and the
  // ones that stay upright at the turned middle
  const moveRefs = useRef<(SVGGElement | null)[]>([]);
  const turnRefs = useRef<(SVGGElement | null)[]>([]);
  const uprightRefs = useRef<(SVGGElement | null)[]>([]);
  const placed = useRef({sx: NaN, sy: NaN, deg: NaN});
  const latest = useRef({fit, k, mx, my, mower});
  // the time of the frame being shown: placed again after a render at that time, a later one would put it a bit ahead
  // until the next frame and it would twitch with every render
  const shownAt = useRef<number | null>(null);
  const place = useCallback(
    (now: number = shownAt.current ?? performance.now()) => {
      const {fit: f, k: unit, mx: ox, my: oy, mower: m} = latest.current;
      const p = (poses ?? own).at(now) ?? m;
      const sx = (p.x - f.minX) * f.scale + f.padX;
      const sy = HEIGHT - ((p.y - f.minY) * f.scale + f.padY);
      // svg y points down, so the map's ccw heading becomes a cw rotation
      const deg = (-p.heading * 180) / Math.PI;
      const last = placed.current;
      // (a fiftieth of a pixel, a twentieth of a degree: nothing is set again while it stands)
      if (Math.abs(sx - last.sx) < 0.02 * unit && Math.abs(sy - last.sy) < 0.02 * unit && Math.abs(deg - last.deg) < 0.05) return;
      placed.current = {sx, sy, deg};
      for (const g of moveRefs.current) g?.setAttribute('transform', `translate(${sx} ${sy})`);
      for (const g of turnRefs.current) g?.setAttribute('transform', `rotate(${deg})`);
      const a = (deg * Math.PI) / 180;
      const up = `translate(${ox * Math.cos(a) - oy * Math.sin(a)} ${ox * Math.sin(a) + oy * Math.cos(a)})`;
      for (const g of uprightRefs.current) g?.setAttribute('transform', up);
    },
    [poses, own],
  );
  // after every render: what's drawn may be new, it's placed before it shows
  useLayoutEffect(() => {
    latest.current = {fit, k, mx, my, mower};
    placed.current = {sx: NaN, sy: NaN, deg: NaN};
    place();
  });
  // every frame while it moves, at rest until a pose comes that's somewhere else
  useEffect(() => {
    const eased = poses ?? own;
    let frame = 0;
    const tick = (now: number) => {
      shownAt.current = now;
      place(now);
      frame = eased.still(now) ? 0 : requestAnimationFrame(tick);
    };
    const wake = () => void (frame ||= requestAnimationFrame(tick));
    frame = requestAnimationFrame(tick);
    const off = eased.listen(wake);
    return () => {
      off();
      cancelAnimationFrame(frame);
    };
  }, [place, poses, own]);

  const drawIcon = (
    <g className={styles.turn} style={turn ? {transform: turn} : undefined}>
      {drawMower(icon, {speed, emergency, blades})}
    </g>
  );
  // its outline where a crown or a parasol hides it: the body's (a real model's contour with its sizes), without sizes the
  // icon's drawn round its shape (a pixel and a bit wide at any zoom)
  const hidden = covers && covers.length > 0 && coverId;
  const iconOutline = showIcon && !shape;
  const [ox, oy] = fitted ? [fitX, fitY] : [size, size];
  const silhouette = (
    <filter id={coverId + 'o'} x="-30%" y="-30%" width="160%" height="160%">
      <feMorphology in="SourceAlpha" operator="dilate" radius={`${(1.4 * k) / ox} ${(1.4 * k) / oy}`} result="grown" />
      <feComposite in="grown" in2="SourceAlpha" operator="out" result="ring" />
      <feFlood floodColor="#fff" floodOpacity={0.9} />
      <feComposite in2="ring" operator="in" />
    </filter>
  );
  return (
    <>
      <g ref={(el) => void (moveRefs.current[0] = el)}>
        <g ref={(el) => void (turnRefs.current[0] = el)}>
          {outline && shape && <polygon className={styles.mowerBody} points={points(shape.corners)} />}
          {fitted ? (
            <g
              className={styles.mower}
              transform={`translate(${mx} ${my}) scale(${fitX} ${fitY})`}
            >
              {icon.draw({speed, emergency, blades})}
            </g>
          ) : (
            showIcon &&
            !icon.upright && (
              <g className={styles.mower} transform={`translate(${mx} ${my}) scale(${size})`}>
                {drawIcon}
              </g>
            )
          )}
        </g>
        {showIcon && !fitted && icon.upright && (
          <g ref={(el) => void (uprightRefs.current[0] = el)}>
            <g className={styles.mower} transform={`scale(${size})`}>
              {drawIcon}
            </g>
          </g>
        )}
        <g ref={(el) => void (turnRefs.current[1] = el)}>
          {/* the blade over the icon, where it sits under the mower */}
          {outline && shape && r > 0 && (
            <g transform={`translate(${bx} ${by})`}>
              <circle className={blades ? styles.mowerBladeOn : styles.mowerBlade} r={r} />
              {/* the blade itself, turning like the mow motor: svg's y points down, so a positive angle turns clockwise */}
              <g className={styles.mowerBladeBar}>
                <rect x={-r * 0.92} y={-r * 0.09} width={r * 1.84} height={r * 0.18} rx={r * 0.05} />
                <rect x={-r * 0.92} y={-r * 0.09} width={r * 0.3} height={r * 0.18} transform={`rotate(-20 ${-r * 0.77} 0)`} />
                <rect x={r * 0.62} y={-r * 0.09} width={r * 0.3} height={r * 0.18} transform={`rotate(-20 ${r * 0.77} 0)`} />
                {spin !== 0 && !still && (
                  <animateTransform
                    attributeName="transform"
                    type="rotate"
                    from="0 0 0"
                    to={`${spin * 360} 0 0`}
                    dur={`${bladeSeconds(rpm)}s`}
                    repeatCount="indefinite"
                  />
                )}
              </g>
            </g>
          )}
          {outline && shape && (
            <>
              {!showIcon && <polyline className={styles.mowerArrow} points={points(shape.arrow)} />}
              <circle className={styles.mowerAxle} cx={0} cy={0} r={1.5 * k} />
            </>
          )}
        </g>
        {showIcon && (costume?.hat || costume?.towel || costume?.umbrella) && (
          // upright over any icon, also one seen from above, at the size it's drawn
          <g ref={(el) => void (uprightRefs.current[1] = el)}>
            <g transform={`scale(${fitted ? fitX : size})`} className={styles.costume}>
              <MapCostume hat={costume.hat} towel={costume.towel} umbrella={costume.umbrella} high={!!icon.side} />
            </g>
          </g>
        )}
      </g>
      {ghost && <MarkerGhost mower={mower} on={speed > 0.05} fit={fit} size={size} />}
      {cover}
      {hidden && (
        <>
          <defs>
            <mask id={coverId} maskUnits="userSpaceOnUse" x={-10 * WIDTH} y={-10 * HEIGHT} width={21 * WIDTH} height={21 * HEIGHT}>
              {covers.map((c, i) =>
                c.pts ? <polygon key={i} points={c.pts.map((p) => p.join(',')).join(' ')} fill="#fff" /> : <circle key={i} cx={c.cx} cy={c.cy} r={c.r} fill="#fff" />,
              )}
            </mask>
            {iconOutline && silhouette}
          </defs>
          <g mask={`url(#${coverId})`} className={styles.mowerUnder}>
            <g ref={(el) => void (moveRefs.current[1] = el)}>
              <g ref={(el) => void (turnRefs.current[2] = el)}>
                {shape && <polygon className={styles.mowerUnderBody} points={points(shape.corners)} />}
                {iconOutline &&
                  (fitted ? (
                    <g transform={`translate(${mx} ${my}) scale(${ox} ${oy})`} filter={`url(#${coverId}o)`}>
                      {icon.draw({speed, emergency, blades})}
                    </g>
                  ) : (
                    !icon.upright && (
                      <g transform={`translate(${mx} ${my}) scale(${size})`} filter={`url(#${coverId}o)`}>
                        {drawIcon}
                      </g>
                    )
                  ))}
              </g>
              {iconOutline && !fitted && icon.upright && (
                <g ref={(el) => void (uprightRefs.current[2] = el)}>
                  <g transform={`scale(${size})`} filter={`url(#${coverId}o)`}>
                    {drawIcon}
                  </g>
                </g>
              )}
            </g>
          </g>
        </>
      )}
    </>
  );
}

// halloween night: a little ghost follows a moment behind while it drives, drawn again every frame on its own
export function MarkerGhost({mower, on, fit, size}: {mower: Pose; on: boolean; fit: Fit; size: number}) {
  const haunt = useTrailingPose(mower, on);
  if (!haunt) return null;
  const sx = (haunt.x - fit.minX) * fit.scale + fit.padX;
  const sy = HEIGHT - ((haunt.y - fit.minY) * fit.scale + fit.padY);
  return (
    <g transform={`translate(${sx} ${sy}) scale(${(size * 2.2) / 30})`} className={styles.ghost}>
      <g className={styles.ghostBob}>
        <MapGhost />
      </g>
    </g>
  );
}
