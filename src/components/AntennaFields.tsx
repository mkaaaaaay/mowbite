'use client';

import {numParam, useMowerParams} from '@/hooks/useMowerParams';
import {CopyButton} from '@/lib/clipboard';
import {cmMetres, cmText, tr} from '@/lib/i18n';
import {PARAM} from '@/lib/openmower';
import {useState} from 'react';
import local from './MowerSizesSettings.module.css';

type Styles = Record<string, string>;

export const ANTENNA_LABELS = {antenna_x: 'Antenna ahead of the rear axle', antenna_y: 'Antenna to the left of the middle'};
// to the millimetre
const mm = (v: number) => Math.round(v * 1000) / 1000;


// the GPS antenna under the mower's sizes (with the planner and without): where OpenMower has it, typed where it really
// sits, for the sketch; nothing without the mower's value. own: MowBite OS's (robot.geometry), saved with the sizes there
// (typed: what to save, null for nothing; bad: the one typed that isn't a number), null while it's not read yet
export function useAntennaFields(
  styles: Styles,
  own?: {x: number; y: number} | null,
): {antenna?: {x: number; y: number}; fields: React.ReactNode; typed: {x: number; y: number} | null; bad: 'antenna_x' | 'antenna_y' | null; clear: () => void} {
  const params = useMowerParams();
  const antennaX = numParam(params, PARAM.antennaX);
  const mowerAntenna = own !== undefined ? (own ?? undefined) : antennaX === undefined ? undefined : {x: antennaX, y: numParam(params, PARAM.antennaY) ?? 0};
  // where the antenna really sits, typed here: OpenMower reads it from its yaml at the start only (no params.set), so
  // the app hands over the lines to put there. the fields follow the mower's values until something is typed
  const [antennaForm, setAntennaForm] = useState<{x: string; y: string} | null>(null);
  const antennaText = antennaForm ?? {x: cmText(mowerAntenna?.x), y: cmText(mowerAntenna?.y)};
  const typedX = cmMetres(antennaText.x);
  const typedY = cmMetres(antennaText.y);
  const antenna = typedX !== null ? {x: typedX, y: typedY ?? 0} : mowerAntenna;
  const antennaChanged =
    !!antennaForm && typedX !== null && (!mowerAntenna || Math.abs(typedX - mowerAntenna.x) > 0.0005 || Math.abs((typedY ?? 0) - mowerAntenna.y) > 0.0005);
  const yamlLines = antennaChanged && own === undefined
    ? `xbot_positioning:\n  antenna_offset_x: ${mm(typedX)}\n  antenna_offset_y: ${mm(typedY ?? 0)}`
    : '';

  const fields = (
    mowerAntenna && (
      <>
        <p className={styles.dim}>
          {own ? tr(
            "Important: the GPS antenna's position has to be exact. MowBite OS works out the mower's position from it, the green dot. Measure it to the centimetre: if it is off, the mower's position, the outline and the cut strip are off by as much, and in turns the position swings. It is saved with the sizes.",
          ) : tr(
            "Important: the GPS antenna's position has to be exact. OpenMower works out the mower's position from it with antenna_offset_x {x} cm (ahead of the middle of the rear wheels, behind is minus) and antenna_offset_y {y} cm (to the left) in mower_params.yaml, the green dot. Measure it to the centimetre: if it is off, the mower's position, the outline and the cut strip are off by as much, and in turns the position swings.",
            {x: Math.round(mowerAntenna.x * 1000) / 10, y: Math.round(mowerAntenna.y * 1000) / 10},
          )}
        </p>
        <div className={local.grid}>
          <label className={styles.field}>
            {tr(ANTENNA_LABELS.antenna_x)} (cm)
            <input inputMode="decimal" value={antennaText.x} onChange={(e) => setAntennaForm({...antennaText, x: e.target.value})} />
          </label>
          <label className={styles.field}>
            {tr(ANTENNA_LABELS.antenna_y)} (cm)
            <input inputMode="decimal" value={antennaText.y} onChange={(e) => setAntennaForm({...antennaText, y: e.target.value})} />
          </label>
        </div>
        {yamlLines && (
          <>
            <p className={styles.dim}>
              {tr(
                'OpenMower takes the antenna only from its mower_params.yaml, the app cannot set it. Put these lines there (replacing the ones it has) and restart OpenMower, e.g. with openmower restart:',
              )}
            </p>
            <div className={local.command}>
              <code>{yamlLines}</code>
              <CopyButton text={yamlLines} className={styles.pillButton} />
            </div>
          </>
        )}
      </>
    )
  );
  const bad = !antennaForm ? null : typedX === null && antennaText.x.trim() ? 'antenna_x' : typedY === null && antennaText.y.trim() ? 'antenna_y' : null;
  return {
    antenna,
    fields: mowerAntenna ? fields : null,
    typed: own && antennaChanged ? {x: mm(typedX), y: mm(typedY ?? 0)} : null,
    bad,
    clear: () => setAntennaForm(null),
  };
}
