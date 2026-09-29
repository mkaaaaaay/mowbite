'use client';

import {devBuild} from '@/lib/build';
import {copyText} from '@/lib/clipboard';
import {clock} from '@/lib/dates';
import {tr} from '@/lib/i18n';
import {rosLogAround, rosLogStatus, type RosLogLine} from '@/lib/roslog';
import Link from 'next/link';
import {useEffect, useState} from 'react';
import styles from './RosLog.module.css';
import box from './Updates.module.css';

const HELPER_URL = 'https://raw.githubusercontent.com/mkaaaaaay/mowbite/main/host/mowbite-roslog.sh';
const STEPS = {
  get: `mkdir -p ~/bin && curl -fsSL ${HELPER_URL} -o ~/bin/mowbite-roslog.sh && chmod +x ~/bin/mowbite-roslog.sh && ~/bin/mowbite-roslog.sh`,
  cron: `(crontab -l 2>/dev/null | grep -v mowbite-roslog; echo '* * * * * $HOME/bin/mowbite-roslog.sh') | crontab -`,
  mount: '- /home/openmower/ros/mowbite-roslog:/ros-log:ro',
  restart: 'docker compose up -d',
};

// minutes: since the helper last ran, rpc: the mower keeps the log itself
type Status = {available: boolean; minutes?: number; rpc?: boolean} | null | undefined;

function useRosLogStatus(): Status {
  const [status, setStatus] = useState<Status>(undefined);
  useEffect(() => {
    void rosLogStatus().then((s) =>
      setStatus(
        s && {
          available: s.available,
          minutes: s.alive ? Math.round((Date.now() / 1000 - s.alive) / 60) : undefined,
          rpc: s.rpc,
        },
      ),
    );
  }, []);
  return status;
}

function Command({text}: {text: string}) {
  const [copied, setCopied] = useState(false);
  return (
    <div className={box.command}>
      <code>{text}</code>
      <button
        className={box.button}
        onClick={() => {
          copyText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
      >
        {copied ? tr('copied') : tr('Copy')}
      </button>
    </div>
  );
}

// settings: whether the helper is there, and how to set it up
// only in dev builds for now, a mower that answers logs.recent doesn't need the helper
export function RosLogSettings({cardClass}: {cardClass: string}) {
  const status = useRosLogStatus();
  if (!devBuild || status === undefined) return null;
  if (status?.rpc)
    return (
      <section className={cardClass} id="roslog">
        <h2>{tr('ROS log')}</h2>
        <p className={box.versions}>
          {tr('Your OpenMower keeps the last warnings and errors itself, nothing to set up. They are gone after a restart of the mower.')}
        </p>
      </section>
    );
  const minutes = status?.minutes ?? null;

  return (
    <section className={cardClass} id="roslog">
      <h2>{tr('ROS log')}</h2>
      <p className={box.versions}>
        {tr('Shows what ROS reported around a problem on the activity page, e.g. why the mower stopped. Only warnings and errors are kept, passwords and logins are blanked out before anything is written.')}
      </p>
      {status === null && <p className={box.versions}>{tr('Only when MowBite runs as its container on the mower.')}</p>}
      {status?.available && (
        <>
          <p className={box.versions}>{tr('Set up, the helper on the mower last ran {n} min ago.', {n: minutes ?? '?'})}</p>
          {minutes !== null && minutes > 10 && (
            <p className={styles.stale}>{tr("That's a while ago, check the cron job on the mower (step 2 below).")}</p>
          )}
        </>
      )}
      {status && (!status.available || (minutes !== null && minutes > 10)) && (
        <ol className={styles.guide}>
          <li>
            {tr('On the mower (SSH, as the openmower user), get the helper and run it once:')}
            <Command text={STEPS.get} />
          </li>
          <li>
            {tr('Let it run every minute:')}
            <Command text={STEPS.cron} />
          </li>
          <li>
            {tr('In the compose.yaml of MowBite, add this line under volumes (or remove the # in front of it):')}
            <Command text={STEPS.mount} />
            <span className={box.versions}>{tr("Change the path if OpenMower doesn't live in /home/openmower.")}</span>
          </li>
          <li>
            {tr('Restart MowBite, in the mowbite folder:')}
            <Command text={STEPS.restart} />
          </li>
        </ol>
      )}
    </section>
  );
}

// next to a problem on the activity page
export function RosLogAround({t}: {t: number}) {
  const status = useRosLogStatus();
  const [open, setOpen] = useState(false);
  const [lines, setLines] = useState<RosLogLine[] | null | 'failed'>(null);

  // the helper is only offered in dev builds, the log from the mower itself everywhere
  if (status === undefined || status === null || (!devBuild && !status.rpc)) return null;
  if (!status.available)
    return (
      <Link className={styles.link} href="/settings#roslog">
        {tr('Set up the ROS log')}
      </Link>
    );

  const toggle = () => {
    setOpen(!open);
    if (!open && lines === null) void rosLogAround(t).then(setLines, () => setLines('failed'));
  };

  return (
    <>
      <button className={styles.link} onClick={toggle}>
        {open ? tr('Hide ROS log') : tr('ROS log')}
      </button>
      {open && (
        <div className={styles.log}>
          {lines === null && <span>{tr('loading…')}</span>}
          {lines === 'failed' && <span>{tr('failed')}</span>}
          {Array.isArray(lines) && lines.length === 0 && (
            <span>
              {status.rpc
                ? tr("Nothing around that time in the mower's memory. It keeps the last 1000 warnings and errors, until it restarts.")
                : tr('ROS reported nothing around that time.')}
            </span>
          )}
          {Array.isArray(lines) &&
            lines.map((l, i) => (
              <span key={i} className={[styles[l.level], Math.abs(l.t - t) < 2 ? styles.at : ''].join(' ')}>
                {clock(l.t, true)} {l.level} {l.text}
              </span>
            ))}
        </div>
      )}
    </>
  );
}
