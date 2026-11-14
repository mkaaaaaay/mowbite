'use client';

import {useRpcMethods} from '@/hooks/useRpcMethods';
import {sendCall} from '@/hooks/useMowerActions';
import {tr} from '@/lib/i18n';
import {DOCK_TEST_REACH, RPC} from '@/lib/openmower';
import {useState} from 'react';

// docking by the dock camera alone, as a test: only where the mower lists it, idle beside the station, after a warning
export function DockingTest({styles, live, idle}: {styles: Record<string, string>; live: boolean; idle: boolean}) {
  const offered = !!useRpcMethods()?.has(RPC.dockingTest);
  const [asking, setAsking] = useState(false);
  if (!offered || !idle) return null;
  if (!asking)
    return (
      <button className={styles.dockTestButton} disabled={!live} onClick={() => setAsking(true)}>
        {tr('Test docking by camera')}
      </button>
    );
  return (
    <div className={styles.resetJob}>
      <span>
        {tr('The mower drives off by itself and docks by the dock camera alone, without map or GPS. Stay at the STOP button.')}{' '}
        {tr('Put it in front of the station first: at most {cm} cm beside the line straight out of it, less than {deg}° skewed.', DOCK_TEST_REACH)}
      </span>
      <button
        className={styles.reset}
        disabled={!live}
        onClick={() => {
          setAsking(false);
          sendCall(RPC.dockingTest);
        }}
      >
        {tr('Start the test')}
      </button>
      <button onClick={() => setAsking(false)}>{tr('Cancel')}</button>
    </div>
  );
}
