'use client';

import {tr} from '@/lib/i18n';
import type {ReactNode} from 'react';
import shared from './AutoUpdate.module.css';
import styles from './OsUpdate.module.css';

// what a part of the software on the mower is, by MowBite OS's id. the updater's ids map onto them
export const PART_TEXT: Record<string, string> = {
  os: 'The software that drives the mower and mows.',
  planner: 'Plans the lanes on your areas and the ways between them.',
  app: 'The interface the mower shows in the browser.',
  host: 'The service on the mower that checks for updates and installs them.',
};

export const Tick = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M5 12l5 5 9-10" />
  </svg>
);

// a box with its headline
export const Note = ({look, title, children}: {look: string; title?: ReactNode; children: ReactNode}) => (
  <span className={[look, styles.note].join(' ')}>
    {title && <b>{title}</b>}
    {children}
  </span>
);

// asked before going back or installing what was held back
export function Ask({title, yes, locked, onYes, onNo, children}: {title: string; yes: string; locked: boolean; onYes: () => void; onNo: () => void; children: ReactNode}) {
  return (
    <div className={styles.ask}>
      <h3>{title}</h3>
      {children}
      <div className={shared.row}>
        <button className={[shared.control, shared.danger].join(' ')} disabled={locked} onClick={onYes}>
          {yes}
        </button>
        <button className={shared.control} onClick={onNo}>
          {tr('Cancel')}
        </button>
      </div>
    </div>
  );
}

export interface StepRow {
  key: string;
  // while it's to come or going on, and once it's done
  label: string;
  title: string;
  // under it while it's going on or done
  more?: ReactNode;
}

// the steps of an update: the done ones ticked, the one going on marked (yellow while it waits), the rest numbered
export function Steps({steps, now, held}: {steps: StepRow[]; now: number; held?: boolean}) {
  return (
    <ol className={styles.steps}>
      {steps.map((step, i) => (
        <li key={step.key} data-step={step.key} className={i < now ? styles.done : i === now ? [styles.now, held ? styles.held : ''].join(' ') : undefined}>
          <span className={styles.dot}>{i < now ? <Tick /> : i === now ? <i /> : i + 1}</span>
          <span>
            <b>{i < now ? step.title : step.label}</b>
            {i <= now && step.more}
          </span>
        </li>
      ))}
    </ol>
  );
}

export const HOUR = 3600;

// what an update asks of the mower
export const IN_DOCK = 'The mower has to stand ready in the dock for this.';
export const RIGHT_AWAY = 'Works right away, also while the mower mows.';

export type Tag = {text: string; look: string};

// a part's name, its mark and what it is, then its facts
export function Head({name, tag, text, children}: {name: string; tag: Tag | null; text?: string; children: ReactNode}) {
  return (
    <>
      <div className={shared.head}>
        <span className={shared.name}>{name}</span>
        {tag && <span className={[shared.badge, tag.look].join(' ')}>{tag.text}</span>}
      </div>
      {text && <span className={shared.dim}>{tr(text)}</span>}
      <div className={styles.facts}>{children}</div>
    </>
  );
}

// a part that can't be changed while another one updates
export const OffCard = ({id, children}: {id: string; children: ReactNode}) => (
  <article className={[shared.part, styles.off].join(' ')} data-part={id}>
    {children}
  </article>
);

// how many updates there are, when the mower last looked and the button that looks again
export function Summary({count, checked, locked, onCheck}: {count: number; checked: string | null; locked: boolean; onCheck: () => void}) {
  return (
    <div className={styles.sum}>
      <span>
        <b>{count === 0 ? tr('Everything is up to date') : count === 1 ? tr('1 update available') : tr('{n} updates available', {n: count})}</b>
        {checked && <span className={shared.dim}>{tr('Checked: {t}', {t: checked})}</span>}
      </span>
      <button className={shared.control} disabled={locked} onClick={onCheck}>
        {tr('Check for updates')}
      </button>
    </div>
  );
}

// the heading of the update going on, and a line under it
export const RunHead = ({name, back, sub}: {name: string; back: boolean; sub?: string | null}) => (
  <div>
    <h3>{back ? tr('{name} goes back', {name}) : tr('{name} is being updated', {name})}</h3>
    {sub && <span className={shared.dim}>{sub}</span>}
  </div>
);

// MowBite on the mower is another version than this page: after its update, the page needs loading again
export const ReloadNote = ({v, page}: {v: string; page: string}) => (
  <Note look={styles.info}>
    {tr('MowBite {v} runs on the mower now, this page is still {page}.', {v, page})}
    <button className={[shared.control, shared.primary].join(' ')} onClick={() => window.location.reload()}>
      {tr('Load again')}
    </button>
  </Note>
);
