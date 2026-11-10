import {CheckIcon, RedoIcon, UndoIcon} from '@/components/icons';
import {tr} from '@/lib/i18n';
import styles from './page.module.css';

// undo, redo and save in a bar at the bottom while there's something to take back or to save, it stays in view while
// the page scrolls. new areas are made from the list of the areas
export default function EditorToolbar({
  canUndo,
  canRedo,
  unsaved,
  placing,
  saving,
  saveLabel,
  saveError,
  onUndo,
  onRedo,
  onSave,
}: {
  canUndo: boolean;
  canRedo: boolean;
  // changed from the mower's map
  unsaved: boolean;
  // points set for a new area or a cut, not in the map yet
  placing?: boolean;
  saving: boolean;
  saveLabel: string;
  saveError: string | null;
  onUndo: () => void;
  onRedo: () => void;
  onSave: () => void;
}) {
  return (
    <div className={styles.changesBar}>
      <button className={styles.barIcon} onClick={onUndo} disabled={!canUndo} aria-label={tr('Undo')} title={tr('Undo')}>
        <UndoIcon size={20} />
      </button>
      <button className={styles.barIcon} onClick={onRedo} disabled={!canRedo} aria-label={tr('Redo')} title={tr('Redo')}>
        <RedoIcon size={20} />
      </button>
      {unsaved || saving ? (
        <button className={[styles.pillButton, styles.saveButton, styles.unsaved].join(' ')} onClick={onSave} disabled={saving}>
          <CheckIcon size={18} />
          {saveLabel}
        </button>
      ) : (
        !placing && <span className={styles.barNote}>{tr('Everything saved')}</span>
      )}
      {saveError && <span className={[styles.error, styles.barError].join(' ')}>{saveError}</span>}
    </div>
  );
}
