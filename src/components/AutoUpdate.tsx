'use client';

import {useSure} from '@/hooks/useSure';
import {useEffect, useRef, useState, type ReactNode} from 'react';
import {
  freeMb,
  isNew,
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
  runSteps,
  size,
  stepDetail,
  stepLabel,
  stepTitle,
  requestUpdate,
  runResult,
  saveUpdateConf,
  selfInfo,
  silentSince,
  updaterAlive,
  updaterWhere,
  WEEKDAYS,
  type Availability,
  type Part,
  type PartResult,
  type Progress,
  type SelfInfo,
  type UpdateConf,
  type UpdatePart,
  type UpdateState,
} from '@/lib/autoUpdate';
import {CopyButton} from '@/lib/clipboard';
import {useDockgeUrl, useUpdaterPageUrl} from '@/lib/dockge';
import {fmt, tr} from '@/lib/i18n';
import {isDemo, pageFromMower} from '@/lib/mowers';
import {useThemeChoice} from '@/lib/theme';
import {APP_VERSION, useUpdates} from '@/lib/updates';
import local from './AutoUpdate.module.css';
import os from './OsUpdate.module.css';
import {Ask, HOUR, Head, IN_DOCK, Note, OffCard, PART_TEXT, RIGHT_AWAY, ReloadNote, RunHead, Steps, Summary, type Tag} from './updateParts';

