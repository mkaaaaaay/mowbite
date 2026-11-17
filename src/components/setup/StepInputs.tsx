'use client';

import {tr} from '@/lib/i18n';
import {nameOf, words, type SetupInput} from '@/lib/setup';
import {useState} from 'react';
import styles from './StepInputs.module.css';

// What a step takes with setup.answer: a choice, a number, or the question of a running step (ask), all in one answer
export function StepInputs({inputs, lang, busy, onAnswer}: {inputs: SetupInput[]; lang: string; busy: boolean; onAnswer: (values: Record<string, unknown>) => void}) {
  const [given, setGiven] = useState<Record<string, unknown>>({});
  if (!inputs.length) return null;
  const valueOf = (i: SetupInput) => (i.name in given ? given[i.name] : i.value);
  const ready = inputs.every((i) => valueOf(i) !== null && valueOf(i) !== undefined && valueOf(i) !== '');
  return (
    <form
      className={styles.inputs}
      onSubmit={(e) => {
        e.preventDefault();
        if (ready) onAnswer(Object.fromEntries(inputs.map((i) => [i.name, valueOf(i)])));
      }}
    >
      {inputs.map((i) => {
        const w = words(i.texts, lang);
        return (
          <fieldset key={i.name} className={styles.input} data-ask={i.ask || undefined}>
            <legend>{w.name || i.name}</legend>
            {w.help && <p className={styles.help}>{w.help}</p>}
            {i.type === 'choice' ? (
              (i.values ?? []).map((v) => (
                <label key={v.id} className={styles.choice}>
                  <input type="radio" name={i.name} value={v.id} checked={valueOf(i) === v.id} onChange={() => setGiven({...given, [i.name]: v.id})} />
                  <span className={styles.text}>
                    <b>{nameOf(v, lang)}</b>
                    {words(v.texts, lang).help && <span>{words(v.texts, lang).help}</span>}
                  </span>
                </label>
              ))
            ) : (
              <label className={styles.number}>
                <input
                  type="number"
                  inputMode="decimal"
                  min={i.min}
                  max={i.max}
                  step="any"
                  value={typeof valueOf(i) === 'number' || typeof valueOf(i) === 'string' ? String(valueOf(i)) : ''}
                  onChange={(e) => setGiven({...given, [i.name]: e.target.value === '' ? '' : Number(e.target.value)})}
                />
                <span>{[i.unit, i.min !== undefined && i.max !== undefined ? tr('{min} to {max}', {min: i.min, max: i.max}) : ''].filter(Boolean).join(', ')}</span>
              </label>
            )}
          </fieldset>
        );
      })}
      <button type="submit" className={styles.answer} disabled={busy || !ready}>
        {tr('Save')}
      </button>
    </form>
  );
}
