'use client';

import type {MowerMap} from '@/hooks/useMowerMap';
import {fmt, tr} from '@/lib/i18n';
import {askLeftovers, type Leftovers} from '@/lib/leftovers';
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
  onStart,
  styles,
}: {
  // the last finished mow, the latest track without it
  jobId?: string;
  map: MowerMap | null;
  live: boolean;
  // starts mowing (the usual action)
  onStart: () => void;
  styles: Record<string, string>;
}) {
  const [known, setKnown] = useState(false);
  const [state, setState] = useState<{busy?: boolean; found?: Leftovers; error?: string; started?: boolean}>({});
  useEffect(() => {
    void rpcMethods().then((m) => setKnown(!!m?.has(RPC.plannerLeftovers)));
  }, []);
  if (!known) return null;

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
      onStart();
      setState({found: armed, started: true});
    } catch (e) {
      fail(e);
    }
  };

  const found = state.found;
  const left = found?.areas.filter((a) => a.passes > 0) ?? [];
  return (
    <div className={styles.leftovers}>
      {!found && (
        <button className={styles.leftoversButton} disabled={!live || state.busy} onClick={() => void check()}>
          {state.busy ? tr('Looking at the track…') : tr('What did the last mow leave?')}
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
          {found.areas.some((a) => a.passes === 0 && a.message) && (
            <small>{found.areas.filter((a) => a.passes === 0 && a.message).map((a) => `${name(a.id)}: ${a.message}`).join(' · ')}</small>
          )}
        </span>
      )}
      {found && left.length > 0 && !state.started && (
        <button className={styles.leftoversButton} disabled={!live || state.busy} onClick={() => void mow()}>
          {state.busy ? tr('Starting…') : tr('Mow just the leftovers')}
        </button>
      )}
      {state.started && <small>{tr('Started. The mower drives only those passes and skips the areas with nothing left.')}</small>}
      {found && !state.started && (
        <button className={styles.leftoversButton} disabled={state.busy} onClick={() => setState({})}>
          {tr('Close')}
        </button>
      )}
      {state.error && <span className={styles.error}>{state.error}</span>}
    </div>
  );
}
