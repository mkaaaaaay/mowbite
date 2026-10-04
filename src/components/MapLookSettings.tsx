'use client';

import {DOCK_ICONS, dockIcon, drawDock, drawMower, MOWER_ICONS, mowerIcon} from '@/components/mapIcons';
import {tr} from '@/lib/i18n';
import {isTileUrl} from '@/lib/imagery';
import {COLORS, saveSettings, settingsStore, type ColorKey, type Settings} from '@/lib/settings';
import {useEffect, useSyncExternalStore} from 'react';
import {createPortal} from 'react-dom';
import styles from './MapLookSettings.module.css';

// How the maps look, opened with the gear on the map: the mower's and the docking station's icon, the colors and an
// aerial imagery source of your own. Saved like the other settings (on the mower when it keeps them, else here).

function IconChoice({
  icons,
  value,
  onChange,
  rotate,
}: {
  icons: {key: string; label: string; upright?: boolean; fit?: number; real?: object; draw: () => React.ReactNode}[];
  value: string;
  onChange: (key: string) => void;
  rotate?: boolean;
}) {
  return (
    <div className={styles.icons}>
      {icons.map((icon) => (
        <button
          key={icon.key}
          className={[styles.icon, icon.key === value ? styles.iconOn : ''].join(' ')}
          onClick={() => onChange(icon.key)}
          title={tr(icon.label)}
        >
          <svg viewBox="-1.5 -1.5 3 3" className={styles.preview}>
            <g transform={rotate && !icon.upright ? 'rotate(-30)' : undefined}>
              {icon.fit ? (
                <g transform={`scale(1 ${icon.fit})`}>{icon.draw()}</g>
              ) : icon.real ? (
                <g transform="rotate(-90)">{icon.draw()}</g>
              ) : (
                icon.draw()
              )}
            </g>
          </svg>
          <span>{tr(icon.label)}</span>
        </button>
      ))}
    </div>
  );
}

function SizeSlider({value, onChange}: {value: number; onChange: (v: number) => void}) {
  return (
    <label className={styles.size}>
      {tr('Size')}
      <input type="range" min={0.5} max={3} step={0.1} value={value} onChange={(e) => onChange(+e.target.value)} />
      <span>{Math.round(value * 100)}%</span>
      {value !== 1 && (
        <button className={styles.linkButton} onClick={() => onChange(1)}>
          {tr('default')}
        </button>
      )}
    </label>
  );
}

// both icons on a bit of lawn at about the size they have on a map filling a phone screen
function IconPreview({icons}: {icons: NonNullable<Settings['icons']>}) {
  return (
    <svg viewBox="0 0 220 76" className={styles.lawn}>
      <rect x="0" y="0" width="220" height="76" fill="var(--c-mow)" opacity="0.18" />
      <path d="M48 40 C 90 70, 120 10, 160 36" className={styles.lawnTrack} />
      <g transform={`translate(48 40) scale(${10 * (icons.dockSize ?? 1)})`}>{drawDock(dockIcon(icons.dock))}</g>
      <g transform={`translate(160 36) rotate(${mowerIcon(icons.mower).upright ? 0 : -20}) scale(${10 * (icons.mowerSize ?? 1)})`}>
        {drawMower(mowerIcon(icons.mower))}
      </g>
    </svg>
  );
}

