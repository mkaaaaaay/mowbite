'use client';

import {useSetup} from '@/hooks/useSetup';
import {platformWords, safetyFailed} from '@/lib/setup';
import {useSure} from '@/hooks/useSure';
import Link from 'next/link';
import {useEffect, useRef, useState, type ReactNode} from 'react';
import {
  elapsed,
  freeMb,
  isNew,
  lastChecked,
  loadUpdate,
  lookingSince,
  missingOf,
  nameOf as partName,
  noKeep,
  lacksPlanner,
  openMowerChoices,
  loadOsModels,
  osBackLeft,
  osHead,
  osModelMissing,
  osModelOf,
  osModelPicture,
  osModelsOf,
  osOnItsPage,
  osResult,
  osStepWords,
  osSteps,
  osSwitchOf,
  osWayOf,
  outOfReach,
  reachLine,
  PART_NAMES,
  TAG_NAMES,
  partInfo,
  partResult,
  partsOf,
  progressOf,
  requestBack,
  requestCheck,
  requestNoKeep,
  requestRoom,
  requestSelf,
  requestSwitch,
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
  mowerNow,
  selfInfo,
  silentSince,
  taken,
  updaterAlive,
  updaterWhere,
  WEEKDAYS,
  working,
  UPDATER_PLATFORM,
  type Availability,
  type OsModel,
  type OsWay,
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
import {fmt, tr, useLang} from '@/lib/i18n';
import {isDemo, pageFromMower} from '@/lib/mowers';
import {useOpenMower, useOsPlatform} from '@/lib/mowerOs';
import {useThemeChoice} from '@/lib/theme';
import {APP_VERSION, useUpdates} from '@/lib/updates';
import local from './AutoUpdate.module.css';
import os from './OsUpdate.module.css';
import {PlatformPicture} from './setup/PlatformPicture';
import {Sheet} from './setup/Sheet';
import sheet from './setup/Sheet.module.css';
import chooser from './setup/StepPlatform.module.css';
import {Ask, Bar, Busy, HOUR, Head, IN_DOCK, Note, OffCard, PART_TEXT, RIGHT_AWAY, ReloadNote, RunHead, runTitle, Steps, Summary, type Tag} from './updateParts';

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

// a request that didn't arrive or a setting not saved, where it was tapped
const Warn = ({text}: {text: string | null}) => (text ? <span className={local.warn}>{text}</span> : null);

// what runs and its channel
const Facts = ({running, channel}: {running: string; channel: ReactNode}) => (
  <>
    <span>{tr('Runs')}</span>
    <span>{running}</span>
    <span>{tr('Channel')}</span>
    <span>{channel}</span>
  </>
);

// updating a part: what it asks of the mower when there's something new, and the button (again: OpenMower once more,
// missing after its update without a copy or left out for its firmware)
function UpdateAction({available, inDock, locked, again, onUpdate}: {available: Availability | null; inDock: boolean; locked: boolean; again?: boolean; onUpdate: () => void}) {
  if (available === 'no' && !again) return null;
  return (
    <>
      {isNew(available) && <span className={local.dim}>{tr(inDock ? IN_DOCK : RIGHT_AWAY)}</span>}
      <button className={[local.control, isNew(available) ? local.primary : ''].join(' ')} disabled={locked} onClick={onUpdate}>
        {again ? tr('Try again') : tr('Update')}
      </button>
    </>
  );
}

// OpenMower without room for both versions: deleting the one that runs first, with what goes, two taps; or why not
function NoKeepOffer({s, part, locked, onYes}: {s: UpdateState; part: Part; locked: boolean; onYes: () => void}) {
  const {sure, confirm} = useSure();
  const offer = noKeep(s, part);
  if (!offer) return null;
  if (!offer.ok) return <span className={local.dim}>{tr("Deleting the old version first isn't possible here: {why}.", {why: offer.why})}</span>;
  return (
    <>
      <span className={local.warn}>
        {tr(
          "Both versions don't fit side by side. This way the version that runs is deleted first, then the new one downloaded ({size}). Until then the mower has no OpenMower and can't mow.",
          {size: offer.size},
        )}
      </span>
      <span className={local.dim}>
        {tr(
          "There's no way back on the mower itself: if the new one doesn't start, the updater downloads the old one again (that takes as long as the update and needs the internet).",
        )}
      </span>
      {offer.parts.length > 0 && (
        <span className={local.dim}>
          {tr("What's built on OpenMower ({names}) is deleted with it and built again afterwards. If building fails, the mower can only mow again once it's built.", {
            names: offer.parts.join(', '),
          })}
        </span>
      )}
      {offer.back.length > 0 && <span className={local.dim}>{tr('Deleted and downloaded or built again: {tags}.', {tags: offer.back.join(', ')})}</span>}
      {offer.gone.length > 0 && <span className={local.dim}>{tr('Deleted for good: {tags}.', {tags: offer.gone.join(', ')})}</span>}
      <button className={[local.control, sure === 'nokeep' ? local.danger : ''].join(' ')} disabled={locked} onClick={() => confirm('nokeep', onYes)}>
        {sure === 'nokeep' ? tr('Really delete it first?') : tr('Delete the old version and update')}
      </button>
    </>
  );
}

// OpenMower not on the mower after its update without a copy: its next try, and both ways by hand
function MissingNote({s}: {s: UpdateState}) {
  const m = missingOf(s);
  if (!m) return null;
  const by = (said: string, text: string) => (
    <>
      <span className={local.dim}>{tr(said)}</span>
      <pre className={local.code}>{text}</pre>
      <div className={local.row}>
        <CopyButton text={text} className={local.control} />
      </div>
    </>
  );
  return (
    <>
      <span className={local.error}>{tr("OpenMower isn't on the mower right now, the mower can't mow.")}</span>
      <span className={local.dim}>{m.next ? tr('Next try by itself: {when}.', {when: m.next}) : tr('No more tries by itself: tap Try again.')}</span>
      {m.fresh && by('By hand in a terminal on the mower, the new version:', m.fresh)}
      {by(m.fresh ? 'or the version before:' : 'By hand in a terminal on the mower, the version before:', m.before)}
    </>
  );
}

// the run going on, where it was asked for: its steps, on the one it's on a bar with how far it is. tapped here (follow)
// it stays in sight while the other cards fold to their heads above it. way: a switch to MowBite OS or back, away: it
// goes on on the updater's page (page)
function Running({
  s,
  p,
  name,
  now,
  asked,
  follow,
  way,
  away,
  page,
  children,
}: {
  s: UpdateState;
  p: Progress;
  name: string;
  now: number;
  asked: boolean;
  follow: boolean;
  way?: OsWay;
  away?: boolean;
  page: string;
  children?: ReactNode;
}) {
  const {steps, now: at, back} = way ? {...osSteps(s, p, way), back: false} : runSteps(s, p, asked);
  const words = (step: Progress['step']) => (way ? osStepWords({...p, step}, way) : [stepLabel({...p, step}), stepTitle(step)]);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (follow) ref.current?.scrollIntoView({block: 'nearest'});
  }, [follow]);
  return (
    <div ref={ref} className={os.run} data-update={p.part || 'all'}>
      <RunHead name={name} back={back} title={way && osHead(way)} />
      {away ? (
        <OnItsPage page={page} />
      ) : at < 0 ? (
        // (a step of the switch not in its list)
        <Busy label={tr('The switch goes on')} pct={p.pct} detail={stepDetail(p, now)} />
      ) : (
        <Steps
          steps={steps.map((step, i) => {
            const [label, title] = words(step);
            return {key: step, label, title, more: i === at ? <Bar label={label} pct={p.pct} detail={stepDetail(p, now)} /> : undefined};
          })}
          now={at}
        />
      )}
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
  error,
  onConf,
  onUpdate,
  onBack,
  onNoKeep,
  onChannel,
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
  // a request from this card that didn't arrive, or a setting not saved
  error: string | null;
  onConf: (patch: Record<string, string | number>) => void;
  onUpdate: () => void;
  onBack: () => void;
  onNoKeep: () => void;
  // another channel picked
  onChannel: (patch: Record<string, string | number>) => void;
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
        <Facts running={info.running} channel={<ChannelPick p={p} s={s} off={off} onConf={onChannel} />} />
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
      {p.kind === 'openmower' && lacksPlanner(String(s.conf.openmower ?? 'edge')) && plannerHere && (
        <span className={local.warn}>
          {tr(
            "With this version the MowBite Planner doesn't work: it needs two changes that came with OpenMower 1.5.0 (OM_PLANNER=external and keeping the planner's settings per area). MowBite also loses the mowing plan from the mower, OpenMower's settings, the ROS log, dropping an interrupted job and areas set to not mow.",
          )}
        </span>
      )}
      {p.kind === 'local' && <span className={local.dim}>{tr('Built from a local copy, it is left as it is.')}</span>}
      {result && result.level !== 'ok' && <LastTime r={result} />}
      {p.kind === 'openmower' && <MissingNote s={s} />}
      {p.kind === 'openmower' && (s.status[part] ?? '').startsWith('nospace') && <NoKeepOffer s={s} part={part} locked={locked} onYes={onNoKeep} />}
      <Warn text={error} />
      {!fixed && (
        <UpdateAction available={info.available} inDock={p.gate !== 'none'} locked={locked} again={p.kind === 'openmower' && (!!missingOf(s) || !!s.status.openmower_fw)} onUpdate={onUpdate} />
      )}
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

// a safety step failed and closed MowBite OS's lock (setup.get safety.why): said before going back
const UNLOCKED = "A safety step failed. OpenMower doesn't know MowBite OS's lock and lets the mower drive by itself again.";

// the switch on the updater's own page: MowBite's container is stopped with OpenMower for it
const OnItsPage = ({page}: {page: string}) => (
  <Note look={os.info} title={tr("It goes on on the updater's page")}>
    {tr("OpenMower and MowBite on the mower are stopped for the switch, this page can't follow it. The updater's own page shows how it goes on.")}
    <a className={[local.control, local.primary].join(' ')} href={page} target="_blank" rel="noreferrer">
      {tr("The updater's page")}
    </a>
  </Note>
);

// the models of MowBite OS that fit this mower (keys with commas) as the updater describes them, with their pictures
type OsModels = {of: string; models: OsModel[]; failed: boolean};
function useOsModels(keys: string): {models: OsModel[]; failed: boolean; pics: Record<string, string>} | null {
  const [got, setGot] = useState<OsModels | null>(null);
  const [pics, setPics] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!keys) return;
    let gone = false;
    const urls: string[] = [];
    loadOsModels(keys.split(',')).then(
      (models) => {
        if (gone) return;
        setGot({of: keys, models, failed: !models.length});
        for (const m of models)
          if (m.picture)
            osModelPicture(m.key).then(
              (url) => {
                if (!url) return;
                if (gone) return URL.revokeObjectURL(url);
                urls.push(url);
                setPics((p) => ({...p, [m.key]: url}));
              },
              () => undefined,
            );
      },
      () => !gone && setGot({of: keys, models: [], failed: true}),
    );
    return () => {
      gone = true;
      urls.forEach((u) => URL.revokeObjectURL(u));
    };
  }, [keys]);
  return keys && got?.of === keys ? {models: got.models, failed: got.failed, pics} : null;
}

