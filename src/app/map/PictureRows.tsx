import {LookSwatch, type Look} from '@/components/gardenLook';
import {GROUND_KEYS, PICTURES} from '@/components/gardenPictures';
import {fmt, tr} from '@/lib/i18n';
import {saveSettings, settingsStore} from '@/lib/settings';
import {useEffect, useRef, useSyncExternalStore} from 'react';
import styles from './page.module.css';

// what's kept for an area's picture by its id: which one, its color, size, direction and the ground under it. null takes
// one back to auto, left out it stays
export function keepLook(
  id: string,
  to: {look?: string | null; variant?: string | null; size?: number | null; turn?: number | null; closed?: true | null; ground?: string | null},
) {
  const cur = settingsStore.snapshot();
  const put = <T,>(all: Record<string, T> | undefined, v: T | null | undefined) => {
    if (v === undefined) return all;
    const next = {...all};
    if (v === null) delete next[id];
    else next[id] = v;
    return Object.keys(next).length ? next : undefined;
  };
  saveSettings({
    ...cur,
    looks: put(cur.looks, to.look) ?? {},
    lookVariants: put(cur.lookVariants, to.variant),
    lookSizes: put(cur.lookSizes, to.size),
    lookTurns: put(cur.lookTurns, to.turn),
    lookClosed: put(cur.lookClosed, to.closed),
    lookGrounds: put(cur.lookGrounds, to.ground),
  });
}

// the rows under the map that change the picture of an area (id) drawn as look: its color, the ground under it, how big
// it is, a parasol open or folded up and which way it lies, each kept with the app's settings right away. autoSize: how
// big it's drawn without a size of its own (m across, a long one its length, bushes each), autoDeg: which way it lies by
// itself (degrees on the map drawing). grounded: it has a ground of its own. sized: a size stays written down, auto too
// (a pin: an older mower_map that drops pin still draws it that big)
export default function PictureRows({id, look, autoSize, autoDeg, grounded, sized}: {id: string; look: Look; autoSize: number; autoDeg: number; grounded: boolean; sized?: boolean}) {
  const settings = useSyncExternalStore(settingsStore.subscribe, settingsStore.snapshot, settingsStore.serverSnapshot);
  const keep = (to: Parameters<typeof keepLook>[1]) => keepLook(id, to);
  const pic = PICTURES[look];
  // the color of a picture that comes in several, none: its usual one (or one of its own by the area)
  const variants = pic?.variants;
  const kept = settings.lookVariants?.[id];
  const variant = variants?.some((v) => v.key === kept) ? kept : undefined;
  const setVariant = (key: string | undefined) => keep({variant: key ?? null});
  // the ground under and round a picture standing in the area (what shows between a bed's plants too), none: its own
  const ground = grounded && GROUND_KEYS.includes(settings.lookGrounds?.[id] ?? '') ? settings.lookGrounds?.[id] : undefined;
  const setGround = (key: string | undefined) => keep({ground: key ?? null});
  // how big it's drawn, none: autoSize. the steps start about where it is and go from a good deal smaller to a good deal
  // bigger
  const sizable = !!pic?.thing && !pic.fill;
  const autoShown = Math.round(autoSize * 10) / 10;
  const ownSize = sizable ? settings.lookSizes?.[id] : undefined;
  const autoOn = !ownSize || (!!sized && ownSize === autoShown);
  const sizeFrom = Math.max(0.1, Math.round(Math.min(pic?.size?.[0] ?? autoSize, autoSize) * 4) / 10);
  const sizeTo = Math.min(30, Math.round(Math.max(pic?.size?.[1] ?? autoSize, autoSize) * 25) / 10);
  const setSize = (v: number | undefined) => keep({size: v ?? (sized ? autoShown : null)});
  // a step bigger or smaller from what it's drawn at, finer while it's small
  const stepSize = (dir: 1 | -1) => {
    const now = settingsStore.snapshot().lookSizes?.[id] ?? autoShown;
    const by = now < 2 ? 0.1 : now < 10 ? 0.5 : 1;
    setSize(Math.min(sizeTo, Math.max(sizeFrom, Math.round((now + dir * by) / by) * by)));
  };
  // which way it lies (degrees on the map, 0 east), a cantilever parasol which way it reaches. none: autoDeg. not for
  // what looks the same turned any way
  const turnable = sizable && !pic.round;
  const ownTurn = turnable ? settings.lookTurns?.[id] : undefined;
  const autoTurn = (Math.round((((autoDeg % 360) + 360) % 360) / 5) * 5) % 360;
  const setTurn = (v: number | undefined) => keep({turn: v ?? null});
  const stepTurn = (dir: 1 | -1) => setTurn((((settingsStore.snapshot().lookTurns?.[id] ?? autoTurn) + dir * 5) % 360 + 360) % 360);
  // a parasol open or folded up
  const folds = sizable && !!pic.folds;
  const closed = folds && settings.lookClosed?.[id] === true;
  const compass = (deg: number) => ['east', 'southeast', 'south', 'southwest', 'west', 'northwest', 'north', 'northeast'][Math.round((((deg % 360) + 360) % 360) / 45) % 8];
  return (
    <>
      {variants && (
        <div className={styles.lookRow}>
          <span className={[styles.dim, styles.variantLabel].join(' ')}>{tr('Color')}</span>
          <div className={styles.variantList} role="radiogroup" aria-label={tr('Color')}>
            <button
              role="radio"
              aria-checked={!variant}
              className={[styles.variantButton, styles.variantText, !variant ? styles.variantOn : ''].join(' ')}
              onClick={() => setVariant(undefined)}
            >
              {tr('auto')}
            </button>
            {variants.map((v) => (
              <button
                key={v.key}
                role="radio"
                aria-checked={variant === v.key}
                className={[styles.variantButton, variant === v.key ? styles.variantOn : ''].join(' ')}
                onClick={() => setVariant(v.key)}
                title={tr(v.label)}
                aria-label={tr(v.label)}
              >
                <LookSwatch look={look} size={30} seed={id} variant={v.key} />
              </button>
            ))}
          </div>
        </div>
      )}
      {grounded && (
        <div className={styles.lookRow}>
          <span className={[styles.dim, styles.variantLabel].join(' ')}>{tr('Ground under it')}</span>
          <div className={styles.variantList} role="radiogroup" aria-label={tr('Ground under it')}>
            <button
              role="radio"
              aria-checked={!ground}
              className={[styles.variantButton, styles.variantText, !ground ? styles.variantOn : ''].join(' ')}
              onClick={() => setGround(undefined)}
            >
              {tr('auto')}
            </button>
            {GROUND_KEYS.map((key) => (
              <button
                key={key}
                role="radio"
                aria-checked={ground === key}
                className={[styles.variantButton, ground === key ? styles.variantOn : ''].join(' ')}
                onClick={() => setGround(key)}
                title={tr(PICTURES[key].label)}
                aria-label={tr(PICTURES[key].label)}
              >
                <LookSwatch look={key} size={30} />
              </button>
            ))}
          </div>
        </div>
      )}
      {sizable && (
        <div className={styles.lookRow}>
          <span className={[styles.dim, styles.variantLabel].join(' ')}>{tr('Size')}</span>
          <div className={styles.variantList}>
            <button
              role="switch"
              aria-checked={autoOn}
              className={[styles.variantButton, styles.variantText, autoOn ? styles.variantOn : ''].join(' ')}
              onClick={() => setSize(undefined)}
            >
              {tr('auto')}
            </button>
            <Stepper label={tr('Size')} text={`${fmt(ownSize ?? autoShown, 1)} m`} dim={autoOn} onStep={stepSize} />
          </div>
        </div>
      )}
      {folds && (
        <div className={styles.lookRow}>
          <span className={[styles.dim, styles.variantLabel].join(' ')}>{tr('Canopy')}</span>
          <div className={styles.variantList} role="radiogroup" aria-label={tr('Canopy')}>
            {[false, true].map((shut) => (
              <button
                key={String(shut)}
                role="radio"
                aria-checked={closed === shut}
                className={[styles.variantButton, styles.variantText, closed === shut ? styles.variantOn : ''].join(' ')}
                onClick={() => keep({closed: shut ? true : null})}
              >
                {shut ? tr('Folded') : tr('Opened up')}
              </button>
            ))}
          </div>
        </div>
      )}
      {turnable && (
        <div className={styles.lookRow}>
          <span className={[styles.dim, styles.variantLabel].join(' ')}>{pic.turn ? tr('Direction') : tr('Rotation')}</span>
          <div className={styles.variantList}>
            <button
              role="switch"
              aria-checked={ownTurn === undefined}
              className={[styles.variantButton, styles.variantText, ownTurn === undefined ? styles.variantOn : ''].join(' ')}
              onClick={() => setTurn(undefined)}
            >
              {tr('auto')}
            </button>
            <Stepper
              label={pic.turn ? tr('Direction') : tr('Rotation')}
              text={pic.turn ? tr(compass(ownTurn ?? autoTurn)) : `${ownTurn ?? autoTurn}°`}
              dim={ownTurn === undefined}
              onStep={stepTurn}
            />
          </div>
        </div>
      )}
    </>
  );
}

