// How long the MowBite Planner says each saved area takes (planner.plan duration, corrected by the last finished
// mows). Kept per device from the plans the map asked for, so the schedule can say whether a start fits its window
// without planning everything again (a plan takes the mower a while)

export interface AreaDuration {
  min: number;
  runs: number;
  at: number; // unix seconds, when the plan said so
}

const KEY = 'planDurations';
const KEEP_DAYS = 60;

export function planDurations(): Record<string, AreaDuration> {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    return v && typeof v === 'object' ? v : {};
  } catch {
    return {};
  }
}

export function savePlanDuration(areaId: string, min: number, runs: number) {
  try {
    const all = planDurations();
    const old = Date.now() / 1000 - KEEP_DAYS * 86400;
    for (const [id, d] of Object.entries(all)) if (!d || typeof d.at !== 'number' || d.at < old) delete all[id];
    all[areaId] = {min, runs, at: Math.round(Date.now() / 1000)};
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {}
}

// the time the picked areas take together, and which of them have no plan yet
export function scheduledDuration(areaIds: string[]): {min: number; unknown: string[]} {
  const all = planDurations();
  let min = 0;
  const unknown: string[] = [];
  for (const id of areaIds) {
    const d = all[id];
    if (d && typeof d.min === 'number') min += d.min;
    else unknown.push(id);
  }
  return {min, unknown};
}

// minutes from one HH:MM to the next, over midnight when the end comes first
export function windowMinutes(start: string, end: string): number {
  const m = (t: string) => {
    const [h, mm] = t.split(':').map(Number);
    return h * 60 + mm;
  };
  const w = m(end) - m(start);
  return w > 0 ? w : w + 1440;
}
