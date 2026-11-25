'use client';

import {useGroupOpen} from '@/hooks/useGroupOpen';
import {useDocked} from '@/hooks/useMowerState';
import {useSure} from '@/hooks/useSure';
import {useUpdaterStatus} from '@/hooks/useUpdaterStatus';
import {requestSound, stateLine} from '@/lib/autoUpdate';
import {tr, useLang} from '@/lib/i18n';
import {
  OWN_FILE,
  readSoundPending,
  readSoundValues,
  SOUND_KEYS,
  SOUND_SYNC_FAILED,
  soundByHand,
  soundFile,
  soundLanguages,
  soundLanguageText,
  soundLines,
  soundRefused,
  soundsChanged,
  soundsNext,
  soundText,
  soundValuesOf,
  soundYaml,
  VOLUME,
  type RunningSounds,
  type SoundValues,
} from '@/lib/openMowerSounds';
import {rosLogHas} from '@/lib/roslog';
import {useEffect, useState} from 'react';
import {HandLines} from './HandLines';
import update from './AutoUpdate.module.css';
import local from './LightSettings.module.css';

// the volume the slider starts at when it's taken over from the mower's own
const START_VOLUME = 50;

// OpenMower's own sounds: set through the MowBite Updater, without it the lines to enter by hand
export function OpenMowerSounds({styles, running}: {styles: Record<string, string>; running: RunningSounds}) {
  useLang();
  const docked = useDocked();
  const open = useGroupOpen();
  const {sure, confirm} = useSure();
  // the form once it's touched, what runs until then
  const [draft, setDraft] = useState<SoundValues | null>(null);
  // the request sent: the updater's line before it, and what was asked
  const [sent, setSent] = useState<{before: string; lines: string} | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [syncFailed, setSyncFailed] = useState(false);
  const {status, loaded, again} = useUpdaterStatus('sound', sent?.before ?? null, open);
  const on = running.enabled;
  useEffect(() => {
    if (!on || !open) return;
    let stop = false;
    rosLogHas(SOUND_SYNC_FAILED).then(
      (failed) => !stop && setSyncFailed(failed),
      () => {},
    );
    return () => {
      stop = true;
    };
  }, [on, open]);

  const file = readSoundValues(status?.sound_values);
  const pending = readSoundPending(status?.sound_pending);
  const languages = soundLanguages(status?.sound_languages);
  // an own file in mower_params.yaml shows as the language before OpenMower runs with it, never written over unasked
  const base: SoundValues = {...soundValuesOf(running), language: file?.language === OWN_FILE ? OWN_FILE : running.language};
  const form = draft ?? base;
  const change = (c: Partial<SoundValues>) => {
    setDraft({...form, ...c});
    setError(null);
  };
  const next = soundsNext(running, file, pending);
  const waits = soundsChanged(running, next);
  const lines = soundLines(form, languages);
  // (only the answer to a request from here, not what the updater said to one before)
  const line = sent ? stateLine(status?.sound, sent.before, docked, soundRefused) : null;
  const unanswered = line?.what === 'asked' || line?.what === 'waiting';
  // nothing to save: untouched, what the file will have anyway, or just asked and not answered yet
  const nothing = !draft || !soundsChanged(next, form).length || (unanswered && sent?.lines === lines);
  const replaces = base.language === OWN_FILE && form.language !== OWN_FILE;
  const save = async () => {
    setBusy(true);
    setError(null);
    const before = status?.sound ?? '';
    try {
      await requestSound(lines);
      setSent({before, lines});
      again();
    } catch {
      setError(tr("Not saved: the updater didn't take it. If MowBite or the updater on the mower is older than this app, update it first."));
    } finally {
      setBusy(false);
    }
  };
  // the lines to enter by hand: where the updater can't write them, or turned them down for what the file is like
  const byHand = loaded && (!file || (line?.what === 'refused' && soundByHand(line.why)));
  const picked = form.language && form.language !== OWN_FILE ? soundFile(form.language) : running.file;
  const yaml = soundYaml({...form, file: picked});
  const names = languages.map((code) => ({code, name: soundLanguageText(code)})).sort((a, b) => a.name.localeCompare(b.name));

  return (
    <section className={styles.card} data-om-sounds={file ? 'set' : 'read'}>
      <p className={styles.dim}>{tr('OpenMower can speak, for example when it starts mowing. Switched off, the mower keeps to the beeps of its firmware.')}</p>
      {file ? (
        <>
          <label className={styles.check}>
            <input type="checkbox" checked={form.enabled} onChange={(e) => change({enabled: e.target.checked})} />
            {tr('Play sounds')}
          </label>
          <label className={styles.check}>
            <input type="checkbox" checked={form.volume < 0} onChange={(e) => change({volume: e.target.checked ? VOLUME.firmware : START_VOLUME})} />
            {tr('Volume as set on the mower')}
          </label>
          {form.volume >= 0 && (
            <label className={styles.field}>
              {tr('Volume {n} %', {n: form.volume})}
              <input
                className={local.range}
                type="range"
                min={VOLUME.min}
                max={VOLUME.max}
                value={form.volume}
                onChange={(e) => change({volume: Number(e.target.value)})}
              />
            </label>
          )}
          <label className={styles.field}>
            {tr('Language')}
            <select value={form.language ?? ''} onChange={(e) => change({language: e.target.value || null})}>
              {!languages.includes(base.language ?? '') && <option value={base.language ?? ''}>{soundLanguageText(base.language)}</option>}
              {names.map(({code, name}) => (
                <option key={code} value={code}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          {!line && waits.length > 0 && (
            <p className={styles.dim} data-om-sounds-waits="">
              {tr('Not in effect yet: {what}.', {what: waits.map((k) => soundText(k, next)).join(', ')})}{' '}
              {pending
                ? tr('The updater writes it and restarts OpenMower once the mower stands quietly in the dock.')
                : tr('It counts once OpenMower has restarted.')}
            </p>
          )}
          <p className={styles.dim}>{tr('Saving restarts OpenMower. The updater does that once the mower stands quietly in the dock, and waits up to 30 minutes for it.')}</p>
          <div className={local.soundButtons}>
            <button
              type="button"
              className={styles.pillButton}
              disabled={busy || nothing}
              onClick={() => (replaces ? confirm('own', () => void save()) : void save())}
            >
              {sure === 'own' ? tr('Really replace your own sound file?') : tr('Save')}
            </button>
          </div>
          {line && (
            <p className={line.tone === 'poor' ? styles.error : styles.dim} data-om-sounds-state={line.what}>
              {line.text}
            </p>
          )}
          {error && <p className={styles.error}>{error}</p>}
        </>
      ) : (
        <>
          <p data-om-sounds-runs="">{SOUND_KEYS.map((k) => soundText(k, running)).join(' · ')}</p>
          {loaded && (
            <p className={styles.dim}>
              {status
                ? tr("Your updater can't write them itself: an older one, or it finds no mower_params.yaml it may write.")
                : tr('To change them from here the mower needs the MowBite Updater.')}
            </p>
          )}
        </>
      )}
      {byHand && (
        <HandLines
          yaml={yaml}
          code={update.code}
          button={styles.pillButton}
          buttons={local.soundButtons}
          note={<p className={styles.dim}>{tr('enabled is true or false, volume 0 to 100 or -1 for as set on the mower, config_file ends in the language: sounds_de.yaml for German.')}</p>}
        />
      )}
      {on && (
        <p className={syncFailed ? styles.error : styles.dim} data-om-sounds-firmware={syncFailed ? 'failed' : 'hint'}>
          {syncFailed
            ? tr("OpenMower couldn't load the sounds onto the mower. Its firmware is probably older than 1.5, {cmd} updates it.", {cmd: 'openmower update-firmware'})
            : tr('Announcements can be missing while the firmware of the mower is older than 1.5, {cmd} updates it.', {cmd: 'openmower update-firmware'})}
        </p>
      )}
    </section>
  );
}
