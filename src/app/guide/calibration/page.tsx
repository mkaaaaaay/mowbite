'use client';

import {CALIB_SHOWN, calibMissingText} from '@/lib/calibration';
import {tr, useLang} from '@/lib/i18n';
import Link from 'next/link';
import {useId} from 'react';
import styles from './page.module.css';

// the mower from above, driving to the right, its middle on the axle
function Mower({x, y, s = 1, dim}: {x: number; y: number; s?: number; dim?: boolean}) {
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`} opacity={dim ? 0.45 : 1}>
      <rect className={styles.body} x={-16} y={-17} width={46} height={34} rx={9} />
      <rect className={styles.wheel} x={-8} y={-22} width={16} height={6} rx={2} />
      <rect className={styles.wheel} x={-8} y={16} width={16} height={6} rx={2} />
      <circle className={styles.blade} cx={12} cy={0} r={10} />
      <circle className={styles.ant} cx={4} cy={0} r={3.2} />
      <path className={styles.nose} d="M22 -5 l5 5 l-5 5" />
    </g>
  );
}

// a drawing with its own arrow heads (accent, good, bad)
function Art({w, h, label, children}: {w: number; h: number; label: string; children: (arrow: (kind?: 'good' | 'bad') => string) => React.ReactNode}) {
  const id = useId().replace(/:/g, '');
  const arrow = (kind?: 'good' | 'bad') => `url(#${id}${kind ?? 'a'})`;
  return (
    <svg className={styles.art} viewBox={`0 0 ${w} ${h}`} role="img" aria-label={label}>
      <defs>
        {(['a', 'good', 'bad'] as const).map((k) => (
          <marker key={k} id={id + k} viewBox="0 0 10 10" refX={6} refY={5} markerWidth={5} markerHeight={5} orient="auto-start-reverse">
            <path d="M0 0L10 5L0 10z" className={k === 'a' ? styles.accentFill : k === 'good' ? styles.goodFill : styles.badFill} />
          </marker>
        ))}
      </defs>
      <rect className={styles.grass} x={0} y={0} width={w} height={h} />
      {children(arrow)}
    </svg>
  );
}

// a turn on the spot round the mower and the way on after it, left or right
function Turn({x, y, left, arrow}: {x: number; y: number; left: boolean; arrow: string}) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <Mower x={0} y={0} s={0.8} />
      <path className={styles.path} d={left ? 'M0 -40 A40 40 0 1 0 35 20' : 'M0 40 A40 40 0 1 1 35 -20'} markerEnd={arrow} />
    </g>
  );
}

