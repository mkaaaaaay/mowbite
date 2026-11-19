'use client';

import {tick} from '@/lib/haptics';
import {nameOf, words, type SetupInput} from '@/lib/setup';
import {useEffect, useRef, useState} from 'react';
import {Clock, useLeft} from './Clock';
import styles from './StepQuestion.module.css';

// The question of a running step while it waits (ask): one tap on a value is the answer, the time left beside it.
// It comes into view by itself, the step only waits so long
export function StepQuestion(props: {input: SetupInput; endsAt: number | null; lang: string; busy: boolean; onAnswer: (values: Record<string, unknown>) => void}) {
  const {input, lang, busy} = props;
  const w = words(input.texts, lang);
  const left = useLeft(props.endsAt);
  const [picked, setPicked] = useState<string | null>(null);
  const box = useRef<HTMLFieldSetElement>(null);
  useEffect(() => {
    box.current?.scrollIntoView({block: 'center'});
    tick();
  }, []);
  return (
    <fieldset ref={box} className={styles.question} data-question={input.name}>
      <legend>{w.name || input.name}</legend>
      <div className={styles.head}>
        {w.help && <p>{w.help}</p>}
        {left !== null && <Clock left={left} />}
      </div>
      <div className={styles.values}>
        {(input.values ?? []).map((v) => {
          const help = words(v.texts, lang).help;
          return (
            <button
              key={v.id}
              type="button"
              className={styles.value}
              data-picked={(busy && picked === v.id) || undefined}
              disabled={busy}
              onClick={() => {
                setPicked(v.id);
                props.onAnswer({[input.name]: v.id});
              }}
            >
              <b>{nameOf(v, lang)}</b>
              {help && <span>{help}</span>}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}
