'use client';

import {GardenDownload} from '@/components/Diagnosis';
import {TitleMark} from '@/components/Logo';
import {TitleRow} from '@/components/TopWeather';
import {flushSettings, forgetOwnSettings, saveSettings, settingsStore, sharedSettings, type OtherMower, type Settings} from '@/lib/settings';
import {useEffect, useRef, useState, useSyncExternalStore} from 'react';
import styles from './page.module.css';
import {dec, setLangChoice, tr, useLang, useLangChoice} from '@/lib/i18n';
import {setThemeChoice, useThemeChoice} from '@/lib/theme';
import {appMowers, appPort, CONTAINER_PORT, DEMO_ID, forgetMowerKeys, isDemo, pageFromMower, parseAddress, sameMowBite, saveAppMowers, selectedMower, selectMower, WS_PORT} from '@/lib/mowers';
import {forgetMqtt5} from '@/lib/mqttClient';
import {isApp} from '@/lib/native';
import {leaveFirst} from '@/lib/leaving';
import {setSwipeEnabled, useSwipeEnabled} from '@/lib/swipe';
import {OpenMowerNote, ParamGroupRows, summary, useCanSetParams} from '@/components/MowerParamSettings';
import {AutoUpdate, DockgeUpdateGuide} from '@/components/AutoUpdate';
import {OsUpdate} from '@/components/OsUpdate';
import {LegalFooter, UpdateSettings} from '@/components/Updates';
import {savePlannerSettings, slic3rPlans, useAskPlanner, usePlannerSettings, usePlannerWaiting} from '@/lib/mowerBody';
import PlannerWaiting from '@/components/PlannerWaiting';
import Link from 'next/link';
import {MowerBodySettings} from '@/components/MowerBodySettings';
import {MowerSizesSettings} from '@/components/MowerSizesSettings';
import {CalibrationLink} from '@/components/CalibrationLink';
import {CALIB_SHOWN, canCalibrate} from '@/lib/calibration';
import {NotifySettings} from '@/components/NotifySettings';
import {LightSettings} from '@/components/LightSettings';
import {SoundSettings} from '@/components/SoundSettings';
import {useRpcMethods} from '@/hooks/useRpcMethods';
import {RPC} from '@/lib/openmower';
import {useMowbiteOs} from '@/lib/mowerOs';
import {osUpdatesOffered} from '@/lib/osUpdate';
import {DashboardItems} from '@/components/DashboardItems';
import {datumFromParams, useMowerParams} from '@/hooks/useMowerParams';
import {posixTz} from '@/lib/schedule';
import {PARAM_GROUPS} from '@/lib/mowerParams';
import {APP_VERSION} from '@/lib/updates';
import {answerError} from '@/lib/rpcText';

const noop = () => () => {};

type Tab = 'mower' | 'app';
// the tab last picked, per device
const TAB_KEY = 'settingsTab';

function storedTab(): Tab {
  try {
    return localStorage.getItem(TAB_KEY) === 'app' ? 'app' : 'mower';
  } catch {
    return 'mower';
  }
}

function keepTab(tab: Tab) {
  try {
    if (tab === 'app') localStorage.setItem(TAB_KEY, tab);
    else localStorage.removeItem(TAB_KEY);
  } catch {}
}

const subscribeHash = (l: () => void) => {
  window.addEventListener('hashchange', l);
  return () => window.removeEventListener('hashchange', l);
};
// the anchor the page was opened with or a link on it led to
const useHash = () => useSyncExternalStore(subscribeHash, () => window.location.hash.slice(1), () => '');
// the tab the anchor's part is in, once it's on the page
function linkedTab(): Tab | null {
  const hash = window.location.hash.slice(1);
  const target = hash ? document.getElementById(hash) : null;
  return target ? (target.closest('#panel-app') ? 'app' : 'mower') : null;
}

// open or not while the app runs: every start, all groups are folded again
const opened = new Map<string, boolean>();

