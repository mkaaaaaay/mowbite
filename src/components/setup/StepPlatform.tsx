'use client';

import {LockIcon} from '@/components/icons';
import {tr} from '@/lib/i18n';
import {answerError} from '@/lib/rpcText';
import {loadPlatforms, platformImage, platformWords, rereadOnVersion, setPlatform, type Platforms, type Setup} from '@/lib/setup';
import {useEffect, useState} from 'react';
import {PlatformPicture} from './PlatformPicture';
import {RestartWait} from './RestartWait';
import {TakenBack} from './SetupReset';
import {Sheet} from './Sheet';
import {StepSymbol} from './StepSymbol';
import sheet from './Sheet.module.css';
import step from './SetupStep.module.css';
import styles from './StepPlatform.module.css';

// The step platform: the mowers this MowBite OS runs as, each with its picture, the one it runs as marked. Choosing
// one starts MowBite OS again as that mower; on a mower that ran as another one every result of the setup goes back,
// asked before
export function StepPlatform({setup, lang}: {setup: Setup; lang: string}) {
  // the list as asked while MowBite OS ran as this mower (of), asked again once it runs as another
  const [got, setGot] = useState<{of: string; list?: Platforms; failed?: string} | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  // the mower chosen until MowBite OS is back as it
  const [waiting, setWaiting] = useState<string | null>(null);
  const {platform} = setup;
  useEffect(() => {
    let gone = false;
    loadPlatforms().then(
      (list) => !gone && setGot({of: platform, list}),
      (e) => !gone && setGot({of: platform, failed: answerError(e)}),
    );
    return () => {
      gone = true;
    };
  }, [platform]);

  if (waiting && waiting !== platform) return <RestartWait />;
  const now = got?.of === platform ? got : null;
  const list = now?.list;
  if (!list)
    return (
      <p className={step.note} data-tone={now?.failed ? 'bad' : undefined} role={now?.failed ? 'alert' : undefined}>
        {now?.failed ?? tr('connecting…')}
      </p>
    );

  const choice = picked ?? list.current;
  const chosen = list.platforms.find((p) => p.name === choice);
  const choose = () => {
    setAsking(false);
    setBusy(true);
    setError(null);
    setPlatform(setup, choice)
      .then((r) => r.restart && setWaiting(choice))
      .catch((e) => {
        setError(answerError(e));
        rereadOnVersion(e);
      })
      .finally(() => setBusy(false));
  };
  return (
    <>
      {list.fixed && (
        <p className={`${step.note} ${styles.fixed}`}>
          <LockIcon size={16} open={false} />
          {tr('The installation sets which mower this is. For another one install MowBite OS again.')}
        </p>
      )}
      <fieldset className={styles.platforms} disabled={busy || list.fixed} data-platforms={list.current || 'none'}>
        {list.platforms.map((p) => {
          const w = platformWords(p, lang);
          return (
            <label key={p.name} className={styles.platform} data-platform={p.name}>
              <PlatformPicture name={p.name} image={platformImage(p)} className={styles.pic} />
              <span className={styles.words}>
                <b>{w.name}</b>
                {p.name === list.current && <i>{tr('This mower now')}</i>}
                {w.text && <span>{w.text}</span>}
                {w.board && (
                  <span className={styles.board}>
                    <StepSymbol name="board" size={14} />
                    {w.board}
                  </span>
                )}
              </span>
              <input type="radio" name="platform" checked={p.name === choice} onChange={() => setPicked(p.name)} />
            </label>
          );
        })}
      </fieldset>
      {error && (
        <p className={step.note} data-tone="bad" role="alert">
          {error}
        </p>
      )}
      {!list.fixed && (
        <button
          type="button"
          className={styles.choose}
          data-primary
          disabled={busy || !chosen || choice === list.current}
          onClick={() => (list.current ? setAsking(true) : choose())}
        >
          {tr('Choose this mower')}
        </button>
      )}
      {asking && chosen && (
        <Sheet title={tr('Choose another mower?')} onClose={() => setAsking(false)}>
          <TakenBack setup={setup} />
          <p className={sheet.limit}>{tr('MowBite OS starts again as {mower}.', {mower: platformWords(chosen, lang).name})}</p>
          <div className={sheet.buttons}>
            <button type="button" className={sheet.button} onClick={() => setAsking(false)}>
              {tr('Cancel')}
            </button>
            <button type="button" className={sheet.button} data-primary onClick={choose}>
              {tr('Choose this mower')}
            </button>
          </div>
        </Sheet>
      )}
    </>
  );
}
