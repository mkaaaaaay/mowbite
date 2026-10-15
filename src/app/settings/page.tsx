'use client';

import {TitleMark} from '@/components/Logo';
import {saveSettings, settingsStore, sharedSettings, type OtherMower, type Settings} from '@/lib/settings';
import {useRouter} from 'next/navigation';
import {useEffect, useState, useSyncExternalStore} from 'react';
import styles from './page.module.css';
import {setLangChoice, tr, useLang, useLangChoice} from '@/lib/i18n';
import {setThemeChoice, useThemeChoice} from '@/lib/theme';
import {appMowers, DEMO_ID, isDemo, saveAppMowers, selectMower} from '@/lib/mowers';
import {isApp} from '@/lib/native';
import {setSwipeEnabled, useSwipeEnabled} from '@/lib/swipe';
import {OpenMowerSettings} from '@/components/MowerParamSettings';
import {UpdateSettings} from '@/components/Updates';
import {loadPlannerSettings, savePlannerSettings, slic3rPlans, usePlannerSettings} from '@/lib/mowerBody';
import Link from 'next/link';
import {MowerSizesSettings} from '@/components/MowerSizesSettings';
import {NotifySettings} from '@/components/NotifySettings';
import {PlannerLogDownload} from '@/components/PlannerLog';

const noop = () => () => {};

// open or not as kept for this device, else open on a wide screen
const groupOpen = (key: string) => {
  try {
    const v = localStorage.getItem(key);
    if (v === '1' || v === '0') return v === '1';
  } catch {}
  return window.matchMedia('(min-width: 900px)').matches;
};

// a few cards that belong together, folding away: on a phone it starts folded so the page stays short, on a wide
// screen open. Open or not is kept per device (read once the page runs, it's built ahead without it)
function Group({id, title, note, children}: {id: string; title: string; note?: string; children: React.ReactNode}) {
  const key = 'settingsGroup.' + id;
  const kept = useSyncExternalStore(
    noop,
    () => groupOpen(key),
    () => false,
  );
  const [toggled, setToggled] = useState<boolean | null>(null);
  const open = toggled ?? kept;
  return (
    <details
      className={styles.group}
      open={open}
      onToggle={(e) => {
        const now = (e.currentTarget as HTMLDetailsElement).open;
        if (now === open) return;
        setToggled(now);
        try {
          localStorage.setItem(key, now ? '1' : '0');
        } catch {}
      }}
    >
      <summary>{title}</summary>
      <div className={styles.groupBody}>
        {note && <p className={styles.dim}>{note}</p>}
        {children}
      </div>
    </details>
  );
}