// the model MowBite OS starts as, of those that fit: a line on the card, the choice in a sheet with each model's picture,
// name and what it is. one with a warning is sent only once the owner ticked it
function OsModelChoice({s, list, locked, onPick}: {s: UpdateState; list: ReturnType<typeof useOsModels>; locked: boolean; onPick: (key: string) => void}) {
  const lang = useLang();
  const chosen = osModelOf(s);
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  const [sure, setSure] = useState(false);
  if (!list) return <span className={local.dim}>{tr('connecting…')}</span>;
  if (list.failed) return <span className={local.error}>{tr("The models of MowBite OS couldn't be loaded.")}</span>;
  const words = (m: OsModel) => platformWords({name: m.key, texts: m.texts}, lang);
  const model = list.models.find((m) => m.key === chosen);
  const pick = list.models.find((m) => m.key === (picked ?? chosen));
  const warning = pick && pick.key !== chosen ? pick.warning[lang] || pick.warning.en || '' : '';
  const close = () => {
    setOpen(false);
    setPicked(null);
    setSure(false);
  };
  const send = () => {
    if (pick) onPick(pick.key);
    close();
  };
  return (
    <>
      <div className={local.model}>
        {model && <PlatformPicture name="" url={list.pics[model.key]} className={chooser.pic} />}
        <span className={chooser.words}>
          {model ? (
            <>
              <span>{tr('This mower')}</span>
              <b>{words(model).name}</b>
            </>
          ) : (
            <>
              <b>{tr('Which mower is this?')}</b>
              <span>{tr('Not chosen yet')}</span>
            </>
          )}
        </span>
        <button className={model ? local.control : [local.control, local.primary].join(' ')} disabled={locked} onClick={() => setOpen(true)}>
          {model ? tr('Change') : tr('Choose the mower')}
        </button>
      </div>
      {open && (
        <Sheet title={tr('Which mower is this?')} sub={tr('MowBite OS starts as the model chosen, only the ones that fit this mower are listed.')} onClose={close}>
          <fieldset className={chooser.platforms} disabled={locked} data-models={chosen ?? 'none'}>
            {list.models.map((m) => {
              const w = words(m);
              return (
                <label key={m.key} className={chooser.platform} data-model={m.key}>
                  <PlatformPicture name="" url={list.pics[m.key]} className={chooser.pic} />
                  <span className={chooser.words}>
                    <b>{w.name}</b>
                    {m.key === chosen && <i>{tr('Chosen')}</i>}
                    {w.text && <span>{w.text}</span>}
                  </span>
                  <input
                    type="radio"
                    name="os_model"
                    checked={m.key === pick?.key}
                    onChange={() => {
                      setPicked(m.key);
                      setSure(false);
                    }}
                  />
                </label>
              );
            })}
          </fieldset>
          {warning && (
            <>
              <p className={sheet.warn}>{warning}</p>
              <label className={sheet.check}>
                <input type="checkbox" checked={sure} disabled={locked} onChange={(e) => setSure(e.target.checked)} />
                {tr('I have checked this')}
              </label>
            </>
          )}
          <p className={sheet.limit}>{tr('After the switch the mower drives only by remote control and the blade stays off until its safety is measured in the setup.')}</p>
          <div className={sheet.buttons}>
            <button type="button" className={sheet.button} onClick={close}>
              {tr('Cancel')}
            </button>
            <button type="button" className={sheet.button} data-primary disabled={locked || !pick || pick.key === chosen || (!!warning && !sure)} onClick={send}>
              {tr('Choose this mower')}
            </button>
          </div>
        </Sheet>
      )}
    </>
  );
}

