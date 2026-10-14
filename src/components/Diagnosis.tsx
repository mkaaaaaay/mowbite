'use client';

import {buildDiagnosis, readSensors, type PlannerLine} from '@/lib/diagnosis';
import {clock} from '@/lib/dates';
import type {Run} from '@/lib/events';
import {gpsLog, gpsLogSince} from '@/lib/gpslog';
import {inEnglish, tr} from '@/lib/i18n';
import {loadKept} from '@/lib/mowerParams';
import {loadPlannerSettings} from '@/lib/mowerBody';
import {apiBase, mowerFetch} from '@/lib/mowers';
import {RPC} from '@/lib/openmower';
import {rosLogAround} from '@/lib/roslog';
import {callRpc, rpcMethods} from '@/lib/rpc';
import {saveFile} from '@/lib/saveFile';
import {APP_VERSION} from '@/lib/updates';
import {useMowerMap} from '@/hooks/useMowerMap';
import {numParam, useMowerParams} from '@/hooks/useMowerParams';
import {PARAM} from '@/lib/openmower';
import {useState} from 'react';

const quiet = <T,>(p: Promise<T>, fallback: T) => p.catch(() => fallback);

// everything about a run in one file: what the app shows about it, all the logs by time, the settings and the raw data
export function DiagnosisDownload({run}: {run: Run}) {
  const params = useMowerParams();
  const map = useMowerMap();
  const [state, setState] = useState<'idle' | 'busy' | 'failed'>('idle');

  const make = async () => {
    const from = run.start - 60;
    const to = run.end + 60;
    const methods = await rpcMethods();
    const has = (m: string) => !!methods?.has(m);
    const snapshot = (kind: 'params' | 'planner') =>
      quiet(
        mowerFetch(`${apiBase()}/cgi-bin/gpslog?snapshot=${Math.round(run.start)}&kind=${kind}`, {cache: 'no-store'}).then(async (r) => {
          const text = r.ok ? (await r.text()).trim() : '';
          return text ? (JSON.parse(text) as Record<string, unknown>) : null;
        }),
        null,
      );
    const [kept, planner, gps, ros, plannerLog, sensorsText, drive, snapParams, snapPlanner] = await Promise.all([
      quiet(loadKept(), null),
      has(RPC.plannerSettings) ? quiet(loadPlannerSettings(), null) : Promise.resolve(null),
      quiet(
        gpsLogSince().then((s) => (s !== null && to >= s ? gpsLog(from, to) : null)),
        null,
      ),
      quiet(rosLogAround(run.start, 60, run.end - run.start + 60), []),
      has(RPC.plannerLog) ? quiet(callRpc<{lines?: PlannerLine[]}>(RPC.plannerLog, {since: from}, 20000).then((a) => a?.lines ?? []), null) : Promise.resolve(null),
      quiet(
        mowerFetch(`${apiBase()}/cgi-bin/sensors`, {cache: 'no-store'}).then((r) => (r.ok ? r.text() : '')),
        '',
      ),
      run.jobId && has(RPC.plannerDrive) ? quiet(callRpc(RPC.plannerDrive, {job_id: run.jobId}, 30000), null) : Promise.resolve(null),
      snapshot('params'),
      snapshot('planner'),
    ]);
    // the planner's snapshot is its answer to planner.settings: {result: {settings: {name: {value}}}}
    const snapSettings = (snapPlanner?.result as {settings?: Record<string, {value: unknown}>} | undefined)?.settings;
    const text = inEnglish(() =>
      buildDiagnosis({
        run,
        appVersion: APP_VERSION,
        created: Date.now() / 1000,
        methods: methods ? [...methods].sort() : null,
        params,
        kept: kept?.values ?? null,
        map,
        planner: planner ? Object.fromEntries(Object.entries(planner.settings).map(([k, s]) => [k, s.value])) : null,
        gps,
        gpsLimit: numParam(params, PARAM.maxPositionAccuracy) ?? 0.2,
        ros,
        plannerLines: plannerLog,
        sensors: readSensors(sensorsText),
        drive,
        snapshot:
          snapParams || snapSettings
            ? {
                t: run.start,
                params: snapParams,
                planner: snapSettings ? Object.fromEntries(Object.entries(snapSettings).map(([k, v]) => [k, v?.value])) : null,
              }
            : null,
      }),
    );
    const d = new Date(run.start * 1000);
    const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    await saveFile(`mowbite-diagnosis-${day}-${clock(run.start).replace(':', '')}.txt`, text, 'text/plain');
  };

  return (
    <button
      disabled={state === 'busy'}
      onClick={() => {
        setState('busy');
        make().then(
          () => setState('idle'),
          () => setState('failed'),
        );
      }}
    >
      {state === 'failed' ? tr('failed') : state === 'busy' ? tr('loading…') : tr('Diagnosis file')}
    </button>
  );
}