// a value set a step at a time with - and +, held down it goes on, faster and faster. no slider: a finger scrolling the
// card over one moved it. a tap steps once, a finger that scrolls on is no tap (the browser takes it over)
function Stepper({label, text, dim, onStep}: {label: string; text: string; dim: boolean; onStep: (dir: 1 | -1) => void}) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const held = useRef(false);
  const stop = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  useEffect(() => stop, []);
  const button = (dir: 1 | -1) => (
    <button
      className={[styles.variantButton, styles.variantText, styles.stepButton].join(' ')}
      aria-label={dir > 0 ? tr('More') : tr('Less')}
      onPointerDown={() => {
        held.current = false;
        stop();
        let wait = 450;
        const again = () => {
          held.current = true;
          onStep(dir);
          wait = Math.max(60, wait * 0.75);
          timer.current = setTimeout(again, wait);
        };
        timer.current = setTimeout(again, wait);
      }}
      onPointerUp={stop}
      onPointerLeave={stop}
      onPointerCancel={stop}
      onClick={() => {
        if (!held.current) onStep(dir);
        held.current = false;
      }}
    >
      {dir > 0 ? '+' : '−'}
    </button>
  );
  return (
    <div className={styles.stepper} role="group" aria-label={label}>
      {button(-1)}
      <span className={[styles.sizeValue, dim ? styles.dim : ''].join(' ')} aria-live="polite">
        {text}
      </span>
      {button(1)}
    </div>
  );
}
