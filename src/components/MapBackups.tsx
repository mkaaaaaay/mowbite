'use client';

import {parseMapFile, type BackupInfo} from '@/lib/backups';
import {GeoJsonError, isGeoJson, mapFromGeoJson} from '@/lib/geojson';
import type {Datum} from '@/lib/imagery';
import type {MowerMap} from '@/hooks/useMowerMap';
import {dayLabel, clock} from '@/lib/dates';
import {tr} from '@/lib/i18n';
import {useRef, useState} from 'react';
import styles from './MapBackups.module.css';

export const backupLabel = (b: BackupInfo) =>
  `${dayLabel(new Date(b.t * 1000))}, ${clock(b.t)}${b.name ? ` · ${b.auto ? tr(b.name) : b.name}` : ''}`;

// list of the container's map backups plus export/import as a file, also as geojson when the mower's datum is known
export default function MapBackups({
  backups,
  onCreate,
  onPreview,
  onDelete,
  onDownload,
  onDownloadGeo,
  onFile,
  geo,
}: {
  // null: not served by the container, no backups on the mower then
  backups: BackupInfo[] | null;
  onCreate: (name: string) => Promise<void>;
  onPreview: (b: BackupInfo) => void;
  onDelete: (b: BackupInfo) => void;
  onDownload: (b: BackupInfo | null) => void;
  onDownloadGeo: () => void;
  onFile: (map: MowerMap, name: string) => void;
  // the datum for geojson's longitude and latitude, the map a geojson file's areas go into (the one being edited), and
  // onLoad takes the map with them in
  geo: {datum: Datum; base: MowerMap | null; onLoad: (map: MowerMap) => void} | null;
}) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  // what a geojson file brought, said while the map being edited is still just what came of it
  const [loaded, setLoaded] = useState<{map: MowerMap; note: string} | null>(null);
  const file = useRef<HTMLInputElement>(null);

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      await onCreate(name.trim());
      setName('');
    } catch (e) {
      setError(e instanceof Error ? e.message : tr('failed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <details className={styles.box}>
      <summary>
        {tr('Backups')}
        {backups && backups.length > 0 && <span className={styles.count}>{backups.length}</span>}
      </summary>

      {backups ? (
        <>
          <div className={styles.row}>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder={tr('name (optional)')} maxLength={60} />
            <button className={styles.button} onClick={() => void create()} disabled={busy}>
              {tr('Create backup')}
            </button>
          </div>
          <p className={styles.dim}>{tr('Before every save the current map is backed up by itself, the last 30 of those are kept.')}</p>
          {backups.length === 0 && <p className={styles.dim}>{tr('No backups yet.')}</p>}
          <ul className={styles.list}>
            {backups.map((b) => (
              <li key={b.id}>
                <div>
                  <span>{backupLabel(b)}</span>
                  <span className={styles.dim}>
                    {tr('{n} areas', {n: b.areas})}
                  </span>
                </div>
                <div className={styles.actions}>
                  <button className={styles.link} onClick={() => onPreview(b)}>
                    {tr('Preview')}
                  </button>
                  <button className={styles.link} onClick={() => onDownload(b)}>
                    {tr('Download')}
                  </button>
                  <button
                    className={[styles.link, styles.danger].join(' ')}
                    onClick={() => (confirmDelete === b.id ? onDelete(b) : setConfirmDelete(b.id))}
                    onBlur={() => setConfirmDelete(null)}
                  >
                    {confirmDelete === b.id ? tr('Really delete?') : tr('Delete')}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className={styles.dim}>{tr('Backups on the mower need MowBite running as its container. Files still work.')}</p>
      )}

      <div className={styles.row}>
        <button className={styles.button} onClick={() => onDownload(null)}>
          {tr('Download current map')}
        </button>
        {geo && (
          <button className={styles.button} onClick={onDownloadGeo}>
            {tr('As GeoJSON')}
          </button>
        )}
        <button className={styles.button} onClick={() => file.current?.click()}>
          {tr('Load from file')}
        </button>
        <input
          ref={file}
          type="file"
          accept=".json,.geojson,application/json,application/geo+json"
          hidden
          onChange={async (e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (!f) return;
            try {
              const text = await f.text();
              const json = JSON.parse(text);
              if (isGeoJson(json)) {
                if (!geo) throw new GeoJsonError("For GeoJSON the mower's position is needed, it isn't known yet.");
                const r = mapFromGeoJson(json, geo.datum, geo.base);
                if (!r.changed && !r.added) throw new GeoJsonError('Nothing in the file differs from the map.');
                geo.onLoad(r.map);
                setLoaded({
                  map: r.map,
                  note: tr('From {file}: {changed} changed, {added} new. Only in the editor so far, the mower gets it when you save the map.', {
                    file: f.name,
                    changed: r.changed,
                    added: r.added,
                  }),
                });
              } else onFile(parseMapFile(text), f.name);
              setError(null);
            } catch (e) {
              setError(e instanceof GeoJsonError ? tr(e.message) : tr("That file doesn't look like a map."));
            }
          }}
        />
      </div>
      {geo && (
        <p className={styles.dim}>
          {tr('GeoJSON opens in QGIS, geojson.io and other map apps. Loaded back, an area from the file takes the place of the one with its id, others come in as new ones, drafts unless the file says what they are.')}{' '}
          {tr("Coordinates are WGS84 longitude and latitude, angles in radians. An area deleted in the file isn't deleted on the map.")}
        </p>
      )}
      {loaded && loaded.map === geo?.base && !error && <p className={styles.dim}>{loaded.note}</p>}
      {error && <p className={styles.error}>{error}</p>}
    </details>
  );
}
