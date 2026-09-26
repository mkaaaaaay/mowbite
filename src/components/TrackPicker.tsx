'use client';

import type {JobInfo, TrackSegment} from '@/hooks/useMowHistory';
import {dayKey, dayLabel} from '@/lib/dates';
import {useState} from 'react';
import styles from './TrackPicker.module.css';

function length(points: [number, number][]) {
  let m = 0;
  for (let i = 1; i < points.length; i++) m += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
  return m;
}

// live trail or one recorded job, days as chips and the jobs of a day as times
export default function TrackPicker({
  jobs,
  selected,
  segments,
  onSelect,
}: {
  jobs: JobInfo[];
  selected: string | null;
  segments: TrackSegment[] | null | undefined;
  onSelect: (jobId: string | null) => void;
}) {
  const days: {key: string; label: string; jobs: JobInfo[]}[] = [];
  for (const j of jobs) {
    const d = new Date(j.timestamp * 1000);
    const key = dayKey(d);
    const last = days[days.length - 1];
    if (last?.key === key) last.jobs.push(j);
    else days.push({key, label: dayLabel(d), jobs: [j]});
  }

  const selectedDay = days.find((d) => d.jobs.some((j) => j.job_id === selected))?.key ?? null;
  const [openDay, setOpenDay] = useState<string | null>(selectedDay);
  const day = days.find((d) => d.key === (openDay ?? selectedDay));

  const mowed = segments?.filter((s) => s.attributes.blades).reduce((m, s) => m + length(s.points), 0);
  const driven = segments?.filter((s) => !s.attributes.blades).reduce((m, s) => m + length(s.points), 0);

  return (
    <div className={styles.picker}>
      <span className={styles.title}>Track</span>
      <div className={styles.days}>
        <button
          className={selected === null ? styles.on : undefined}
          onClick={() => {
            setOpenDay(null);
            onSelect(null);
          }}
        >
          Live
        </button>
        {days.map((d) => (
          <button
            key={d.key}
            className={d.key === (openDay ?? selectedDay) ? styles.on : d.key === selectedDay ? styles.half : undefined}
            onClick={() => {
              setOpenDay(d.key);
              if (d.jobs.length === 1) onSelect(d.jobs[0].job_id);
            }}
          >
            {d.label}
          </button>
        ))}
      </div>

      {day && day.jobs.length > 1 && (
        <div className={styles.times}>
          {day.jobs.map((j) => (
            <button key={j.job_id} className={j.job_id === selected ? styles.on : undefined} onClick={() => onSelect(j.job_id)}>
              {new Date(j.timestamp * 1000).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'})}
            </button>
          ))}
        </div>
      )}

      {selected && (
        <span className={styles.info}>
          {segments === null || segments === undefined
            ? 'loading…'
            : `${Math.round(mowed ?? 0)} m mowed, ${Math.round(driven ?? 0)} m driven without blades`}
        </span>
      )}
    </div>
  );
}