// the updater's part of compose.yaml, as in the repository's
const UPDATER_YAML = `  updater:
    image: ghcr.io/mkaaaaaay/mowbite-updater:latest
    container_name: mowbite-updater
    restart: unless-stopped
    network_mode: host
    logging:
      driver: json-file
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

// MowBite runs as a container there (it told its version), the demo doesn't: else there's no stack to update in dockge
function useContainer(): boolean {
  return useUpdates().level !== null && !isDemo();
}

// MowBite updated by hand in dockge, step by step
export function DockgeUpdateGuide() {
  const dockge = useDockgeUrl();
  if (!useContainer()) return null;
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

// the updater's parts as the ones of MowBite OS, for what each is
const AS_OS: Record<string, string> = {openmower: 'os', mowbite: 'app', planner: 'planner'};

const TAG: Record<Availability, string> = {
  yes: 'Update available',
  switch: 'Switch to the version picked',
  no: 'Up to date',
  failed: 'Skipped',
  unknown: 'Not known yet',
  local: 'Built here',
};

const FROM_REGISTRY = 'This is a version built on its own, not one from its registry. "Update" swaps it for the one from there.';

// the mark of a part: something new, just updated, left out or up to date
function tagOf(available: Availability, fresh: boolean): Tag {
  if (isNew(available)) return {text: tr(TAG[available]), look: local.badgeNew};
  if (fresh) return {text: tr('Just updated'), look: local.badgeNew};
  return {text: tr(TAG[available]), look: available === 'failed' ? local.badgeBad : ''};
}

// updated within the last hour (<part>: "updated <t> ...")
const freshly = (s: UpdateState, part: Part, now: number) => {
  const [state, t] = (s.status[part] ?? '').split(' ');
  return state === 'updated' && now - Number(t) < HOUR;
};

// what it did last with a part: in passing, or in a box when it's something to know or went wrong
function LastTime({r}: {r: PartResult}) {
  if (r.level === 'ok')
    return <span className={local.dim}>{r.at ? tr('Last time ({when}): {what}', {when: r.at, what: r.text}) : tr('Last time: {what}', {what: r.text})}</span>;
  return (
    <Note look={r.level === 'error' ? local.error : local.warn}>
      {r.text}
      {r.at && <small>{r.at}</small>}
    </Note>
  );
}

// what runs and its channel
const Facts = ({running, channel}: {running: string; channel: ReactNode}) => (
  <>
    <span>{tr('Runs')}</span>
    <span>{running}</span>
    <span>{tr('Channel')}</span>
    <span>{channel}</span>
  </>
);

// updating a part: what it asks of the mower when there's something new, and the button
function UpdateAction({available, inDock, locked, onUpdate}: {available: Availability | null; inDock: boolean; locked: boolean; onUpdate: () => void}) {
  if (available === 'no') return null;
  return (
    <>
      {isNew(available) && <span className={local.dim}>{tr(inDock ? IN_DOCK : RIGHT_AWAY)}</span>}
      <button className={[local.control, isNew(available) ? local.primary : ''].join(' ')} disabled={locked} onClick={onUpdate}>
        {tr('Update')}
      </button>
    </>
  );
}

// the run going on: its steps, the one it's on with how far it is
function Running({s, p, name, now, children}: {s: UpdateState; p: Progress; name: string; now: number; children?: ReactNode}) {
  const {steps, now: at, back} = runSteps(s, p);
  return (
    <div className={os.run} data-update={p.part}>
      <RunHead name={name} back={back} sub={runResult(s)} />
      <Steps
        steps={steps.map((step) => ({
          key: step,
          label: stepLabel({...p, step}),
          title: stepTitle(step),
          more: step === p.step ? <small>{stepDetail(p, now)}</small> : undefined,
        }))}
        now={at}
      />
      {children}
    </div>
  );
}

// the version to pick: beta or stable of an image with releases, OpenMower's tag, else what it's made from
function ChannelPick({p, s, off, onConf}: {p: UpdatePart; s: UpdateState; off: boolean; onConf: (patch: Record<string, string | number>) => void}) {
  const part = p.id;
  if (p.kind === 'local') return tr('Local copy');
  if (p.kind === 'build') return tr('Newest version');
  if (p.kind === 'openmower')
    return (
      <select className={local.control} aria-label={tr('Channel')} value={String(s.conf.openmower ?? 'edge')} disabled={off} onChange={(e) => onConf({openmower: e.target.value})}>
        {openMowerChoices(s).map((t) => (
          <option key={t} value={t}>
            {t === 'edge' ? tr('Edge (newest)') : t === 'latest' ? tr('Release') : t}
          </option>
        ))}
      </select>
    );
  if (!s.status[`${part}_stable`]) return imageTag(s, part);
  const channel = String(s.conf[part] ?? 'beta');
  return (
    <select className={local.control} aria-label={tr('Channel')} value={channel} disabled={off} onChange={(e) => onConf({[part]: e.target.value})}>
      <option value="beta">{tr('Beta')}</option>
      {/* only an image with releases without "beta" */}
      {(s.status[`${part}_stable`] !== 'no' || channel === 'stable') && <option value="stable">{tr('Stable')}</option>}
    </select>
  );
}

function PartCard({
  p,
  s,
  locked,
  off,
  queued,
  now,
  onConf,
  onUpdate,
  onBack,
  children,
}: {
  p: UpdatePart;
  s: UpdateState;
  locked: boolean;
  // another part updates, this one only shows what runs
  off: boolean;
  // its turn comes in the run going on
  queued: boolean;
  now: number;
  onConf: (patch: Record<string, string | number>) => void;
  onUpdate: () => void;
  onBack: () => void;
  children?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [ask, setAsk] = useState(false);
  const part = p.id;
  const info = partInfo(s, part);
  if (!info.running) return null;
  const result = partResult(s, part);
  // built from a copy here, or coming with the os: nothing to update from here
  const fixed = p.kind === 'local' || p.kind === 'os';
  const tag = info.available && !fixed ? tagOf(info.available, freshly(s, part, now)) : null;
  const plannerHere = partsOf(s).some((x) => x.id === 'planner' && partInfo(s, 'planner').running);
  const auto = !!s.conf[`${part}_auto`];
  const channel = String(s.conf[part] ?? 'beta');
  // an image with releases (MowBite's own): beta or stable
  const releases = p.kind === 'image' && !!s.status[`${part}_stable`];
  const canBack = p.kind === 'image' && s.status[`${part}_back`] === 'yes';

  const head = (
    <Head name={tr(p.name)} tag={tag} text={off ? undefined : PART_TEXT[AS_OS[part]]}>
      {p.kind === 'os' ? (
        <>
          <span>{tr('Runs')}</span>
          <span>{info.running}</span>
        </>
      ) : (
        <Facts running={info.running} channel={<ChannelPick p={p} s={s} off={off} onConf={onConf} />} />
      )}
    </Head>
  );

  if (off)
    return (
      <OffCard id={part}>
        {head}
        {queued && <span className={local.dim}>{tr('Next in line, after the one updating now.')}</span>}
      </OffCard>
    );

  return (
    <article className={local.part} data-part={part}>
      {head}
      {children}
      {info.available === 'failed' && <div className={local.warn}>{tr("This version didn't start, it's left out until a newer one comes.")}</div>}
      {p.kind === 'image' && info.available === 'local' && (
        <span className={local.dim}>
          {part === 'mowbite'
            ? tr('This is a version built on its own, not one from GitHub. "Update" swaps it for the {channel} version from GitHub.', {
                channel: channel === 'stable' ? tr('Stable') : tr('Beta'),
              })
            : tr(FROM_REGISTRY)}
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
      {p.kind === 'local' && <span className={local.dim}>{tr('Built from a local copy, it is left as it is.')}</span>}
      {result && result.level !== 'ok' && <LastTime r={result} />}
      {!fixed && <UpdateAction available={info.available} inDock={p.gate !== 'none'} locked={locked} onUpdate={onUpdate} />}
      {!fixed && (
        <label className={local.check}>
          <input type="checkbox" checked={auto} onChange={(e) => onConf({[`${part}_auto`]: e.target.checked ? 1 : 0})} />
          {tr('Automatically at night')}
        </label>
      )}
      {p.kind === 'openmower' && auto && (
        <span className={local.dim}>
          {tr("Edge changes often, an update at night can bring a new fault. Only when there's room for the old and the new image at once.")}
        </span>
      )}

      {(result?.level === 'ok' || canBack) && (
        <button className={os.more} aria-expanded={open} onClick={() => setOpen(!open)}>
          {tr('Details and the version before')}
        </button>
      )}
      {open && (
        <>
          {result?.level === 'ok' && <LastTime r={result} />}
          {canBack && !ask && (
            <>
              <span className={local.dim}>{tr('Something is wrong since the last update? Then go back to the version before.')}</span>
              <button className={local.control} disabled={locked} onClick={() => setAsk(true)}>
                {tr('Back to the version before')}
              </button>
            </>
          )}
          {canBack && ask && (
            <Ask
              title={tr('Take {name} back to the version before?', {name: tr(p.name)})}
              yes={tr('Go back')}
              locked={locked}
              onYes={() => {
                setAsk(false);
                onBack();
              }}
              onNo={() => setAsk(false)}
            >
              {p.gate !== 'none' && <p>{tr(IN_DOCK)}</p>}
              <p>{tr("The version that runs now isn't installed by itself afterwards, a newer one is.")}</p>
            </Ask>
          )}
        </>
      )}
    </article>
  );
}

// the updater itself: the commit it runs, whether there's a newer one and updating it
function UpdaterCard({info, s, locked, off, now, anyAuto, onUpdate}: {info: SelfInfo; s: UpdateState; locked: boolean; off: boolean; now: number; anyAuto: boolean; onUpdate: () => void}) {
  const tag = info.available ? tagOf(info.available, freshly(s, 'updater', now)) : null;
  const head = (
    <Head name="MowBite Updater" tag={tag} text={off ? undefined : PART_TEXT.host}>
      <Facts running={info.running} channel={info.tag} />
    </Head>
  );
  if (off) return <OffCard id="updater">{head}</OffCard>;
  return (
    <article className={local.part} data-part="updater">
      {head}
      {info.available === 'local' && <span className={local.dim}>{tr(FROM_REGISTRY)}</span>}
      {info.result && <LastTime r={info.result} />}
      <UpdateAction available={info.available} inDock={false} locked={locked} onUpdate={onUpdate} />
      {anyAuto && <span className={local.dim}>{tr('It updates itself too, at night with the automatic updates.')}</span>}
    </article>
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

// the updater on the mower (lib/autoUpdate), laid out like MowBite OS's updates: how many there are, each part with
// what runs, whether there's something new, its channel and updating it now and at night, the run going on step by
// step, then when it updates by itself, the free space and the log
export function AutoUpdate() {
  const [s, setS] = useState<UpdateState | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [asked, setAsked] = useState(false);
  // the container doesn't answer for a moment (MowBite restarting after its update): what came last stays
  const [lost, setLost] = useState(false);
  const [now, setNow] = useState(() => Date.now() / 1000);
  const page = useUpdaterPageUrl();
  const theme = useThemeChoice();
  const container = useContainer();
  const fast = useRef(false);
  const restartingRef = useRef(false);
  // counts taps that change something: an answer asked for before the last one is older than what's shown
  const tapped = useRef(0);
  // an updater answered on this page already
  const seenRef = useRef(false);
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
        // what it does shows up while the page is open, every 2 seconds while it updates
        .finally(() => {
          if (!stop) timer = setTimeout(load, fast.current ? 2000 : 5000);
        });
    };
    void load();
    return () => {
      stop = true;
      clearTimeout(timer);
    };
  }, []);

  const running = s?.status.result === 'running';
  const self = s ? selfInfo(s, now) : null;
  const restarting = !!self?.restarting;
  // the time of the step, by the second while it updates or restarts itself
  useEffect(() => {
    if (!running && !restarting) return;
    const tick = setInterval(() => setNow(Date.now() / 1000), 1000);
    return () => clearInterval(tick);
  }, [running, restarting]);

  if (s === undefined) return null;
  if (!s) {
    if (isDemo()) return null;
    return container ? <AddUpdater /> : <span className={local.dim}>{tr('Only when MowBite runs as its container on the mower.')}</span>;
  }

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
  const parts = partsOf(st);
  const anyAuto = parts.some((p) => st.conf[`${p.id}_auto`] === 1);
  const days = st.conf.days === 'daily' ? [] : st.conf.days.split(',').map(Number);
  const toggleDay = (d: number) => {
    const next = days.includes(d) ? days.filter((x) => x !== d) : [...days, d].sort();
    // the last day taken away would be every night: that day stays, off is the switch of each app
    if (!next.length) return;
    set({days: next.length < 7 ? next.join(',') : 'daily'});
  };
  const log = [...st.log].reverse().join('\n');
  // the run going on, the updater's restart on its new version as its last step
  const current = progressOf(st) ?? (self?.restarting ? {part: 'updater', step: 'restart' as const, pct: null, since: self.restarting} : null);
  const queue = runParts(st);
  const count =
    parts.filter((p) => p.kind !== 'local' && p.kind !== 'os' && isNew(partInfo(st, p.id).available)).length + (self?.available === 'yes' ? 1 : 0);
  // MowBite on the mower is another version than this page: after its update, the page needs loading again
  const onMower = (st.status.mowbite_running ?? '').split(' ')[0];
  // (only the mower this page comes from: another one picked can run another version for good)
  const reload = pageFromMower() && !isDemo() && !running && /^\d/.test(onMower) && onMower !== APP_VERSION;
  const nameOf = (part: Part) => (part === 'updater' ? 'MowBite Updater' : tr(parts.find((p) => p.id === part)?.name ?? part));
  const base = where || page;
  const since = silentSince(st);
  const waited = !running && runResult(st);

  return (
    <div className={local.panel}>
      {current ? (
        <Running s={st} p={current} name={nameOf(current.part)} now={now}>
          {current.part === 'updater' && self?.restarting && (
            <Note look={os.info} title={tr('Restarting the updater, this comes back by itself')}>
              {tr("For a few seconds nothing arrives here. That's no error, the mower drives and mows on as usual.")}
            </Note>
          )}
          {lost && current.part === 'mowbite' && <span className={local.dim}>{tr('MowBite does not answer for a moment, it may be restarting.')}</span>}
        </Running>
      ) : (
        <Summary count={count} checked={lastChecked(st)} locked={busy} onCheck={() => ask(requestCheck)} />
      )}
      {busy && !current && <span className={local.dim}>{tr('asked, within a minute…')}</span>}
      {waited && <Note look={local.warn}>{waited}</Note>}
      {!updaterAlive(st) && !isDemo() && (
        <span className={local.warn}>
          {since
            ? tr("The updater hasn't given a sign of life since {t}, it may hang or be restarting. Shown is what it said last.", {t: since})
            : tr("The updater doesn't give a sign of life, it may hang or be restarting.")}
        </span>
      )}
      {error && <span className={local.warn}>{error}</span>}

      <OutOfReachNote s={st} />

      <div className={os.parts}>
        {parts
          .filter((p) => p.id !== current?.part)
          .map((p) => (
            <PartCard
              key={p.id}
              p={p}
              s={st}
              locked={busy}
              off={!!current}
              queued={!!current && queue.indexOf(p.id) > queue.indexOf(current.part)}
              now={now}
              onConf={set}
              onUpdate={() => ask(() => requestUpdate(p.id))}
              onBack={() => ask(() => requestBack(p.id))}
            >
              {p.id === 'mowbite' && reload && <ReloadNote v={onMower} page={APP_VERSION} />}
            </PartCard>
          ))}
        {self && current?.part !== 'updater' && (
          <UpdaterCard info={self} s={st} locked={busy} off={!!current} now={now} anyAuto={anyAuto} onUpdate={() => ask(requestSelf)} />
        )}
      </div>
      {current && <span className={local.dim}>{tr('The other parts can only be changed after it: always one update after the other.')}</span>}
      {!current && count > 1 && (
        <button className={local.control} disabled={busy} onClick={() => ask(() => requestUpdate())}>
          {tr('Update all')}
        </button>
      )}

      {anyAuto && !current && (
        <div className={local.part}>
          <span className={local.name}>{tr('When it updates by itself')}</span>
          <div className={os.window}>
            <span className={local.dim}>{tr('at')}</span>
            <input className={local.control} type="time" aria-label={tr('At')} value={st.conf.at} onChange={(e) => e.target.value && set({at: e.target.value})} />
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
          <span className={local.dim}>
            {tr(
              "Only when the mower is idle in the dock, if it isn't, it tries again every 10 minutes for 3 hours. If a new version doesn't start, it goes back to the one before by itself.",
            )}
          </span>
        </div>
      )}

      <Room s={st} busy={busy} onAsk={ask} />

      {base && !isDemo() && (
        <span className={local.dim}>
          {tr('More on its own page, like adding apps, their logs and putting data back:')}{' '}
          <a href={`${base}/?theme=${theme}`} target="_blank" rel="noreferrer">
            {base}
          </a>
        </span>
      )}
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
  );
}
