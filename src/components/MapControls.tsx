import {imageryInfo, type CustomImagery, type ImagerySource} from '@/lib/imagery';
import {fmt, tr} from '@/lib/i18n';
import {useRef, useState} from 'react';
import {MagnetIcon, MoveIcon} from './icons';
import {MapLookPanel} from './MapLookSettings';
import styles from './MapView.module.css';

export const LAYERS = [
  {key: 'obstacle', label: 'Obstacles'},
  {key: 'nav', label: 'Navigation areas'},
  {key: 'order', label: 'Mowing order numbers'},
  {key: 'stripes', label: 'Mowing plan'},
  // the turns between the lanes and the drives between the parts in the plan, only when the planner tells them apart
  {key: 'planTurns', label: 'Turns in the plan'},
  {key: 'planTransit', label: 'Drives in the plan'},
  {key: 'track', label: 'Track'},
  {key: 'margins', label: 'Too close'},
  {key: 'checks', label: 'Collision check fixes'},
  {key: 'transit', label: 'Driving without blades'},
  {key: 'mowerIcon', label: 'Mower icon'},
  {key: 'body', label: 'Mower outline'},
  {key: 'swath', label: 'Cut width'},
  {key: 'edges', label: 'Real edges'},
] as const;
export type Layer = (typeof LAYERS)[number]['key'];

// how the part of the plan still to mow is drawn: dots are pellets for the pac-man mower to eat
export const PLAN_STYLES = [
  {key: 'dashed', label: 'dashed'},
  {key: 'solid', label: 'solid'},
  {key: 'dots', label: 'pellets'},
] as const;
export type PlanStyle = (typeof PLAN_STYLES)[number]['key'];

// the menu keeps the layers switched off
export const layerOn = (hidden: Set<Layer>, l: Layer) => !hidden.has(l);

// where gps or wifi were good or bad over the last 14 days, one of them at a time
export type Coverage = 'off' | 'gps' | 'wifi';

const COVER_ORDER: Coverage[] = ['wifi', 'off', 'gps'];
const COVER_TITLES: Record<Coverage, string> = {
  wifi: 'Wi-Fi signal where the mower drove',
  off: 'No coverage on the map',
  gps: 'GPS accuracy where the mower drove',
};

