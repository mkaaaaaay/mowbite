import {LookSwatch} from '@/components/gardenLook';
import {CheckIcon, PencilIcon, RedoIcon, RouteIcon, UndoIcon} from '@/components/icons';
import {tr} from '@/lib/i18n';
import Link from 'next/link';
import styles from './page.module.css';

// new area and decorating (only while nothing else is going on), undo, redo and save
export default function EditorToolbar({
  idle,
  canUndo,
  canRedo,
  unsaved,
  saving,
  saveLabel,
  saveError,
  onDraw,
  onDecorate,
  onUndo,
  onRedo,
  onSave,
}: {
  idle: boolean;
  canUndo: boolean;
  canRedo: boolean;
  // changed from the mower's map
  unsaved: boolean;
  saving: boolean;
  saveLabel: string;
  saveError: string | null;
  onDraw: () => void;
  // pictures standing by themselves, set and changed on the map (a gnome, a lamp ...)
  onDecorate?: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onSave: () => void;
}) {
  const tool = [styles.pillButton, styles.tool].join(' ');
  return (
    <div className={styles.toolbar}>
      {idle && (
        <>
          <span className={styles.toolLabel}>{tr('New area')}</span>
          <button className={tool} onClick={onDraw}>
            <PencilIcon size={16} />
            {tr('Draw')}
          </button>
          {/* recording adds the area on the mower, unsaved edits here would overwrite it */}
          {unsaved ? (
            <span className={[tool, styles.disabledLink].join(' ')} title={tr('Save or undo your changes first')}>
              <RouteIcon size={16} />
              {tr('Record')}
            </span>
          ) : (
            <Link href="/record" className={tool}>
              <RouteIcon size={16} />
              {tr('Record')}
            </Link>
          )}
          {onDecorate && (
            <button className={[tool, styles.toolWide].join(' ')} onClick={onDecorate}>
              <LookSwatch look="gnome" size={18} />
              {tr('Decorate')}
            </button>
          )}
          <span className={styles.toolLabel}>{tr('Changes')}</span>
        </>
      )}
      <button className={tool} onClick={onUndo} disabled={!canUndo}>
        <UndoIcon size={16} />
        {tr('Undo')}
      </button>
      <button className={tool} onClick={onRedo} disabled={!canRedo}>
        <RedoIcon size={16} />
        {tr('Redo')}
      </button>
      <button
        className={[tool, styles.toolWide, styles.saveButton, unsaved ? styles.unsaved : ''].join(' ')}
        onClick={onSave}
        disabled={saving || !unsaved}
      >
        <CheckIcon size={16} />
        {saveLabel}
      </button>
      {saveError && <span className={[styles.error, styles.toolWide].join(' ')}>{saveError}</span>}
    </div>
  );
}
