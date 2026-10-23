'use client';

import {GardenDownload} from '@/components/Diagnosis';
import {TitleMark} from '@/components/Logo';
import {TitleRow} from '@/components/TopWeather';
import {saveSettings, settingsStore, sharedSettings, type OtherMower, type Settings} from '@/lib/settings';
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
import {MowerBodySettings} from '@/components/MowerBodySettings';
import {MowerSizesSettings} from '@/components/MowerSizesSettings';
import {NotifySettings} from '@/components/NotifySettings';
import {datumFromParams, useMowerParams} from '@/hooks/useMowerParams';
import {posixTz} from '@/lib/schedule';
import {RpcError} from '@/lib/rpc';

const noop = () => () => {};

// open or not while the app runs: every start, all groups are folded again
const opened = new Map<string, boolean>();

// a few cards that belong together, folding away so the page stays short. The line under the title says what's
// inside. A link to it or to one of its cards (#updates) opens it
function Group({
  id,
  title,
  hint,
  note,
  anchors = [],
  children,
}: {
  id: string;
  title: string;
  hint?: string;
  note?: React.ReactNode;
  anchors?: string[];
  children: React.ReactNode;
}) {
  const linked = useSyncExternalStore(
    noop,
    () => [id, ...anchors].some((a) => window.location.hash === '#' + a),
    () => false,
  );
  const [toggled, setToggled] = useState<boolean | null>(() => opened.get(id) ?? null);
  const open = toggled ?? linked;
  useEffect(() => {
    if (linked) document.getElementById(window.location.hash.slice(1))?.scrollIntoView({block: 'start'});
  }, [linked]);
  return (
    <details
      id={id}
      className={styles.group}
      open={open}
      onToggle={(e) => {
        const now = (e.currentTarget as HTMLDetailsElement).open;
        if (now === open) return;
        setToggled(now);
        opened.set(id, now);
      }}
    >
      <summary>
        <span className={styles.groupTitle}>
          {title}
          {hint && <small>{hint}</small>}
        </span>
      </summary>
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
          'More than one mower with MowBite? Add the others here and switch between them at the top of the dashboard (on a computer in the sidebar). Colors, icons and the language stay the same for all.',
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

      {others.length > 0 && <span className={styles.subTitle}>{app ? tr('Your mowers') : tr('Other mowers')}</span>}
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
  const settings = useSyncExternalStore(settingsStore.subscribe, settingsStore.snapshot, settingsStore.serverSnapshot);
  const shared = useSyncExternalStore(settingsStore.subscribe, sharedSettings, () => false);
  // the MowBite Planner on the mower: its settings are with the map. Asked here too, the page may be the first one
  // opened
  const planner = usePlannerSettings();
  const datum = datumFromParams(useMowerParams());
  // the leftovers setting with this device's time zone and the mower's place: the container needs them for "not in the
  // dark" when no schedule is saved
  const leftovers = (change: Partial<NonNullable<Settings['leftovers']>>): Settings['leftovers'] => ({
    ...settingsStore.snapshot().leftovers,
    ...change,
    tz: posixTz(),
    ...(datum ? {pos: `${datum.lat.toFixed(2)} ${datum.lon.toFixed(2)}`} : {}),
  });
  // no answer (OpenMower restarting, a slow connection): the sizes as without the planner, so they can be set
  const [unanswered, setUnanswered] = useState(false);
  // why the planner's switch for the leftovers didn't change, it stays as the planner says
  const [leftoversFailed, setLeftoversFailed] = useState<string | null>(null);
  useEffect(() => {
    if (planner === undefined) loadPlannerSettings().catch(() => setUnanswered(true));
  }, [planner]);

  return (
    <div className={styles.page}>
      <main className={styles.main}>
        <TitleRow>
          <h1>
            <TitleMark />
            {tr('Settings')}
          </h1>
        </TitleRow>
        <p className={styles.dim}>
          {shared ? tr('Saved on the mower, the same on all your devices.') : tr('Saved on this device only.')}
        </p>

        {(planner !== undefined || unanswered) && (
          <Group
            id="mower"
            title={tr('Your mower')}
            hint={planner ? tr('Mower sizes, leftovers') : tr('Mower sizes')}
            anchors={['sizes']}
            note={
              planner && (
                <>
                  {tr("The planner's settings are with the map: under it for all areas, with an area selected for that one.")}{' '}
                  <Link href="/map">{tr('To the map')}</Link>
                </>
              )
            }
          >
            {/* set once: with the MowBite Planner kept by it, without it in the app */}
            <div id="sizes">
              {planner ? <MowerBodySettings styles={styles} /> : <MowerSizesSettings settings={settings} styles={styles} />}
            </div>
            {planner && (
            <section className={styles.card}>
              <h2>{tr('Mow the leftovers')}</h2>
              <p className={styles.dim}>
                {tr(
                  'After a finished mow the planner looks at the real track for pieces the mower missed, e.g. where it drifted or went round something. They can be mowed from the dashboard, or by themselves once the mower is back in the dock.',
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
                        setLeftoversFailed(null);
                        savePlannerSettings({leftovers_auto: e.target.checked}).catch((err: unknown) =>
                          setLeftoversFailed(err instanceof RpcError && err.code !== 'timeout' ? err.message : tr('The mower did not answer.')),
                        );
                      }}
                    />
                    {tr('Mow the leftovers automatically')}
                  </label>
                  {leftoversFailed && <p className={styles.error}>{leftoversFailed}</p>}
                  <p className={styles.dim}>
                    {slic3rPlans(planner)
                      ? tr("Not with OpenMower's slic3r planner, it plans no leftovers.")
                      : tr("It goes out again by itself when more than 0.3 m² it can reach was left, within 15 minutes of the end or not at all. Not in the rain or with an emergency stop. It doesn't wait for daylight: after a mow that ended at dusk it goes out in the dark.")}
                  </p>
                </>
              ) : (
                <>
                  <label className={styles.check}>
                    <input
                      type="checkbox"
                      checked={!!settings.leftovers?.auto}
                      onChange={(e) => {
                        saveSettings({...settingsStore.snapshot(), leftovers: leftovers({auto: e.target.checked})});
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
                        saveSettings({...settingsStore.snapshot(), leftovers: leftovers({min: Number.isFinite(v) && v >= 0 ? v : 0.5})});
                      }}
                    />
                  </label>
                  <p className={styles.dim}>
                    {tr('Not in the dark, not in the rain, not with an emergency stop, like the schedule. What it did is in the schedule log. Needs the MowBite container on the mower.')}
                  </p>
                </>
              )}
            </section>
            )}
            {/* everything to plan and drive this garden again elsewhere, for sharing: one file */}
            <section className={styles.card}>
              <h2>{tr('Garden file')}</h2>
              <p className={styles.dim}>
                {tr(
                  "The map, the planner's settings and what OpenMower mows and drives with, in one file, to share for a look at a plan or to improve the planner. No logins and not where the garden is. For a mow that went wrong take the diagnosis file of that run under Activity, it has this in it too.",
                )}
              </p>
              <GardenDownload className={styles.pillButton} />
            </section>
          </Group>
        )}

        <Group id="notify" title={tr('Push messages')} hint={tr('On the phone when the mower needs you')}>
          <NotifySettings settings={settings} styles={styles} />
        </Group>

        <Group id="look" title={tr('Appearance')} hint={tr('Language, design, map, weather')}>
          <section className={styles.card}>
            <h2>{tr('Language and design')}</h2>
            <span className={styles.subTitle}>{tr('Language')}</span>
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
            <span className={styles.subTitle}>{tr('Design')}</span>
            <div className={styles.segment}>
              {(
                [
                  ['auto', tr('Automatic')],
                  ['light', tr('Light')],
                  ['dark', tr('Dark')],
                  ['frost', tr('Frosted glass')],
                  ['aurora', tr('Aurora')],
                  ['sunny', tr('Sunny')],
                  ['openmower', 'OpenMower'],
                ] as const
              ).map(([k, label]) => (
                <button key={k} className={theme === k ? styles.segmentOn : undefined} onClick={() => setThemeChoice(k)}>
                  {label}
                </button>
              ))}
            </div>
            <p className={styles.dim}>{tr("Both only for this device. Automatic follows the device's setting.")}</p>
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
              {tr('Always show the map on the dashboard, not only while the mower drives')}
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

        <OpenMowerSettings styles={styles} />

        <Group id="app" title={tr('App')} hint={tr('Guides, mowers, updates, privacy, license')} anchors={['updates', 'guides']}>
          <section className={styles.card} id="guides">
            <h2>{tr('Guides')}</h2>
            <p className={styles.dim}>{tr('Step by step with moving pictures.')}</p>
            <div className={styles.guides}>
              <Link href="/guide" className={styles.pillButton}>
                {tr('Map your garden')}
              </Link>
              <Link href="/guide/editor" className={styles.pillButton}>
                {tr('Edit the map')}
              </Link>
            </div>
          </section>
          <MowersSection settings={settings} />
          <UpdateSettings cardClass={styles.card} checkClass={styles.check} />
        </Group>
      </main>
    </div>
  );
}
