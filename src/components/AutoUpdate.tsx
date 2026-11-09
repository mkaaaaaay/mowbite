'use client';

import {useSure} from '@/hooks/useSure';
import {useEffect, useRef, useState} from 'react';
import {
  frameTakesTaps,
  freeMb,
  lastChecked,
  loadUpdate,
  openMowerChoices,
  outOfReach,
  reachLine,
  partInfo,
  partResult,
  partsOf,
  progressOf,
  requestBack,
  requestCheck,
  requestRoom,
  requestSelf,
  freeRoom,
  roomLabel,
  roomNote,
  roomLoose,
  roomTotal,
  runParts,
  size,
  stepDetail,
  stepLabel,
  requestUpdate,
  runResult,
  saveUpdateConf,
  selfInfo,
  silentSince,
  updaterAlive,
  updaterWhere,
  WEEKDAYS,
  type Part,
  type PartResult,
  type Progress,
  type UpdateConf,
  type UpdatePart,
  type UpdateState,
} from '@/lib/autoUpdate';
import {CopyButton} from '@/lib/clipboard';
import {useDockgeUrl, useUpdaterPageUrl} from '@/lib/dockge';
import {fmt, tr, useLang} from '@/lib/i18n';
import {apiBase, isDemo} from '@/lib/mowers';
import {isApp} from '@/lib/native';
import {useThemeChoice} from '@/lib/theme';
import {APP_VERSION} from '@/lib/updates';
import local from './AutoUpdate.module.css';

// the updater's part of compose.yaml, as in the repository's
const UPDATER_YAML = `  updater:
    image: ghcr.io/mkaaaaaay/mowbite-updater:latest
    container_name: mowbite-updater
    restart: unless-stopped
    network_mode: host
    logging:
      options:
        max-size: 1m
        max-file: "2"
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
      - /opt/stacks:/opt/stacks
      - /etc/localtime:/etc/localtime:ro
      - /etc/os-release:/host/os-release:ro
    labels:
      openmower.ui: "true"
      openmower.ui.name: MowBite Updater
      openmower.ui.port: "8083"
      openmower.ui.icon: SystemUpdateAlt
      openmower.ui.description: Updates OpenMower, MowBite, the planner and other apps, with the mower idle in the dock
`;

// what it did last with a part: in passing, or in a box when it's something to know or went wrong
function LastTime({r}: {r: PartResult}) {
  const text = r.at ? tr('Last time ({when}): {what}', {when: r.at, what: r.text}) : tr('Last time: {what}', {what: r.text});
  return <span className={r.level === 'error' ? local.error : r.level === 'warn' ? local.warn : local.dim}>{text}</span>;
}

// MowBite updated by hand in dockge, step by step
export function DockgeUpdateGuide() {
  const dockge = useDockgeUrl();
  return (
    <details className={local.part}>
      <summary className={local.name}>{tr('Update MowBite in Dockge')}</summary>
      <ol className={local.steps}>
        <li>
          {tr('Open Dockge on the mower:')}{' '}
          <a href={dockge} target="_blank" rel="noreferrer">
            {dockge}
          </a>
        </li>
        <li>{tr('Pick the stack "mowbite" on the left.')}</li>
        <li>{tr('Tap "Update". Dockge fetches the newest version and starts it, that takes a minute.')}</li>
        <li>{tr('Reload this page. Your settings stay, they are kept apart from the app.')}</li>
      </ol>
    </details>
  );
}

