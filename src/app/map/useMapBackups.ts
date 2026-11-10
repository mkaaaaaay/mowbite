// The map's backups kept in the container, one of them shown instead of the editor and put back on the mower, and the
// map as a file: the one being edited (shown), so a file taken out and back in doesn't take back what isn't saved yet.
// restored: what the editor drops once a backup is on the mower, with the map put there, the one before, whether it's
// still shown (put back late after the preview got closed: the edits stay) and whether the job it ends got dropped already.
// dropJob: that job dropped, for a restore that ends it and gets there only after its time
import {useEffect, useRef, useState} from 'react';
import {saveMap, whenMowerHas, type MowerMap} from '@/hooks/useMowerMap';
import {listBackups, loadBackup, useBackupFirst, type BackupInfo, type Backups} from '@/lib/backups';
import {mapToGeoJson} from '@/lib/geojson';
import type {Datum} from '@/lib/imagery';
import {closedRings} from '@/lib/rings';
import {RpcError} from '@/lib/rpc';
import {rpcErrorText} from '@/lib/rpcText';
import {sameContent} from '@/lib/sameMap';
import {saveFile} from '@/lib/saveFile';

export function useMapBackups(
  liveMap: MowerMap | null,
  shown: MowerMap | null,
  datum: Datum | undefined,
  restored: (put: MowerMap, before: MowerMap | null, shown: boolean, jobDropped?: boolean) => void,
  dropJob: () => void,
) {
  const [backups, setBackups] = useState<Backups | null | undefined>(undefined);
  const [preview, setPreview] = useState<{map: MowerMap; label: string} | null>(null);
  const [confirmRestore, setConfirmRestore] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  // the backup before it failed, the next try restores without one
  const backupFirst = useBackupFirst(setRestoreError, 'restore');
  const refreshBackups = () => listBackups().then(setBackups);
  useEffect(() => {
    void listBackups().then(setBackups);
  }, []);
  const closePreview = () => {
    setPreview(null);
    setConfirmRestore(false);
    setRestoreError(null);
    backupFirst.reset();
  };
  // a restore the mower didn't answer in time: once its map comes back from there it's restored after all
  const lateRestore = useRef<{map: MowerMap; before: MowerMap | null; jobDropped?: boolean} | null>(null);
  useEffect(() => {
    const late = lateRestore.current;
    if (!late || !liveMap || !sameContent(liveMap, late.map)) return;
    lateRestore.current = null;
    const open = preview?.map === late.map;
    restored(late.map, late.before, open, late.jobDropped);
    if (open) closePreview();
    void refreshBackups();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when the mower's map comes
  }, [liveMap]);
  // the job it ends dropped once its map is on the mower, also while the editor is hidden. once: marked here, the effect
  // above takes the restore away, whichever comes first. called off by the next restore
  const offLateDrop = useRef(() => {});
  const dropLateJob = () => {
    const late = lateRestore.current;
    if (!late) return;
    late.jobDropped = true;
    dropJob();
  };

  // ends: restoring ends the job the mower interrupted, as it is now
  const restore = async (ends: boolean) => {
    if (!preview) return;
    setRestoring(true);
    setRestoreError(null);
    try {
      if ((await backupFirst.first(liveMap, 'before restoring')) === 'failed') return;
      offLateDrop.current();
      lateRestore.current = {map: preview.map, before: liveMap};
      await saveMap(preview.map);
      // the mower's map can come back before its answer, then that took it already (above)
      const taken = lateRestore.current === null;
      lateRestore.current = null;
      if (!taken) {
        restored(preview.map, liveMap, true);
        closePreview();
        void refreshBackups();
      }
    } catch (e) {
      // no answer: it may still get there, then it's restored after all (above)
      if (!(e instanceof RpcError && e.code === 'timeout')) lateRestore.current = null;
      else if (ends) offLateDrop.current = whenMowerHas(preview.map, dropLateJob);
      setRestoreError(rpcErrorText(e));
    } finally {
      setRestoring(false);
      setConfirmRestore(false);
    }
  };
  // a backup, or the map as it's shown now, as a file
  const fileName = (t: Date, ext: string) => {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `mowbite-map-${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}-${pad(t.getHours())}${pad(t.getMinutes())}.${ext}`;
  };
  const download = async (b: BackupInfo | null) => {
    const m = b ? await loadBackup(b.id) : shown;
    if (!m) return;
    await saveFile(fileName(new Date((b ? b.t : Date.now() / 1000) * 1000), 'json'), JSON.stringify(closedRings(m), null, 2));
  };
  // the map in longitude and latitude, for other map apps
  const downloadGeo = async () => {
    if (!shown || !datum) return;
    await saveFile(fileName(new Date(), 'geojson'), JSON.stringify(mapToGeoJson(shown, datum), null, 2), 'application/geo+json');
  };

  return {
    backups,
    restoreWithoutBackup: backupFirst.without,
    preview,
    setPreview,
    confirmRestore,
    setConfirmRestore,
    restoring,
    restoreError,
    refreshBackups,
    closePreview,
    restore,
    download,
    downloadGeo,
  };
}