// MowBite OS in OpenMower's place where the updater offers it (os_switch), on two taps, and on MowBite OS the way back
// the same. what came of the last switch, after one to MowBite OS the way to its setup until that released the mower
function OsSwitchCard({
  s,
  locked,
  off,
  error,
  checkFailed,
  released,
  page,
  onSwitch,
  onModel,
}: {
  s: UpdateState;
  locked: boolean;
  off: boolean;
  error: string | null;
  checkFailed: boolean;
  released: boolean;
  page: string;
  onSwitch: (to: 'os' | 'openmower') => void;
  onModel: (key: string) => void;
}) {
  // the question asked, of the way there or back
  const [ask, setAsk] = useState<'os' | 'openmower' | null>(null);
  const lang = useLang();
  const models = useOsModels((osModelsOf(s) ?? []).join(','));
  const found = osSwitchOf(s);
  const left = osBackLeft(s);
  if (!found && !left) return null;
  // (the way back left halfway goes on first)
  const offer = left && found?.state === 'yes' ? null : found;
  const result = osResult(s);
  const on = offer?.state === 'on';
  const back = on || left;
  const answer = (to?: 'os' | 'openmower') => () => {
    setAsk(null);
    if (to) onSwitch(to);
  };
  const head = (
    <Head name="MowBite OS" tag={on ? {text: tr('In place of OpenMower'), look: local.badgeNew} : null} text={off ? undefined : PART_TEXT.os}>
      {on && (
        <>
          <span>{tr('Runs')}</span>
          <span>{tr('since {time}', {time: offer.since})}</span>
        </>
      )}
      {offer?.state === 'yes' && (
        <>
          <span>{tr('Download size')}</span>
          <span>{offer.size ?? tr('on the mower already')}</span>
          <span>{tr('OpenMower')}</span>
          <span>{offer.drop ? tr('deleted first, downloaded again on the way back') : tr('stays on the mower, stopped')}</span>
          <span>{tr('Map')}</span>
          <span>{offer.kept ? tr('its own from an earlier switch') : tr('taken from OpenMower')}</span>
        </>
      )}
    </Head>
  );
  if (off) return <OffCard id="os">{head}</OffCard>;
  const switched = on && (s.status.os ?? '').startsWith('switched ') && !released;
  // (the choice of the model while MowBite OS doesn't run, the switch only with one of those that fit)
  const choosing = !back && !!osModelsOf(s)?.length;
  const noModel = osModelMissing(s);
  const ready = offer?.state === 'yes' && !noModel ? offer : null;
  // (the updater holds the switch back only for the model: said by the line of the choice, the switch shown greyed)
  const waits = offer?.state === 'no' && offer.code === 'model' && choosing;
  const model = models?.models.find((m) => m.key === osModelOf(s));

  return (
    <article className={local.part} data-part="os">
      {head}
      {offer?.state === 'no' && !waits && <span className={local.dim}>{tr("MowBite OS can't take OpenMower's place right now: {why}.", {why: offer.why})}</span>}
      {switched && result ? (
        <Note look={os.info} title={tr('Next: its setup')}>
          {result.text} {tr('The mower drives only by remote control until its setup is done.')}
          <Link className={[local.control, local.primary].join(' ')} href="/setup">
            {tr('To the setup')}
          </Link>
        </Note>
      ) : (
        result && <LastTime r={result} />
      )}
      <Warn text={error} />
      {choosing && ask === null && <OsModelChoice s={s} list={models} locked={locked} onPick={onModel} />}
      {(offer?.state === 'yes' || waits) &&
        (ask === 'os' && ready ? (
          <Ask title={tr('Switch to MowBite OS?')} yes={tr('Switch')} locked={locked} onYes={answer('os')} onNo={answer()}>
            <p>
              {tr(IN_DOCK)} {tr('It takes a few minutes.')}
            </p>
            {model && <p>{tr('MowBite OS starts as {mower}.', {mower: platformWords({name: model.key, texts: model.texts}, lang).name})}</p>}
            <p>{tr('Before the first switch make a full image of the eMMC by hand. The updater keeps only the map and mower_params.yaml.')}</p>
            <p>
              {tr("Once OpenMower stops, MowBite on the mower stops too: from there the switch goes on on the updater's own page.")}{' '}
              <a href={page} target="_blank" rel="noreferrer">
                {page.split('/?')[0]}
              </a>
            </p>
            <p>
              {ready.drop
                ? tr("There isn't room for both: OpenMower's version and what's built on it, like the planner, are deleted first. The way back downloads them again, that needs the internet.")
                : tr('OpenMower stays on the mower, stopped: the way back starts it again.')}
            </p>
            <p>
              {ready.kept
                ? tr("MowBite OS keeps its own data from an earlier switch: what changed in OpenMower since then isn't taken.")
                : tr("MowBite OS takes OpenMower's map and mower_params.yaml, OpenMower's own stay as they are.")}
            </p>
            <p>{tr("If MowBite OS doesn't run as it should, OpenMower comes back by itself. If it runs, the mower drives only by remote control until its setup in the app is done.")}</p>
          </Ask>
        ) : (
          <>
            <span className={local.dim}>
              {noModel ? tr("Choose the mower first, then MowBite OS can take OpenMower's place.") : tr("MowBite OS can take OpenMower's place on this mower, the way back to OpenMower is the same.")}
            </span>
            <button className={local.control} disabled={locked || !ready} onClick={() => setAsk('os')}>
              {tr('Switch to MowBite OS')}
            </button>
          </>
        ))}
      {back &&
        (ask === 'openmower' ? (
          <Ask title={tr('Back to OpenMower?')} yes={tr('Back to OpenMower')} locked={locked} onYes={answer('openmower')} onNo={answer()}>
            {checkFailed && <p className={local.error}>{tr(UNLOCKED)}</p>}
            <p>{tr(IN_DOCK)}</p>
            <p>{tr("MowBite OS hands its map to OpenMower. What OpenMower can't take is lost, the result says so. If that doesn't work, OpenMower gets its map from before the switch.")}</p>
            {!!s.status.os_drop && <p>{tr("OpenMower's version was deleted for the switch, it's downloaded again: that needs the internet and takes a while.")}</p>}
            <p>{tr("If MowBite OS doesn't run any more, it goes back all the same, with OpenMower's map from before the switch.")}</p>
            <p>{tr("MowBite OS's own data stays on the mower for a later switch.")}</p>
          </Ask>
        ) : (
          <button className={local.control} disabled={locked} onClick={() => setAsk('openmower')}>
            {tr('Back to OpenMower')}
          </button>
        ))}
    </article>
  );
}

