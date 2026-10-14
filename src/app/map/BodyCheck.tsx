'use client';

import type {PlanRequest} from '@/lib/areaPlan';
import {fmt, tr} from '@/lib/i18n';
import {checkBody, spotPlaces, usePlannerSettings, type BodyCheck as Result, type BodySpot} from '@/lib/mowerBody';
import type {PlanChecks as Checks} from '@/lib/mowPlan';
import {RpcError} from '@/lib/rpc';
import {useEffect, useMemo, useState} from 'react';
import styles from './page.module.css';

const KINDS: Record<string, string> = {
  turn: 'turn between lanes',
  spin: 'turning on the spot',
  lane_end: 'end of a lane',
  loop: 'corner of a loop',
  transit: 'drive between parts',
};

// The plan of the selected area checked against the mower's body by the MowBite Planner: where the body would stick
// out further than the map allows, one body drawn on the map for each place. Asked on demand, the check takes a few
// seconds on the mower. Only for the plan it was asked for: anything changed (the angle, a point) and it's gone.
export function BodyCheck({request, onSpots}: {request: PlanRequest | null; onSpots: (spots: BodySpot[] | null) => void}) {
  const [state, setState] = useState<{key: string; busy?: boolean; result?: Result | null; error?: string} | null>(null);
  const recorded = usePlannerSettings()?.settings.edges?.value !== 'hard';
  const key = request ? JSON.stringify(request) : '';
  // an older answer doesn't fit what's edited now
  const current = state?.key === key ? state : null;
  const places = useMemo(() => spotPlaces(current?.result?.spots ?? []), [current]);

  // the map shows the places of the answer that fits, none otherwise
  useEffect(() => onSpots(places.length ? places.map((p) => p.spot) : null), [places, onSpots]);
  // no plan from the mower right now (it's being worked out for a change), another area: its places go too
  useEffect(() => () => onSpots(null), [onSpots]);

  if (!request) return null;

  const run = async () => {
    setState({key, busy: true});
    try {
      setState({key, result: await checkBody(request)});
    } catch (e) {
      setState({key, error: e instanceof RpcError && e.code !== 'timeout' ? e.message : tr('The mower did not answer.')});
    }
  };

  const kinds = [...new Set(places.flatMap((p) => p.kinds))].map((k) => tr(KINDS[k] ?? k));
  return (
    <div className={styles.bodyCheck}>
      <button className={styles.pillButton} onClick={run} disabled={current?.busy}>
        {current?.busy ? tr('Checking…') : tr('Check against the mower body')}
      </button>
      {current?.result === null && <span className={styles.dim}>{tr('Only with the MowBite Planner on the mower.')}</span>}
      {current?.result &&
        (places.length ? (
          <span className={styles.warningText}>
            {tr('{n} spots where the body would stick out', {n: places.length})}
            {kinds.length > 0 && `: ${kinds.join(', ')}`}
          </span>
        ) : (
          <span className={styles.dim}>{tr('The body fits everywhere.')}</span>
        ))}
      {current?.error && <span className={styles.warningText}>{current.error}</span>}
      {recorded && places.some((p) => p.kinds.includes('loop')) && (
        <span className={styles.dim}>
          {tr(
            'Corners of the outline passes on lines driven along the edge: the check takes the wall to be half the width beyond the line everywhere, the mower drove there itself when recording. An outline offset for the area moves the passes in.',
          )}
        </span>
      )}
    </div>
  );
}

// the planner's lines it has words for here, the others as they come
function warningText(w: string): string {
  const ends = /^(\d+) lanes? shortened or left out where the body would stick out at (?:their|its) ends/.exec(w);
  if (ends) {
    const n = Number(ends[1]);
    return n === 1
      ? tr('1 lane shortened or left out at its ends, the body would stick out there')
      : tr('{n} lanes shortened or left out at their ends, the body would stick out there', {n});
  }
  return w;
}

// With a planner that checks the body in every plan (collision mode): what it found in the plan shown, no button.
// The places are on the map (MapView fitPlaces, turnPlaces)
export function PlanChecks({checks, on}: {checks: Checks | undefined; on: boolean}) {
  if (!on) return <span className={styles.dim}>{tr('Collision check off: the plan stays as it comes.')}</span>;
  const fixed = checks?.fixed ?? 0;
  const left = checks?.left ?? 0;
  const skipped = checks?.skipped ?? 0;
  return (
    <div className={styles.bodyCheck}>
      <span className={styles.dim}>{tr('Collision check on, with the mower sizes set.')}</span>
      {fixed > 0 && (
        <span className={styles.dim}>
          {fixed === 1 ? tr('1 place driven another way so the body fits') : tr('{n} places driven another way so the body fits', {n: fixed})}
          {skipped > 0 && `, ${tr('{m} m of loops and lanes left out there', {m: fmt(skipped, 1)})}`}
        </span>
      )}
      {left > 0 && (
        <span className={styles.warningText}>
          {left === 1 ? tr("1 place left out, the body doesn't fit there at all") : tr("{n} places left out, the body doesn't fit there at all", {n: left})}
        </span>
      )}
      {fixed + left === 0 && <span className={styles.dim}>{tr('The body fits everywhere.')}</span>}
      {(checks?.unchecked.length ?? 0) > 0 && (
        <div className={styles.warning}>
          {checks!.unchecked.length === 1
            ? tr('The plan starts or ends at 1 place without the body checked (cross on the map). OpenMower drives from or to there itself, without checking the body.')
            : tr('The plan starts or ends at {n} places without the body checked (crosses on the map). OpenMower drives from or to there itself, without checking the body.', {
                n: checks!.unchecked.length,
              })}
        </div>
      )}
      {(checks?.jumps.length ?? 0) > 0 && (
        <div className={styles.warning}>
          {checks!.jumps.length === 1
            ? tr("The path jumps at 1 place (cross on the map). OpenMower drives the way between the parts itself, without checking the body: it may go straight through a narrow place. Larger distances to obstacles usually help.")
            : tr("The path jumps at {n} places (crosses on the map). OpenMower drives the way between the parts itself, without checking the body: it may go straight through a narrow place. Larger distances to obstacles usually help.", {n: checks!.jumps.length})}
        </div>
      )}
      {(checks?.turns.length ?? 0) > 0 && <span className={styles.dim}>{tr('{n} turns still in the field of lanes', {n: checks!.turns.length})}</span>}
      {checks?.warnings.map((w, i) => (
        <span key={i} className={styles.dim}>
          {warningText(w)}
        </span>
      ))}
    </div>
  );
}
