import {areaLook, facing, LookPicker, LookSwatch, PIN_KEYS, pinSize, type Look} from '@/components/gardenLook';
import {PICTURES} from '@/components/gardenPictures';
import {CheckIcon, CloseIcon, RedoIcon, TrashIcon, UndoIcon} from '@/components/icons';
import {tr} from '@/lib/i18n';
import {isPin} from '@/lib/mowerBody';
import {settingsStore} from '@/lib/settings';
import {useEffect, useMemo, useRef, useState, useSyncExternalStore} from 'react';
import {pinTiles, type Area} from './editing';
import PictureRows, {keepLook} from './PictureRows';
import styles from './page.module.css';

// el brought into view when it isn't: under the map a phone keeps at the top of the page (pinned) and above its tab bar.
// not in the guide's picture of the page (inert)
export function showUnderMap(el: Element | null) {
  if (!el || el.closest('[inert]')) return;
  const map = document.querySelector(`.${styles.pinned} .${styles.mapCol}`);
  const top = map && getComputedStyle(map).position === 'sticky' ? map.getBoundingClientRect().bottom : 0;
  const nav = document.querySelector('nav')?.getBoundingClientRect();
  const bottom = nav && nav.top > window.innerHeight / 2 ? nav.top : window.innerHeight;
  const r = el.getBoundingClientRect();
  // its top shown first when it doesn't fit between them
  const by = r.top < top + 8 ? r.top - top - 8 : r.bottom > bottom - 8 ? Math.min(r.bottom - bottom + 8, r.top - top - 8) : 0;
  if (by) window.scrollBy({top: by, behavior: 'smooth'});
}

// decorating, under the map: what the next tap on the map sets (a row of pictures, the ones the garden has first), the
// pin picked with what can be changed of it, and the way out. on a wide screen undo, redo and finish too, a phone has
// them on the map. areas: the map's as edited, pin: the one picked, armed: what the next tap sets (copy: the picked one
// again), busy: finish was tapped while the mower is out, changed: cancel would throw something away, onSwap: another
// picture put in the picked pin's place. what it asks or says shows under the map
export default function DecorPanel({
  areas,
  pin,
  armed,
  canUndo,
  canRedo,
  unsaved,
  saving,
  busy,
  error,
  changed,
  onArm,
  onCopy,
  onRemove,
  onUndo,
  onRedo,
  onFinish,
  onSaveAnyway,
  onLater,
  onCancel,
  onSwap,
}: {
  areas: Area[];
  pin: Area | null;
  armed: {look: Look; copy: boolean} | null;
  canUndo: boolean;
  canRedo: boolean;
  unsaved: boolean;
  saving: boolean;
  busy: boolean;
  error: string | null;
  changed: boolean;
  onArm: (look: Look | null) => void;
  onCopy: () => void;
  onRemove: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onFinish: () => void;
  onSaveAnyway: () => void;
  onLater: () => void;
  onCancel: () => void;
  onSwap: (look: Look) => void;
}) {
  const settings = useSyncExternalStore(settingsStore.subscribe, settingsStore.snapshot, settingsStore.serverSnapshot);
  const pins = areas.filter(isPin);
  // the pins' pictures first, one picked from all of them in front until it's set
  const tiles = pinTiles(pins.map((a) => areaLook(a, settings.looks)).filter((k) => PIN_KEYS.includes(k)));
  const shown = armed && !armed.copy && !tiles.includes(armed.look) ? [armed.look, ...tiles] : tiles;
  const [all, setAll] = useState(false);
  // cancel asks first when it throws something away
  const [confirm, setConfirm] = useState(false);
  const tool = [styles.pillButton, styles.tool].join(' ');
  const hintRef = useRef<HTMLDivElement>(null);
  const tilesRef = useRef<HTMLDivElement>(null);
  const busyRef = useRef<HTMLDivElement>(null);
  const errorRef = useRef<HTMLParagraphElement>(null);
  // a picture picked: what to do now in view, its tile too (one from all of them goes in front of the row)
  const picked = armed ? `${armed.look} ${armed.copy}` : null;
  useEffect(() => {
    if (!picked) return;
    showUnderMap(hintRef.current);
    const row = tilesRef.current;
    const tile = row?.querySelector('[aria-checked="true"]');
    if (!row || !tile) return;
    const [r, box] = [tile.getBoundingClientRect(), row.getBoundingClientRect()];
    if (r.left < box.left) row.scrollBy({left: r.left - box.left - 4, behavior: 'smooth'});
    else if (r.right > box.right) row.scrollBy({left: r.right - box.right + 4, behavior: 'smooth'});
  }, [picked]);
  useEffect(() => {
    if (busy) showUnderMap(busyRef.current);
  }, [busy]);
  useEffect(() => {
    if (error) showUnderMap(errorRef.current);
  }, [error]);
  const hint = armed
    ? armed.copy
      ? tr('Tap the map where the copy should go.')
      : tr('Tap the map where the picture "{what}" should go.', {what: tr(PICTURES[armed.look].label)})
    : pins.length
      ? tr('Tap a picture to change it, hold and drag to move it.')
      : tr('Pick a picture below, then tap the map where it should go.');
  return (
    <div className={styles.decorPanel}>
      <div className={[styles.toolbar, styles.decorBar].join(' ')}>
        <button className={tool} onClick={onUndo} disabled={!canUndo}>
          <UndoIcon size={16} />
          {tr('Undo')}
        </button>
        <button className={tool} onClick={onRedo} disabled={!canRedo}>
          <RedoIcon size={16} />
          {tr('Redo')}
        </button>
        <button className={[tool, styles.toolWide, styles.saveButton, unsaved ? styles.unsaved : ''].join(' ')} onClick={onFinish} disabled={saving}>
          <CheckIcon size={16} />
          {saving ? tr('saving…') : tr('Finish')}
        </button>
      </div>
      <div ref={hintRef} className={styles.inlineRow}>
        <span className={[styles.dim, styles.decorHint].join(' ')}>{hint}</span>
        {/* no picture set after all, the round goes on */}
        {armed && (
          <button className={styles.pillButton} onClick={() => onArm(null)} aria-label={tr("Don't set it")} title={tr("Don't set it")}>
            <CloseIcon size={16} />
          </button>
        )}
        <button
          className={[styles.pillButton, confirm ? styles.danger : ''].join(' ')}
          onClick={() => (confirm || !changed ? onCancel() : setConfirm(true))}
          onBlur={() => setConfirm(false)}
        >
          {confirm ? tr('Discard changes?') : tr('Cancel')}
        </button>
      </div>
      {busy && (
        <div ref={busyRef} className={styles.warning}>
          <p>{tr('The mower is busy. Saving now can interrupt it.')}</p>
          <div className={styles.inlineRow}>
            <button className={styles.pillButton} onClick={onSaveAnyway}>
              {tr('Save anyway')}
            </button>
            <button className={styles.pillButton} onClick={onLater}>
              {tr('After mowing')}
            </button>
          </div>
        </div>
      )}
      {error && (
        <p ref={errorRef} className={styles.error}>
          {error}
        </p>
      )}
      <div ref={tilesRef} className={styles.decorTiles} role="radiogroup" aria-label={tr('Decorate')}>
        {shown.map((k) => {
          // a second tap lets it go again
          const on = !!armed && !armed.copy && armed.look === k;
          return (
            <button key={k} role="radio" aria-checked={on} className={[styles.decorTile, on ? styles.decorTileOn : ''].join(' ')} onClick={() => onArm(on ? null : k)}>
              <LookSwatch look={k} size={40} />
              <span>{tr(PICTURES[k].label)}</span>
            </button>
          );
        })}
        <button className={styles.decorTile} onClick={() => setAll(true)}>
          <span className={styles.decorMore}>…</span>
          <span>{tr('All…')}</span>
        </button>
      </div>
      {pin && <PinCard key={pin.id} pin={pin} areas={areas} copying={!!armed?.copy} onCopy={onCopy} onRemove={onRemove} onSwap={onSwap} />}
      {all && (
        <LookPicker
          value={armed && !armed.copy ? armed.look : undefined}
          auto={null}
          keys={PIN_KEYS}
          onPick={(look) => {
            if (look) onArm(look);
            setAll(false);
          }}
          onClose={() => setAll(false)}
        />
      )}
    </div>
  );
}