// how to add the updater, step by step, while it isn't there
function AddUpdater() {
  const dockge = useDockgeUrl();
  return (
    <details className={local.part}>
      <summary>
        <span className={local.name}>{tr('Updates from the app')}</span> <span className={local.dim}>{tr('not set up yet, how to:')}</span>
      </summary>
      <span className={local.dim}>
        {tr("They need a second, small container next to MowBite, the MowBite Updater. It's added once, then everything is set here or on its own page.")}
      </span>
      <ol className={local.steps}>
        <li>
          {tr('Open Dockge on the mower:')}{' '}
          <a href={dockge} target="_blank" rel="noreferrer">
            {dockge}
          </a>
        </li>
        <li>{tr('Pick the stack "mowbite" and tap "Edit".')}</li>
        <li>
          {tr(
            'In compose.yaml, at the very end there\'s "volumes:" with "settings:" under it. Paste the lines below just above that "volumes:" line, as they are: they start with two spaces, like "mowbite:" further up.',
          )}
        </li>
        <li>{tr('Tap "Save", then "Update": that also gets the newest MowBite, which these updates need.')}</li>
        <li>{tr('After about a minute the updates show up here.')}</li>
      </ol>
      <pre className={local.code}>{UPDATER_YAML}</pre>
      <div className={local.row}>
        <CopyButton text={UPDATER_YAML} className={local.control} />
      </div>
      <span className={local.dim}>
        {tr('If your stacks aren\'t in /opt/stacks (Dockge\'s folder), change both sides of the line "/opt/stacks:/opt/stacks" to yours.')}
      </span>
    </details>
  );
}

// what the updater does with a part right now: the step, a bar with its percent (moving without one while there's no
// telling, a restart, the wait until it answers) and on the right the percent, how many of how many or the time
function ProgressBar({p, now}: {p: Progress; now: number}) {
  const label = stepLabel(p);
  return (
    <div className={local.progress}>
      <div className={local.progressHead}>
        <span>{label}</span>
        <span className={local.dim}>{stepDetail(p, now)}</span>
      </div>
      <div className={local.track} role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={p.pct ?? undefined}>
        {p.pct === null ? <div className={local.moving} /> : <div className={local.fill} style={{width: `${p.pct}%`}} />}
      </div>
    </div>
  );
}

const BADGE: Record<string, string> = {
  yes: 'Update available',
  switch: 'Switch to the version picked',
  no: 'Up to date',
  failed: 'Skipped',
  unknown: 'Not known yet',
  local: 'Built here',
};

// whether there's something new, in short: something new in green, a version that didn't start in yellow (why: under
// the mouse)
function Badge({available, isNew}: {available: string; isNew: boolean}) {
  const failed = available === 'failed';
  return (
    <span
      className={[local.badge, isNew ? local.badgeNew : failed ? local.badgeBad : ''].join(' ')}
      title={failed ? tr("This version didn't start, it's left out until a newer one comes") : undefined}
    >
      {tr(BADGE[available])}
    </span>
  );
}

