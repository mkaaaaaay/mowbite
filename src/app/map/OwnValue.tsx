import InfoTip from '@/components/InfoTip';
import {useState, type ReactNode} from 'react';
import styles from './page.module.css';

// A value an area has of its own in place of the one for all: both to choose from, the own one with its field. An
// empty field is the one for all; onSet gets what was typed, null for none of its own
export function OwnValue(props: {
  label: string;
  // the field's name, the words on the two choices
  name: string;
  all: string;
  own: string;
  // the one for all and the area's own as shown, the own one empty without
  general: string;
  value: string;
  unit: string;
  decimal?: boolean;
  range?: string;
  info: ReactNode;
  onSet: (text: string | null) => void;
}) {
  const {value, unit, onSet} = props;
  const [draft, setDraft] = useState<string | null>(null);
  const apply = () => {
    if (draft === null) return;
    setDraft(null);
    if (draft.trim() !== value) onSet(draft.trim() || null);
  };
  const clear = () => {
    setDraft(null);
    if (value) onSet(null);
  };
  const own = !!value || draft !== null;
  return (
    <div className={styles.ownValue}>
      <span className={styles.ownLabel}>
        {props.label}
        <InfoTip>{props.info}</InfoTip>
      </span>
      <div className={styles.ownChoice}>
        <button type="button" aria-pressed={!own} onClick={clear}>
          {props.all}
          <b>
            {props.general || '?'} {unit}
          </b>
        </button>
        <label data-on={own || undefined}>
          {props.own}
          <input
            inputMode={props.decimal ? 'decimal' : 'numeric'}
            aria-label={props.name}
            value={draft ?? value}
            placeholder={props.general}
            onFocus={() => setDraft(draft ?? value)}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={apply}
            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          />
          {unit}
        </label>
      </div>
      {own && props.range && <span className={styles.dim}>{props.range}</span>}
    </div>
  );
}
