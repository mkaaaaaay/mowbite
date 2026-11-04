'use client';

import {CheckIcon, PinIcon} from '@/components/icons';
import {useMowerActions} from '@/hooks/useMowerActions';
import {useMowerMap, type DockingStation} from '@/hooks/useMowerMap';
import {useMowerPosition} from '@/hooks/useMowerPosition';
import {useSensorValue} from '@/hooks/useMowerSensors';
import {isLive, useMowerState} from '@/hooks/useMowerState';
import {firstPointOff, inFront, OUT, OUT_MAX, OUT_MIN, SIDE, standing, stationChange, TURN} from '@/lib/dockGuide';
import {parseEvent, refusalText, type MowerEvent} from '@/lib/events';
import {tick} from '@/lib/haptics';
import {fmt, tr} from '@/lib/i18n';
import {onTopic} from '@/lib/mqttClient';
import {ACTION, TOPIC} from '@/lib/openmower';
import {onCharger} from '@/lib/status';
import {useEffect, useRef, useState} from 'react';
import Drive, {type DriveGuide} from './Drive';
import styles from './page.module.css';

const A = ACTION.recording;
// near where the station was and not charging this long: its power may be off, saving it is offered anyway
const NEAR = 0.3;
const NO_POWER_MS = 5000;
// a point sent and nothing changed within this long: it didn't get through
const TAKE_MS = 5000;
const SAVE_MS = 10000;

const deg = (rad: number) => (Math.abs(rad) * 180) / Math.PI;