function PartCard({
  p,
  s,
  busy,
  now,
  onConf,
  onUpdate,
  onBack,
}: {
  p: UpdatePart;
  s: UpdateState;
  busy: boolean;
  now: number;
  onConf: (patch: Record<string, string | number>) => void;
  onUpdate: () => void;
  onBack: () => void;
}) {
  const {sure, confirm} = useSure();
  const part = p.id;
  const info = partInfo(s, part);
  if (!info.running) return null;
  const result = partResult(s, part);
  const isNew = info.available === 'yes' || info.available === 'switch';
  const plannerHere = partsOf(s).some((x) => x.id === 'planner' && partInfo(s, 'planner').running);
  const auto = !!s.conf[`${part}_auto`];
  // built from a copy here, or coming with the os: nothing to update from here
  const fixed = p.kind === 'local' || p.kind === 'os';
  const channel = String(s.conf[part] ?? 'beta');
  // an image with releases (MowBite's own): beta or stable
  const releases = p.kind === 'image' && !!s.status[`${part}_stable`];
  // in the run going on: this part now, after the one now, or done with already
  const progress = progressOf(s);
  const parts = runParts(s);
  const mine = progress?.part === part ? progress : null;
  const queued = !mine && !!progress && parts.indexOf(part) > parts.indexOf(progress.part);

  return (
    <div className={local.part}>
      <div className={local.head}>
        <span className={local.name}>{p.name}</span>
        {info.available && !fixed && <Badge available={info.available} isNew={isNew} />}
      </div>
      <span className={local.dim}>{tr('Runs: {what}', {what: info.running})}</span>

      {mine && <ProgressBar p={mine} now={now} />}
      {queued && <span className={local.dim}>{tr('Next in line, after the one updating now.')}</span>}

      {p.kind !== 'os' && (
        <div className={local.row}>
          {releases ? (
            <select className={local.control} aria-label={tr('Version')} value={channel} onChange={(e) => onConf({[part]: e.target.value})}>
              <option value="beta">{tr('Beta')}</option>
              {/* only an image with releases without "beta" */}
              {(s.status[`${part}_stable`] !== 'no' || channel === 'stable') && <option value="stable">{tr('Stable')}</option>}
            </select>
          ) : p.kind === 'openmower' ? (
            <select className={local.control} aria-label={tr('Version')} value={String(s.conf.openmower ?? 'edge')} onChange={(e) => onConf({openmower: e.target.value})}>
              {openMowerChoices(s).map((t) => (
                <option key={t} value={t}>
                  {t === 'edge' ? tr('Edge (newest)') : t === 'latest' ? tr('Release') : t}
                </option>
              ))}
            </select>
          ) : (
            <select className={local.control} aria-label={tr('Version')} disabled value="this">
              <option value="this">
                {p.kind === 'local' ? tr('Local copy') : p.kind === 'build' ? tr('Newest version') : imageTag(s, part)}
              </option>
            </select>
          )}
          <button className={[local.control, isNew ? local.primary : ''].join(' ')} disabled={busy || fixed} onClick={onUpdate}>
            {tr('Update')}
          </button>
        </div>
      )}

      {!fixed && (
        <label className={local.check}>
          <input type="checkbox" checked={auto} onChange={(e) => onConf({[`${part}_auto`]: e.target.checked ? 1 : 0})} />
          {tr('Automatically at night')}
        </label>
      )}

      {p.kind === 'image' && info.available === 'local' && (
        <span className={local.dim}>
          {part === 'mowbite'
            ? tr('This is a version built on its own, not one from GitHub. "Update" swaps it for the {channel} version from GitHub.', {
                channel: channel === 'stable' ? tr('Stable') : tr('Beta'),
              })
            : tr('This is a version built on its own, not one from its registry. "Update" swaps it for the one from there.')}
        </span>
      )}
      {releases && channel === 'stable' && (
        <span className={local.dim}>
          {tr('Stable is the newest release without "beta". It can be older than the beta that runs now, going there leaves out what came since.')}
        </span>
      )}
      {p.kind === 'openmower' && s.conf.openmower !== 'edge' && plannerHere && (
        <span className={local.warn}>
          {tr(
            "With this version the MowBite Planner doesn't work: it needs two changes that are only in edge so far (OM_PLANNER=external and keeping the planner's settings per area). MowBite also loses the mowing plan from the mower, OpenMower's settings, the ROS log, dropping an interrupted job and areas set to not mow.",
          )}
        </span>
      )}
      {p.kind === 'openmower' && auto && (
        <span className={local.dim}>
          {tr("Edge changes often, an update at night can bring a new fault. Only when there's room for the old and the new image at once.")}
        </span>
      )}
      {p.kind === 'local' && <span className={local.dim}>{tr('Built from a local copy, it is left as it is.')}</span>}
      {p.gate === 'none' && <span className={local.dim}>{tr('Updates also with the mower out of the dock.')}</span>}
      {result && <LastTime r={result} />}

      {p.kind === 'image' && s.status[`${part}_back`] === 'yes' && (
        <div className={local.row}>
          <span className={local.dim}>{tr('Something wrong since the last update?')}</span>
          <button className={[local.control, sure === 'back' ? local.danger : ''].join(' ')} disabled={busy} onClick={() => confirm('back', onBack)}>
            {sure === 'back' ? tr('Really go back?') : tr('Back to the version before')}
          </button>
        </div>
      )}
    </div>
  );
}

