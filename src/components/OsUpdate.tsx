'use client';

import {useRpcMethods} from '@/hooks/useRpcMethods';
import {clock, dayClock, nearClock, numericDay, numericDayClock} from '@/lib/dates';
import {reasonSentence} from '@/lib/events';
import {tr} from '@/lib/i18n';
import {pageFromMower} from '@/lib/mowers';
import {isApp} from '@/lib/native';
import {RPC, UPDATE_GATED} from '@/lib/openmower';
import {
  abortUpdate,
  appTooOld,
  askUpdateStatus,
  checkUpdates,
  goingBack,
  netLook,
  nextByItself,
  partVersion,
  rollBack,
  runSteps,
  runTarget,
  runsByItself,
  setAutoUpdate,
  setChannel,
  shortRevision,
  startUpdate,
  updating,
  useHostOnline,
  useUpdateStatus,
  versionInText,
  versionLabel,
  versionName,
  wentBackByHand,
  withoutJobWait,
  type Auto,
  type Available,
  type Channel,
  type Component,
  type Last,
  type Origin,
  type Step,
  type UpdateStatus,
} from '@/lib/osUpdate';
import {answerError} from '@/lib/rpcText';
import {APP_VERSION, FROM_STORE} from '@/lib/updates';
import Link from 'next/link';
import {useEffect, useRef, useState} from 'react';
import shared from './AutoUpdate.module.css';
import styles from './OsUpdate.module.css';
import {Ask, HOUR, Head, Note, OffCard, PART_TEXT, RIGHT_AWAY, ReloadNote, RunHead, Steps, Summary} from './updateParts';

// what each part's update asks of the mower. A part a newer MowBite OS adds has none
const HINTS: Record<string, string> = {
  os: 'The mower has to stand ready in the dock for this. MowBite OS restarts, that takes a few minutes.',
  planner: 'The mower has to stand ready in the dock for this, MowBite OS restarts. A mowing job that was started is mowed to the end first.',
  app: RIGHT_AWAY,
  host: "Works right away, the mower doesn't have to stand in the dock. For a few seconds the updater doesn't answer then.",
};

// a step of an update: still to come or going on, and once it's done
const STEPS: Record<Step, {label: string; title: string; done?: string}> = {
  verifying: {label: 'Checking the update', title: 'Checked', done: 'Where it comes from and its signature are right.'},
  unpacking: {label: 'Unpacking', title: 'Unpacked'},
  waiting_gate: {label: 'Waiting for the mower', title: 'Mower stands ready in the dock'},
  switching: {label: 'Switching', title: 'Switched'},
  checking: {label: 'Check', title: 'Check'},
};

// a reason of the updater in words, as a sentence
const why = (reason: string, type = 'UPDATE') => reasonSentence(reason, type);

// the app is older than a version needs: which one to update first, by where this one comes from
function appFirst(min: string): string {
  const vars = {min, v: APP_VERSION};
  if (isApp())
    return FROM_STORE
      ? tr('Needs MowBite {min} or newer, this app is {v}. Update it in the Play Store first.', vars)
      : tr('Needs MowBite {min} or newer, this app is {v}. Update it under "This app" first.', vars);
  return pageFromMower()
    ? tr('Needs MowBite {min} or newer, this page is {v}. Update the MowBite App first.', vars)
    : tr('Needs MowBite {min} or newer, this page is {v}. Update the MowBite it comes from first.', vars);
}

// how the last update ended when it didn't go through, in a box
function Result({last, name}: {last: Last; name: string}) {
  const box = (look: string, title: string, more?: string) => (
    <Note look={look} title={title}>
      {last.reason && why(last.reason)}
      {more && ` ${more}`}
      <small>{nearClock(last.t)}</small>
    </Note>
  );
  if (last.result === 'rolled_back')
    return box(shared.error, tr('{name}: update taken back', {name}), tr("You don't have to do anything, it runs as before."));
  if (last.result === 'failed') return box(shared.error, tr('{name}: update failed', {name}));
  if (last.result === 'refused') return box(shared.warn, tr('{name}: update not installed', {name}), tr('Everything stays as it is.'));
  return null;
}

