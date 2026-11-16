'use client';

import {useRpcMethods} from '@/hooks/useRpcMethods';
import {sendCall} from '@/hooks/useMowerActions';
import {describe, parseEvent, type MowerEvent} from '@/lib/events';
import {tr} from '@/lib/i18n';
import {onTopic} from '@/lib/mqttClient';
import {useDockTestSeries} from '@/lib/mowerOs';
import {DOCK_TEST_REACH, DOCK_TEST_RUNS, RPC, TOPIC} from '@/lib/openmower';
import {useEffect, useState} from 'react';

// docking by the dock camera alone, as a test: only where the mower lists it, idle beside the station, after a warning.
// several dockings in a row where the mower takes runs, the warning then is for all of them. how the last run ended
// stays under it while the mower docks or is idle
export function DockingTest({styles, live, idle, state}: {styles: Record<string, string>; live: boolean; idle: boolean; state: string}) {
  const offered = !!useRpcMethods()?.has(RPC.dockingTest);
  const series = useDockTestSeries();
  const [asking, setAsking] = useState(false);
  const [runs, setRuns] = useState(1);
  const [ended, setEnded] = useState<MowerEvent | null>(null);
  useEffect(() => {
    if (!offered) return;
    return onTopic(TOPIC.events, (payload) => {
      const e = parseEvent(payload.toString());
      if (e?.type === 'DOCKING_TEST_RUN') setEnded(e);
    });
  }, [offered]);
  if (ended && state !== 'DOCKING' && state !== 'IDLE') setEnded(null);
  if (!offered) return null;
  const said = ended && describe(ended, undefined, true);
  const run = said && <p className={[styles.commandNote, said.severity === 'info' ? '' : styles.warn].join(' ')}>{said.text}</p>;
  if (!idle) return run;
  if (!asking)
    return (
      <>
        {run}
        <button className={styles.dockTestButton} disabled={!live} onClick={() => setAsking(true)}>
          {tr('Test docking by camera')}
        </button>
      </>
    );
  return (
    <div className={styles.resetJob}>
      <span>
        {runs > 1
          ? tr(
              'The mower drives off by itself and docks {n} times in a row by the dock camera alone, without map or GPS. After each docking it drives out of the station by itself and docks again. Stay at the STOP button until the last one is done.',
              {n: runs},
            )
          : tr('The mower drives off by itself and docks by the dock camera alone, without map or GPS. Stay at the STOP button.')}{' '}
        {tr('Put it in front of the station first: at most {cm} cm beside the line straight out of it, less than {deg}° skewed.', DOCK_TEST_REACH)}
      </span>
      {series && (
        <label className={styles.dockTestRuns}>
          {tr('Dockings in a row')}
          <select value={runs} onChange={(e) => setRuns(Number(e.target.value))}>
            {Array.from({length: DOCK_TEST_RUNS}, (_, i) => (
              <option key={i + 1} value={i + 1}>
                {i + 1}
              </option>
            ))}
          </select>
        </label>
      )}
      <button
        className={styles.reset}
        disabled={!live}
        onClick={() => {
          setAsking(false);
          setEnded(null);
          sendCall(RPC.dockingTest, runs > 1 ? {runs} : {});
        }}
      >
        {tr('Start the test')}
      </button>
      <button onClick={() => setAsking(false)}>{tr('Cancel')}</button>
    </div>
  );
}
