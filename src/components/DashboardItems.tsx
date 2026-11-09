'use client';

import {useMowerSensors} from '@/hooks/useMowerSensors';
import {DASH_FACTS, isTemperature, tempLabel, tempRank} from '@/lib/dashboard';
import {tr, useLang} from '@/lib/i18n';
import {saveSettings, settingsStore, type Settings} from '@/lib/settings';

// what the dashboard's status card shows: the facts and the mower's temperatures, each to switch off. one switched off
// still shows while it warns
export function DashboardItems({settings, styles}: {settings: Settings; styles: Record<string, string>}) {
  useLang();
  const {infos} = useMowerSensors();
  const temps = infos
    .filter(isTemperature)
    .map((info) => ({key: info.sensor_id, label: tempLabel(info)}))
    .sort((a, b) => tempRank(a.key) - tempRank(b.key) || a.label.localeCompare(b.label));
  const items = [...DASH_FACTS.map(([key, label]) => ({key, label: tr(label)})), ...temps];
  const hidden = settings.dashboard?.hidden ?? [];
  const toggle = (key: string, on: boolean) => {
    const cur = settingsStore.snapshot();
    const rest = (cur.dashboard?.hidden ?? []).filter((k) => k !== key);
    saveSettings({...cur, dashboard: {...cur.dashboard, hidden: on ? rest : [...rest, key]}});
  };
  return (
    <div className={styles.field}>
      {tr('Shown on the dashboard')}
      {items.map((it) => (
        <label key={it.key} className={styles.check}>
          <input type="checkbox" checked={!hidden.includes(it.key)} onChange={(e) => toggle(it.key, e.target.checked)} />
          {it.label}
        </label>
      ))}
      <small className={styles.dim}>{tr("One that's off still shows while it warns. Some only show while the mower drives or charges.")}</small>
    </div>
  );
}
