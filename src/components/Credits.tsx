'use client';

import {stillPreferred} from '@/lib/eggs';
import {tr} from '@/lib/i18n';
import {useEffect, useLayoutEffect, useRef, useState} from 'react';
import {createPortal} from 'react-dom';
import LogoMark from './Logo';
import styles from './Credits.module.css';

// seven taps on the version in the settings and the credits roll, like at the end of a film: over a strip of lawn the
// eater mows meanwhile, and at the end it eats "The End". a tap or escape closes them

const TAPS = 7;
// how fast the credits roll, px/s
const SPEED = 46;
// "the end" stands a moment, then the eater eats it and burps
const END_HOLD_MS = 1800;
const EAT_MS = 2600;

type Row = {role?: string; name: string} | {head: string} | {line: string} | {gap: true};

const ROWS: Row[] = [
  {role: 'Directed by', name: 'mkay'},
  {role: 'Screenplay', name: 'mkay'},
  {gap: true},
  {head: 'Starring'},
  {role: 'The lawn eater', name: 'as itself'},
  {role: 'The hedgehog', name: 'as the hedgehog'},
  {role: 'Father Christmas', name: 'seasonal'},
  {role: 'The snowman', name: 'also seasonal'},
  {role: 'Shrek', name: 'as a John Deere Tango'},
  {role: 'The Punisher', name: 'as an NX60'},
  {role: 'A pumpkin', name: 'once a year'},
  {gap: true},
  {head: 'Testers'},
  {name: 'Lauri'},
  {name: 'Pascal'},
  {name: 'amylizzle'},
  {name: 'Apehaenger'},
  {name: 'c.ez'},
  {gap: true},
  {role: 'Runs on', name: 'OpenMower'},
  {role: 'Special thanks', name: 'everyone who builds OpenMower'},
  {role: 'Coverage planning', name: 'the MowBite Planner'},
  {role: '', name: '(still learning to drive)'},
  {role: 'Weather', name: 'Open-Meteo'},
  {role: 'Maps drawn with', name: 'RTK, patience and a lot of walking'},
  {role: 'Catering', name: 'fresh grass clippings'},
  {role: 'Stunts', name: 'a trained robot'},
  {role: 'Filmed on location', name: 'in your garden'},
  {gap: true},
  {line: 'No hedgehogs were harmed in the making of this app.'},
  {gap: true},
  {line: 'So long, and thanks for all the grass.'},
];

const END = 'The End';

