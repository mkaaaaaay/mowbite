'use client';

import {DOCK_ICONS, MOWER_ICONS} from '@/components/mapIcons';
import {isTileUrl} from '@/lib/imagery';
import {COLORS, saveSettings, settingsStore, sharedSettings, type ColorKey} from '@/lib/settings';
import {useSyncExternalStore} from 'react';
import styles from './page.module.css';

function IconChoice({
  icons,
  value,
  onChange,
  rotate,
}: {
  icons: {key: string; label: string; draw: () => React.ReactNode}[];
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
          title={icon.label}
        >
          <svg viewBox="-1.5 -1.5 3 3" className={styles.preview}>
            <g transform={rotate ? 'rotate(-30)' : undefined}>{icon.draw()}</g>
          </svg>
          <span>{icon.label}</span>
        </button>
      ))}
    </div>
  );
}

function SizeSlider({value, onChange}: {value: number; onChange: (v: number) => void}) {
  return (
    <label className={styles.size}>
      Size
      <input type="range" min={0.5} max={3} step={0.1} value={value} onChange={(e) => onChange(+e.target.value)} />
      <span>{Math.round(value * 100)}%</span>
      {value !== 1 && (
        <button className={styles.linkButton} onClick={() => onChange(1)}>
          default
        </button>
      )}
    </label>
  );
}

export default function SettingsPage() {
  const settings = useSyncExternalStore(settingsStore.subscribe, settingsStore.snapshot, settingsStore.serverSnapshot);
  const colors = settings.colors ?? {};
  const icons = settings.icons ?? {};

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
  const imageryUrl = settings.imagery?.url;

  const setIcon = (field: 'mower' | 'dock' | 'mowerSize' | 'dockSize', value: string | number) => {
    const cur = settingsStore.snapshot();
    saveSettings({...cur, icons: {...cur.icons, [field]: value}});
  };

  return (
    <div className={styles.page}>
      <main className={styles.main}>
        <h1>Settings</h1>
        <p className={styles.dim}>
          {sharedSettings() ? 'Saved on the mower, the same on all your devices.' : 'Saved on this device only.'}
        </p>

        <section className={styles.card}>
          <h2>Mower icon</h2>
          <IconChoice icons={MOWER_ICONS} value={icons.mower ?? MOWER_ICONS[0].key} onChange={(k) => setIcon('mower', k)} rotate />
          <SizeSlider value={icons.mowerSize ?? 1} onChange={(v) => setIcon('mowerSize', v)} />
        </section>

        <section className={styles.card}>
          <h2>Docking station icon</h2>
          <IconChoice icons={DOCK_ICONS} value={icons.dock ?? DOCK_ICONS[0].key} onChange={(k) => setIcon('dock', k)} />
          <SizeSlider value={icons.dockSize ?? 1} onChange={(v) => setIcon('dockSize', v)} />
        </section>

        <section className={styles.card}>
          <h2>Aerial imagery</h2>
          <p className={styles.dim}>
            In Germany the official orthophotos of your state are built in (open data, all states except Saarland).
            Anywhere else you can add a tile source you are allowed to use, as an XYZ url with {'{z}'}, {'{x}'} and{' '}
            {'{y}'}. You are responsible for that source&apos;s terms of use.
          </p>
          {/* saved when leaving the field, not on every key */}
          <label className={styles.field}>
            Tile url
            <input
              key={'url' + (imageryUrl ?? '')}
              defaultValue={imageryUrl ?? ''}
              placeholder="https://example.org/tiles/{z}/{x}/{y}.jpg"
              onBlur={(e) => setImagery('url', e.target.value)}
            />
          </label>
          {imageryUrl && !isTileUrl(imageryUrl) && (
            <span className={styles.error}>The url needs to start with http(s) and contain {'{z}'}, {'{x}'} and {'{y}'}.</span>
          )}
          <label className={styles.field}>
            Attribution
            <input
              key={'attr' + (settings.imagery?.attribution ?? '')}
              defaultValue={settings.imagery?.attribution ?? ''}
              placeholder="shown on the map, as the source requires"
              onBlur={(e) => setImagery('attribution', e.target.value)}
            />
          </label>
        </section>

        <section className={styles.card}>
          <div className={styles.cardHead}>
            <h2>Map colors</h2>
            <button
              className={styles.pillButton}
              onClick={() => saveSettings({...settingsStore.snapshot(), colors: {}})}
              disabled={!Object.keys(colors).length}
            >
              Reset all
            </button>
          </div>
          <p className={styles.dim}>Used on every map in the app.</p>

          <div className={styles.colors}>
            {COLORS.map((c) => {
              const value = colors[c.key] ?? c.value;
              return (
                <div key={c.key} className={styles.colorRow}>
                  <input type="color" value={value} onChange={(e) => setColor(c.key, e.target.value)} aria-label={c.label} />
                  <span>{c.label}</span>
                  {colors[c.key] && (
                    <button className={styles.linkButton} onClick={() => setColor(c.key, undefined)}>
                      default
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      </main>
    </div>
  );
}
