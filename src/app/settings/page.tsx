'use client';

import {TitleMark} from '@/components/Logo';
import {DOCK_ICONS, dockIcon, MOWER_ICONS, mowerIcon} from '@/components/mapIcons';
import {isTileUrl} from '@/lib/imagery';
import {COLORS, saveSettings, settingsStore, sharedSettings, type ColorKey, type Settings} from '@/lib/settings';
import {useRouter} from 'next/navigation';
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

// both icons on a bit of lawn at about the size they have on a map filling a phone screen
function IconPreview({icons}: {icons: NonNullable<Settings['icons']>}) {
  return (
    <svg viewBox="0 0 220 76" className={styles.lawn}>
      <rect x="0" y="0" width="220" height="76" fill="var(--c-mow)" opacity="0.18" />
      <path d="M48 40 C 90 70, 120 10, 160 36" className={styles.lawnTrack} />
      <g transform={`translate(48 40) scale(${10 * (icons.dockSize ?? 1)})`}>{dockIcon(icons.dock).draw()}</g>
      <g transform={`translate(160 36) rotate(-20) scale(${10 * (icons.mowerSize ?? 1)})`}>{mowerIcon(icons.mower).draw()}</g>
    </svg>
  );
}

export default function SettingsPage() {
  const router = useRouter();
  // back to wherever the gear was clicked, or the dashboard when the page was opened directly
  const back = () => (window.history.length > 1 ? router.back() : router.push('/'));
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
        <button className={styles.back} onClick={back}>
          ← Back
        </button>
        <h1>
          <TitleMark />
          Settings
        </h1>
        <p className={styles.dim}>
          {sharedSettings() ? 'Saved on the mower, the same on all your devices.' : 'Saved on this device only.'}
        </p>

        <section className={styles.card}>
          <h2>Dashboard</h2>
          <label className={styles.check}>
            <input
              type="checkbox"
              checked={settings.dashboard?.map === 'always'}
              onChange={(e) => {
                const cur = settingsStore.snapshot();
                saveSettings({...cur, dashboard: {...cur.dashboard, map: e.target.checked ? 'always' : 'auto'}});
              }}
            />
            Always show the map, not only while the mower is driving
          </label>
        </section>

        <section className={styles.card}>
          <h2>Mower icon</h2>
          <IconChoice icons={MOWER_ICONS} value={icons.mower ?? MOWER_ICONS[0].key} onChange={(k) => setIcon('mower', k)} rotate />
          <SizeSlider value={icons.mowerSize ?? 1} onChange={(v) => setIcon('mowerSize', v)} />
          <IconPreview icons={icons} />
        </section>

        <section className={styles.card}>
          <h2>Docking station icon</h2>
          <IconChoice icons={DOCK_ICONS} value={icons.dock ?? DOCK_ICONS[0].key} onChange={(k) => setIcon('dock', k)} />
          <SizeSlider value={icons.dockSize ?? 1} onChange={(v) => setIcon('dockSize', v)} />
          <IconPreview icons={icons} />
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