// on MowBite OS without the updater's status, where the updater can be next to it: the way back on its own page
const OsBackLink = ({page, checkFailed}: {page: string; checkFailed: boolean}) => (
  <article className={local.part} data-part="os">
    <Head name="MowBite OS" tag={{text: tr('In place of OpenMower'), look: local.badgeNew}} text={PART_TEXT.os} />
    <span className={local.dim}>{tr("The way back to OpenMower is on the MowBite Updater's own page, with the mower idle in the dock.")}</span>
    {checkFailed && <span className={local.error}>{tr(UNLOCKED)}</span>}
    <a className={local.control} href={page} target="_blank" rel="noreferrer">
      {tr('Back to OpenMower')}
    </a>
  </article>
);

// the updater itself: the commit it runs, whether there's a newer one and updating it
function UpdaterCard({
  info,
  s,
  locked,
  off,
  now,
  anyAuto,
  error,
  onUpdate,
}: {
  info: SelfInfo;
  s: UpdateState;
  locked: boolean;
  off: boolean;
  now: number;
  anyAuto: boolean;
  error: string | null;
  onUpdate: () => void;
}) {
  const tag = info.available ? tagOf(info.available, freshly(s, 'updater', now)) : null;
  const head = (
    <Head name={PART_NAMES.updater} tag={tag} text={off ? undefined : PART_TEXT.host}>
      <Facts running={info.running} channel={TAG_NAMES[info.tag] ?? info.tag} />
    </Head>
  );
  if (off) return <OffCard id="updater">{head}</OffCard>;
  return (
    <article className={local.part} data-part="updater">
      {head}
      {info.available === 'local' && <span className={local.dim}>{tr(FROM_REGISTRY)}</span>}
      {info.result && <LastTime r={info.result} />}
      <Warn text={error} />
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

// what can go to make room on the mower, deleted only when asked and confirmed: each image, all of them, the build cache.
// what it does with it right now where it was tapped: its look (room) or deleting (free:img:<id>, free:all, free:cache;
// the updater only says free:<what>)
function Room({
  s,
  busy,
  doing,
  error,
  now,
  onAsk,
}: {
  s: UpdateState;
  busy: boolean;
  doing: {word: string; since: number} | null;
  error: string | null;
  now: number;
  onAsk: (word: string, go: () => Promise<void>) => void;
}) {
  const {sure, confirm} = useSure();
  const items = s.room?.items ?? [];
  const cache = s.room?.cache ?? 0;
  const free = freeMb(s);
  const at = (word: string) => doing?.word === word;
  const busyLine = (label: string) => doing && <Busy label={label} detail={elapsed(doing.since, now)} />;
  const deleting = (word: string) => at(word) && busyLine(tr('Deleting…'));
  const button = (word: string, label: string, go: () => Promise<void>) => (
    <button className={[local.control, sure === word ? local.danger : ''].join(' ')} disabled={busy} onClick={() => confirm(word, () => onAsk(word, go))}>
      {sure === word ? tr('Really delete?') : label}
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
            {button(`free:img:${i.id}`, tr('Delete'), () => freeRoom({id: i.id}))}
          </div>
          {deleting(`free:img:${i.id}`)}
        </div>
      ))}
      {cache > 0 && (
        <div className={local.item}>
          <span className={local.itemName}>{tr('Build cache')}</span>
          <span className={local.dim}>{tr('The next build of the planner then takes 1–2 minutes longer and needs the internet (shapely is loaded again).')}</span>
          <div className={local.row}>
            <span className={local.dim}>{size(cache)}</span>
            {button('free:cache', tr('Empty it'), () => freeRoom('cache'))}
          </div>
          {deleting('free:cache')}
        </div>
      )}
      {!items.length && !cache && <span className={local.dim}>{tr('Nothing to delete right now.')}</span>}
      {at('room') && busyLine(tr('Looking what can go…'))}
      {/* (all of it, or an image asked for elsewhere: which one the updater doesn't say) */}
      {(at('free:all') || at('free:img')) && busyLine(tr('Deleting…'))}
      <Warn text={error} />
      <div className={local.row}>
        <button className={local.control} disabled={busy} onClick={() => onAsk('room', requestRoom)}>
          {tr('Look again')}
        </button>
        {roomLoose(s).length > 1 ? (
          button('free:all', tr('Delete all but the ways back ({size})', {size: size(roomTotal(roomLoose(s)))}), () => freeRoom('all'))
        ) : (
          <span />
        )}
      </div>
    </div>
  );
}

