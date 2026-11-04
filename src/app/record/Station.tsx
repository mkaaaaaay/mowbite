'use client';

import {CheckIcon, HomeIcon} from '@/components/icons';
import DriveView, {driveStyles as ds, type Driving} from '@/components/DriveView';
import {saveMap, useMowerMap, type DockingStation} from '@/hooks/useMowerMap';
import {numParam, useMowerParams} from '@/hooks/useMowerParams';
import {useSensorValue} from '@/hooks/useMowerSensors';
import {isLive, useMowerState} from '@/hooks/useMowerState';
import {saveBackup} from '@/lib/backups';
import {antennaOf, besideStep, OUT, OUT_MIN, SETTLE_S, STAND_S, standOn, standPoint, stationChange, stationFrom, wayCheck, type Point, type Pose, type Stand, type Station} from '@/lib/dockGuide';
import {tick} from '@/lib/haptics';
import {fmt, tr} from '@/lib/i18n';
import {onTopic} from '@/lib/mqttClient';
import {PARAM, TOPIC} from '@/lib/openmower';
import {rpcErrorText} from '@/lib/rpcText';
import {generateId} from '@/lib/splitPolygon';
import {onCharger} from '@/lib/status';
import {useEffect, useRef, useState} from 'react';
import styles from './page.module.css';

// how wide the lane out of the station is drawn, about a mower
const LANE_W = 0.5;
// the stick let go this long ago: it stands (the wheels stop a moment after the last command)
const STILL_MS = 1500;
// the map this many metres across around the mower, close enough for centimetres
const SPANS = [4, 6, 8, 12, 16, 24, 32];
// fewer than this share of a stand's samples near its middle: the gps jumps there (multipath by a wall)
const STEADY = 0.7;
// saving: no answer this long, then it's said and can be tapped again (the same map written twice does no harm); the
// backup before it given this long
const SLOW_MS = 15000;
const BACKUP_MS = 15000;

const deg = (rad: number) => (Math.abs(rad) * 180) / Math.PI;

type Step = 'in' | 'dock' | 'out' | 'end' | 'ready' | 'home';
// what the position says, a few times a second: the antenna, the pose, how long it has stood (after settling) and where
// side: how far beside the station's line the way out went so far (besideStep summed up since the stand in it)
type Seen = {at: Point | null; pose: Pose | null; still: boolean; stood: number; point: (Point & {used: number; of: number; h?: number}) | null; side: number};
// where the antenna stood, OpenMower's heading meanwhile
type End = Point & {h?: number};

