'use client';

import {datumFromParams, useMowerParams} from '@/hooks/useMowerParams';
import {useWeather} from '@/hooks/useWeather';
import {clock} from '@/lib/dates';
import {fmt, tr} from '@/lib/i18n';
import {settingsStore} from '@/lib/settings';
import {useMemo, useSyncExternalStore} from 'react';
import styles from './TopWeather.module.css';
import WeatherIcon, {WEATHER_LABELS, weatherKind} from './WeatherIcon';

// The weather at the top right of every tab: now, today's highest and lowest, and rain now or coming. Only when it's
// switched on in the settings and the mower's place is known. away: faded out while something else needs the room
export default function TopWeather({away}: {away?: boolean}) {
  const settings = useSyncExternalStore(settingsStore.subscribe, settingsStore.snapshot, settingsStore.serverSnapshot);
  const params = useMowerParams();
  const datum = useMemo(() => datumFromParams(params), [params]);
  const weather = useWeather(datum, !!settings.weather);
  if (!weather) return null;
  return (
    <div
      className={[styles.weather, away ? styles.away : ''].join(' ')}
      title={`${tr(WEATHER_LABELS[weatherKind(weather.code)])}, ${tr('max. {max}°, min. {min}°', {max: fmt(weather.max), min: fmt(weather.min)})}`}
    >
      <WeatherIcon code={weather.code} day={weather.day} size={34} />
      <div>
        <strong>{fmt(weather.temp)}°</strong>
        <span>
          ↑{fmt(weather.max)}° ↓{fmt(weather.min)}°
        </span>
        {(weather.raining || weather.rainAt) && (
          <small>
            {weather.raining ? tr('Raining') : weather.rainSoon ? tr('Rain soon') : tr('Rain from about {time}', {time: clock(weather.rainAt!)})}
          </small>
        )}
      </div>
    </div>
  );
}

// a page's title with the weather on its right
export function TitleRow({className, children}: {className?: string; children: React.ReactNode}) {
  return (
    <div className={[styles.row, className].filter(Boolean).join(' ')}>
      {children}
      <TopWeather />
    </div>
  );
}