// the buttons along the right edge of the map, the switch for the coverage, the layer menu and the imagery bar
export default function MapControls({
  onZoom,
  showGrid,
  onToggleGrid,
  sources,
  source,
  lastSource,
  imagerySettings,
  onSource,
  align,
  hidden,
  onToggleLayer,
  layersOpen,
  onLayersOpen,
  planStyle,
  body,
  reset,
  follow,
  pin,
  snap,
  decorate,
  planParts,
  planner,
  coverage,
}: {
  // factor < 1 zooms in
  onZoom: (factor: number) => void;
  showGrid: boolean;
  onToggleGrid: () => void;
  sources: ImagerySource[];
  source: ImagerySource | null;
  // picked last on this device, switching the imagery on brings it back while it's still offered
  lastSource: ImagerySource | null;
  imagerySettings: CustomImagery | undefined;
  onSource: (s: ImagerySource | null) => void;
  // moving the aerial imagery by hand until it lines up with the map: the shift while it's being set, else null
  align?: {shift: [number, number] | null; onStart: () => void; onChange: (shift: [number, number]) => void; onDone: () => void};
  hidden: Set<Layer>;
  onToggleLayer: (l: Layer) => void;
  layersOpen: boolean;
  onLayersOpen: (open: boolean) => void;
  // only while there's a plan being mowed
  planStyle?: {value: PlanStyle; onChange: (s: PlanStyle) => void};
  // only with the mower's sizes set: its outline and icon and the real edges, the strip its blade cuts only with a
  // blade size
  body?: {blade: boolean};
  // the plan shown tells its turns and drives apart, the two layers for them show
  planParts?: boolean;
  // the MowBite Planner on the mower: where the mower came too close and what its collision check fixed, only it tells
  planner?: boolean;
  // the three way switch on the map (wifi, off, gps), when MowBite's container keeps the gps log. wifi false: no signal
  // in it
  // paused: the map can be edited, but not while the coverage is shown
  // none: nothing kept yet to show
  coverage?: {wifi: boolean; none?: boolean; value: Coverage; paused?: boolean; onChange: (c: Coverage) => void};
  // shown when zoomed or panned, follow: the view follows the mower
  reset: {follow: boolean; onReset: () => void} | null;
  // only while the view can follow the mower
  follow?: {on: boolean; onToggle: () => void};
  // the map editor on a phone: the map stays at the top while the settings under it scroll
  pin?: {on: boolean; onToggle: () => void};
  // the map editor: points snap onto other areas' corners and edges
  snap?: {on: boolean; onToggle: () => void};
  // the map editor: decorating, started from the map's settings
  decorate?: () => void;
}) {
  // the icons, colors and aerial imagery of the maps, over the page
  const [lookOpen, setLookOpen] = useState(false);
  // done with the arrows: the button that opened them gets the focus back
  const refocusAlign = useRef(false);
  return (
    <>
      {/* where gps or wifi were good or bad: wifi left, off in the middle, gps right, the knob slides */}
      {coverage && (
        <div className={styles.coverSwitchWrap}>
          <div className={styles.coverSwitch} role="radiogroup" aria-label={tr('Coverage')}>
            <span
              className={[styles.coverKnob, coverage.value === 'off' ? styles.coverKnobOff : ''].filter(Boolean).join(' ')}
              style={{transform: `translateX(${COVER_ORDER.indexOf(coverage.value) * 100}%)`}}
            />
            {COVER_ORDER.map((c) => (
              <button
                key={c}
                role="radio"
                aria-checked={coverage.value === c}
                className={coverage.value === c ? styles.coverOn : undefined}
                disabled={c === 'wifi' && !coverage.wifi}
                title={tr(COVER_TITLES[c])}
                onClick={() => coverage.onChange(c)}
              >
                {c === 'gps' ? 'GPS' : tr(c === 'wifi' ? 'Wi-Fi' : 'Off')}
              </button>
            ))}
          </div>
          {coverage.value !== 'off' && coverage.none && (
            <span className={styles.coverLegend}>{tr('Nothing kept yet, the squares fill up while the mower drives')}</span>
          )}
          {coverage.value !== 'off' && !coverage.none && (
            <span className={styles.coverLegend} title={tr('Paler: little data there. Tap a square for its numbers.')}>
              <i className={styles.good} /> {coverage.value === 'gps' ? '≤ 5 cm' : tr('strong')}
              <i className={styles.ok} /> {tr(coverage.value === 'gps' ? 'at times worse' : 'medium')}
              <i className={styles.bad} /> {tr(coverage.value === 'gps' ? 'often worse' : 'weak')}
            </span>
          )}
          {coverage.value !== 'off' && coverage.paused && <span className={styles.coverPaused}>{tr('Editing is off while the coverage is shown')}</span>}
        </div>
      )}
      <div className={styles.zoomButtons} data-map-tools>
        <button onClick={() => onZoom(1 / 1.5)} aria-label={tr('Zoom in')} title={tr('Zoom in (or mouse wheel / pinch)')}>
          +
        </button>
        <button onClick={() => onZoom(1.5)} aria-label={tr('Zoom out')} title={tr('Zoom out')}>
          −
        </button>
        <button
          className={showGrid ? '' : styles.off}
          onClick={onToggleGrid}
          aria-label={tr('Grid')}
          title={tr('Show or hide the meter grid')}
        >
          #
        </button>
        {sources.length > 0 && (
          <button
            className={source ? '' : styles.off}
            onClick={() => onSource(source ? null : lastSource && sources.includes(lastSource) ? lastSource : sources[0])}
            aria-label={tr('Aerial imagery')}
            title={tr('Aerial imagery (loads images of this area from the selected provider)')}
          >
            ◩
          </button>
        )}
        <button
          className={hidden.size ? styles.partly : ''}
          onClick={() => onLayersOpen(!layersOpen)}
          aria-label={tr('Layers')}
          title={tr('Show or hide obstacles, numbers, track and more')}
        >
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round">
            <path d="M12 3 3 8l9 5 9-5-9-5Z" />
            <path d="m3 12 9 5 9-5" />
            <path d="m3 16 9 5 9-5" />
          </svg>
        </button>
        <button onClick={() => setLookOpen(true)} aria-label={tr('Map settings')} title={tr('Map colors, icons and aerial imagery')}>
          ⚙
        </button>
        {snap && (
          <button
            className={snap.on ? '' : styles.off}
            onClick={snap.onToggle}
            aria-label={tr('Snap')}
            aria-pressed={snap.on}
            title={snap.on ? tr('Points snap onto the corners and edges of other areas (hold Alt to place one freely), tap to switch it off') : tr('Let points snap onto the corners and edges of other areas')}
          >
            <MagnetIcon size={18} />
          </button>
        )}
        {follow && (
          <button
            className={follow.on ? '' : styles.off}
            onClick={follow.onToggle}
            aria-label={tr('Follow the mower')}
            title={follow.on ? tr('Following the mower, tap to move the map freely') : tr('Follow the mower again')}
          >
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
              <circle cx="12" cy="12" r="6" />
              <circle cx="12" cy="12" r="1.5" fill="currentColor" />
              <path d="M12 2v4M12 18v4M2 12h4M18 12h4" />
            </svg>
          </button>
        )}
        {pin && (
          <button
            className={[styles.pin, pin.on ? '' : styles.off].filter(Boolean).join(' ')}
            onClick={pin.onToggle}
            aria-label={tr('Pin the map')}
            title={pin.on ? tr('The map stays at the top, tap to let it scroll away') : tr('Keep the map at the top while scrolling')}
          >
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round">
              <path d="M9 3h6l-1 6 4 3v2H6v-2l4-3-1-6Z" />
              <path d="M12 14v7" />
            </svg>
          </button>
        )}
        {reset && (
          <button
            onClick={reset.onReset}
            aria-label={tr('Reset zoom')}
            title={reset.follow ? tr('Back to the default zoom') : tr('Fit the whole map')}
          >
            ⤢
          </button>
        )}
      </div>
      {lookOpen && (
        <MapLookPanel
          onClose={() => setLookOpen(false)}
          onDecorate={
            decorate &&
            (() => {
              setLookOpen(false);
              decorate();
            })
          }
        />
      )}
      {layersOpen && (
        <div className={styles.layers}>
          {/* the mower's own layers only with its sizes */}
          {LAYERS.filter(
            (l) =>
              ((l.key !== 'mowerIcon' && l.key !== 'body' && l.key !== 'edges') || body) &&
              (l.key !== 'swath' || body?.blade) &&
              ((l.key !== 'planTurns' && l.key !== 'planTransit') || planParts) &&
              ((l.key !== 'margins' && l.key !== 'checks') || planner),
          ).map((l) => (
            <label key={l.key}>
              <input type="checkbox" checked={layerOn(hidden, l.key)} onChange={() => onToggleLayer(l.key)} />
              {tr(l.label)}
            </label>
          ))}
          {planStyle && (
            <label>
              {tr('Rest of the plan')}
              <select value={planStyle.value} onChange={(e) => planStyle.onChange(e.target.value as PlanStyle)}>
                {PLAN_STYLES.map((st) => (
                  <option key={st.key} value={st.key}>
                    {tr(st.label)}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      )}
      {source && !align?.shift && (
        <div className={styles.imageryBar}>
          {sources.length > 1 && (
            <select value={source} onChange={(e) => onSource(e.target.value as ImagerySource)}>
              {sources.map((s) => (
                <option key={s} value={s}>
                  {tr(imageryInfo(s, imagerySettings).label)}
                </option>
              ))}
            </select>
          )}
          {/* moving the imagery by hand opens from its own button, the list only picks the source */}
          {align && (
            <button
              ref={(b) => {
                if (b && refocusAlign.current) {
                  refocusAlign.current = false;
                  b.focus();
                }
              }}
              className={styles.alignOpen}
              onClick={align.onStart}
              aria-label={tr('Align…')}
              title={tr('Align…')}
            >
              <MoveIcon size={14} />
            </button>
          )}
          <span>© {imageryInfo(source, imagerySettings).attribution}</span>
        </div>
      )}
      {source && align?.shift && (
        <AlignBar
          shift={align.shift}
          attribution={imageryInfo(source, imagerySettings).attribution}
          onChange={align.onChange}
          onDone={() => {
            refocusAlign.current = true;
            align.onDone();
          }}
        />
      )}
    </>
  );
}

// the aerial imagery moved in steps of 10 cm or 1 m until it lines up with the map, kept for its source on every
// device, with its credits still on the map
function AlignBar({
  shift,
  attribution,
  onChange,
  onDone,
}: {
  shift: [number, number];
  attribution: string;
  onChange: (shift: [number, number]) => void;
  onDone: () => void;
}) {
  const [step, setStep] = useState(0.1);
  const [dx, dy] = shift;
  const move = (x: number, y: number) => onChange([Math.round((dx + x * step) * 100) / 100, Math.round((dy + y * step) * 100) / 100]);
  const stepLabel = step < 1 ? '10 cm' : '1 m';
  const parts = [
    ...(dx ? [tr(dx > 0 ? '{m} m east' : '{m} m west', {m: fmt(Math.abs(dx), 1)})] : []),
    ...(dy ? [tr(dy > 0 ? '{m} m north' : '{m} m south', {m: fmt(Math.abs(dy), 1)})] : []),
  ];
  return (
    <div className={styles.alignBar}>
      <span>{parts.length ? tr('Imagery moved {what}', {what: parts.join(', ')}) : tr('Imagery not moved')}</span>
      <div>
        <button onClick={() => move(-1, 0)} aria-label={tr('west')} autoFocus>
          ←
        </button>
        <button onClick={() => move(0, 1)} aria-label={tr('north')}>
          ↑
        </button>
        <button onClick={() => move(0, -1)} aria-label={tr('south')}>
          ↓
        </button>
        <button onClick={() => move(1, 0)} aria-label={tr('east')}>
          →
        </button>
        <button onClick={() => setStep(step < 1 ? 1 : 0.1)} title={tr('Step')} aria-label={tr('Step: {step}', {step: stepLabel})}>
          {stepLabel}
        </button>
        <button onClick={() => onChange([0, 0])} disabled={!dx && !dy}>
          {tr('Reset')}
        </button>
        <button className={styles.alignDone} onClick={onDone}>
          {tr('Finish')}
        </button>
      </div>
      <span className={styles.alignCredit}>© {attribution}</span>
    </div>
  );
}
