'use client';

import {CopyButton} from '@/lib/clipboard';
import {tr} from '@/lib/i18n';

// lines for mower_params.yaml to enter by hand, to copy; note: under the lines
export function HandLines({yaml, code, button, buttons, note}: {yaml: string; code: string; button?: string; buttons?: string; note?: React.ReactNode}) {
  return (
    <>
      <p>{tr('Enter them in {file} and restart OpenMower ({cmd}).', {file: 'mower_params.yaml', cmd: 'openmower restart'})}</p>
      <pre className={code}>{yaml}</pre>
      {note}
      <div className={buttons}>
        <CopyButton text={yaml} className={button} />
      </div>
    </>
  );
}
