'use client';

import {numParam, useMowerParams} from '@/hooks/useMowerParams';
import {copyText} from '@/lib/clipboard';
import {tr} from '@/lib/i18n';
import {PARAM} from '@/lib/openmower';
import {useState} from 'react';
import local from './MowerSizesSettings.module.css';

type Styles = Record<string, string>;

const cm = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? String(Math.round(v * 1000) / 10) : '');
const metres = (text: string) => {
  const v = parseFloat(text.replace(',', '.'));
  return text.trim() && Number.isFinite(v) ? v / 100 : null;
};

// the GPS antenna under the mower's sizes (with the planner and without): where OpenMower has it, typed where it really
// sits, for the sketch; nothing without the mower's value
export function useAntennaFields(styles: Styles): {antenna?: {x: number; y: number}; fields: React.ReactNode} {
  const params = useMowerParams();
  const antennaX = numParam(params, PARAM.antennaX);
  const mowerAntenna = antennaX === undefined ? undefined : {x: antennaX, y: numParam(params, PARAM.antennaY) ?? 0};
  // where the antenna really sits, typed here: OpenMower reads it from its yaml at the start only (no params.set), so
  // the app hands over the lines to put there. the fields follow the mower's values until something is typed
  const [antennaForm, setAntennaForm] = useState<{x: string; y: string} | null>(null);
  const antennaText = antennaForm ?? {x: cm(mowerAntenna?.x), y: cm(mowerAntenna?.y)};
  const typedX = metres(antennaText.x);
  const typedY = metres(antennaText.y);
  const antenna = typedX !== null ? {x: typedX, y: typedY ?? 0} : mowerAntenna;
  const antennaChanged =
    !!antennaForm && typedX !== null && (!mowerAntenna || Math.abs(typedX - mowerAntenna.x) > 0.0005 || Math.abs((typedY ?? 0) - mowerAntenna.y) > 0.0005);
  const yamlLines = antennaChanged
    ? `xbot_positioning:\n  antenna_offset_x: ${Math.round(typedX * 1000) / 1000}\n  antenna_offset_y: ${Math.round((typedY ?? 0) * 1000) / 1000}`
    : '';
  const [copied, setCopied] = useState(false);

  const fields = (
    mowerAntenna && (
      <>
        <p className={styles.dim}>
          {tr(
            "Important: the GPS antenna's position has to be exact. OpenMower works out the mower's position from it with antenna_offset_x {x} cm (ahead of the middle of the rear wheels, behind is minus) and antenna_offset_y {y} cm (to the left) in mower_params.yaml, the green dot. Measure it to the centimetre: if it is off, the mower's position, the outline and the cut strip are off by as much, and in turns the position swings.",
            {x: Math.round(mowerAntenna.x * 1000) / 10, y: Math.round(mowerAntenna.y * 1000) / 10},
          )}
        </p>
        <div className={local.grid}>
          <label className={styles.field}>
            {tr('Antenna ahead of the rear axle')} (cm)
            <input inputMode="decimal" value={antennaText.x} onChange={(e) => setAntennaForm({...antennaText, x: e.target.value})} />
          </label>
          <label className={styles.field}>
            {tr('Antenna to the left of the middle')} (cm)
            <input inputMode="decimal" value={antennaText.y} onChange={(e) => setAntennaForm({...antennaText, y: e.target.value})} />
          </label>
        </div>
        {antennaChanged && (
          <>
            <p className={styles.dim}>
              {tr(
                'OpenMower takes the antenna only from its mower_params.yaml, the app cannot set it. Put these lines there (replacing the ones it has) and restart OpenMower, e.g. with openmower restart:',
              )}
            </p>
            <div className={local.command}>
              <code>{yamlLines}</code>
              <button
                className={styles.pillButton}
                onClick={() => {
                  copyText(yamlLines);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                }}
              >
                {copied ? tr('copied') : tr('Copy')}
              </button>
            </div>
          </>
        )}
      </>
    )
  );
  return {antenna, fields: mowerAntenna ? fields : null};
}