// the updater itself: the commit it runs, whether there's a newer one and updating it, the bar while it downloads and
// while it restarts on the new version
function UpdaterCard({s, busy, now, anyAuto, onUpdate}: {s: UpdateState; busy: boolean; now: number; anyAuto: boolean; onUpdate: () => void}) {
  const info = selfInfo(s, now);
  if (!info) return null;
  const isNew = info.available === 'yes';
  const progress = progressOf(s);
  const mine = progress?.part === 'updater' ? progress : null;
  return (
    <div className={local.part}>
      <div className={local.head}>
        <span className={local.name}>MowBite Updater</span>
        {info.available && <Badge available={info.available} isNew={isNew} />}
      </div>
      <span className={local.dim}>{tr('Runs: {what}', {what: info.running})}</span>
      {mine && <ProgressBar p={mine} now={now} />}
      {info.restarting && <ProgressBar p={{part: 'updater', step: 'restart', pct: null, since: info.restarting}} now={now} />}
      {info.restarting && <span className={local.dim}>{tr('Restarting the updater, this comes back by itself')}</span>}
      <div className={local.row}>
        <select className={local.control} aria-label={tr('Version')} disabled value="this">
          <option value="this">{info.tag}</option>
        </select>
        <button className={[local.control, isNew ? local.primary : ''].join(' ')} disabled={busy} onClick={onUpdate}>
          {tr('Update')}
        </button>
      </div>
      {info.available === 'local' && (
        <span className={local.dim}>{tr('This is a version built on its own, not one from its registry. "Update" swaps it for the one from there.')}</span>
      )}
      {anyAuto && <span className={local.dim}>{tr('It updates itself too, at night with the automatic updates.')}</span>}
      {info.result && <LastTime r={info.result} />}
    </div>
  );
}

// what the updater can't reach and why, with the line that gives it the folder
function OutOfReachNote({s}: {s: UpdateState}) {
  const away = outOfReach(s);
  if (!away) return null;
  return (
    <div className={local.part}>
      <span className={local.name}>{tr('Out of reach for the updater')}</span>
      {away.self && (
        <>
          <span className={local.dim}>
            {tr('The updater doesn\'t see its own folder {dir}: it forgets its settings and can\'t update itself. Add this line to its "volumes:":', {dir: away.self})}
          </span>
          <pre className={local.code}>{reachLine(away.self)}</pre>
        </>
      )}
      {away.far.map((f) =>
        f.dir === '-' ? (
          <span key={f.name} className={local.dim}>
            {tr('"{name}" runs without a compose file, the updater can\'t update it.', {name: f.name})}
          </span>
        ) : (
          <div key={f.name} className={local.item}>
            <span className={local.dim}>
              {tr(
                '"{name}" is in {dir}. The updater only sees {reach}. Move it there, or add this line to the updater\'s "volumes:":',
                {name: f.name, dir: f.dir, reach: away.reach},
              )}
            </span>
            <pre className={local.code}>{reachLine(f.dir)}</pre>
          </div>
        ),
      )}
    </div>
  );
}

