'use client';

import {clock} from '@/lib/dates';
import {gpsBefore, gpsCsv, gpsLog, gpsLogSince, type GpsSample} from '@/lib/gpslog';
import {fmt, tr} from '@/lib/i18n';
import {saveFile} from '@/lib/saveFile';
import {useEffect, useState} from 'react';
import styles from './RosLog.module.css';

const cm = (m: number) => `${fmt(m * 100, m < 0.1 ? 1 : 0)} cm`;

// one line for each stretch of seconds with the same state and about the same accuracy (to the cm), the worst of it
function stretches(samples: readonly GpsSample[]) {
  const out: {from: number; to: number; state: string; acc: number | null}[] = [];
  const band = (a: number | null) => (a === null ? -1 : Math.round(a * 100));
  for (const s of samples) {
    const last = out[out.length - 1];
    if (last && last.state === s.state && band(last.acc) === band(s.acc) && s.t - last.to <= 3) {
      last.to = s.t;
      if (s.acc !== null && last.acc !== null && s.acc > last.acc) last.acc = s.acc;
    } else out.push({from: s.t, to: s.t, state: s.state, acc: s.acc});
  }
  return out;
}

// under a problem on the activity page: how the gps was in the minute before, from what the container kept. tells
// whether the mower could have been somewhere else than it thought when it bumped into something
export function GpsAround({t, limit}: {t: number; limit?: number}) {
  const [samples, setSamples] = useState<GpsSample[] | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let gone = false;
    void gpsLogSince().then((from) => {
      if (from === null || t < from) return;
      gpsLog(t - 60, t + 10).then(
        (s) => !gone && setSamples(s),
        () => {},
      );
    });
    return () => {
      gone = true;
    };
  }, [t]);

  const b = samples && gpsBefore(samples, t, limit);
  if (!samples || !b) return null;

  // short: good is one line in normal colour, only a real gap is orange. a second or two just over 5 cm says nothing
  const good = b.noFix <= 2 && b.none === 0;
  const worst = b.worst === null ? tr('no GPS') : cm(b.worst);
  const parts = [
    b.dockOff ? tr('off in the dock approach, as it should be') : null,
    b.at && b.at.quality !== 'fix' ? (b.at.acc === null ? tr('none at that moment') : tr('{acc} at that moment', {acc: cm(b.at.acc)})) : null,
    b.covered === 0 ? null : good ? tr('RTK fix before, at worst {acc}', {acc: worst}) : tr('{s} s without RTK fix in the minute before, at worst {acc}', {s: b.noFix, acc: worst}),
  ].filter(Boolean);

  return (
    <>
      <p className={styles.gps}>
        <span className={good ? undefined : styles.WARN}>
          GPS: {parts.join(', ')}.{!good && ' ' + tr('Its position may have been off.')}
        </span>
      </p>
      <button className={styles.link} onClick={() => setOpen(!open)}>
        {open ? tr('Hide GPS log') : tr('GPS log')}
      </button>
      {open && (
        <div className={styles.log}>
          {stretches(samples).map((r, i) => (
            <span key={i} className={[r.acc === null || r.acc > 0.05 ? styles.WARN : '', r.from - 1 <= t && t <= r.to + 1 ? styles.at : ''].join(' ')}>
              {clock(r.from, true)}
              {r.to > r.from && `–${clock(r.to, true)}`} {r.state} {r.acc === null ? tr('no GPS') : cm(r.acc)}
            </span>
          ))}
        </div>
      )}
    </>
  );
}

// the whole run's positions and accuracy as a csv file
export function GpsDownload({from, to}: {from: number; to: number}) {
  const [available, setAvailable] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    void gpsLogSince().then((s) => setAvailable(s !== null && to >= s));
  }, [to]);
  if (!available) return null;
  return (
    <button
      className={styles.link}
      disabled={busy}
      onClick={() => {
        setBusy(true);
        setFailed(false);
        const d = new Date(from * 1000);
        const name = `mowbite-gps-${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}-${clock(from).replace(':', '')}.csv`;
        gpsLog(from - 60, to + 60)
          .then((s) => saveFile(name, gpsCsv(s), 'text/csv'))
          .catch(() => setFailed(true))
          .finally(() => setBusy(false));
      }}
    >
      {failed ? tr('failed') : busy ? tr('loading…') : tr('Download GPS log')}
    </button>
  );
}
