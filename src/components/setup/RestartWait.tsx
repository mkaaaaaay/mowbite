import {tr} from '@/lib/i18n';
import styles from './RestartWait.module.css';

// a step waits for MowBite OS to start again, which the program asks for itself
export function RestartWait() {
  return (
    <p className={styles.wait} role="status">
      {tr('MowBite OS starts again for this step. The setup goes on by itself afterwards.')}
    </p>
  );
}