function MowersSection({settings}: {settings: Settings}) {
  const [name, setName] = useState('');
  const [host, setHost] = useState('');
  const [appPort, setAppPort] = useState('8082');
  const [wsPort, setWsPort] = useState('9001');
  const [error, setError] = useState<string | null>(null);
  // the android app keeps its list on the phone, a mower keeps it in its shared settings
  const app = useSyncExternalStore(noop, isApp, () => false);
  const [phoneList, setPhoneList] = useState<OtherMower[]>(() => appMowers());
  const demo = useSyncExternalStore(noop, isDemo, () => false);
  const others = app ? phoneList : (settings.mowers ?? []);
  const store = (list: OtherMower[]) => {
    if (app) {
      saveAppMowers(list);
      setPhoneList(list);
    } else saveSettings({...settingsStore.snapshot(), mowers: list});
  };
  const add = () => {
    const h = host.trim().replace(/^https?:\/\//, '').replace(/[/:].*$/, '').toLowerCase();
    if (!h) return;
    if (!app && (h === window.location.hostname.toLowerCase() || h === 'localhost' || h === '127.0.0.1')) {
      setError(tr("That's this mower, it's already there. Enter the address of another one."));
      return;
    }
    if (others.some((m) => m.host.toLowerCase() === h)) {
      setError(tr('This mower is already in the list.'));
      return;
    }
    const mower: OtherMower = {
      id: Math.random().toString(36).slice(2, 10),
      name: name.trim(),
      host: h,
      appPort: Number(appPort) || 8082,
      wsPort: Number(wsPort) || 9001,
    };
    store([...others, mower]);
    setName('');
    setHost('');
    setError(null);
  };
  return (
    <section className={styles.card}>
      <h2>{tr('Mowers')}</h2>
      <p className={styles.dim}>
        {tr(
          "Got more than one robot mower with MowBite? Add the others here, as many as you like, and switch between them at the top of the dashboard (on a computer in the sidebar). Colors, icons and the language stay the same for all.",
        )}
      </p>

      {!app && (
        <label className={styles.field}>
          {tr('This mower (the one this app runs on)')}
          <input
            key={'this' + (settings.thisName ?? '')}
            defaultValue={settings.thisName ?? ''}
            placeholder={tr('Name, e.g. Back garden')}
            onBlur={(e) => saveSettings({...settingsStore.snapshot(), thisName: e.target.value.trim() || undefined})}
          />
        </label>
      )}

      {others.length > 0 && <span className={styles.subTitle}>{tr('Other mowers')}</span>}
      {others.map((m) => (
        <div key={m.id} className={styles.mowerRow}>
          <span>
            <strong>{m.name || m.host}</strong>{' '}
            <span className={styles.dim}>
              {m.host}:{m.appPort ?? 8082}
            </span>
          </span>
          <button
            className={styles.linkButton}
            onClick={() => store(others.filter((x) => x.id !== m.id))}
          >
            {tr('Remove')}
          </button>
        </div>
      ))}

      <div className={styles.mowerAdd}>
        <span className={styles.subTitle}>{tr('Add another mower')}</span>
        <label className={styles.field}>
          {tr('Name')}
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder={tr('e.g. Front garden')} />
        </label>
        <label className={styles.field}>
          {tr("Address of the other mower (IP or name in your network)")}
          <input
            value={host}
            onChange={(e) => {
              setHost(e.target.value);
              setError(null);
            }}
            placeholder="192.168.2.170"
            autoCapitalize="off"
            autoCorrect="off"
          />
        </label>
        <details className={styles.ports}>
          <summary>{tr('Ports (only if you changed them)')}</summary>
          <label className={styles.field}>
            {tr('MowBite port')}
            <input value={appPort} onChange={(e) => setAppPort(e.target.value)} inputMode="numeric" />
          </label>
          <label className={styles.field}>
            {tr('MQTT websocket port')}
            <input value={wsPort} onChange={(e) => setWsPort(e.target.value)} inputMode="numeric" />
          </label>
        </details>
        {error && <span className={styles.error}>{error}</span>}
        <button className={styles.pillButton} onClick={add} disabled={!host.trim()}>
          {tr('Add mower')}
        </button>
      </div>
      {!demo && (
        <button className={styles.linkButton} onClick={() => selectMower(DEMO_ID)}>
          {tr('Look around with a demo mower')}
        </button>
      )}
    </section>
  );
}

export default function SettingsPage() {
  useLang();
  const choice = useLangChoice();
  const theme = useThemeChoice();
  const swipe = useSwipeEnabled();
  const router = useRouter();
  // back to wherever the gear was clicked, or the dashboard when the page was opened directly
  const back = () => (window.history.length > 1 ? router.back() : router.push('/'));
  const settings = useSyncExternalStore(settingsStore.subscribe, settingsStore.snapshot, settingsStore.serverSnapshot);
  // the MowBite Planner on the mower: its settings are with the map. Asked here too, the page may be the first one
  // opened
  const planner = usePlannerSettings();
  // no answer (OpenMower restarting, a slow connection): the sizes as without the planner, so they can be set
  const [unanswered, setUnanswered] = useState(false);
  useEffect(() => {
    if (planner === undefined) loadPlannerSettings().catch(() => setUnanswered(true));
  }, [planner]);

  return (
    <div className={styles.page}>
      <main className={styles.main}>
        <button className={styles.back} onClick={back}>
          ← {tr('Back')}
        </button>
        <h1>
          <TitleMark />
          {tr('Settings')}
        </h1>
        <p className={styles.dim}>
          {sharedSettings() ? tr('Saved on the mower, the same on all your devices.') : tr('Saved on this device only.')}
        </p>

        <Group id="general" title={tr('General')}>
          <section className={styles.card}>
            <h2>{tr('Language')}</h2>
            <div className={styles.segment}>
              {(
                [
                  ['auto', tr('Automatic')],
                  ['en', 'English'],
                  ['de', 'Deutsch'],
                ] as const
              ).map(([k, label]) => (
                <button key={k} className={choice === k ? styles.segmentOn : undefined} onClick={() => setLangChoice(k)}>
                  {label}
                </button>
              ))}
            </div>
            <p className={styles.dim}>{tr("Only for this device. Automatic follows the browser's language.")}</p>
          </section>

          <section className={styles.card}>
            <h2>{tr('Design')}</h2>
            <div className={styles.segment}>
              {(
                [
                  ['auto', tr('Automatic')],
                  ['light', tr('Light')],
                  ['dark', tr('Dark')],
                  ['frost', tr('Frosted glass')],
                ] as const
              ).map(([k, label]) => (
                <button key={k} className={theme === k ? styles.segmentOn : undefined} onClick={() => setThemeChoice(k)}>
                  {label}
                </button>
              ))}
            </div>
            <p className={styles.dim}>{tr("Only for this device. Automatic follows the phone's or computer's setting.")}</p>
          </section>

          <section className={styles.card}>
            <h2>{tr('Display')}</h2>
            <label className={styles.check}>
              <input
                type="checkbox"
                checked={settings.dashboard?.map === 'always'}
                onChange={(e) => {
                  const cur = settingsStore.snapshot();
                  saveSettings({...cur, dashboard: {...cur.dashboard, map: e.target.checked ? 'always' : 'auto'}});
                }}
              />
              {tr('Always show the map, not only while the mower is driving')}
            </label>
            <label className={styles.check}>
              <input
                type="checkbox"
                checked={settings.grass !== false}
                onChange={(e) => saveSettings({...settingsStore.snapshot(), grass: e.target.checked})}
              />
              {tr('Grass along the bottom of the screen')}
            </label>
            <label className={styles.check}>
              <input
                type="checkbox"
                checked={settings.leaves !== false}
                onChange={(e) => saveSettings({...settingsStore.snapshot(), leaves: e.target.checked})}
              />
              {tr('Falling leaves in autumn, snow in winter')}
            </label>
            <label className={styles.check}>
              <input type="checkbox" checked={swipe} onChange={(e) => setSwipeEnabled(e.target.checked)} />
              {tr('Swipe left and right between the pages (on this device)')}
            </label>
          </section>

          <section className={styles.card}>
            <h2>{tr('Weather')}</h2>
            <label className={styles.check}>
              <input
                type="checkbox"
                checked={!!settings.weather}
                onChange={(e) => saveSettings({...settingsStore.snapshot(), weather: e.target.checked})}
              />
              {tr('Show the weather for the garden')}
            </label>
            <p className={styles.dim}>
              {tr(
                "Shows the current weather and whether rain is coming on the dashboard. The data comes from Open-Meteo, for that the garden's position is sent there, rounded to about a kilometer.",
              )}
            </p>
          </section>

        </Group>

        {planner && (
          <section className={styles.card}>
            <h2>{tr('Planner and mower sizes')}</h2>
            <p className={styles.dim}>{tr('Everything for the planner is with the map now: under the map while no area is selected, and with an area its own.')}</p>
            <div className={styles.pillRow}>
              <Link href="/map" className={styles.pillButton}>
                {tr('To the map')}
              </Link>
              <PlannerLogDownload className={styles.pillButton} />
            </div>
          </section>
        )}
        {planner && (
          <section className={styles.card}>
            <h2>{tr('Mow the leftovers')}</h2>
            <p className={styles.dim}>
              {tr(
                'After a finished mow the planner looks at the real track for pieces the mower missed (it drifted, went round something). On the dashboard you can have just those mowed, or it happens by itself: once the mower is back in the dock it goes out again for them. Only with the MowBite container on the mower.',
              )}
            </p>
            {planner.settings.leftovers_auto ? (
              <>
                {/* a planner that sends the mower out for the leftovers itself: its switch, the container's own stays off */}
                <label className={styles.check}>
                  <input
                    type="checkbox"
                    checked={planner.settings.leftovers_auto.value === true}
                    disabled={slic3rPlans(planner)}
                    onChange={(e) => {
                      const cur = settingsStore.snapshot();
                      if (cur.leftovers?.auto) saveSettings({...cur, leftovers: {...cur.leftovers, auto: false}});
                      savePlannerSettings({leftovers_auto: e.target.checked}).catch(() => {});
                    }}
                  />
                  {tr('Mow the leftovers automatically')}
                </label>
                <p className={styles.dim}>
                  {slic3rPlans(planner)
                    ? tr("Not with OpenMower's slic3r planner, it plans no leftovers.")
                    : tr('After a mow the mower goes out again by itself when more than 0.3 m² it can reach was left, within 15 minutes of the end of the mow or not at all. Not in the rain, not with an emergency stop. It does not wait for daylight: after a mow that ended at dusk it goes out in the dark.')}
                </p>
              </>
            ) : (
              <>
                <label className={styles.check}>
                  <input
                    type="checkbox"
                    checked={!!settings.leftovers?.auto}
                    onChange={(e) => {
                      const cur = settingsStore.snapshot();
                      saveSettings({...cur, leftovers: {...cur.leftovers, auto: e.target.checked}});
                    }}
                  />
                  {tr('Mow the leftovers by itself after every finished mow')}
                </label>
                <label className={styles.field}>
                  {tr('Only from this much left, in m²')}
                  <input
                    key={'leftmin' + (settings.leftovers?.min ?? '')}
                    inputMode="decimal"
                    defaultValue={settings.leftovers?.min ?? 0.5}
                    disabled={!settings.leftovers?.auto}
                    onBlur={(e) => {
                      const v = Number(e.target.value.trim().replace(',', '.'));
                      const cur = settingsStore.snapshot();
                      saveSettings({...cur, leftovers: {...cur.leftovers, min: Number.isFinite(v) && v >= 0 ? v : 0.5}});
                    }}
                  />
                </label>
                <p className={styles.dim}>{tr('Not in the dark, not in the rain, not with an emergency stop, like the schedule. What it did is in the schedule log.')}</p>
              </>
            )}
          </section>
        )}
        <Group id="mower" title={tr('Your mower')}>
          {/* without the MowBite Planner the sizes are kept in the app */}
          {(planner === null || (planner === undefined && unanswered)) && <MowerSizesSettings settings={settings} styles={styles} />}
          <NotifySettings settings={settings} styles={styles} />
        </Group>

        <OpenMowerSettings styles={styles} />

        <Group id="app" title={tr('App')}>
          <MowersSection settings={settings} />
          <UpdateSettings cardClass={styles.card} checkClass={styles.check} />
        </Group>
      </main>
    </div>
  );
}