// how to calibrate, in cards with a drawing each: before, standing, straight runs, turns, while mowing, the result
export default function CalibrationGuidePage() {
  useLang();
  if (!CALIB_SHOWN)
    return (
      <div className={styles.page}>
        <main className={styles.main}>
          <h1>{tr('Calibrating')}</h1>
          <section className={styles.card}>
            <p>{calibMissingText('build')}</p>
          </section>
        </main>
      </div>
    );
  return (
    <div className={styles.page}>
      <main className={styles.main}>
        <Link href="/calibration" className={styles.back}>
          ← {tr('Calibration')}
        </Link>
        <h1>{tr('Calibrating')}</h1>
        <p className={styles.lead}>
          {tr("Driving it yourself takes about 5 minutes: at the start stand still for 10 s, then one and a half rounds on the spot and at least 5 m straight back, at least three times each way, four are better. It goes to and fro on a lane of about 7 × 3 m. The page shows you what's still missing.")}
        </p>

        <section className={styles.card}>
          <h2>
            <span className={styles.num}>!</span>
            {tr('Before: calibrate first, then the docking station')}
          </h2>
          <Art w={340} h={150} label={tr('Calibrate first, then record the docking station again')}>
            {(arrow) => (
              <>
                <Mower x={80} y={74} />
                <text className={styles.label} x={80} y={128} textAnchor="middle">
                  {tr('1 · Calibrate')}
                </text>
                <path className={styles.path} d="M140 74 H200" markerEnd={arrow()} />
                <path d="M230 44 H278 V104 H230" className={styles.nose} />
                <rect x={266} y={56} width={10} height={36} rx={3} className={styles.accentFill} />
                <Mower x={246} y={74} s={0.8} />
                <text className={styles.label} x={252} y={128} textAnchor="middle">
                  {tr('2 · Record the station')}
                </text>
              </>
            )}
          </Art>
          <p>
            {tr("If the antenna's position changes by more than 2 cm, the station lies off on the map. MowBite tells you after applying, and the record page guides you through recording it again: it stands in the station, you back it out straight 1 to 1½ m, it stands there too and it's saved.")}
          </p>
          <p className={styles.dim}>
            {tr('Driving it yourself switches the mower into recording mode, nothing is recorded as an area. Drive it back onto the docking station afterwards.')}
          </p>
        </section>

        <section className={styles.card}>
          <h2>
            <span className={styles.num}>1</span>
            {tr('Stand still for 10 seconds')}
          </h2>
          <Art w={340} h={150} label={tr('The mower stands still for 10 seconds')}>
            {() => (
              <>
                <circle className={styles.ring} cx={120} cy={75} r={52} />
                <circle cx={120} cy={75} r={52} fill="none" className={styles.path} strokeDasharray="245 327" transform="rotate(-90 120 75)" />
                <Mower x={112} y={75} />
                <text className={styles.label} x={200} y={68} style={{fontSize: 22}}>
                  10 s
                </text>
                <text className={styles.small} x={200} y={92}>
                  {tr('Let go of the stick, touch nothing')}
                </text>
              </>
            )}
          </Art>
          <p>{tr('From this it measures how calm the sensors are at rest. Best right at the start. Stops of 3 s and more count too.')}</p>
        </section>

        <section className={styles.card}>
          <h2>
            <span className={styles.num}>2</span>
            {tr('Straight runs')}
          </h2>
          <Art w={340} h={206} label={tr('A straight run of at least 5 meters: start gently, drive steadily, stop gently')}>
            {(arrow) => (
              <>
                <Mower x={40} y={56} s={0.8} dim />
                <path className={styles.path} d="M70 56 H262" markerEnd={arrow()} />
                <Mower x={290} y={56} s={0.8} />
                <path className={styles.guide} d="M40 88 V96 M290 88 V96 M40 92 H290" />
                <text className={styles.small} x={165} y={110} textAnchor="middle">
                  {tr('at least 5 m, better 8 to 10 m')}
                </text>
                <text className={styles.small} x={165} y={146} textAnchor="middle">
                  {tr('steady, stick half to full')}
                </text>
                <path className={styles.guide} d="M40 182 H290" />
                <path className={styles.path} d="M40 182 C62 182 66 156 90 156 H240 C264 156 268 182 290 182" />
                <text className={styles.small} x={62} y={200} textAnchor="middle">
                  {tr('gentle start')}
                </text>
                <text className={styles.small} x={268} y={200} textAnchor="middle">
                  {tr('gentle stop')}
                </text>
              </>
            )}
          </Art>
          <div className={styles.two}>
            <div>
              <Art w={160} h={100} label={tr('A gentle curve from 3 m radius counts as straight')}>
                {(arrow) => (
                  <>
                    <path className={styles.good} d="M18 74 Q80 30 142 60" markerEnd={arrow('good')} />
                    <text className={styles.label} x={80} y={90} textAnchor="middle">
                      ✓
                    </text>
                  </>
                )}
              </Art>
              <div className={styles.cap}>{tr('A gentle curve from 3 m radius counts as straight')}</div>
            </div>
            <div>
              <Art w={160} h={100} label={tr("Don't steer back and forth")}>
                {(arrow) => (
                  <>
                    <path className={styles.bad} d="M18 56 L40 44 L60 62 L82 42 L104 62 L126 46 L142 54" markerEnd={arrow('bad')} />
                    <text className={styles.label} x={80} y={90} textAnchor="middle">
                      ✗
                    </text>
                  </>
                )}
              </Art>
              <div className={styles.cap}>{tr("Don't steer back and forth")}</div>
            </div>
          </div>
          <ul className={styles.steps}>
            <li>
              <span className={styles.ok}>✓</span>
              <span>{tr('At least 4 runs, 20 m together. There and back works too.')}</span>
            </li>
            <li>
              <span className={styles.ok}>✓</span>
              <span>{tr('Only push the stick forward and hold it steady, not at a crawl. Drifting a little is fine.')}</span>
            </li>
            <li>
              <span className={styles.ok}>✓</span>
              <span>{tr("Gone crooked? Stop, line up, new run. The crooked one doesn't count then.")}</span>
            </li>
            <li>
              <span className={styles.no}>✗</span>
              <span>{tr('No jolt when starting or braking, no constant steering.')}</span>
            </li>
          </ul>
        </section>

        <section className={styles.card}>
          <h2>
            <span className={styles.num}>3</span>
            {tr('Turning on the spot')}
          </h2>
          <Art w={340} h={170} label={tr('One and a half rounds on the spot, then 5 meters back along the lane, three or better four times to each side')}>
            {(arrow) => (
              <>
                <path className={styles.guide} d="M40 112 H300" />
                <Turn x={62} y={72} left arrow={arrow()} />
                <path className={styles.path} d="M112 62 H226" markerEnd={arrow()} />
                <path className={styles.pathSoft} d="M226 84 H112" markerEnd={arrow()} />
                <text className={styles.small} x={169} y={104} textAnchor="middle">
                  5 m
                </text>
                <Turn x={276} y={72} left arrow={arrow()} />
                <text className={styles.label} x={170} y={146} textAnchor="middle">
                  {tr('1½ rounds, 5 m, 1½ rounds, 5 m back')}
                </text>
              </>
            )}
          </Art>
          <p>
            {tr(
              'Stick to the side only, without forward or back, and hold it steady at speed 0.25. One and a half rounds until it looks back, then at least 5 m straight back: so it goes to and fro on one lane. A turn only counts once a run follows it, and the turn including its stops must take less than a minute. Rounds in a row count as one turn, what counts are separate turns between straight pieces: at least three to the left and three to the right, four each are better for the wheel distance.',
            )}
          </p>
          <p className={styles.dim}>{tr('Turns on the spot measure the antenna, all turns between runs the wheel distance.')}</p>
        </section>

        <section className={styles.card}>
          <h2>{tr('On the next mowing run')}</h2>
          <p>
            {tr(
              "It measures along: at least 50 m in 8 lanes and 20 turns each way. The antenna only when it also turns on the spot. You don't need to do anything.",
            )}
          </p>
          <p className={styles.dim}>{tr('The recording ends after the mow, after 2 hours at the latest: start the mow right after.')}</p>
        </section>

        <section className={styles.card}>
          <h2>{tr('The result')}</h2>
          <p>
            {tr(
              "Each value next to the one set now, with how far it changes and how sure it is (good, fair, poor). Poor ones can't be applied, a change smaller than the measuring accuracy isn't ticked. Big changes are marked: check them first.",
            )}
          </p>
          <p>
            {tr(
              'The MowBite Updater writes what you apply into mower_params.yaml and restarts OpenMower once the mower stands in the dock. Set back brings the values before back the same way.',
            )}
          </p>
          <p className={styles.dim}>
            {tr("A difference between the left and right wheel or a tilted IMU is only shown as a note: OpenMower has no setting for them.")}
          </p>
        </section>

        <Link href="/calibration" className={styles.next}>
          {tr('To the calibration')}
        </Link>
      </main>
    </div>
  );
}
