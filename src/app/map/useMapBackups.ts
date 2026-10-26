// The map's backups kept in the container, one of them shown instead of the editor and put back on the mower, and the
// map as a file. restored: what the editor drops once a backup is on the mower
import {useEffect, useState} from 'react';
import {saveMap, type MowerMap} from '@/hooks/useMowerMap';
import {listBackups, loadBackup, saveBackup, type BackupInfo} from '@/lib/backups';
import {mapToGeoJson} from '@/lib/geojson';
import type {Datum} from '@/lib/imagery';
import {closedRings} from '@/lib/rings';
import {rpcErrorText} from '@/lib/rpcText';
import {saveFile} from '@/lib/saveFile';

export function useMapBackups(liveMap: MowerMap | null, datum: Datum | undefined, restored: () => void) {
  const [backups, setBackups] = useState<BackupInfo[] | null | undefined>(undefined);
  const [preview, setPreview] = useState<{map: MowerMap; label: string} | null>(null);
  const [confirmRestore, setConfirmRestore] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const refreshBackups = () => listBackups().then(setBackups);
  useEffect(() => {
    void listBackups().then(setBackups);
  }, []);
  const closePreview = () => {
    setPreview(null);
    setConfirmRestore(false);
    setRestoreError(null);
  };
  const restore = async () => {
    if (!preview) return;
    setRestoring(true);
    setRestoreError(null);
    try {
      if (backups && liveMap) await saveBackup(liveMap, 'before restoring', true);
      await saveMap(preview.map);
      restored();
      closePreview();
      void refreshBackups();
    } catch (e) {
      setRestoreError(rpcErrorText(e));
    } finally {
      setRestoring(false);
      setConfirmRestore(false);
    }
  };
  // a backup, or the map as it is on the mower right now, as a file
  const fileName = (t: Date, ext: string) => {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `mowbite-map-${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}-${pad(t.getHours())}${pad(t.getMinutes())}.${ext}`;
  };
  const download = async (b: BackupInfo | null) => {
    const m = b ? await loadBackup(b.id) : liveMap;
    if (!m) return;
    await saveFile(fileName(new Date((b ? b.t : Date.now() / 1000) * 1000), 'json'), JSON.stringify(closedRings(m), null, 2));
  };
  // the mower's map in longitude and latitude, for other map apps
  const downloadGeo = async () => {
    if (!liveMap || !datum) return;
    await saveFile(fileName(new Date(), 'geojson'), JSON.stringify(mapToGeoJson(liveMap, datum), null, 2), 'application/geo+json');
  };

  return {backups, preview, setPreview, confirmRestore, setConfirmRestore, restoring, restoreError, setRestoreError, refreshBackups, closePreview, restore, download, downloadGeo};
}
