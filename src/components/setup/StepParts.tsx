import {nameOf, type SetupPart} from '@/lib/setup';
import {StateMark, stateWord} from './StateMark';
import styles from './StepParts.module.css';

// the parts of a step, each with its own tick; the one to do now is waiting
export function StepParts({parts, lang}: {parts: SetupPart[]; lang: string}) {
  if (!parts.length) return null;
  return (
    <ol className={styles.parts}>
      {parts.map((p) => {
        const word = stateWord(p.state);
        return (
          <li key={p.id} data-state={p.state} className={styles.part}>
            <StateMark state={p.state} />
            <span className={styles.text}>
              <b>{nameOf(p, lang)}</b>
              {word && <span>{word}</span>}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
