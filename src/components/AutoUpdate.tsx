'use client';

import {useEffect, useRef, useState} from 'react';
import {
  freeMb,
  lastChecked,
  loadUpdate,
  openMowerChoices,
  partInfo,
  partResult,
  PART_NAMES,
  PARTS,
  progressOf,
  requestBack,
  requestCheck,
  requestRoom,
  freeRoom,
  roomLabel,
  roomNote,
  roomTotal,
  runParts,
  size,
  stepDetail,
  stepLabel,
  requestUpdate,
  runResult,
  saveUpdateConf,
  updaterAlive,
  WEEKDAYS,
  type Part,
  type Progress,
  type UpdateConf,
  type UpdateState,
} from '@/lib/autoUpdate';
import {copyText} from '@/lib/clipboard';
import {useDockgeUrl, useUpdaterPageUrl} from '@/lib/dockge';
import {fmt, tr} from '@/lib/i18n';
import {isDemo} from '@/lib/mowers';
import {isApp} from '@/lib/native';
import {APP_VERSION} from '@/lib/updates';
import local from './AutoUpdate.module.css';

// the updater's part of compose.yaml, as in the repository's
const UPDATER_YAML = `  updater:
    image: ghcr.io/mkaaaaaay/mowbite-updater:latest
    container_name: mowbite-updater
    restart: unless-stopped
    network_mode: host
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
      - /opt/stacks:/opt/stacks
      - /etc/localtime:/etc/localtime:ro
      - /etc/os-release:/host/os-release:ro
    labels:
      openmower.ui: "true"
      openmower.ui.name: MowBite Updater
      openmower.ui.port: "8083"
`;

function CopyButton({text}: {text: string}) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className={local.control}
      onClick={() => {
        copyText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
    >
      {copied ? tr('copied') : tr('Copy')}
    </button>
  );
}

// a delete or a step back takes two taps: the first asks, for a few seconds
function useSure() {
  const [sure, setSure] = useState<string | null>(null);
  const confirm = (key: string, go: () => void) => {
    if (sure !== key) {
      setSure(key);
      setTimeout(() => setSure((k) => (k === key ? null : k)), 4000);
      return;
    }
    setSure(null);
    go();
  };
  return {sure, confirm};
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
        <li>{tr('Tap "Save", then "Update" (or "Deploy").')}</li>
        <li>{tr('After about a minute the updates show up here.')}</li>
      </ol>
      <pre className={local.code}>{UPDATER_YAML}</pre>
      <div className={local.row}>
        <CopyButton text={UPDATER_YAML} />
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
  failed: "Left out (didn't start)",
  unknown: 'Not known yet',
  local: 'Built here',
};

