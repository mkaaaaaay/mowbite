'use client';

import {useRpcMethods} from '@/hooks/useRpcMethods';
import {useSure} from '@/hooks/useSure';
import {clock} from '@/lib/dates';
import {fmt, tr, useLang} from '@/lib/i18n';
import {RPC} from '@/lib/openmower';
import {RpcError} from '@/lib/rpc';
import {answerError} from '@/lib/rpcText';
import {deleteSound, HELD_MS, leftHeld, loadSounds, playSound, setVolume, stopSound, uploadSound, type Sounds} from '@/lib/sound';
import {useEffect, useRef, useState} from 'react';
import local from './LightSettings.module.css';

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

// the sounds of a mower with MowBite OS: each situation to listen to and to give an own sound, one volume for all
export function SoundSettings({styles}: {styles: Record<string, string>}) {
  useLang();
  const methods = useRpcMethods();
  const {sure, confirm} = useSure();
  // undefined: loading, null: it didn't answer
  const [sounds, setSounds] = useState<Sounds | null>();
  const [volume, setVol] = useState(0);
  const [note, setNote] = useState<{situation?: string; text: string; error?: boolean} | null>(null);
  // the volume last sent or loaded: letting go and leaving the slider both send, the second one only if it changed
  const sent = useRef<number | null>(null);
  // one upload at a time: its situation and how far it got
  const [busy, setBusy] = useState<{situation: string; text: string} | null>(null);
  const picker = useRef<HTMLInputElement>(null);
  const target = useRef('');
  // until when an own upload that broke off keeps the mower busy
  const held = useRef(0);
  useEffect(() => {
    let stop = false;
    loadSounds().then(
      (s) => {
        if (stop) return;
        setSounds(s);
        setVol(s.volume);
        sent.current = s.volume;
      },
      () => !stop && setSounds(null),
    );
    return () => {
      stop = true;
    };
  }, []);
  if (sounds === undefined) return <p className={styles.dim}>{tr('loading…')}</p>;
  if (sounds === null) return <p className={styles.error}>{tr('The mower did not answer.')}</p>;

  // the mower writes each volume to its storage: sent once the slider is let go
  const sendVolume = () => {
    if (volume === sent.current) return;
    sent.current = volume;
    setVolume(volume).then(
      (r) => {
        setSounds((s) => (s ? {...s, volume: r.volume} : s));
        setVol(r.volume);
        sent.current = r.volume;
        setNote(null);
      },
      (e) => {
        setVol(sounds.volume);
        sent.current = sounds.volume;
        setNote({text: answerError(e), error: true});
      },
    );
  };
  const upload = async (situation: string, file: File) => {
    setNote(null);
    setBusy({situation, text: ''});
    let partsOut = false;
    try {
      const r = await uploadSound(situation, file, (part, parts) => {
        partsOut = true;
        setBusy({situation, text: part < parts - 1 ? tr('Uploading part {n} of {m}…', {n: part + 1, m: parts}) : tr('The mower checks the sound…')});
      });
      setNote({situation, text: tr('Uploaded, {n} s.', {n: fmt(r.duration_s, 1)})});
    } catch (e) {
      if (partsOut && leftHeld(e)) held.current = Date.now() + HELD_MS;
      const wait = e instanceof RpcError && e.data?.reason === 'BUSY' && held.current > Date.now();
      const until = tr('The upload that broke off keeps the mower busy until {time} at the latest, the same file for the same situation goes right away.', {
        time: clock(held.current / 1000),
      });
      setNote({situation, text: wait ? `${answerError(e)} ${until}` : answerError(e), error: true});
    } finally {
      // also after one that broke off, the mower may have taken it
      await loadSounds().then(setSounds, () => undefined);
      setBusy(null);
    }
  };
  const remove = (situation: string) =>
    deleteSound(situation).then(
      (r) => {
        setSounds((s) => s && {...s, situations: s.situations.map((x) => (x.name === situation ? {...x, file: r.file} : x))});
        setNote(null);
      },
      (e) => setNote({situation, text: answerError(e), error: true}),
    );
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
          <input
            className={local.range}
            type="range"
            min={0}
            max={100}
            value={volume}
            onChange={(e) => setVol(Number(e.target.value))}
            onPointerUp={sendVolume}
            onKeyUp={sendVolume}
            onBlur={sendVolume}
          />
        </label>
        {volume === 0 && <p className={styles.dim}>{tr('Silent: the mower plays nothing, not even for an emergency stop.')}</p>}
        <button type="button" className={styles.linkButton} onClick={() => stopSound().catch((e) => setNote({text: answerError(e), error: true}))}>
          {tr('Stop the sound')}
        </button>
        {note && !note.situation && <p className={note.error ? styles.error : styles.dim}>{note.text}</p>}
      </section>
      <input
        ref={picker}
        type="file"
        accept="audio/mpeg,.mp3"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) void upload(target.current, file);
        }}
      />
      {sounds.situations.map((s) => (
        <section key={s.name} className={styles.card} data-sound={s.name}>
          <h2>{named(s.name)}</h2>
          <p className={styles.dim}>
            {s.file
              ? tr('{n} s, {from}', {n: fmt(s.file.seconds, 1), from: s.file.source === 'upload' ? tr('your own') : tr('from the manufacturer')})
              : tr('No sound')}
          </p>
          <div className={local.soundButtons}>
            {s.file && (
              <button type="button" className={styles.pillButton} onClick={() => void play(s.name)}>
                {tr('Listen')}
              </button>
            )}
            {methods?.has(RPC.soundUpload) && (
              <button
                type="button"
                className={styles.pillButton}
                disabled={!!busy}
                onClick={() => {
                  target.current = s.name;
                  picker.current?.click();
                }}
              >
                {tr('Choose your own sound')}
              </button>
            )}
            {s.file?.source === 'upload' && methods?.has(RPC.soundDelete) && (
              <button type="button" className={styles.linkButton} disabled={!!busy} onClick={() => confirm(s.name, () => void remove(s.name))}>
                {sure === s.name ? tr('Really delete your own sound?') : tr('Sound of the manufacturer')}
              </button>
            )}
          </div>
          {busy?.situation === s.name && busy.text && <p className={styles.dim}>{busy.text}</p>}
          {note?.situation === s.name && <p className={note.error ? styles.error : styles.dim}>{note.text}</p>}
        </section>
      ))}
    </>
  );
}
