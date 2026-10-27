'use client';

import {rememberArmed} from '@/hooks/useLeftoversBefore';
import type {MowerMap} from '@/hooks/useMowerMap';
import {fmt, tr} from '@/lib/i18n';
import {askLeftovers, type Leftovers} from '@/lib/leftovers';
import {loadPlannerSettings, slic3rPlans, usePlannerSettings} from '@/lib/mowerBody';
import {RPC} from '@/lib/openmower';
import {RpcError, rpcMethods} from '@/lib/rpc';
import {useEffect, useState} from 'react';

// On the dashboard while the mower stands idle: what the last finished mow left unmowed (the MowBite Planner looks at
// its real track), and a button to mow just that. The planner is armed and the mower started the usual way, it drives
// the passes over the leftovers in place of the plans

export function LeftoversCard({
  jobId,
  map,
  live,
  interrupted,
  onStart,
  styles,
}: {
  // the last finished mow, the latest track without it
  jobId?: string;
  map: MowerMap | null;
  live: boolean;
  // a job still open: a start goes on with it from its area on, and gets the leftovers there in place of its plans
  interrupted?: boolean;
  // starts mowing (the usual action)
  onStart: () => void;
  styles: Record<string, string>;
}) {
  const [known, setKnown] = useState(false);
  const [state, setState] = useState<{busy?: boolean; found?: Leftovers; error?: string; started?: boolean}>({});
  const planner = usePlannerSettings();
  useEffect(() => {
    void rpcMethods().then((m) => setKnown(!!m?.has(RPC.plannerLeftovers)));
  }, []);
  useEffect(() => {
    if (known && planner === undefined) loadPlannerSettings().catch(() => {});
  }, [known, planner]);
  // OpenMower's slic3r planner plans no leftovers
  if (!known || slic3rPlans(planner)) return null;

  const name = (id: string) => map?.areas.find((a) => a.id === id)?.properties.name || tr('unnamed');
  const fail = (e: unknown) => setState({error: e instanceof RpcError && e.code !== 'timeout' ? e.message : tr('The mower did not answer.')});
  const check = async () => {
    setState({busy: true});
    try {
      const found = await askLeftovers({jobId});
      setState(found ? {found} : {});
    } catch (e) {
      fail(e);
    }
  };
  const mow = async () => {
    setState({...state, busy: true});
    try {
      const armed = await askLeftovers({jobId, arm: true});
      if (!armed || armed.armed <= 0) return setState({error: tr("The planner didn't take it.")});
      if (jobId) rememberArmed(jobId);
      onStart();
      setState({found: armed, started: true});
    } catch (e) {
      fail(e);
    }
  };

  const found = state.found;
  const left = found?.areas.filter((a) => a.passes > 0) ?? [];
  const names = (areas: {id: string}[]) => areas.map((a) => name(a.id)).join(', ');
  const leftOut = found?.areas.filter((a) => a.reason === 'most_left') ?? [];
  const whole = found?.areas.filter((a) => a.whole) ?? [];
  const other = found?.areas.filter((a) => a.passes === 0 && a.message && !a.reason && !a.whole) ?? [];
  return (
    <div className={styles.leftovers}>
      {!found && (
        <button className={styles.leftoversButton} disabled={!live || state.busy} onClick={() => void check()}>
          {state.busy ? tr('Looking at the track…') : tr('Check the last mow for leftovers')}
        </button>
      )}
      {found && (
        <span>
          {left.length === 0
            ? tr('Nothing worth another pass is left from the last mow.')
            : tr('{m2} m² left in {n} passes: {areas}.', {
                m2: fmt(found.m2, found.m2 < 1 ? 2 : 1),
                n: found.passes,
                areas: left.map((a) => `${name(a.id)} (${fmt(a.m2, a.m2 < 1 ? 2 : 1)} m²)`).join(', '),
              })}
          {leftOut.length > 0 && <small>{tr('Left out, hardly mowed last time: {areas}. A normal start mows them.', {areas: names(leftOut)})}</small>}
          {whole.length > 0 && (
            <small className={styles.error}>
              {tr('Hardly mowed last time: {areas}. This MowBite Planner mows them completely along with the leftovers, a newer one leaves them out.', {
                areas: names(whole),
              })}
            </small>
          )}
          {/* (the planner's own words why, in English) */}
          {other.length > 0 && (
            <small>{other.map((a) => tr('{area}: the planner found no passes ({why})', {area: name(a.id), why: a.message ?? ''})).join(' · ')}</small>
          )}
          {left.length > 0 && interrupted && !state.started && (
            <small>{tr('An interrupted job is still open, a start goes on with it. Drop it first to mow just the leftovers.')}</small>
          )}
        </span>
      )}
      {found && left.length > 0 && !interrupted && !state.started && (
        <button className={styles.leftoversButton} disabled={!live || state.busy} onClick={() => void mow()}>
          {state.busy ? tr('Starting…') : tr('Mow just the leftovers')}
        </button>
      )}
      {state.started && (
        <small>
          {whole.length > 0
            ? tr('Started. The mower drives those passes, {areas} it mows completely.', {areas: names(whole)})
            : tr('Started. The mower drives only those passes and skips the other areas.')}
        </small>
      )}
      {found && !state.started && (
        <button className={styles.leftoversButton} disabled={state.busy} onClick={() => setState({})}>
          {tr('Close')}
        </button>
      )}
      {state.error && <span className={styles.error}>{state.error}</span>}
    </div>
  );
}
