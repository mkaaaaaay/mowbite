'use client';

import {gardenExport, scrub} from '@/lib/gardenExport';
import {settingsStore} from '@/lib/settings';
import {buildDiagnosis, mergePlanner, readKeptPlan, readKeptPlanner, readSensors, type KeptPlan, type PlannerLine} from '@/lib/diagnosis';
import type {MowerMap} from '@/hooks/useMowerMap';
import {openRings} from '@/lib/rings';
import {clock} from '@/lib/dates';
import type {Run} from '@/lib/events';
import {gpsLog, gpsLogSince} from '@/lib/gpslog';
import {inEnglish, tr} from '@/lib/i18n';
import {loadKept} from '@/lib/mowerParams';
import {loadPlannerSettings, type PlannerSettings} from '@/lib/mowerBody';
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
    const snapshot = (kind: 'params' | 'planner' | 'map') =>
      quiet(
        mowerFetch(`${apiBase()}/cgi-bin/gpslog?snapshot=${Math.round(run.start)}&kind=${kind}`, {cache: 'no-store'}).then(async (r) => {
          const text = r.ok ? (await r.text()).trim() : '';
          return text ? (JSON.parse(text) as Record<string, unknown>) : null;
        }),
        null,
      );
    const [kept, planner, gps, ros, plannerLog, sensorsText, drive, snapParams, snapPlanner, plannerKept, startMap, plans] = await Promise.all([
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
      // what the container kept of the planner's log, also from before the planner's last start
      quiet(
        mowerFetch(`${apiBase()}/cgi-bin/plannerlog?from=${Math.floor(from)}&to=${Math.ceil(to)}`, {cache: 'no-store'}).then(async (r) =>
          r.ok ? readKeptPlanner(await r.text()) : [],
        ),
        [] as PlannerLine[],
      ),
      // the map as the run left the dock, and the plan of every area it started on
      snapshot('map') as Promise<MowerMap | null>,
      quiet(
        mowerFetch(`${apiBase()}/cgi-bin/gpslog?plans&from=${Math.floor(from)}&to=${Math.ceil(to)}`, {cache: 'no-store'})
          .then((r) => (r.ok ? r.text() : ''))
          .then((text) =>
            Promise.all(
              text
                .split('\n')
                .map((l) => l.trim().split(' '))
                .filter((p) => p.length === 2)
                .map(([t, id]) =>
                  mowerFetch(`${apiBase()}/cgi-bin/gpslog?plan=${t}-${id}`, {cache: 'no-store'})
                    .then((r) => (r.ok ? r.json() : null))
                    .then((a) => readKeptPlan(Number(t), id, a))
                    .catch(() => null),
                ),
            ),
          )
          .then((all) => all.filter((p): p is KeptPlan => !!p).sort((a, b) => a.t - b.t)),
        [] as KeptPlan[],
      ),
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
        plannerLines: mergePlanner(plannerKept, plannerLog),
        sensors: readSensors(sensorsText),
        drive,
        // the same shape as the map the app has (outlines not closed), so the two compare
        startMap: startMap && Array.isArray(startMap.areas) ? openRings(startMap) : null,
        plans,
        garden: gardenExport({
          created: Date.now() / 1000,
          appVersion: APP_VERSION,
          methods: methods ? [...methods].sort() : null,
          map,
          planner,
          params,
          sizes: settingsStore.snapshot().mower,
          startMap,
          startPlanner: (snapPlanner?.result as PlannerSettings | undefined) ?? null,
          startParams: snapParams,
          plans,
        }),
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

// the garden on its own (lib/gardenExport), without a run: from the settings
export function GardenDownload({className}: {className?: string}) {
  const params = useMowerParams();
  const map = useMowerMap();
  const [state, setState] = useState<'idle' | 'busy' | 'failed'>('idle');

  const make = async () => {
    const methods = await rpcMethods();
    const planner = methods?.has(RPC.plannerSettings) ? await quiet(loadPlannerSettings(true), null) : null;
    const now = Date.now() / 1000;
    const garden = gardenExport({
      created: now,
      appVersion: APP_VERSION,
      methods: methods ? [...methods].sort() : null,
      map,
      planner,
      params,
      sizes: settingsStore.snapshot().mower,
    });
    const d = new Date(now * 1000);
    const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    await saveFile(`mowbite-garden-${day}-${clock(now).replace(':', '')}.json`, scrub(JSON.stringify(garden, null, 1)), 'application/json');
  };

  return (
    <button
      className={className}
      disabled={state === 'busy' || !map}
      onClick={() => {
        setState('busy');
        make().then(
          () => setState('idle'),
          () => setState('failed'),
        );
      }}
    >
      {state === 'failed' ? tr('failed') : state === 'busy' ? tr('loading…') : tr('Save the garden as a file')}
    </button>
  );
}