// a few cards that belong together, folding away so the page stays short. The line under the title says what's
// inside. A link to it or to one of its cards (#updates) opens it
function Group({
  id,
  title,
  hint,
  anchors = [],
  children,
}: {
  id: string;
  title: string;
  hint?: string;
  anchors?: string[];
  children: React.ReactNode;
}) {
  const linked = [id, ...anchors].includes(useHash());
  // a link to it opens it, also when it was folded by hand before
  const [toggled, setToggled] = useState<boolean | null>(() => (linked ? null : (opened.get(id) ?? null)));
  const open = toggled ?? linked;
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
        {children}
      </div>
    </details>
  );
}

function MowersSection({settings}: {settings: Settings}) {
  const [name, setName] = useState('');
  const [host, setHost] = useState('');
  const [typedPort, setTypedPort] = useState(String(CONTAINER_PORT));
  const [wsPort, setWsPort] = useState(String(WS_PORT));
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
  // remove needs a second tap, id of the mower it's armed for
  const [sure, setSure] = useState<string | null>(null);
  // the mower looked at taken out: something unsaved asks before the list changes, its last save goes out, then the app
  // switches (in a browser to the page's own mower). what this device kept for it goes
  const remove = async (m: OtherMower) => {
    const viewed = selectedMower()?.id === m.id;
    const wait = viewed ? leaveFirst() : 0;
    if (wait === false) return;
    const rest = others.filter((x) => x.id !== m.id);
    store(rest);
    if (viewed) await Promise.race([flushSettings(), new Promise((r) => setTimeout(r, 3000))]);
    forgetMowerKeys(m.id);
    forgetOwnSettings(m.id);
    forgetMqtt5(m, rest);
    if (viewed) selectMower(app ? (rest[0]?.id ?? '') : '', wait);
  };
  const add = () => {
    const typed = parseAddress(host);
    if (!typed) {
      setError(tr("That's not an address. Enter an IP or the mower's name in your network."));
      return;
    }
    const mower: OtherMower = {
      id: Math.random().toString(36).slice(2, 10),
      name: name.trim(),
      host: typed.host,
      appPort: typed.port ?? (Number(typedPort) || CONTAINER_PORT),
      wsPort: Number(wsPort) || WS_PORT,
    };
    // (another MowBite on the same host answers on another port)
    const port = Number(window.location.port) || 80;
    if (!app && [window.location.hostname, 'localhost', '127.0.0.1'].some((h) => sameMowBite(mower, {host: h, appPort: port}))) {
      setError(tr("That's this mower, it's already there. Enter the address of another one."));
      return;
    }
    if (others.some((m) => sameMowBite(m, mower))) {
      setError(tr('This mower is already in the list.'));
      return;
    }
    store([...others, mower]);
    setName('');
    setHost('');
    setError(null);
  };
  return (
    <section className={styles.card}>
      <p className={styles.dim}>
        {app
          ? tr("More than one mower with MowBite? Add the others here and switch between them at the top of the dashboard. Colors and icons are each mower's own, the language is the app's.")
          : tr(
              'More than one mower with MowBite? Add the others here and switch between them at the top of the dashboard (on a computer in the sidebar). Colors and the language stay the same for all, each mower has its own icons, map style and pictures and the values its dashboard shows.',
            )}
      </p>
      {/* (in a browser the list is kept in the settings, the demo's are gone once it's left) */}
      {demo && !app && <p className={styles.dim}>{tr('Not in the demo: leave it to add your mowers.')}</p>}

      {!app && !demo && (
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
              {m.host}:{appPort(m)}
            </span>
          </span>
          <button
            className={styles.linkButton}
            onClick={() => (sure === m.id ? void remove(m) : setSure(m.id))}
            onBlur={() => setSure(null)}
          >
            {sure === m.id ? tr('Really remove?') : tr('Remove')}
          </button>
        </div>
      ))}

      {!(demo && !app) && (
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
              aria-invalid={!!error}
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
              <input value={typedPort} onChange={(e) => setTypedPort(e.target.value)} inputMode="numeric" />
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
      )}
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
  // the tab a link leads into, else the one picked, else the one picked last on this device. a tab picked counts until
  // the next link
  const hash = useHash();
  const linked = useSyncExternalStore(subscribeHash, linkedTab, () => null);
  const stored = useSyncExternalStore(noop, storedTab, () => 'mower');
  const [picked, setPicked] = useState<{tab: Tab; hash: string} | null>(null);
  const tab = picked?.hash === hash ? picked.tab : (linked ?? stored);
  // then to the part itself once it shows (some only once the mower told what it has)
  const pending = useRef('');
  useEffect(() => {
    pending.current = hash;
  }, [hash]);
  useEffect(() => {
    const target = pending.current ? document.getElementById(pending.current) : null;
    if (!target?.getClientRects().length) return;
    target.scrollIntoView({block: 'start'});
    pending.current = '';
  });
  const settings = useSyncExternalStore(settingsStore.subscribe, settingsStore.snapshot, settingsStore.serverSnapshot);
  const shared = useSyncExternalStore(settingsStore.subscribe, sharedSettings, () => false);
  // the MowBite Planner on the mower: its settings are with the map. Asked here too, the page may be the first one
  // opened
  const planner = usePlannerSettings();
  const params = useMowerParams();
  const datum = datumFromParams(params);
  // the leftovers setting with a time zone (the one set first, like the schedule's) and the mower's place: the container
  // needs them for "not in the dark" when no schedule is saved
  const leftovers = (change: Partial<NonNullable<Settings['leftovers']>>): Settings['leftovers'] => ({
    ...settingsStore.snapshot().leftovers,
    ...change,
    tz: settingsStore.snapshot().leftovers?.tz ?? posixTz(),
    ...(datum ? {pos: `${datum.lat.toFixed(2)} ${datum.lon.toFixed(2)}`} : {}),
  });
  // no answer (OpenMower restarting, a slow connection): the sizes as without the planner, so they can be set
  const [unanswered, setUnanswered] = useState(false);
  // why the planner's switch for the leftovers didn't change, it stays as the planner says
  const [leftoversFailed, setLeftoversFailed] = useState<string | null>(null);
  useAskPlanner(() => setUnanswered(true));
  // the planner there but busy: it's waited for, not the sizes as without it
  const waiting = usePlannerWaiting()?.what === 'load';
  const sizes = planner !== undefined || unanswered || waiting;
  const demo = useSyncExternalStore(noop, isDemo, () => false);
  // the lights by state and the sounds, on a mower that has them (MowBite OS)
  const methods = useRpcMethods();
  const lights = !!methods?.has(RPC.lightGet);
  const sounds = !!methods?.has(RPC.soundList);
  // MowBite OS keeps the sizes itself, with its planner or without
  const geometry = !!methods?.has(RPC.geometry);
  // the calibration isn't there on MowBite OS, nor is the way to its guide
  const os = useMowbiteOs();
  const calibrate = canCalibrate(methods, os);
  // OpenMower's own settings, on one that takes them
  const can = useCanSetParams();
  // MowBite OS updates itself through its host: its own view, and the page from the mower is one of its parts there
  const osUpdates = osUpdatesOffered(methods);
  // a planner that sends the mower out for the leftovers itself, else the container's own switch
  const plannerLeftovers = planner?.settings.leftovers_auto;
  const leftoversOn = plannerLeftovers
    ? plannerLeftovers.value === true || (plannerLeftovers.settable !== false && !!settings.leftovers?.auto)
    : !!settings.leftovers?.auto;
  const tabs: [Tab, string][] = [
    ['mower', tr('Mower')],
    ['app', tr('App')],
  ];

  return (
    <div className={styles.page}>
      <main className={styles.main}>
        <TitleRow>
          <h1>
            <TitleMark />
            {tr('Settings')}
          </h1>
        </TitleRow>
        {demo && <p className={styles.dim}>{tr("These are the demo's settings, they're gone once you leave it. The ones only for this device stay.")}</p>}

        <div className={styles.tabs} role="tablist">
          {tabs.map(([k, label]) => (
            <button
              key={k}
              type="button"
              role="tab"
              id={'tab-' + k}
              aria-selected={tab === k}
              aria-controls={'panel-' + k}
              className={tab === k ? styles.tabOn : undefined}
              onClick={() => {
                setPicked({tab: k, hash});
                keepTab(k);
              }}
            >
              {label}
            </button>
          ))}
        </div>

        {/* both there, the one not shown hidden: a link finds its part in either, nothing loads again on a switch */}
        <div className={styles.tabPanel} role="tabpanel" id="panel-mower" aria-labelledby="tab-mower" hidden={tab !== 'mower'}>
            {!demo && <p className={styles.dim}>{tr('Saved on the mower, it counts for everyone who uses it.')}</p>}
            {(sizes || lights || sounds) && (
              <section className={styles.section}>
                <h2 className={styles.sectionTitle}>{tr('The mower itself')}</h2>
                {sizes && (
                  <Group id="mower" title={calibrate ? tr('Sizes and calibration') : tr('Mower sizes')} hint={tr('Body, blade and antenna')} anchors={['sizes']}>
                    {/* set once: with the MowBite Planner kept by it, without it in the app, on MowBite OS by the OS */}
                    <div id="sizes">
                      {planner || geometry ? (
                        <MowerBodySettings styles={styles} />
                      ) : waiting ? (
                        <PlannerWaiting />
                      ) : (
                        <MowerSizesSettings settings={settings} styles={styles} />
                      )}
                    </div>
                    <CalibrationLink styles={styles} />
                  </Group>
                )}
                {lights && (
                  <Group id="lights" title={tr('Lights')} hint={tr('Color and effect by state')}>
                    <LightSettings styles={styles} />
                  </Group>
                )}
                {sounds && (
                  <Group id="sounds" title={tr('Sounds')} hint={tr('Volume, listen to each sound')}>
                    <SoundSettings styles={styles} />
                  </Group>
                )}
              </section>
            )}

            {(can || planner) && (
              <section className={styles.section} id="openmower">
                <h2 className={styles.sectionTitle}>{tr('How it works')}</h2>
                {can &&
                  PARAM_GROUPS.filter((g) => g.key !== 'mowing').map((g) => (
                    <Group key={g.key} id={g.key} title={tr(g.title)} hint={summary(g.key, params, os)}>
                      <ParamGroupRows group={g.key} params={params} os={os} />
                    </Group>
                  ))}
                {can && <OpenMowerNote styles={styles} params={params} os={os} />}
                {planner && (
                  <Group id="leftovers" title={tr('Mow the leftovers')} hint={leftoversOn ? tr('by itself after mowing') : tr('from the dashboard')}>
                    <section className={styles.card}>
                      <p className={styles.dim}>
                        {tr(
                          'After a finished mow the planner looks at the real track for pieces the mower missed, e.g. where it drifted or went round something. They can be mowed from the dashboard, or by themselves once the mower is back in the dock.',
                        )}
                      </p>
                      {plannerLeftovers ? (
                        <>
                          {/* a planner that sends the mower out for the leftovers itself: its switch, the container's own stays
                              off. one switched on before the planner could stays on until this one is used. one the planner
                              doesn't let be set (MowBite OS decides it) only shows how it is */}
                          <label className={styles.check}>
                            <input
                              type="checkbox"
                              checked={leftoversOn}
                              disabled={slic3rPlans(planner) || plannerLeftovers.settable === false}
                              onChange={(e) => {
                                const cur = settingsStore.snapshot();
                                if (cur.leftovers?.auto) saveSettings({...cur, leftovers: {...cur.leftovers, auto: false}});
                                setLeftoversFailed(null);
                                savePlannerSettings({leftovers_auto: e.target.checked}).catch((err: unknown) => setLeftoversFailed(answerError(err)));
                              }}
                            />
                            {tr('Mow the leftovers automatically')}
                          </label>
                          {leftoversFailed && <p className={styles.error}>{leftoversFailed}</p>}
                          {plannerLeftovers.settable === false && <p className={styles.dim}>{tr("Set by the mower, it can't be changed here.")}</p>}
                          {plannerLeftovers.value !== true && plannerLeftovers.settable !== false && settings.leftovers?.auto && (
                            <p className={styles.dim}>
                              {tr('Still done by MowBite on the mower as set before, from {m} m² and after charging. Switch it off and on to let the planner do it.', {
                                m: dec(settings.leftovers.min ?? 0.5),
                              })}
                            </p>
                          )}
                          <p className={styles.dim}>
                            {slic3rPlans(planner)
                              ? tr("Not with OpenMower's slic3r planner, it plans no leftovers.")
                              : tr("It goes out again by itself if more than 0.3 m² it can reach was left, at most 15 minutes after the end, otherwise not at all. Not in the rain or with an emergency stop. It doesn't wait for daylight: after a mow that ended at dusk it goes out in the dark.")}
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
                  </Group>
                )}
              </section>
            )}

            <section className={styles.section}>
              <h2 className={styles.sectionTitle}>{tr('Software and data')}</h2>
              <Group id="update" title={tr('Updates')} hint={osUpdates ? 'MowBite OS' : 'MowBite Updater'}>
                <section className={styles.card}>
                  <h2>{tr('On the mower')}</h2>
                  {osUpdates ? (
                    <OsUpdate />
                  ) : (
                    <>
                      <AutoUpdate />
                      <DockgeUpdateGuide />
                    </>
                  )}
                </section>
              </Group>
              {/* everything to plan and drive this garden again elsewhere, for sharing: one file */}
              {sizes && (
                <Group id="garden" title={tr('Garden file')} hint={tr('The map and the settings in one file')}>
                  <section className={styles.card}>
                    <p className={styles.dim}>
                      {tr(
                        "The map, the planner's settings and what OpenMower mows and drives with, in one file, to share for a look at a plan or to improve the planner. No logins and not where the garden is. For a mow that went wrong take the diagnosis file of that run under Activity, it has this in it too.",
                      )}
                    </p>
                    <GardenDownload className={styles.pillButton} />
                  </section>
                </Group>
              )}
            </section>

            <section className={styles.section}>
              <h2 className={styles.sectionTitle}>{tr('Set elsewhere')}</h2>
              <Link href="/map" className={styles.jump}>
                <span className={styles.groupTitle}>
                  {tr('Lanes, outline passes, driving')}
                  <small>{tr('For each area, with the map')}</small>
                </span>
              </Link>
              <Link href="/schedule" className={styles.jump}>
                <span className={styles.groupTitle}>
                  {tr('Start times and conditions')}
                  <small>{tr('In the schedule')}</small>
                </span>
              </Link>
            </section>
        </div>
        <div className={styles.tabPanel} role="tabpanel" id="panel-app" aria-labelledby="tab-app" hidden={tab !== 'app'}>
            {!demo && <p className={styles.dim}>{shared ? tr('Saved on the mower, the same on all your devices.') : tr('Saved on this device only.')}</p>}
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

              <section className={styles.card}>
                <h2>{tr('Dashboard')}</h2>
                <DashboardItems settings={settings} styles={styles} />
              </section>
            </Group>

            {!(osUpdates && pageFromMower()) && (
              <Group id="updates" title={tr('This app')} hint={`MowBite ${APP_VERSION}`}>
                <UpdateSettings cardClass={styles.card} />
              </Group>
            )}

            <Group id="guides" title={tr('Guides')} hint={tr('Step by step with moving pictures')}>
              <section className={styles.card}>
                <div className={styles.guides}>
                  <Link href="/guide" className={styles.pillButton}>
                    {tr('Map your garden')}
                  </Link>
                  <Link href="/guide/editor" className={styles.pillButton}>
                    {tr('Edit the map')}
                  </Link>
                  <Link href="/guide/app" className={styles.pillButton}>
                    {tr('Dashboard and mowers')}
                  </Link>
                  {(lights || sounds) && (
                    <Link href="/guide/lights" className={styles.pillButton}>
                      {lights ? tr('Lights and sounds') : tr('Sounds')}
                    </Link>
                  )}
                  {CALIB_SHOWN && !os && (
                    <Link href="/guide/calibration" className={styles.pillButton}>
                      {tr('Calibrating')}
                    </Link>
                  )}
                </div>
              </section>
            </Group>

            <Group id="mowers" title={tr('Your mowers')} hint={tr('Add one, switch between them')}>
              <MowersSection settings={settings} />
            </Group>

            <LegalFooter />
        </div>
      </main>
    </div>
  );
}