// what waits at the gate and how it goes on
function GateNote({reason}: {reason: string}) {
  if (reason === 'JOB_OPEN')
    return (
      <Note look={shared.warn} title={tr('A mowing job is still open.')}>
        {tr(
          "The update goes on as soon as it's mowed to the end. You can also install it right away, then the area that was started begins anew at the next mowing.",
        )}
      </Note>
    );
  return (
    <Note look={shared.warn} title={why(reason)}>
      {reason === 'BUSY'
        ? tr("The update goes on as soon as it's done and stands ready in the dock. You can also send it home.")
        : tr('The update goes on as soon as the mower stands ready in the dock.')}
    </Note>
  );
}

// the mark of a part: held back and how, something new, just updated or up to date
function tagOf(a: Available | null, fresh: boolean): {text: string; look: string} {
  const b = a?.blocked;
  if (b) return {text: b.result === 'rolled_back' ? tr('Taken back') : b.result === 'failed' ? tr('Failed') : tr('Held back'), look: shared.badgeBad};
  if (a) return {text: tr('Update available'), look: shared.badgeNew};
  return fresh ? {text: tr('Just updated'), look: shared.badgeNew} : {text: tr('Up to date'), look: ''};
}

// the update going on: its steps, why it waits, and the way out while there is one
function Running({
  s,
  c,
  busy,
  onAbort,
  onSkipJob,
}: {
  s: UpdateStatus;
  c: Component;
  busy: boolean;
  onAbort: () => void;
  onSkipJob: () => void;
}) {
  const {steps, now} = runSteps(s);
  const back = goingBack(s);
  const target = runTarget(s);
  const gated = steps.includes('waiting_gate');
  const switched = s.phase === 'switching' || s.phase === 'checking';
  const held = s.phase === 'waiting_gate' && !!s.reason;

  const detail = (step: Step) => {
    if (step === 'waiting_gate' && held)
      return (
        <>
          <GateNote reason={s.reason!} />
          <small>
            {runsByItself(s)
              ? tr('It waits for 30 minutes at most, not beyond the time window. After that it gives up and everything stays as it is.')
              : tr('It waits for 30 minutes at most. After that it gives up and everything stays as it is.')}
          </small>
        </>
      );
    if (step === 'switching' && gated) return <small>{tr("MowBite OS restarts. The mower stays in the dock, the app's displays stand still that long.")}</small>;
    if (step === 'checking')
      return (
        <small>
          {c.id === 'host'
            ? tr('The new version has to run for a minute, then it stays. Else the host goes back to the one before by itself.')
            : tr('The mower checks whether the new version runs properly.')}
        </small>
      );
    return null;
  };

  return (
    <div className={styles.run} data-update={c.id}>
      <RunHead name={c.name} back={back} sub={target && tr('to {v}', {v: versionLabel(target)})} />
      <Steps
        steps={steps.map((step, i) => ({
          key: step,
          label: tr(STEPS[step].label),
          title: tr(STEPS[step].title),
          more: i < now ? STEPS[step].done && <small>{tr(STEPS[step].done!)}</small> : detail(step),
        }))}
        now={now}
        held={held}
      />
      {switched && gated && (
        <Note look={styles.info} title={tr("Don't do anything now, don't switch the mower off.")}>
          {tr("Cancelling isn't possible from here on. If the new version doesn't run properly, the mower goes back to the one before by itself.")}
        </Note>
      )}
      {switched && c.id === 'host' && (
        <Note look={styles.info} title={tr('The host is restarting.')}>
          {tr("For a few seconds nothing arrives here. That's no error, the mower drives and mows on as usual.")}
        </Note>
      )}
      {held && s.reason === 'JOB_OPEN' && (
        <button className={shared.control} disabled={busy} onClick={onSkipJob}>
          {tr("Don't wait for the job")}
        </button>
      )}
      {!switched && (
        <>
          <div className={shared.row}>
            <button className={shared.control} disabled={busy} onClick={onAbort}>
              {tr('Cancel')}
            </button>
            <Link href="/" className={[shared.control, styles.link].join(' ')}>
              {tr('To the overview')}
            </Link>
          </div>
          <span className={shared.dim}>{tr('Cancelling works until the switch.')}</span>
        </>
      )}
    </div>
  );
}