function Credits({onClose}: {onClose: () => void}) {
  const still = stillPreferred();
  const roll = useRef<HTMLDivElement>(null);
  // the time it takes to roll through, from the height of the credits
  const [rollMs, setRollMs] = useState(0);
  const [phase, setPhase] = useState<'roll' | 'end' | 'out'>(still ? 'end' : 'roll');
  const [height, setHeight] = useState(0);

  useLayoutEffect(() => {
    if (still || !roll.current) return;
    const h = roll.current.offsetHeight;
    setHeight(h);
    setRollMs(((h + window.innerHeight) / SPEED) * 1000);
  }, [still]);

  useEffect(() => {
    if (phase === 'roll' && rollMs) {
      const t = setTimeout(() => setPhase('end'), rollMs);
      return () => clearTimeout(t);
    }
    if (phase === 'end' && !still) {
      const t = setTimeout(() => setPhase('out'), END_HOLD_MS + EAT_MS + 2000);
      return () => clearTimeout(t);
    }
    if (phase === 'out') {
      const t = setTimeout(onClose, 600);
      return () => clearTimeout(t);
    }
  }, [phase, rollMs, still, onClose]);

  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === 'Escape' && setPhase('out');
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, []);

  const rows = ROWS.map((r, i) =>
    'gap' in r ? (
      <div key={i} className={styles.gap} />
    ) : 'head' in r ? (
      <h3 key={i}>{tr(r.head)}</h3>
    ) : 'line' in r ? (
      <p key={i} className={styles.line}>
        {tr(r.line)}
      </p>
    ) : (
      <div key={i} className={r.role === undefined ? styles.name : styles.row}>
        {r.role !== undefined && <span>{r.role ? tr(r.role) : ''}</span>}
        <strong>{r.role === undefined || r.name === 'mkay' || r.name === 'OpenMower' || r.name === 'Open-Meteo' ? r.name : tr(r.name)}</strong>
      </div>
    ),
  );

  return createPortal(
    <div
      className={[styles.screen, phase === 'out' ? styles.out : '', still ? styles.still : ''].join(' ')}
      role="dialog"
      aria-label={tr('Credits')}
      onClick={() => setPhase('out')}
    >
      {phase === 'roll' && (
        <div
          ref={roll}
          className={styles.roll}
          style={rollMs ? ({'--roll': `${rollMs}ms`, '--h': `${height}px`} as React.CSSProperties) : {visibility: 'hidden'}}
        >
          <div className={styles.title}>
            <LogoMark size={88} chomp bare />
            <h2>
              <strong>mow</strong>bite
            </h2>
            <p>{tr('a lawn eater production')}</p>
          </div>
          {rows}
        </div>
      )}
      {still && (
        <div className={styles.list}>
          <div className={styles.title}>
            <LogoMark size={72} bare />
            <h2>
              <strong>mow</strong>bite
            </h2>
            <p>{tr('a lawn eater production')}</p>
          </div>
          {rows}
        </div>
      )}
      {phase !== 'roll' && (
        <div className={styles.end} style={{'--eat': `${EAT_MS}ms`, '--hold': `${END_HOLD_MS}ms`} as React.CSSProperties}>
          <span className={styles.words}>
            {[...tr(END)].map((c, i, all) => (
              <span key={i} style={{'--at': `${((i + 0.7) / (all.length + 1)) * EAT_MS}ms`} as React.CSSProperties}>
                {c === ' ' ? ' ' : c}
              </span>
            ))}
            {!still && (
              <span className={styles.eater}>
                <LogoMark size={64} chomp bare />
              </span>
            )}
          </span>
          {!still && <span className={styles.burp}>{tr('*burp*')}</span>}
        </div>
      )}
      {/* the lawn along the bottom, mown while the credits roll */}
      {!still && (
        <div className={styles.lawn} style={rollMs ? ({'--roll': `${rollMs}ms`} as React.CSSProperties) : undefined}>
          <div className={styles.stubble} />
          <div className={[styles.tall, phase === 'roll' && rollMs ? styles.mowing : styles.mown].join(' ')} />
          {phase === 'roll' && rollMs > 0 && (
            <div className={styles.mower}>
              <LogoMark size={40} chomp bare />
            </div>
          )}
        </div>
      )}
      <button
        className={styles.close}
        onClick={(e) => {
          e.stopPropagation();
          setPhase('out');
        }}
        aria-label={tr('Close')}
      >
        ×
      </button>
    </div>,
    document.body,
  );
}

// the version line in the settings: tapped seven times it rolls the credits, the last taps count down quietly
export function CreditsTrigger({children, className}: {children: React.ReactNode; className?: string}) {
  const [taps, setTaps] = useState(0);
  const [open, setOpen] = useState(false);
  const last = useRef(0);
  const count = useRef(0);
  const left = TAPS - taps;
  // the countdown goes away when the tapping stops
  useEffect(() => {
    if (!taps) return;
    const t = setTimeout(() => setTaps(0), 2000);
    return () => clearTimeout(t);
  }, [taps]);
  return (
    <>
      <span
        className={className}
        onClick={(e) => {
          // a pause of two seconds starts over. counted in a ref, quick taps come faster than renders
          count.current = e.timeStamp - last.current > 2000 ? 1 : count.current + 1;
          last.current = e.timeStamp;
          if (count.current >= TAPS) {
            count.current = 0;
            setTaps(0);
            setOpen(true);
          } else setTaps(count.current);
        }}
      >
        {children}
        {taps >= 4 && left > 0 && <span className={styles.countdown}>{tr('{n} more…', {n: left})}</span>}
      </span>
      {open && <Credits onClose={() => setOpen(false)} />}
    </>
  );
}