// the updater's own page in here, in this design and language, its height given by it: what it shows and does comes
// from it, so a newer updater brings its new parts along without a new MowBite
function UpdaterFrame({base}: {base: string}) {
  const theme = useThemeChoice();
  const lang = useLang();
  const src = `${base}/?embed=1&theme=${theme}&lang=${lang}`;
  const [height, setHeight] = useState(480);
  useEffect(() => {
    const origin = new URL(src).origin;
    const onMessage = (e: MessageEvent) => {
      const h = e.origin === origin && e.data?.mowbiteUpdater === 'height' ? Number(e.data.height) : NaN;
      if (Number.isFinite(h)) setHeight(Math.max(120, Math.min(20000, Math.ceil(h))));
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [src]);
  return <iframe className={local.frame} src={src} title="MowBite Updater" style={{height}} />;
}

// the tag of an image that has no releases to pick from: the one it pulls again
const imageTag = (s: UpdateState, part: Part) => (s.status[`${part}_available`] ?? '').split(' ')[1]?.split(':').pop() || '–';

// what can go to make room on the mower, deleted only when asked and confirmed: each image, all of them, the build cache
function Room({s, busy, onAsk}: {s: UpdateState; busy: boolean; onAsk: (go: () => Promise<void>) => void}) {
  const {sure, confirm} = useSure();
  const items = s.room?.items ?? [];
  const cache = s.room?.cache ?? 0;
  const free = freeMb(s);
  const button = (key: string, label: string, go: () => Promise<void>) => (
    <button className={[local.control, sure === key ? local.danger : ''].join(' ')} disabled={busy} onClick={() => confirm(key, () => onAsk(go))}>
      {sure === key ? tr('Really delete?') : label}
    </button>
  );

  return (
    <div className={local.part}>
      <div className={local.head}>
        <span className={local.name}>{tr('Make room')}</span>
        {free !== null && <span className={local.badge}>{tr('{gb} GB free', {gb: fmt(free / 1024, 1)})}</span>}
      </div>
      <span className={local.dim}>
        {tr("What's on the mower that nothing needs: images no container uses and the build cache. Shown is the room each really frees. Nothing is deleted automatically, versions kept for going back only one at a time.")}
      </span>
      {items.map((i) => (
        <div key={i.id} className={local.item}>
          <span className={local.itemName}>{roomLabel(i)}</span>
          <span className={local.dim}>{roomNote(i)}</span>
          <div className={local.row}>
            <span className={local.dim}>{size(i.bytes)}</span>
            {button(i.id, tr('Delete'), () => freeRoom({id: i.id}))}
          </div>
        </div>
      ))}
      {cache > 0 && (
        <div className={local.item}>
          <span className={local.itemName}>{tr('Build cache')}</span>
          <span className={local.dim}>{tr('The next build of the planner then takes 1–2 minutes longer and needs the internet (shapely is loaded again).')}</span>
          <div className={local.row}>
            <span className={local.dim}>{size(cache)}</span>
            {button('cache', tr('Empty it'), () => freeRoom('cache'))}
          </div>
        </div>
      )}
      {!items.length && !cache && <span className={local.dim}>{tr('Nothing to delete right now.')}</span>}
      <div className={local.row}>
        <button className={local.control} disabled={busy} onClick={() => onAsk(requestRoom)}>
          {tr('Look again')}
        </button>
        {roomLoose(s).length > 1 ? button('all', tr('Delete all but the ways back ({size})', {size: size(roomTotal(roomLoose(s)))}), () => freeRoom('all')) : <span />}
      </div>
    </div>
  );
}

// the updater on the mower (lib/autoUpdate): each part with what runs, whether there's something new, its version,
// updating it now and automatically, then when, the free space and the log. while it updates, the step it's on
export function AutoUpdate() {
  const [s, setS] = useState<UpdateState | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [asked, setAsked] = useState(false);
  // the container doesn't answer for a moment (MowBite restarting after its update): what came last stays
  const [lost, setLost] = useState(false);
  const [now, setNow] = useState(() => Date.now() / 1000);
  const page = useUpdaterPageUrl();
  const theme = useThemeChoice();
  const fast = useRef(false);
  const restartingRef = useRef(false);
  // counts taps that change something: an answer asked for before the last one is older than what's shown
  const tapped = useRef(0);
  // an updater answered on this page already
  const seenRef = useRef(false);
  // its own page shown in here (see below)
  const framedRef = useRef(false);
  // where the updater's page is: from MowBite's container, else next to MowBite
  const [where, setWhere] = useState<string | null>(null);
  useEffect(() => {
    if (!isDemo()) void updaterWhere().then(setWhere);
  }, []);

  useEffect(() => {
    let stop = false;
    let timer: ReturnType<typeof setTimeout>;
    const load = () => {
      const at = tapped.current;
      return loadUpdate()
        .then(
          (x) => {
            if (stop || at !== tapped.current) return;
            // the updater restarting on its new version answers nothing for a moment, one that answered before and
            // doesn't now (10 s and no answer) is out of reach: what came last stays, it isn't one never set up
            if (!x && (restartingRef.current || seenRef.current)) {
              setLost(true);
              return;
            }
            setS(x);
            setLost(false);
            if (x) seenRef.current = true;
            restartingRef.current = !!x && !!selfInfo(x)?.restarting;
            fast.current = !!x && (x.requested || x.status.result === 'running' || restartingRef.current);
            if (x && !x.requested && x.status.result !== 'running') setAsked(false);
          },
          () => {
            if (stop) return;
            setLost(true);
            setS((last) => (last === undefined ? null : last));
          },
        )
        // what it does shows up while the page is open, every 2 seconds while it updates. with its own page in here,
        // that one asks, this only looks every half minute whether it's still there and which MowBite runs
        .finally(() => {
          if (!stop) timer = setTimeout(load, framedRef.current ? 30000 : fast.current ? 2000 : 5000);
        });
    };
    void load();
    return () => {
      stop = true;
      clearTimeout(timer);
    };
  }, []);

  const running = s?.status.result === 'running';
  const restarting = !!s && !!selfInfo(s, now)?.restarting;
  // its page: where MowBite's container says, else next to MowBite. an updater that brings its own page for in here
  // (embed) shows that one, with all it can do, only where it takes taps: else MowBite's own cards, which ask often
  const base = where || page;
  const framed = !!s && s.status.embed === '1' && !isDemo() && !!base && frameTakesTaps(base, window.location, isApp());
  useEffect(() => {
    framedRef.current = framed;
  }, [framed]);
  // the time on the bar, by the second while it updates or restarts itself
  useEffect(() => {
    if (!running && !restarting) return;
    const tick = setInterval(() => setNow(Date.now() / 1000), 1000);
    return () => clearInterval(tick);
  }, [running, restarting]);

  if (s === undefined) return null;
  if (!s) return isDemo() ? null : <AddUpdater />;

  const st = s;
  const busy = asked || st.requested || running || restarting;
  const set = (patch: Record<string, string | number>) => {
    const conf: UpdateConf = {...st.conf, ...patch};
    tapped.current++;
    setS({...st, conf});
    setError(null);
    saveUpdateConf(patch).catch(() => setError(tr('Not saved, the mower did not answer.')));
  };
  const ask = (go: () => Promise<void>) => {
    setAsked(true);
    tapped.current++;
    fast.current = true;
    setError(null);
    // (a look started before the request arrived still saw none, it doesn't free the buttons)
    go().then(
      () => {
        tapped.current++;
      },
      () => {
        setAsked(false);
        setError(tr('The mower did not answer.'));
      },
    );
  };
  const anyAuto = partsOf(st).some((p) => st.conf[`${p.id}_auto`] === 1);
  const days = st.conf.days === 'daily' ? [] : st.conf.days.split(',').map(Number);
  const toggleDay = (d: number) => {
    const next = days.includes(d) ? days.filter((x) => x !== d) : [...days, d].sort();
    // the last day taken away would be every night: that day stays, off is the switch of each app
    if (!next.length) return;
    set({days: next.length < 7 ? next.join(',') : 'daily'});
  };
  const free = freeMb(st);
  const checked = lastChecked(st);
  const run = runResult(st);
  const log = [...st.log].reverse().join('\n');
  // MowBite on the mower is another version than this page: after its update, the page needs loading again
  const onMower = (st.status.mowbite_running ?? '').split(' ')[0];
  // (only the mower this page comes from: another one picked can run another version for good)
  const reload = !isApp() && !isDemo() && !apiBase() && !running && /^\d/.test(onMower) && onMower !== APP_VERSION;
  const reloadNote = reload && (
    <div className={local.warn}>
      <div className={local.row}>
        <span>{tr('MowBite {v} runs on the mower now, this page is still {page}.', {v: onMower, page: APP_VERSION})}</span>
        <button className={local.control} onClick={() => window.location.reload()}>
          {tr('Load again')}
        </button>
      </div>
    </div>
  );

  // it answers, but its loop hasn't said it's there for a while: what it said last stays, it isn't one never set up
  const since = silentSince(st);
  const silentNote = !updaterAlive(st) && !isDemo() && (
    <span className={local.warn}>
      {since
        ? tr("The updater hasn't given a sign of life since {t}, it may hang or be restarting. Shown is what it said last.", {t: since})
        : tr("The updater doesn't give a sign of life, it may hang or be restarting.")}
    </span>
  );
  const own = base && !isDemo() && (
    <span className={local.dim}>
      {tr('Its own page:')}{' '}
      <a href={`${base}/?theme=${theme}`} target="_blank" rel="noreferrer">
        {base}
      </a>
    </span>
  );

  if (framed && base) {
    return (
      <div className={local.panel}>
        {reloadNote}
        {silentNote}
        <UpdaterFrame base={base} />
        {own}
      </div>
    );
  }

  return (
    <div className={local.panel}>
      <span className={local.dim}>
        {tr(
          "Only with the mower idle in the dock. If a new version doesn't start, it goes back to the one before. Afterwards old images and the build cache are cleared away.",
        )}
      </span>

      {reloadNote}
      {silentNote}

      <OutOfReachNote s={st} />

      {partsOf(st).map((p) => (
        <PartCard
          key={p.id}
          p={p}
          s={st}
          busy={busy}
          now={now}
          onConf={set}
          onUpdate={() => ask(() => requestUpdate(p.id))}
          onBack={() => ask(() => requestBack(p.id))}
        />
      ))}

      {st.status.updater_running && <UpdaterCard s={st} busy={busy} now={now} anyAuto={anyAuto} onUpdate={() => ask(requestSelf)} />}

      {anyAuto ? (
        <div className={local.part}>
          <span className={local.name}>{tr('When it updates by itself')}</span>
          <div className={local.row}>
            <input
              className={local.control}
              type="time"
              aria-label={tr('At')}
              value={st.conf.at}
              onChange={(e) => e.target.value && set({at: e.target.value})}
            />
            <label className={local.check}>
              <input type="checkbox" checked={st.conf.days === 'daily'} onChange={(e) => set({days: e.target.checked ? 'daily' : '7'})} />
              {tr('every night')}
            </label>
          </div>
          {st.conf.days !== 'daily' && (
            <div className={local.days} role="group" aria-label={tr('Days')}>
              {WEEKDAYS.map((d, i) => (
                <button
                  key={d}
                  aria-pressed={days.includes(i + 1)}
                  className={[local.control, days.includes(i + 1) ? local.primary : ''].join(' ')}
                  onClick={() => toggleDay(i + 1)}
                >
                  {tr(d)}
                </button>
              ))}
            </div>
          )}
          <span className={local.dim}>{tr("If the mower isn't idle in the dock then, it tries again every 10 minutes for 3 hours.")}</span>
        </div>
      ) : null}

      <div className={local.part}>
        <div className={local.row}>
          <button className={local.control} disabled={busy} onClick={() => ask(requestCheck)}>
            {tr('Check for updates')}
          </button>
          <button className={local.control} disabled={busy} onClick={() => ask(() => requestUpdate())}>
            {tr('Update all')}
          </button>
        </div>
        <span className={local.dim}>
          {[
            busy && !run ? tr('asked, within a minute…') : run,
            lost && running && tr('MowBite does not answer for a moment, it may be restarting.'),
            checked && tr('Last checked {t}.', {t: checked}),
            free !== null && tr('{gb} GB free on the mower.', {gb: fmt(free / 1024, 1)}),
          ]
            .filter(Boolean)
            .join(' ')}
        </span>
        {error && <span className={local.warn}>{error}</span>}
        {own}
        {log && (
          <details>
            <summary className={local.dim}>{tr('Log')}</summary>
            <div className={local.row}>
              <span className={local.dim}>{tr('newest at the top')}</span>
              <CopyButton text={log} className={local.control} />
            </div>
            <pre className={local.log}>{log}</pre>
          </details>
        )}
      </div>

      <Room s={st} busy={busy} onAsk={ask} />
    </div>
  );
}