// a request as the updater notes it when it takes it (taken): now:<part>, now:all, back:<part>, nokeep:<part>, self,
// check, room, free:img|all|cache. here free:img:<id>, to show it at its image
type Asked = {word: string; at: number};

// where a request without an answer is said: on the card it was tapped on
function whereOf(word: string): string {
  const [k, v] = word.split(':');
  if (k === 'now' || k === 'back' || k === 'nokeep') return v;
  if (k === 'self') return 'updater';
  if (k === 'switch') return 'os';
  if (k === 'room' || k === 'free') return 'room';
  return 'top';
}

// the updater on the mower (lib/autoUpdate), laid out like MowBite OS's updates: how many there are, each part with
// what runs, whether there's something new, its channel and updating it now and at night, the run going on step by
// step where it was asked for, then when it updates by itself, the free space and the log. what's tapped shows at once
// and locks the buttons until the updater is done with it
export function AutoUpdate() {
  const om = useOpenMower();
  const platform = useOsPlatform();
  const setup = useSetup();
  const setupFailed = safetyFailed(setup);
  const [s, setS] = useState<UpdateState | null | undefined>(undefined);
  const [error, setError] = useState<{text: string; where: string} | null>(null);
  const [asked, setAsked] = useState<Asked | null>(null);
  // the container doesn't answer for a while (MowBite restarting after its update): what came last stays
  const [lost, setLost] = useState(false);
  // this device's clock, by the second while it's on something
  const [clock, setClock] = useState(() => Date.now() / 1000);
  const page = useUpdaterPageUrl();
  const theme = useThemeChoice();
  const container = useContainer();
  const fast = useRef(false);
  const restartingRef = useRef(false);
  // loads without an answer in a row: a moment without one in a weak wlan isn't one
  const misses = useRef(0);
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
    // (its own restart on a new version at once: it says so itself)
    const miss = () => {
      misses.current++;
      if (misses.current >= 2 || restartingRef.current) setLost(true);
    };
    const load = () => {
      const at = tapped.current;
      return loadUpdate()
        .then(
          (x) => {
            if (stop || at !== tapped.current) return;
            // the updater restarting on its new version answers nothing for a moment, one that answered before and
            // doesn't now (10 s and no answer) is out of reach: what came last stays, it isn't one never set up
            if (!x && (restartingRef.current || seenRef.current)) return miss();
            setS(x);
            misses.current = 0;
            setLost(false);
            if (x) seenRef.current = true;
            restartingRef.current = !!x && !!selfInfo(x)?.restarting;
            const on = !!x && working(x);
            fast.current = on;
            // (done with what was asked: an answer from after the request, which shows it asked or taken until then)
            if (!on) setAsked(null);
          },
          () => {
            if (stop) return;
            miss();
            setS((last) => (last === undefined ? null : last));
          },
        )
        // what it does shows up while the page is open, every 2 seconds while it's on something
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

  // the time on the bars, by the second while it's on something
  const on = !!s && (working(s) || asked !== null);
  useEffect(() => {
    if (!on) return;
    const tick = setInterval(() => setClock(Date.now() / 1000), 1000);
    return () => clearInterval(tick);
  }, [on]);

  // the updater's page: from MowBite's container, else next to MowBite
  const base = where || page;
  const pageLink = `${base}/?theme=${theme}`;
  if (s === undefined) return null;
  if (!s) {
    if (platform === UPDATER_PLATFORM) return <OsBackLink page={pageLink} checkFailed={setupFailed} />;
    if (isDemo()) return null;
    return container ? <AddUpdater /> : om ? <span className={local.dim}>{tr('Only when MowBite runs as its container on the mower.')}</span> : null;
  }

  const st = s;
  // the updater's times count by the mower's clock
  const now = clock + (st.skew ?? 0);
  const running = st.status.result === 'running';
  const self = selfInfo(st, now);
  const restarting = !!self?.restarting;
  const tk = taken(st, now);
  // what's asked: tapped here, or taken by the updater. since when, null when it isn't
  const words = [...(asked ? [asked.word] : []), ...(tk?.what ?? [])];
  const sinceOf = (word: string) => (asked?.word === word ? asked.at : tk?.what.includes(word) ? tk.since : null);
  const lookSince = lookingSince(st, now) ?? sinceOf('check');
  const checking = lookSince !== null;
  // a look alone locks only its own button: a request stops it, it looks again afterwards
  const busy = lost || st.requested || running || restarting || words.some((w) => w !== 'check');
  const errorAt = (place: string) => (error?.where === place ? error.text : null);

  const set = (patch: Record<string, string | number>, place: string, then?: () => void) => {
    const conf: UpdateConf = {...st.conf, ...patch};
    tapped.current++;
    setS({...st, conf});
    setError(null);
    saveUpdateConf(patch).then(then, () => setError({text: tr('Not saved, the mower did not answer.'), where: place}));
  };
  const ask = (word: string, go: () => Promise<void>) => {
    setAsked({word, at: mowerNow(s)});
    tapped.current++;
    fast.current = true;
    setError(null);
    // (a look started before the request arrived still saw none, it doesn't free the buttons)
    go().then(
      () => {
        tapped.current++;
      },
      () => {
        setAsked(null);
        setError({text: tr('The mower did not answer.'), where: whereOf(word)});
      },
    );
  };
  // another channel: looked for at once, what's new there shows
  const pick = (part: Part) => (patch: Record<string, string | number>) => set(patch, part, () => ask('check', requestCheck));
  const parts = partsOf(st);
  const anyAuto = parts.some((p) => st.conf[`${p.id}_auto`] === 1);
  const days = st.conf.days === 'daily' ? [] : st.conf.days.split(',').map(Number);
  const toggleDay = (d: number) => {
    const next = days.includes(d) ? days.filter((x) => x !== d) : [...days, d].sort();
    // the last day taken away would be every night: that day stays, off is the switch of each app
    if (!next.length) return;
    set({days: next.length < 7 ? next.join(',') : 'daily'}, 'schedule');
  };
  const log = [...st.log].reverse().join('\n');

  // the run to show: its step now, the updater's restart on its new version, or one asked for that it hasn't begun yet
  // (from the tap on). its getting ready counted from the tap
  const queue = runParts(st);
  const tapAt = (part: Part) => sinceOf(part === 'updater' ? 'self' : `now:${part}`) ?? sinceOf('now:all');
  const asRun = (part: Part, step: Progress['step'], since: number): Progress => ({part, step, pct: null, since});
  let current: Progress | null = progressOf(st) ?? (self?.restarting ? asRun('updater', 'restart', self.restarting) : null);
  if (!current && running && queue.length) current = asRun(queue[0], words.includes(`back:${queue[0]}`) ? 'back' : 'prepare', tapAt(queue[0]) ?? 0);
  for (const w of words) {
    if (current) break;
    const [k, v] = w.split(':');
    const t = sinceOf(w) ?? 0;
    if (k === 'self') current = asRun('updater', 'prepare', t);
    else if (k === 'now' && v === 'all') current = asRun('', 'prepare', t);
    else if ((k === 'now' || k === 'nokeep') && v) current = asRun(v, 'prepare', t);
    else if (k === 'back' && v) current = asRun(v, 'back', t);
    else if (k === 'switch') current = asRun('os', v === 'openmower' ? 'export' : 'prepare', t);
  }
  if (current?.step === 'prepare' && current.part) {
    const t = tapAt(current.part);
    if (t && (!current.since || t < current.since)) current = {...current, since: t};
  }
  // all of them asked for: the run where that button was, else on the card of the part
  const all = !!current && (words.includes('now:all') || queue.length > 1 || !current.part);
  // (taken back as asked: the updater says so only until its run begins, this page until it's done)
  const askedBack = !!current && words.includes(`back:${current.part}`);
  const back = askedBack || current?.step === 'back';
  const nameOf = (part: Part) => (part ? partName(st, part) : tr('Everything'));
  // (a switch to MowBite OS or back)
  const way = current?.part === 'os' ? osWayOf(st, current, words.find((w) => w.startsWith('switch:'))) : undefined;
  const doing = current
    ? (running && runResult(st)) ||
      (way ? osHead(way) : runTitle(nameOf(current.part), back))
    : null;
  const run = current && (
    <Running
      s={st}
      p={current}
      name={nameOf(current.part)}
      now={now}
      asked={askedBack}
      follow={asked !== null}
      way={way}
      away={!!way && (lost || osOnItsPage(st, current, way))}
      page={pageLink}
    >
      {current.part === 'updater' && self?.restarting && (
        <Note look={os.info} title={tr('Restarting the updater, this comes back by itself')}>
          {tr("For a few seconds nothing arrives here. That's no error, the mower drives and mows on as usual.")}
        </Note>
      )}
      {lost && current.part === 'mowbite' && <span className={local.dim}>{tr('MowBite does not answer for a moment, it may be restarting.')}</span>}
    </Running>
  );
  const roomWord = words.find((w) => w === 'room' || w.startsWith('free:'));
  const roomDoing = roomWord ? {word: roomWord, since: sinceOf(roomWord) ?? 0} : null;

  const count =
    parts.filter((p) => p.kind !== 'local' && p.kind !== 'os' && isNew(partInfo(st, p.id).available)).length + (self?.available === 'yes' ? 1 : 0);
  // MowBite on the mower is another version than this page: after its update, the page needs loading again
  const onMower = (st.status.mowbite_running ?? '').split(' ')[0];
  // (only the mower this page comes from: another one picked can run another version for good)
  const reload = pageFromMower() && !isDemo() && !running && /^\d/.test(onMower) && onMower !== APP_VERSION;
  const since = silentSince(st);
  const waited = !current && !running && runResult(st);

  return (
    <div className={local.panel}>
      {/* (one part's update says so on its card, like MowBite OS's view) */}
      {(!current || all) && (
        <Summary
          count={count}
          doing={doing}
          checked={lastChecked(st)}
          locked={busy || checking}
          checking={checking}
          onCheck={() => ask('check', requestCheck)}
        />
      )}
      {lookSince !== null && !current && <Busy label={tr('Looking for updates')} detail={elapsed(lookSince, now)} />}
      {busy && !current && !roomDoing && !lost && <span className={local.dim}>{tr('asked, within a minute…')}</span>}
      {waited && <Note look={local.warn}>{waited}</Note>}
      {lost && !restarting && current?.part !== 'mowbite' && !way && (
        <span className={local.warn}>{tr('No connection to the updater, shown is what it said last.')}</span>
      )}
      {!lost && !updaterAlive(st) && !isDemo() && (
        <span className={local.warn}>
          {since
            ? tr("The updater hasn't given a sign of life since {t}, it may hang or be restarting. Shown is what it said last.", {t: since})
            : tr("The updater doesn't give a sign of life, it may hang or be restarting.")}
        </span>
      )}
      <Warn text={errorAt('top')} />

      <OutOfReachNote s={st} />

      <div className={os.parts}>
        {parts.map((p) =>
          p.id === current?.part && !all ? (
            <div key={p.id} className={os.wide}>
              {run}
            </div>
          ) : (
            <PartCard
              key={p.id}
              p={p}
              s={st}
              locked={busy}
              off={!!current}
              queued={!!current && queue.indexOf(p.id) > queue.indexOf(current.part)}
              now={now}
              error={errorAt(p.id)}
              onConf={(patch) => set(patch, p.id)}
              onChannel={pick(p.id)}
              onUpdate={() => ask(`now:${p.id}`, () => requestUpdate(p.id))}
              onBack={() => ask(`back:${p.id}`, () => requestBack(p.id))}
              onNoKeep={() => ask(`nokeep:${p.id}`, () => requestNoKeep(p.id))}
            >
              {p.id === 'mowbite' && reload && <ReloadNote v={onMower} page={APP_VERSION} />}
            </PartCard>
          ),
        )}
        {way ? (
          <div className={os.wide}>{run}</div>
        ) : (
          <OsSwitchCard
            s={st}
            locked={busy}
            off={!!current}
            error={errorAt('os')}
            checkFailed={setupFailed || st.status.os_safety === 'check_failed'}
            released={!!setup?.safety.open}
            page={pageLink}
            onSwitch={(to) => ask(`switch:${to}`, () => requestSwitch(to))}
            onModel={(key) => set({os_model: key}, 'os', () => ask('check', requestCheck))}
          />
        )}
        {self &&
          (current?.part === 'updater' && !all ? (
            <div className={os.wide}>{run}</div>
          ) : (
            <UpdaterCard
              info={self}
              s={st}
              locked={busy}
              off={!!current}
              now={now}
              anyAuto={anyAuto}
              error={errorAt('updater')}
              onUpdate={() => ask('self', requestSelf)}
            />
          ))}
      </div>
      {all && run}
      {current && <span className={local.dim}>{tr('The other parts can only be changed after it: always one update after the other.')}</span>}
      {!current && count > 1 && (
        <button className={local.control} disabled={busy} onClick={() => ask('now:all', () => requestUpdate())}>
          {tr('Update all')}
        </button>
      )}
      <Warn text={errorAt('all')} />

      {anyAuto && !current && (
        <div className={local.part}>
          <span className={local.name}>{tr('When it updates by itself')}</span>
          <div className={os.window}>
            <span className={local.dim}>{tr('at')}</span>
            <input
              className={local.control}
              type="time"
              aria-label={tr('At')}
              value={st.conf.at}
              onChange={(e) => e.target.value && set({at: e.target.value}, 'schedule')}
            />
            <label className={local.check}>
              <input type="checkbox" checked={st.conf.days === 'daily'} onChange={(e) => set({days: e.target.checked ? 'daily' : '7'}, 'schedule')} />
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
          <Warn text={errorAt('schedule')} />
        </div>
      )}

      <Room s={st} busy={busy} doing={roomDoing} error={errorAt('room')} now={now} onAsk={ask} />

      {base && !isDemo() && (
        <span className={local.dim}>
          {tr('More on its own page, like adding apps, their logs and putting data back:')}{' '}
          <a href={pageLink} target="_blank" rel="noreferrer">
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