// one part of the software on the mower: what runs, what's new, updating it, and in the details the way back
function Part({
  c,
  fresh,
  locked,
  off,
  onStart,
  onBack,
}: {
  c: Component;
  // its update went through within the last hour
  fresh: boolean;
  // nothing can be started now
  locked: boolean;
  // another part updates, this one only shows what runs
  off: boolean;
  onStart: (revision?: string) => void;
  onBack: (resetJobs: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const [ask, setAsk] = useState<'back' | 'anyway' | null>(null);
  const [resetJobs, setResetJobs] = useState(false);
  const {available: a, running, previous} = c;
  const blocked = a?.blocked ?? null;
  const tooOld = appTooOld(a);
  // the mower runs another version of the app than this page shows
  const reload = c.id === 'app' && pageFromMower() && !!running?.version && running.version !== APP_VERSION;

  const tag = tagOf(a, fresh);
  const text = PART_TEXT[c.id];
  const hint = HINTS[c.id];
  const answer = (go?: () => void) => () => {
    setAsk(null);
    go?.();
  };

  const head = (
    <Head name={c.name} tag={tag} text={off ? undefined : text}>
      <span>{tr('Runs')}</span>
      <span>
        {!running
          ? tr('nothing yet')
          : c.source === 'bundled'
            ? tr('{v}, came with MowBite OS', {v: running.version ?? versionLabel(running)})
            : versionLabel(running)}
      </span>
      {a && (
        <>
          <span>{tr('New')}</span>
          <span>
            {blocked ? versionLabel(a) : <b>{versionLabel(a)}</b>}
            {a.from === 'net' && <small className={shared.dim}>{` ${tr('from the net')}`}</small>}
          </span>
        </>
      )}
    </Head>
  );
  if (off) return <OffCard id={c.id}>{head}</OffCard>;

  return (
    <article className={shared.part} data-part={c.id}>
      {head}
      {c.own_skipped && (
        <div className={shared.warn}>
          {tr("Your own version ({rev}) isn't used.", {rev: shortRevision(c.own_skipped.revision)})} {why(c.own_skipped.reason)}{' '}
          {tr('The one MowBite OS brought along runs.')}
        </div>
      )}
      {reload && <ReloadNote v={running.version!} page={APP_VERSION} />}
      {blocked && (
        <div className={shared.warn}>
          {blocked.reason === 'ROLLED_BACK_BY_HAND'
            ? `${why(blocked.reason)}${blocked.result ? ` ${tr('A newer one is.')}` : ''}`
            : `${blocked.result ? tr("This version isn't installed by itself any more, a newer one is.") : tr("This version isn't installed by itself.")} ${why(blocked.reason)}`}
        </div>
      )}
      {a && tooOld && <div className={shared.warn}>{appFirst(a.min_app!)}</div>}
      {a && !blocked && !tooOld && hint && <span className={shared.dim}>{tr(hint)}</span>}
      {a && !blocked && (
        <button className={[shared.control, shared.primary].join(' ')} disabled={locked || tooOld} onClick={() => onStart()}>
          {tr('Update')}
        </button>
      )}
      {blocked && ask !== 'anyway' && (
        <button className={shared.control} disabled={locked || tooOld} onClick={() => setAsk('anyway')}>
          {tr('Install anyway')}
        </button>
      )}
      {a && ask === 'anyway' && (
        <Ask
          title={tr('Install {what} anyway?', {what: partVersion(c.name, a)})}
          yes={tr('Install anyway')}
          locked={locked}
          onYes={answer(() => onStart(a.revision))}
          onNo={answer()}
        >
          <p>{tr("If it doesn't run properly, the mower goes back to the version before by itself.")}</p>
        </Ask>
      )}

      <button className={styles.more} aria-expanded={open} onClick={() => setOpen(!open)}>
        {tr('Details and the version before')}
      </button>
      {open && running && (
        <>
          <div className={styles.facts}>
            {c.installed_at !== null && (
              <>
                <span>{tr('Installed')}</span>
                <span>{numericDayClock(c.installed_at)}</span>
              </>
            )}
            <span>{tr('Revision')}</span>
            <span>{shortRevision(running.revision)}</span>
            {previous && (
              <>
                <span>{tr('Version before')}</span>
                <span>{versionLabel(previous)}</span>
              </>
            )}
          </div>
          {c.crashes_since_install > 0 && <div className={shared.warn}>{tr('Crashes since this update: {n}.', {n: c.crashes_since_install})}</div>}
          {!previous && <span className={shared.dim}>{why('NO_PREVIOUS', 'UPDATE_REFUSED')}</span>}
          {previous && ask !== 'back' && (
            <>
              <span className={shared.dim}>{tr('Something is wrong since the last update? Then go back to {v}.', {v: versionInText(previous)})}</span>
              <button className={shared.control} disabled={locked} onClick={() => setAsk('back')}>
                {tr('Back to the version before')}
              </button>
            </>
          )}
          {previous && ask === 'back' && (
            <Ask
              title={tr('Back to {what}?', {what: partVersion(c.name, previous)})}
              yes={tr('Back to {v}', {v: versionName(previous)})}
              locked={locked}
              onYes={answer(() => onBack(resetJobs))}
              onNo={answer()}
            >
              {UPDATE_GATED.includes(c.id) && (
                <p>
                  {tr('The mower has to stand ready in the dock for this.')}
                  {c.id === 'planner' && ` ${tr('A mowing job that was started is mowed to the end first.')}`}
                </p>
              )}
              {c.id === 'planner' && (
                <label className={shared.check}>
                  <input type="checkbox" checked={resetJobs} onChange={(e) => setResetJobs(e.target.checked)} />
                  <span>{tr("Don't wait for the mowing job. The area that was started begins anew afterwards.")}</span>
                </label>
              )}
              <p>
                {running.version || !running.date
                  ? tr("{v} isn't installed by itself afterwards. You can put it back here at any time.", {v: versionName(running)})
                  : tr("The version of {day} isn't installed by itself afterwards. You can put it back here at any time.", {day: numericDay(running.date)})}
              </p>
            </Ask>
          )}
        </>
      )}
    </article>
  );
}

// the release index on the net: stable releases only or previews too, and how the last look at it went
function Net({origin, canPick, locked, onPick}: {origin: Origin; canPick: boolean; locked: boolean; onPick: (c: Channel) => void}) {
  const look = netLook(origin);
  return (
    <div className={shared.part} data-net>
      <span className={shared.name}>{tr('Updates from the net')}</span>
      {canPick && (
        <select
          className={shared.control}
          aria-label={tr('Channel')}
          value={origin.channel}
          disabled={locked}
          onChange={(e) => onPick(e.target.value as Channel)}
        >
          <option value="stable">{tr('Stable only')}</option>
          <option value="preview">{tr('Previews too')}</option>
        </select>
      )}
      <span className={look.bad ? shared.warn : shared.dim} title={origin.message ?? undefined}>
        {look.text}
        {look.at !== undefined && <small>{` ${nearClock(look.at)}`}</small>}
      </span>
      <span className={shared.dim}>
        {tr('The mower looks now and then and when you check, and only downloads. Installing is up to you or the automatic update.')}
      </span>
    </div>
  );
}

// the updates of a mower with MowBite OS (lib/osUpdate): each part with what runs and what's new, the update going on
// step by step, the automatic one at night and how the last one ended
export function OsUpdate() {
  const seen = useUpdateStatus();
  const online = useHostOnline() !== false;
  const methods = useRpcMethods();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unanswered, setUnanswered] = useState(false);
  const [checked, setChecked] = useState<number | null>(null);
  // the window as typed, until the mower has it: kept while a save is on its way
  const [typed, setTyped] = useState<Partial<Auto>>({});
  // the channel picked, until the mower has it
  const [picked, setPicked] = useState<Channel | null>(null);
  const saving = useRef(0);

  useEffect(() => {
    askUpdateStatus().catch(() => setUnanswered(true));
  }, []);

  if (!seen) return unanswered ? <span className={shared.dim}>{tr('The mower did not answer.')}</span> : null;
  const {status: s, at} = seen;
  const run = (go: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    go()
      .catch((e) => setError(answerError(e)))
      .finally(() => setBusy(false));
  };
  const auto = {...s.auto, ...typed};
  const saveAuto = (patch: Partial<Auto>) => {
    setTyped({...typed, ...patch});
    saving.current++;
    run(() => setAutoUpdate(patch).finally(() => --saving.current || setTyped({})));
  };

  const now = updating(s);
  const locked = busy || !online || s.phase !== 'idle';
  // one held back isn't counted, it's only installed when asked
  const count = s.components.filter((c) => c.available && !c.available.blocked).length;
  const next = nextByItself(s);
  const last = s.last;
  const lastName = last && (s.components.find((c) => c.id === last.component)?.name ?? last.component);
  const freshId = last?.result === 'installed' && at - last.t < HOUR ? last.component : null;

  return (
    <div className={shared.panel}>
      {now ? (
        <Running
          s={s}
          c={now}
          busy={busy}
          onAbort={() => run(abortUpdate)}
          onSkipJob={() => run(() => withoutJobWait(s))}
        />
      ) : (
        <Summary count={count} checked={checked === null ? null : clock(checked)} locked={locked} onCheck={() => run(() => checkUpdates().then(() => setChecked(Date.now() / 1000)))} />
      )}
      {!online && <span className={shared.dim}>{tr("The mower's updater doesn't answer right now, shown is what it said at {t}.", {t: clock(at)})}</span>}
      {error && <span className={shared.warn}>{error}</span>}
      {!now && last && <Result last={last} name={lastName!} />}

      <div className={styles.parts}>
        {s.components
          .filter((c) => c !== now)
          .map((c) => (
            <Part
              key={c.id}
              c={c}
              fresh={c.id === freshId}
              locked={locked}
              off={!!now}
              onStart={(revision) => run(() => startUpdate(c.id, revision ? {revision} : {}))}
              onBack={(resetJobs) => run(() => rollBack(c.id, resetJobs))}
            />
          ))}
      </div>
      {now && <span className={shared.dim}>{tr('The other parts can only be changed after it: always one update after the other.')}</span>}

      {!now && s.origin?.url && (
        <Net
          origin={{...s.origin, ...(picked && {channel: picked})}}
          canPick={!!methods?.has(RPC.updateSetChannel)}
          locked={busy || !online}
          onPick={(c) => {
            setPicked(c);
            run(() => setChannel(c).finally(() => setPicked(null)));
          }}
        />
      )}

      {!now && (
        <div className={shared.part}>
          <label className={shared.check}>
            <input type="checkbox" checked={auto.enabled} disabled={busy || !online} onChange={(e) => saveAuto({enabled: e.target.checked})} />
            {tr('Update automatically at night')}
          </label>
          {auto.enabled && (
            <div className={styles.window}>
              <span className={shared.dim}>{tr('between')}</span>
              <input
                className={shared.control}
                type="time"
                aria-label={tr('From')}
                value={auto.from}
                onChange={(e) => e.target.value && saveAuto({from: e.target.value})}
              />
              <span className={shared.dim}>{tr('and')}</span>
              <input
                className={shared.control}
                type="time"
                aria-label={tr('To')}
                value={auto.to}
                onChange={(e) => e.target.value && saveAuto({to: e.target.value})}
              />
            </div>
          )}
          <span className={shared.dim}>
            {tr(
              "Only when the mower stands ready in the dock. Each update is tried at most once a night. If a new version doesn't run properly, the mower goes back to the one before by itself.",
            )}
          </span>
          {auto.enabled && (next || s.components.some((c) => c.available?.blocked?.result)) && (
            <span className={shared.dim}>
              <b>{tr('Next in line:')}</b>{' '}
              {next ? `${next.name}.` : tr("nothing. The automatic update doesn't install a version again that was taken back or failed, a newer one it does.")}
            </span>
          )}
        </div>
      )}

      {!now && last && (last.result === 'installed' || last.result === 'aborted') && (
        <span className={shared.dim}>
          {tr('Last time ({when}): {what}', {
            when: dayClock(last.t),
            what:
              last.result === 'aborted'
                ? tr('update of {name} cancelled.', {name: lastName!})
                : wentBackByHand(s)
                  ? tr('{name} went back to the version before.', {name: lastName!})
                  : tr('{name} updated.', {name: lastName!}),
          })}
        </span>
      )}
    </div>
  );
}
