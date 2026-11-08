'use client';

import {fmt, tr, useLang} from '@/lib/i18n';
import {answerError} from '@/lib/rpcText';
import {loadSounds, playSound, setVolume, stopSound, type Sounds} from '@/lib/sound';
import {useEffect, useRef, useState} from 'react';

// the situations as the app calls them (open_mower_ros #347), one it doesn't know readable
const SITUATION_NAMES: Record<string, string> = {
  MOWING_START: 'Mowing starts',
  MOWING_COMPLETE: 'Mowing done',
  MOWING_PAUSED: 'Paused',
  DOCKING_START: 'Heading home',
  DOCKING_FAILED: 'Docking failed',
  CHARGING_START: 'Charging starts',
  CHARGING_DONE: 'Fully charged',
  LOW_BATTERY: 'Battery low',
  RAIN_DETECTED: 'Rain',
  AREA_RECORDING_MODE: 'Recording mode',
  EMERGENCY: 'Emergency stop',
  LIFT_TRIGGERED: 'Lifted',
};
const named = (key: string) => (SITUATION_NAMES[key] ? tr(SITUATION_NAMES[key]) : key.replace(/_/g, ' ').toLowerCase());
// the volume goes to the mower once the slider rests this long
const VOLUME_MS = 400;

// the sounds of a mower with MowBite OS: each situation to listen to, one volume for all
export function SoundSettings({styles}: {styles: Record<string, string>}) {
  useLang();
  // undefined: loading, null: it didn't answer
  const [sounds, setSounds] = useState<Sounds | null>();
  const [volume, setVol] = useState(0);
  const [note, setNote] = useState<{situation?: string; text: string; error?: boolean} | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => {
    let stop = false;
    loadSounds().then(
      (s) => {
        if (stop) return;
        setSounds(s);
        setVol(s.volume);
      },
      () => !stop && setSounds(null),
    );
    return () => {
      stop = true;
      clearTimeout(timer.current);
    };
  }, []);
  if (sounds === undefined) return <p className={styles.dim}>{tr('loading…')}</p>;
  if (sounds === null) return <p className={styles.error}>{tr('The mower did not answer.')}</p>;

  const changeVolume = (v: number) => {
    setVol(v);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      setVolume(v).then(
        (r) => {
          setSounds((s) => (s ? {...s, volume: r.volume} : s));
          setVol(r.volume);
          setNote(null);
        },
        (e) => {
          setVol(sounds.volume);
          setNote({text: answerError(e), error: true});
        },
      );
    }, VOLUME_MS);
  };
  const play = (situation: string) =>
    playSound(situation).then(
      (r) => setNote({situation, text: tr('Plays on the mower ({n} s).', {n: fmt(r.seconds, 0)})}),
      (e) => setNote({situation, text: answerError(e), error: true}),
    );

  return (
    <>
      <section className={styles.card}>
        <label className={styles.field}>
          {tr('Volume {n} %', {n: volume})}
          <input type="range" min={0} max={100} value={volume} onChange={(e) => changeVolume(Number(e.target.value))} />
        </label>
        {volume === 0 && <p className={styles.dim}>{tr('Silent: the mower plays nothing, not even for an emergency stop.')}</p>}
        <button type="button" className={styles.linkButton} onClick={() => stopSound().catch((e) => setNote({text: answerError(e), error: true}))}>
          {tr('Stop the sound')}
        </button>
        {note && !note.situation && <p className={note.error ? styles.error : styles.dim}>{note.text}</p>}
      </section>
      {sounds.situations.map((s) => (
        <section key={s.name} className={styles.card} data-sound={s.name}>
          <h2>{named(s.name)}</h2>
          <p className={styles.dim}>
            {s.file
              ? tr('{n} s, {from}', {n: fmt(s.file.seconds, 1), from: s.file.source === 'vendor' ? tr('from the manufacturer') : tr('your own')})
              : tr('No sound')}
            {s.event && ` · ${s.event}`}
          </p>
          {s.file && (
            <button type="button" className={styles.pillButton} onClick={() => void play(s.name)}>
              {tr('Listen')}
            </button>
          )}
          {note?.situation === s.name && <p className={note.error ? styles.error : styles.dim}>{note.text}</p>}
        </section>
      ))}
    </>
  );
}