export function MapLookSettings() {
  const settings = useSyncExternalStore(settingsStore.subscribe, settingsStore.snapshot, settingsStore.serverSnapshot);
  const colors = settings.colors ?? {};
  const icons = settings.icons ?? {};
  const imageryUrl = settings.imagery?.url;

  // always start from the latest saved state, two quick changes shouldn't overwrite each other
  const setColor = (key: ColorKey, value: string | undefined) => {
    const cur = settingsStore.snapshot();
    const next = {...cur.colors};
    if (value === undefined) delete next[key];
    else next[key] = value;
    saveSettings({...cur, colors: next});
  };
  const setImagery = (field: 'url' | 'attribution', value: string) => {
    const cur = settingsStore.snapshot();
    saveSettings({...cur, imagery: {...cur.imagery, [field]: value.trim() || undefined}});
  };
  const setIcon = (field: 'mower' | 'dock' | 'mowerSize' | 'dockSize' | 'mowerRealSize', value: string | number | boolean) => {
    const cur = settingsStore.snapshot();
    saveSettings({...cur, icons: {...cur.icons, [field]: value}});
  };

  return (
    <>
      <section className={styles.section}>
        <h3>{tr('Mower icon')}</h3>
        <IconChoice icons={MOWER_ICONS} value={icons.mower ?? MOWER_ICONS[0].key} onChange={(k) => setIcon('mower', k)} rotate />
        <div className={styles.segment}>
          <span>{tr('On the map')}</span>
          <button className={!icons.mowerRealSize ? styles.segmentOn : undefined} onClick={() => setIcon('mowerRealSize', false)}>
            {tr('Same size at every zoom')}
          </button>
          <button className={icons.mowerRealSize ? styles.segmentOn : undefined} onClick={() => setIcon('mowerRealSize', true)}>
            {tr('Real size')}
          </button>
        </div>
        <SizeSlider value={icons.mowerSize ?? 1} onChange={(v) => setIcon('mowerSize', v)} />
        <IconPreview icons={icons} />
      </section>

      <section className={styles.section}>
        <h3>{tr('Docking station icon')}</h3>
        <IconChoice icons={DOCK_ICONS} value={icons.dock ?? DOCK_ICONS[0].key} onChange={(k) => setIcon('dock', k)} />
        <SizeSlider value={icons.dockSize ?? 1} onChange={(v) => setIcon('dockSize', v)} />
        <IconPreview icons={icons} />
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <h3>{tr('Map colors')}</h3>
          <button
            className={styles.pillButton}
            onClick={() => saveSettings({...settingsStore.snapshot(), colors: {}})}
            disabled={!Object.keys(colors).length}
          >
            {tr('Reset all')}
          </button>
        </div>
        <p className={styles.dim}>{tr('Used on every map in the app.')}</p>
        <div className={styles.colors}>
          {COLORS.map((c) => {
            const value = colors[c.key] ?? c.value;
            return (
              <div key={c.key} className={styles.colorRow}>
                <input type="color" value={value} onChange={(e) => setColor(c.key, e.target.value)} aria-label={tr(c.label)} />
                <span>{tr(c.label)}</span>
                {colors[c.key] && (
                  <button className={styles.linkButton} onClick={() => setColor(c.key, undefined)}>
                    {tr('default')}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </section>

      <section className={styles.section}>
        <h3>{tr('Aerial imagery')}</h3>
        <p className={styles.dim}>
          {tr(
            'Official open orthophotos are built in where a country offers them for free: Germany (all states except Saarland), Austria, Switzerland, the Netherlands, Belgium, Luxembourg, France, Spain, Czechia, Finland and the USA. Anywhere else you can add a tile source you are allowed to use: an XYZ url with {z}, {x} and {y}, or a WMS url in EPSG:3857 with {bbox}. It shows up as an extra choice on the map, and you are responsible for its terms of use.',
            {z: '{z}', x: '{x}', y: '{y}', bbox: '{bbox}'},
          )}
        </p>
        {/* saved when leaving the field, not on every key */}
        <label className={styles.field}>
          {tr('Tile url')}
          <input
            key={'url' + (imageryUrl ?? '')}
            defaultValue={imageryUrl ?? ''}
            placeholder="https://example.org/tiles/{z}/{x}/{y}.jpg"
            onBlur={(e) => setImagery('url', e.target.value)}
          />
        </label>
        {imageryUrl && !isTileUrl(imageryUrl) && (
          <span className={styles.error}>
            {tr('The url needs to start with http(s) and contain {z}, {x} and {y}, or {bbox} for a WMS.', {z: '{z}', x: '{x}', y: '{y}', bbox: '{bbox}'})}
          </span>
        )}
        <label className={styles.field}>
          {tr('Attribution')}
          <input
            key={'attr' + (settings.imagery?.attribution ?? '')}
            defaultValue={settings.imagery?.attribution ?? ''}
            placeholder={tr('shown on the map, as the source requires')}
            onBlur={(e) => setImagery('attribution', e.target.value)}
          />
        </label>
      </section>
    </>
  );
}

// the map settings over the page: from the side on a wide screen, from the bottom on a phone. Escape, the cross or a
// tap next to it closes them
export function MapLookPanel({onClose}: {onClose: () => void}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  // (events still bubble up to the map through react: it mustn't pan or zoom under the panel)
  const keep = (e: React.SyntheticEvent) => e.stopPropagation();
  return createPortal(
    <div className={styles.backdrop} onClick={onClose} onPointerDown={keep} onWheel={keep} onTouchStart={keep}>
      <div className={styles.panel} role="dialog" aria-modal="true" aria-label={tr('Map')} onClick={keep}>
        <div className={styles.panelHead}>
          <h2>{tr('Map')}</h2>
          <button className={styles.close} onClick={onClose} aria-label={tr('Close')}>
            ✕
          </button>
        </div>
        <MapLookSettings />
      </div>
    </div>,
    document.body,
  );
}