function PartCard({
  part,
  s,
  busy,
  now,
  onConf,
  onUpdate,
  onBack,
}: {
  part: Part;
  s: UpdateState;
  busy: boolean;
  now: number;
  onConf: (patch: Partial<UpdateConf>) => void;
  onUpdate: () => void;
  onBack: () => void;
}) {
  const {sure, confirm} = useSure();
  const info = partInfo(s, part);
  if (!info.running) return null;
  const result = partResult(s, part);
  const isNew = info.available === 'yes' || info.available === 'switch';
  const plannerHere = partInfo(s, 'planner').source !== 'none';
  const auto = !!s.conf[`${part}_auto`];
  const fromCopy = info.source === 'local';
  // in the run going on: this part now, after the one now, or done with already
  const progress = progressOf(s);
  const parts = runParts(s);
  const mine = progress?.part === part ? progress : null;
  const queued = !mine && !!progress && parts.indexOf(part) > parts.indexOf(progress.part);

  return (
    <div className={local.part}>
      <div className={local.head}>
        <span className={local.name}>{PART_NAMES[part]}</span>
        {info.available && !fromCopy && <span className={[local.badge, isNew ? local.badgeNew : ''].join(' ')}>{tr(BADGE[info.available])}</span>}
      </div>
      <span className={local.dim}>{tr('Runs: {what}', {what: info.running})}</span>

      {mine && <ProgressBar p={mine} now={now} />}
      {queued && <span className={local.dim}>{tr('Next in line, after the one updating now.')}</span>}

      <div className={local.row}>
        {part === 'mowbite' && (
          <select
            className={local.control}
            aria-label={tr('Version')}
            value={s.conf.mowbite}
            onChange={(e) => onConf({mowbite: e.target.value as 'beta' | 'stable'})}
          >
            <option value="beta">{tr('Beta')}</option>
            {/* only MowBite's own image has releases without "beta" */}
            {(s.status.mowbite_stable !== 'no' || s.conf.mowbite === 'stable') && <option value="stable">{tr('Stable')}</option>}
          </select>
        )}
        {part === 'openmower' && (
          <select className={local.control} aria-label={tr('Version')} value={s.conf.openmower} onChange={(e) => onConf({openmower: e.target.value})}>
            {openMowerChoices(s).map((t) => (
              <option key={t} value={t}>
                {t === 'edge' ? tr('Edge (newest)') : t === 'latest' ? tr('Release') : t}
              </option>
            ))}
          </select>
        )}
        {part === 'planner' && (
          <select className={local.control} aria-label={tr('Version')} disabled value="main">
            <option value="main">{fromCopy ? tr('Local copy') : tr('Newest version')}</option>
          </select>
        )}
        <button className={[local.control, isNew ? local.primary : ''].join(' ')} disabled={busy || fromCopy} onClick={onUpdate}>
          {tr('Update')}
        </button>
      </div>

      {!fromCopy && (
        <label className={local.check}>
          <input type="checkbox" checked={auto} onChange={(e) => onConf({[`${part}_auto`]: e.target.checked ? 1 : 0})} />
          {tr('Automatically at night')}
        </label>
      )}

      {part === 'mowbite' && info.available === 'local' && (
        <span className={local.dim}>
          {tr('This is a version built on its own, not one from GitHub. "Update" swaps it for the {channel} from GitHub.', {
            channel: s.conf.mowbite === 'stable' ? tr('Stable') : tr('Beta'),
          })}
        </span>
      )}
      {part === 'mowbite' && s.conf.mowbite === 'stable' && (
        <span className={local.dim}>
          {tr('Stable is the newest release without "beta". It can be older than the beta that runs now, going there leaves out what came since.')}
        </span>
      )}
      {part === 'openmower' && s.conf.openmower !== 'edge' && plannerHere && (
        <span className={local.warn}>
          {tr(
            "With this version the MowBite Planner doesn't work: it needs two changes that are only in edge so far (OM_PLANNER=external and keeping the planner's settings per area). MowBite also loses the mowing plan from the mower, OpenMower's settings, the ROS log, dropping an interrupted job and areas set to not mow.",
          )}
        </span>
      )}
      {part === 'openmower' && auto && (
        <span className={local.dim}>
          {tr("Edge changes often, an update at night can bring a new fault. Only when there's room for the old and the new image at once.")}
        </span>
      )}
      {fromCopy && <span className={local.dim}>{tr('Built from a local copy, it is left as it is.')}</span>}
      {result && <span className={local.dim}>{tr('Last time: {what}', {what: result})}</span>}

      {part === 'mowbite' && s.status.mowbite_back === 'yes' && (
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
        {tr("What's on the mower that nothing needs: images no container uses and the build cache. Shown is the room each really frees. Nothing goes by itself.")}
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
            {button('cache', tr('Clear'), () => freeRoom('cache'))}
          </div>
        </div>
      )}
      {!items.length && !cache && <span className={local.dim}>{tr('Nothing to delete right now.')}</span>}
      <div className={local.row}>
        <button className={local.control} disabled={busy} onClick={() => onAsk(requestRoom)}>
          {tr('Look again')}
        </button>
        {items.length > 1 ? button('all', tr('Delete all ({size})', {size: size(roomTotal(s))}), () => freeRoom('all')) : <span />}
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
  const fast = useRef(false);

  useEffect(() => {
    let stop = false;
    let timer: ReturnType<typeof setTimeout>;
    const load = () =>
      loadUpdate()
        .then(
          (x) => {
            if (stop) return;
            setS(x);
            setLost(false);
            fast.current = !!x && (x.requested || x.status.result === 'running');
            if (x && !x.requested && x.status.result !== 'running') setAsked(false);
          },
          () => {
            if (stop) return;
            setLost(true);
            setS((last) => (last === undefined ? null : last));
          },
        )
        // what it does shows up while the page is open, every 2 seconds while it updates
        .finally(() => {
          if (!stop) timer = setTimeout(load, fast.current ? 2000 : 5000);
        });
    void load();
    return () => {
      stop = true;
      clearTimeout(timer);
    };
  }, []);

  const running = s?.status.result === 'running';
  // the time on the bar, by the second while it updates
  useEffect(() => {
    if (!running) return;
    const tick = setInterval(() => setNow(Date.now() / 1000), 1000);
    return () => clearInterval(tick);
  }, [running]);

  if (s === undefined) return null;
  if (!updaterAlive(s)) return isDemo() ? null : <AddUpdater />;

  const st = s!;
  const busy = asked || st.requested || running;
  const set = (patch: Partial<UpdateConf>) => {
    const conf = {...st.conf, ...patch};
    setS({...st, conf});
    setError(null);
    saveUpdateConf(conf).catch(() => setError(tr('Not saved, the mower did not answer.')));
  };
  const ask = (go: () => Promise<void>) => {
    setAsked(true);
    fast.current = true;
    setError(null);
    go().catch(() => {
      setAsked(false);
      setError(tr('The mower did not answer.'));
    });
  };
  const anyAuto = st.conf.mowbite_auto || st.conf.openmower_auto || st.conf.planner_auto;
  const days = st.conf.days === 'daily' ? [] : st.conf.days.split(',').map(Number);
  const toggleDay = (d: number) => {
    const next = days.includes(d) ? days.filter((x) => x !== d) : [...days, d].sort();
    set({days: next.length && next.length < 7 ? next.join(',') : 'daily'});
  };
  const free = freeMb(st);
  const checked = lastChecked(st);
  const run = runResult(st);
  const log = [...st.log].reverse().join('\n');
  // what else it looks after (apps labelled for it): those only on its own page
  const more = (st.parts ?? []).filter((p) => !PARTS.includes(p.id as Part)).map((p) => p.name);
  // MowBite on the mower is another version than this page: after its update, the page needs loading again
  const onMower = (st.status.mowbite_running ?? '').split(' ')[0];
  const reload = !isApp() && !isDemo() && !running && !!onMower && onMower !== APP_VERSION;

  return (
    <div className={local.panel}>
      <span className={local.dim}>
        {tr(
          "Only with the mower idle in the dock. If a new version doesn't start, it goes back to the one before. Afterwards old images and the build cache are cleared away.",
        )}
      </span>

      {reload && (
        <div className={local.warn}>
          <div className={local.row}>
            <span>{tr('MowBite {v} runs on the mower now, this page is still {page}.', {v: onMower, page: APP_VERSION})}</span>
            <button className={local.control} onClick={() => window.location.reload()}>
              {tr('Load again')}
            </button>
          </div>
        </div>
      )}

      {PARTS.map((p) => (
        <PartCard
          key={p}
          part={p}
          s={st}
          busy={busy}
          now={now}
          onConf={set}
          onUpdate={() => ask(() => requestUpdate(p))}
          onBack={() => ask(requestBack)}
        />
      ))}

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
        {page && !isDemo() && (
          <span className={local.dim}>
            {more.length ? tr('More apps it looks after ({names}) are on its own page:', {names: more.join(', ')}) : tr('Its own page:')}{' '}
            <a href={page} target="_blank" rel="noreferrer">
              {page}
            </a>
          </span>
        )}
        {log && (
          <details>
            <summary className={local.dim}>{tr('Log')}</summary>
            <div className={local.row}>
              <span className={local.dim}>{tr('newest at the top')}</span>
              <CopyButton text={log} />
            </div>
            <pre className={local.log}>{log}</pre>
          </details>
        )}
      </div>

      <Room s={st} busy={busy} onAsk={ask} />
    </div>
  );
}