// the docking station recorded again after the antenna moved (the result's card): in recording mode a metre out in front
// of the station recorded before, facing it, the first point there (record_dock), then straight in until it charges and
// saved with the second one. recording mode ends after it by itself (onDone with the station before, for the
// confirmation). OpenMower offers record_dock only while nothing else is recorded, after the first point nothing else
export default function Station({onDone, onCancel}: {onDone: (before: DockingStation | null) => void; onCancel: () => void}) {
  const link = useMowerState();
  const {state} = link;
  const live = isLive(link);
  const {hasAction, publishAction} = useMowerActions();
  const map = useMowerMap();
  const position = useMowerPosition() ?? state?.pose;
  const charging = onCharger(state, useSensorValue('om_v_charge', (v) => v));
  const recordingMode = state?.current_state === 'AREA_RECORDING';

  // the station as recorded before: the guide goes by it, it stays while the new one is saved
  const [before, setBefore] = useState<DockingStation | null>(null);
  const station = before ?? map?.docking_stations[0] ?? null;
  if (!before && station) setBefore(station);
  // the first point taken: OpenMower offers nothing but the second one then (also when the page came back to it)
  const second = recordingMode && hasAction(A('record_dock')) && !hasAction(A('start_recording'));
  // where the first point was taken, for the way in; a point or the station sent and not through yet
  const [first, setFirst] = useState<{x: number; y: number} | null>(null);
  const [taking, setTaking] = useState(false);
  if (taking && second) setTaking(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // a point MowBite OS turned down, with why (OpenMower doesn't say)
  const [refused, setRefused] = useState<MowerEvent | null>(null);
  useEffect(
    () =>
      onTopic(TOPIC.events, (payload) => {
        const e = parseEvent(payload.toString());
        if (e?.type !== 'RECORDING_REFUSED' || e.action !== 'record_dock') return;
        setRefused(e);
        setTaking(false);
        setSaving(false);
      }),
    [],
  );
  useEffect(() => {
    if (!taking) return;
    const t = setTimeout(() => setTaking(false), TAKE_MS);
    return () => clearTimeout(t);
  }, [taking]);
  useEffect(() => {
    if (!saving) return;
    const t = setTimeout(() => {
      setSaving(false);
      setError(tr("It wasn't saved. Try once more."));
    }, SAVE_MS);
    return () => clearTimeout(t);
  }, [saving]);
  // saved: OpenMower is back at the steps before the first point. recording mode ends, the guide with it (once)
  const saved = saving && !second && hasAction(A('exit_recording_mode'));
  const ended = useRef(false);
  useEffect(() => {
    if (!saved || ended.current) return;
    ended.current = true;
    publishAction(A('exit_recording_mode'));
    onDone(before);
  }, [saved, publishAction, onDone, before]);

  const s = station && position ? standing(station, position) : null;
  const off = s ? firstPointOff(s) : null;
  // without a station to go by it's up to the user
  const ready = !second && (station ? !!s && !off : !!position);
  // the phone ticks once it stands right, and once it charges on the way in: the eyes are on the mower
  useEffect(() => {
    if (ready) tick();
  }, [ready]);
  useEffect(() => {
    if (second && charging) tick();
  }, [second, charging]);
  // in on the contacts by where the station was, and no charge: the station may have no power
  const near = second && !charging && !!station && !!position && Math.hypot(position.x - station.position.x, position.y - station.position.y) < NEAR;
  const [noPower, setNoPower] = useState(false);
  if (noPower && !near) setNoPower(false);
  useEffect(() => {
    if (!near) return;
    const t = setTimeout(() => setNoPower(true), NO_POWER_MS);
    return () => clearTimeout(t);
  }, [near]);

  const takeFirst = () => {
    setRefused(null);
    setError(null);
    setTaking(true);
    if (position) setFirst({x: position.x, y: position.y});
    publishAction(A('record_dock'));
  };
  const save = () => {
    setRefused(null);
    setError(null);
    setSaving(true);
    publishAction(A('record_dock'));
  };
  // only before the first point: OpenMower doesn't end recording mode after it
  const cancel = () => {
    if (hasAction(A('exit_recording_mode'))) publishAction(A('exit_recording_mode'));
    onCancel();
  };

  if (!recordingMode) return <p className={styles.dim}>{tr('Starting recording mode…')}</p>;

  // what to do now: the first point, then the way in
  let say: React.ReactNode;
  let bar: DriveGuide['bar'] = null;
  if (saving) {
    say = <b>{tr('Saving the docking station…')}</b>;
  } else if (second) {
    const togo = s ? Math.max(0, s.out) : 0;
    say = charging ? (
      <>
        <b>{tr('It charges.')}</b> {tr('Now save the docking station.')}
      </>
    ) : noPower ? (
      <>
        <b>{tr("It doesn't charge.")}</b> {tr('On the contacts, it can be saved without.')}
      </>
    ) : (
      <>
        <b>{tr('Straight in until it charges')}</b>
        {togo >= 0.1 && <> · {tr('{m} m to go', {m: fmt(togo, 1)})}</>}
      </>
    );
  } else if (!station) {
    say = (
      <>
        <b>{tr('A meter in front of the station, facing it')}</b> · {tr('then set the first point')}
      </>
    );
  } else if (!s || !position) {
    say = <b>{tr('Waiting for the position…')}</b>;
  } else if (off === 'away') {
    const mark = inFront(station, OUT);
    say = (
      <>
        <b>{tr('To the mark in front of the station')}</b> · {tr('{m} m away', {m: fmt(Math.hypot(mark.x - position.x, mark.y - position.y), 1)})}
      </>
    );
  } else if (off === 'short') {
    const out = Math.max(0, s.out);
    say = (
      <>
        <b>{tr('Back it out straight')}</b> · {tr('{m} m to go', {m: fmt(Math.max(0.1, OUT - out), 1)})}
      </>
    );
    bar = {share: out / OUT, label: tr('{a} of {b} m', {a: fmt(out, 1), b: fmt(OUT, 0)})};
  } else if (off === 'turn') {
    say = (
      <>
        <b>{tr(s.turn > 0 ? 'Turn it {n}° to the left' : 'Turn it {n}° to the right', {n: fmt(deg(s.turn), 0)})}</b> · {tr('on the spot, gently')}
      </>
    );
  } else if (off === 'side') {
    say = (
      <>
        <b>{tr('{cm} cm beside the line', {cm: fmt(Math.abs(s.side) * 100, 0)})}</b> · {tr('in a little, then back out straight again')}
      </>
    );
  } else if (off === 'far') {
    say = (
      <>
        <b>{tr('A little too far')}</b> · {tr('{m} m forward again', {m: fmt(s.out - OUT, 1)})}
      </>
    );
  } else {
    say = (
      <>
        <b>{tr('Stands right.')}</b> {tr('Set the first point.')}
      </>
    );
  }
  // on the map: the station's line, the stretch the first point is taken in with the mark at a metre; then the way in
  const draw: DriveGuide['draw'] = ({toScreen, k}) => {
    if (!station) return null;
    const at = (along: number, side = 0) => {
      const p = inFront(station, along, side);
      return toScreen(p.x, p.y);
    };
    const [sx, sy] = at(0);
    if (second) {
      const from = first ?? inFront(station, OUT);
      const [fx, fy] = toScreen(from.x, from.y);
      const len = Math.hypot(sx - fx, sy - fy) || 1;
      const [ux, uy] = [(sx - fx) / len, (sy - fy) / len];
      const [bx, by] = [sx - ux * 14 * k, sy - uy * 14 * k];
      const head = [
        [sx, sy],
        [bx - uy * 8 * k, by + ux * 8 * k],
        [bx + uy * 8 * k, by - ux * 8 * k],
      ];
      return (
        <g className={charging ? styles.laneDone : styles.lane}>
          <line x1={fx} y1={fy} x2={bx} y2={by} className={styles.wayIn} strokeWidth={4 * k} />
          <polygon points={head.map((p) => p.join(',')).join(' ')} className={styles.wayInHead} />
        </g>
      );
    }
    const box = [at(OUT_MIN, SIDE), at(OUT_MAX, SIDE), at(OUT_MAX, -SIDE), at(OUT_MIN, -SIDE)].map((p) => p.join(',')).join(' ');
    const [ax, ay] = at(OUT_MAX + 0.4);
    const [m1x, m1y] = at(OUT, SIDE * 2.5);
    const [m2x, m2y] = at(OUT, -SIDE * 2.5);
    return (
      <g className={ready ? styles.laneDone : styles.lane}>
        <line x1={ax} y1={ay} x2={sx} y2={sy} className={styles.axis} strokeWidth={1.5 * k} />
        <polygon className={styles.laneAll} points={box} strokeWidth={1.5 * k} />
        <line x1={m1x} y1={m1y} x2={m2x} y2={m2y} className={styles.laneEnd} strokeWidth={3 * k} />
      </g>
    );
  };

  const buttons: DriveGuide['buttons'] = ({primary, warn}) =>
    !second ? (
      <button className={primary} disabled={!live || !ready || taking || !hasAction(A('record_dock'))} onClick={takeFirst}>
        <PinIcon size={18} />
        {tr('Set first point')}
      </button>
    ) : (
      <>
        <button className={primary} disabled={!live || !charging || saving} onClick={save}>
          <CheckIcon size={18} />
          {tr('Save docking station')}
        </button>
        {noPower && (
          <button className={warn} disabled={!live || saving} onClick={save}>
            {tr('Save without charging')}
          </button>
        )}
      </>
    );

  // under the map: how it stands (upright only; not out far enough yet is no mistake), what the step is for
  const note = (
    <>
      {s && !second && (
        <div className={styles.line}>
          <span className={s.out <= OUT_MAX ? undefined : styles.warn}>{tr('{m} m out', {m: fmt(Math.max(0, s.out), 2)})}</span>
          <span className={Math.abs(s.side) <= SIDE ? undefined : styles.warn}>{tr('{cm} cm aside', {cm: fmt(Math.abs(s.side) * 100, 0)})}</span>
          <span className={Math.abs(s.turn) <= TURN ? undefined : styles.warn}>{tr('{n}° turned', {n: fmt(deg(s.turn), 0)})}</span>
        </div>
      )}
      <p className={styles.dim}>
        {second
          ? tr('Drive it straight in until it sits on the contacts and charges. The way from the first point to there becomes the docking direction.')
          : tr('Back it out of the station to the mark without steering, then it stands on its line. Taken from {a} to {b} m out, up to {cm} cm aside and {n}° turned.', {
              a: '¾',
              b: '1½',
              cm: fmt(SIDE * 100, 0),
              n: fmt(deg(TURN), 0),
            })}
      </p>
    </>
  );

  return (
    <Drive
      progress={null}
      since={null}
      guide={{
        say,
        // a point turned down or not saved: under it until the next try
        missed: saving ? null : refused ? refusalText(refused) : error,
        ok: ready || (second && charging && !saving),
        bar,
        status: second ? tr('Docking station · 2 of 2') : tr('Docking station · 1 of 2'),
        draw,
        buttons,
        note,
        cancel: !second,
      }}
      onStop={cancel}
      onDone={cancel}
    />
  );
}

// the docking station recorded again: how far it lies from the one before
export function StationSaved({before}: {before: DockingStation | null}) {
  const now = useMowerMap()?.docking_stations[0];
  const c = before && now ? stationChange(before, now) : null;
  return (
    <section className={styles.card}>
      <div className={styles.sheetHead}>
        <span className={[styles.badge, styles.good].join(' ')}>
          <CheckIcon size={22} />
        </span>
        <div>
          <h2>{tr('Docking station recorded again')}</h2>
          {c && (
            <p className={styles.dim}>
              {c.moved < 0.005 && deg(c.turned) < 0.5
                ? tr('In the same place as before.')
                : tr('{cm} cm and {deg}° from the one before.', {cm: fmt(c.moved * 100, 0), deg: fmt(deg(c.turned), 1)})}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