// the docking station recorded with a guide, also without one in the map yet or moved somewhere else: a few seconds
// standing in it until it charges, backed out straight (steered where the ground pushes it aside), a few seconds standing
// out there, then saved into the map (map.replace like the editor, a backup before). the station before plays no part,
// it may stand elsewhere now. OpenMower's record_dock takes the pose as it is, this goes by where the antenna was
// (lib/dockGuide). recording mode stays on
export default function StationGuide({
  drive,
  drift,
  remoteRef,
  onSaved,
  onExit,
  onClose,
}: {
  drive: Driving;
  // the heading running away while it stands, a line from the page
  drift?: React.ReactNode;
  remoteRef?: React.Ref<HTMLDivElement>;
  onSaved: (s: {station: Station; before: DockingStation | null}) => void;
  // end recording mode, close the guide in it
  onExit: () => void;
  onClose: () => void;
}) {
  const link = useMowerState();
  const {state} = link;
  const live = isLive(link);
  const map = useMowerMap();
  const params = useMowerParams();
  const charging = onCharger(state, useSensorValue('om_v_charge', (v) => v));
  const o = {x: numParam(params, PARAM.antennaX) ?? 0, y: numParam(params, PARAM.antennaY) ?? 0};
  // the gps in OpenMower's position: in recording mode with a fix, else 999 (idle it leaves the gps out)
  const inUse = (state?.pose.pos_accuracy ?? 999) < 1;

  // the station as it was when the guide started, the new one compared to it
  const [before, setBefore] = useState<DockingStation | null | undefined>(undefined);
  if (before === undefined && map) setBefore(map.docking_stations[0] ?? null);

  // the poses as they come: the antenna of each, a stand while the stick is let go and the gps is in
  const [seen, setSeen] = useState<Seen>({at: null, pose: null, still: false, stood: 0, point: null, side: 0});
  const offset = useRef(o);
  const gpsIn = useRef(inUse);
  useEffect(() => {
    offset.current = o;
    gpsIn.current = inUse;
  });
  const {movedAt} = drive;
  // where it stood in the station, for the way out summed up from there
  const insideRef = useRef<End | null>(null);
  useEffect(() => {
    let stand: Stand | null = null;
    let shown = 0;
    let side = 0;
    let last: Point | null = null;
    let from: End | null = null;
    return onTopic(TOPIC.position, (payload) => {
      let p: Pose;
      try {
        const raw = JSON.parse(payload.toString());
        if (typeof raw.x !== 'number' || typeof raw.y !== 'number') return;
        p = {x: raw.x, y: raw.y, heading: raw.heading ?? 0};
      } catch {
        return;
      }
      const now = performance.now();
      const t = now / 1000;
      const at = antennaOf(p, offset.current);
      stand = !gpsIn.current || now - movedAt.current < STILL_MS ? null : standOn(stand, {...at, t, h: p.heading});
      const ins = insideRef.current;
      if (ins !== from) {
        from = ins;
        side = 0;
        last = null;
      }
      if (ins?.h !== undefined) {
        if (last) side += besideStep(ins.h, last, {...at, h: p.heading});
        last = at;
      }
      if (now - shown < 250) return;
      shown = now;
      const stood = stand ? Math.max(0, t - stand.t0 - SETTLE_S) : 0;
      setSeen({at, pose: p, still: !!stand, stood, point: stand && stood > 0 ? standPoint(stand.points, stand.t0 + SETTLE_S) : null, side});
    });
  }, [movedAt]);

  // the antenna standing in the station and out in front of it; said by the user: on the contacts without a charge
  const [inside, setInside] = useState<End | null>(null);
  const [outside, setOutside] = useState<End | null>(null);
  useEffect(() => {
    insideRef.current = inside;
  }, [inside]);
  const [contacts, setContacts] = useState(false);
  const [saved, setSaved] = useState<{station: Station; before: DockingStation | null} | null>(null);
  const out = inside && seen.at ? Math.hypot(seen.at.x - inside.x, seen.at.y - inside.y) : 0;
  const step: Step = saved ? 'home' : !inside ? (charging || contacts ? 'dock' : 'in') : !outside ? (out >= OUT_MIN && seen.still ? 'end' : 'out') : 'ready';
  // a stand long enough: taken. moved on after the one out there: that's measured again where it stops
  const done = seen.point && seen.stood >= STAND_S ? {x: seen.point.x, y: seen.point.y, h: seen.point.h} : null;
  if (step === 'dock' && done) setInside(done);
  if (step === 'end' && done) setOutside(done);
  if (step === 'ready' && !seen.still) setOutside(null);
  // the eyes are on the mower: a tick for each end measured, and once it charges again
  useEffect(() => {
    if (inside) tick();
  }, [inside]);
  useEffect(() => {
    if (outside) tick();
  }, [outside]);
  useEffect(() => {
    if (saved && charging) tick();
  }, [saved, charging]);

  // saves under way (tapped again while one has no answer yet), whether that's long
  const [saving, setSaving] = useState(false);
  const pending = useRef(0);
  const [slow, setSlow] = useState(false);
  if (slow && !saving) setSlow(false);
  useEffect(() => {
    if (!saving) return;
    const t = setTimeout(() => setSlow(true), SLOW_MS);
    return () => clearTimeout(t);
  }, [saving]);
  const [error, setError] = useState<string | null>(null);
  // the backup before saving failed: the next tap saves without one
  const [withoutBackup, setWithoutBackup] = useState(false);
  const save = async () => {
    if (!map || !inside || !outside) return;
    pending.current++;
    setSaving(true);
    setError(null);
    const station = stationFrom(inside, outside, o);
    try {
      if (!withoutBackup) {
        try {
          await Promise.race([
            saveBackup(map, 'before recording the docking station', true),
            new Promise<never>((_, reject) => setTimeout(() => reject(new Error(tr('no answer'))), BACKUP_MS)),
          ]);
        } catch (e) {
          setWithoutBackup(true);
          setError(
            tr("The map on the mower couldn't be backed up first ({why}). Tap save again to save without that backup.", {
              why: e instanceof Error ? e.message : tr('failed'),
            }),
          );
          return;
        }
      }
      const was = map.docking_stations[0];
      await saveMap({...map, docking_stations: [{...was, id: was?.id ?? generateId(), position: station.position, heading: station.heading}, ...map.docking_stations.slice(1)]});
      const s = {station, before: before ?? null};
      setSaved(s);
      onSaved(s);
    } catch (e) {
      setError(rpcErrorText(e));
    } finally {
      if (--pending.current === 0) setSaving(false);
    }
  };
  // the way out bent (only while OpenMower had the heading right in the station), or its heading off there
  const check = inside?.h !== undefined && outside ? wayCheck(inside as Point & {h: number}, outside, seen.side) : null;
  // ending recording mode away from the station asks once more: the stick doesn't drive it any more after
  const [sure, setSure] = useState(false);
  const end = () => {
    if (!charging && !sure) return setSure(true);
    drive.stop();
    onExit();
  };

  // where the map looks: the station it goes to or comes from, the mower near it
  const pose = seen.pose ?? state?.pose ?? null;
  const target = saved?.station.position ?? inside ?? before?.position ?? null;
  const toTarget = target && pose ? Math.hypot(target.x - pose.x, target.y - pose.y) : null;
  const span = toTarget === null ? 6 : (SPANS.find((s) => s >= (toTarget + 0.5) / 0.22) ?? SPANS[SPANS.length - 1]);

  // what to do now
  let say: React.ReactNode;
  let bar: {share: number; label: string} | null = null;
  const standBar = () => ({share: seen.stood / STAND_S, label: tr('{a} of {b} s', {a: fmt(Math.min(seen.stood, STAND_S), 0), b: fmt(STAND_S, 0)})});
  if (step === 'in') {
    say = (
      <>
        <b>{tr('Drive it into the docking station until it charges')}</b>
      </>
    );
  } else if ((step === 'dock' || step === 'end') && !inUse) {
    say = (
      <>
        <b>{tr('Waiting for an RTK fix')}</b> · {tr('it measures once there is one')}
      </>
    );
  } else if (step === 'dock') {
    say = (
      <>
        <b>{tr('Let it stand')}</b> · {tr('it measures where it charges')}
      </>
    );
    bar = standBar();
  } else if (step === 'out') {
    say =
      out < OUT_MIN ? (
        <>
          <b>{tr('Back it out straight')}</b> · {tr('{m} m to go', {m: fmt(Math.max(0.1, OUT_MIN - out), 1)})}
        </>
      ) : (
        <>
          <b>{tr('Far enough, let go')}</b> · {tr('up to {m} m makes the direction more accurate', {m: '1½'})}
        </>
      );
    bar = {share: out / OUT, label: tr('{a} of {b} m', {a: fmt(Math.min(out, OUT), 1), b: '1½'})};
  } else if (step === 'end') {
    say = (
      <>
        <b>{tr('Let it stand')}</b> · {tr('it measures the way out')}
      </>
    );
    bar = standBar();
  } else if (step === 'ready') {
    say = (
      <>
        <b>{tr('Measured.')}</b> {tr('Now save the docking station.')}
      </>
    );
  } else {
    say =
      charging || (toTarget !== null && toTarget < 0.1) ? (
        <b>{tr('On the station. Now end recording mode.')}</b>
      ) : (
        <>
          <b>{tr('Back into the station')}</b>
          {toTarget !== null && <> · {tr('{m} m to go', {m: fmt(toTarget, 1)})}</>}
        </>
      );
  }
  if (saving) say = <b>{tr('Saving the docking station…')}</b>;
  if (step === 'ready' && check?.bent && !saving)
    say = (
      <>
        <b>{tr('Not quite straight.')}</b> {tr('Better back in and out once more, or save it like this.')}
      </>
    );
  const jumps = seen.point && (step === 'dock' || step === 'end') && seen.point.used / seen.point.of < STEADY;
  const missed = (
    <>
      {error && <em className={ds.missed}>{error}</em>}
      {jumps && <em className={ds.missed}>{tr('The GPS jumps here, it leaves the jumps out.')}</em>}
      {slow && <em className={ds.missed}>{tr('No answer from the mower yet. If nothing happens, tap save once more.')}</em>}
      {step === 'ready' && check?.bent && (
        <em className={ds.missed}>
          {tr("It didn't stay quite on its line, about {cm} cm beside it at the end: the direction may be about {n}° off.", {
            cm: fmt(Math.abs(seen.side) * 100, 0),
            n: fmt(deg(check.err), 0),
          })}
        </em>
      )}
      {drift}
    </>
  );

  // on the map: the station before while it drives in, the lane out of the station, the way in once measured, the way
  // back in once saved
  const draw: NonNullable<React.ComponentProps<typeof DriveView>['draw']> = ({toScreen, k}) => {
    const arrow = (from: Point, to: Point, ok: boolean) => {
      const [fx, fy] = toScreen(from.x, from.y);
      const [sx, sy] = toScreen(to.x, to.y);
      const len = Math.hypot(sx - fx, sy - fy) || 1;
      const [ux, uy] = [(sx - fx) / len, (sy - fy) / len];
      const [bx, by] = [sx - ux * 14 * k, sy - uy * 14 * k];
      const head = [
        [sx, sy],
        [bx - uy * 8 * k, by + ux * 8 * k],
        [bx + uy * 8 * k, by - ux * 8 * k],
      ];
      return (
        <g className={ok ? ds.laneDone : ds.lane}>
          <line x1={fx} y1={fy} x2={bx} y2={by} className={ds.wayIn} strokeWidth={4 * k} />
          <polygon points={head.map((p) => p.join(',')).join(' ')} className={ds.wayInHead} />
        </g>
      );
    };
    if (saved) return pose && !charging && (toTarget ?? 0) >= 0.1 ? arrow(pose, saved.station.position, false) : null;
    if (inside && outside) return arrow(outside, inside, true);
    if (inside) {
      const [ix, iy] = toScreen(inside.x, inside.y);
      const dot = <circle cx={ix} cy={iy} r={5 * k} className={ds.laneEnd} fill="currentColor" strokeWidth={2 * k} />;
      if (!seen.at || out < 0.1) return <g className={ds.lane}>{dot}</g>;
      // the way out so far, on to the far end
      const h = Math.atan2(seen.at.y - inside.y, seen.at.x - inside.x);
      const at = (along: number, side: number) => toScreen(inside.x + Math.cos(h) * along - Math.sin(h) * side, inside.y + Math.sin(h) * along + Math.cos(h) * side);
      const box = (a: number, b: number) => [at(a, LANE_W / 2), at(b, LANE_W / 2), at(b, -LANE_W / 2), at(a, -LANE_W / 2)].map((p) => p.join(',')).join(' ');
      const mark = (along: number, w: number) => {
        const [x1, y1] = at(along, LANE_W * w);
        const [x2, y2] = at(along, -LANE_W * w);
        return <line x1={x1} y1={y1} x2={x2} y2={y2} className={ds.laneEnd} strokeWidth={(w > 0.6 ? 3 : 1.5) * k} />;
      };
      const [lx, ly] = at(OUT + 0.45, 0);
      return (
        <g className={out >= OUT_MIN ? ds.laneDone : ds.lane}>
          <polygon className={ds.laneAll} points={box(0, OUT)} strokeWidth={1.5 * k} />
          <polygon className={ds.laneGot} points={box(0, Math.min(out, OUT))} />
          {mark(OUT_MIN, 0.5)}
          {mark(OUT, 1)}
          {dot}
          <text x={lx} y={ly} fontSize={13 * k} className={ds.laneText} textAnchor="middle" dominantBaseline="middle">
            1½ m
          </text>
        </g>
      );
    }
    // (it may stand elsewhere now)
    if (!before) return null;
    const [sx, sy] = toScreen(before.position.x, before.position.y);
    return (
      <g className={ds.station}>
        <circle cx={sx} cy={sy} r={14 * k} strokeWidth={3 * k} />
        <text x={sx} y={sy - 22 * k} fontSize={12 * k} textAnchor="middle">
          {tr('Station before')}
        </text>
      </g>
    );
  };

  const change = saved?.before ? stationChange(saved.before, saved.station) : null;
  const buttons = (main: string, warn: string, danger: string) => (
    <>
      {step === 'in' && seen.still && seen.stood >= 3 && (
        // its power may be off: the user says it's on the contacts
        <button className={warn} disabled={!live} onClick={() => setContacts(true)}>
          {tr('It stands on the contacts')}
        </button>
      )}
      {(step === 'ready' || saving) && (
        <button className={main} disabled={!live || (saving && !slow)} onClick={() => void save()}>
          <HomeIcon size={18} />
          {tr('Save docking station')}
        </button>
      )}
      {step === 'home' && (
        <>
          {charging || !sure ? (
            <button className={charging ? main : undefined} disabled={!live} onClick={end}>
              {charging && <CheckIcon size={18} />}
              {tr('End recording mode')}
            </button>
          ) : (
            <button className={warn} disabled={!live} onClick={end}>
              {tr('End it anyway')}
            </button>
          )}
          <button onClick={onClose}>{tr('Record areas')}</button>
        </>
      )}
      {step !== 'home' && (
        <button className={danger} onClick={onClose}>
          {tr('Cancel')}
        </button>
      )}
    </>
  );

  return (
    <DriveView
      drive={drive}
      say={say}
      missed={missed}
      bar={saving ? null : bar}
      ok={step === 'ready' || (step === 'home' && charging)}
      status={step === 'home' ? tr('Docking station saved') : tr('Docking station · {n} of 3', {n: step === 'in' || step === 'dock' ? 1 : step === 'ready' ? 3 : 2})}
      span={span}
      draw={draw}
      line={inside && !saved && <span>{tr('{m} m out', {m: fmt(out, 2)})}</span>}
      note={step === 'home' && sure && !charging ? tr("It isn't on the station yet, after this the stick doesn't drive it any more.") : undefined}
      close={{label: step === 'home' ? tr('Close') : tr('Cancel'), onClick: onClose}}
      remoteRef={remoteRef}
      bottom={<div className={ds.remoteButtons}>{buttons(ds.primary, ds.warnButton, ds.danger)}</div>}
    >
      {saved && (
        <div className={styles.saved}>
          <CheckIcon size={18} />
          <span>
            <b>{tr('Docking station saved')}</b>{' '}
            {!change
              ? tr('New in the map.')
              : change.moved < 0.005 && deg(change.turned) < 0.5
                ? tr('In the same place as before.')
                : tr('{cm} cm and {deg}° from the one before.', {cm: fmt(change.moved * 100, 0), deg: fmt(deg(change.turned), 1)})}
          </span>
        </div>
      )}
      {step === 'home' && sure && !charging && <p className={ds.warn}>{tr("It isn't on the station yet, after this the stick doesn't drive it any more.")}</p>}
      {/* OpenMower takes its heading from the station in the map when it docks: a wrong one shows the mower turned */}
      {check && Math.abs(check.off) > (20 * Math.PI) / 180 && (step === 'ready' || step === 'home') && (
        <p className={ds.dim}>
          {tr("OpenMower's heading was {n}° off in the station, so the mower was shown turned until it drove a bit. It takes the heading from the station saved here when it docks next.", {
            n: fmt(deg(check.off), 0),
          })}
        </p>
      )}
      <p className={ds.dim}>
        {step === 'in' || step === 'dock'
          ? tr('First it stands in the station a few seconds, then you back it out straight 1 to 1½ m and it stands there a few seconds too. The way between becomes its docking direction.')
          : step === 'home'
            ? tr('Saved in the map, the map before is in the backups. Drive it back into the station and end recording mode, or record areas first.')
            : tr('Back it out straight, steer a little where the ground pushes it aside. Further out makes the direction more accurate.')}
      </p>
      <div className={styles.buttons}>{buttons(ds.primary, ds.warnButton, ds.danger)}</div>
    </DriveView>
  );
}