// the pin picked: its picture (another one in its place), its color, size and direction, a copy set with the next tap, or
// it taken away. the mower doesn't know it
function PinCard({
  pin,
  areas,
  copying,
  onCopy,
  onRemove,
  onSwap,
}: {
  pin: Area;
  areas: Area[];
  copying: boolean;
  onCopy: () => void;
  onRemove: () => void;
  onSwap: (look: Look) => void;
}) {
  const settings = useSyncExternalStore(settingsStore.subscribe, settingsStore.snapshot, settingsStore.serverSnapshot);
  const look = areaLook(pin, settings.looks);
  const pic = PICTURES[look];
  const [swapping, setSwapping] = useState(false);
  // a parasol towards the seats next to it like the map draws it, the map's y points up and the drawing's down
  const faced = useMemo(() => (pic?.turn ? facing(pin, areas, settings.looks, (p) => ({x: p.x, y: -p.y})) : 0), [pic, pin, areas, settings.looks]);
  const variant = pic?.variants?.some((v) => v.key === settings.lookVariants?.[pin.id]) ? settings.lookVariants?.[pin.id] : undefined;
  return (
    <div className={styles.areaEditor}>
      <div className={styles.pinHead}>
        <span className={styles.pinName}>
          <LookSwatch look={look} size={28} seed={pin.id} variant={variant} />
          {tr(pic.label)}
        </span>
        <button className={styles.pillButton} onClick={() => setSwapping(true)}>
          {tr('Swap')}
        </button>
      </div>
      <span className={styles.dim}>{tr("Only a picture, the mower doesn't drive round it.")}</span>
      <PictureRows id={pin.id} look={look} autoSize={pinSize(look)} autoDeg={faced} grounded={false} sized />
      <div className={styles.pinTools}>
        <button className={[styles.pillButton, copying ? styles.decorTileOn : ''].join(' ')} aria-pressed={copying} onClick={onCopy}>
          {tr('Another one')}
        </button>
        <button className={[styles.pillButton, styles.danger].join(' ')} onClick={onRemove}>
          <TrashIcon size={14} />
          {tr('Remove')}
        </button>
      </div>
      {swapping && (
        <LookPicker
          value={look}
          auto={null}
          keys={PIN_KEYS}
          onPick={(next) => {
            // another picture in the same place, at its own usual size, color and direction
            if (next) {
              keepLook(pin.id, {look: next, variant: null, size: pinSize(next), turn: null, closed: null});
              onSwap(next);
            }
            setSwapping(false);
          }}
          onClose={() => setSwapping(false)}
        />
      )}
    </div>
  );
}
