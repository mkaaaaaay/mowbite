import {tr} from '@/lib/i18n';
import {ROLE_NAMES, type SetupLine} from '@/lib/setup';
import styles from './StepLines.module.css';

// the board's inputs line by line, live: switched now, held by the hardware, only watched while the mower learns them
export function StepLines({lines}: {lines: SetupLine[]}) {
  if (!lines.length) return null;
  return (
    <section className={styles.lines}>
      <h3>{tr('Lines')}</h3>
      <ul>
        {lines.map((l) => (
          <li key={l.name} data-line={l.name} data-active={l.active || undefined} data-assigned={l.assigned}>
            <span className={styles.dot} aria-hidden="true" />
            <span className={styles.name}>{l.name}</span>
            <span className={styles.role}>{l.role ? tr(ROLE_NAMES[l.role] ?? l.role) : l.assigned ? tr('No role') : tr('Watched only')}</span>
            <span className={styles.state}>{l.held ? tr('Held until released') : l.active ? tr('Triggered') : tr('At rest')}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
