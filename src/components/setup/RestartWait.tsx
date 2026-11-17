import {TurnIcon} from '@/components/icons';
import {tr} from '@/lib/i18n';
import styles from './RestartWait.module.css';

// a step waits for MowBite OS to start again, which the program asks for itself
export function RestartWait() {
  return (
    <div className={styles.wait} role="status">
      <span className={styles.sign}>
        <TurnIcon size={28} />
      </span>
      <h3>{tr('MowBite OS is starting again')}</h3>
      <p>{tr('The setup goes on by itself afterwards, you can leave this page open.')}</p>
    </div>
  );
}
