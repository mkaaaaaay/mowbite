import {locale, monthStyle} from './i18n';

export const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;

// today/yesterday in the app's language, like the weekday names. the formatters once per language, making them costs
// far more than formatting (the map's track picker labels every day while the mower drives)
const dayFormats = new Map<string, {rel: Intl.RelativeTimeFormat; date: Intl.DateTimeFormat; year: Intl.DateTimeFormat; numeric: Intl.DateTimeFormat}>();
function dayFormat() {
  let f = dayFormats.get(locale());
  if (!f) {
    f = {
      rel: new Intl.RelativeTimeFormat(locale(), {numeric: 'auto'}),
      date: new Intl.DateTimeFormat(locale(), {weekday: 'short', day: 'numeric', month: monthStyle()}),
      year: new Intl.DateTimeFormat(locale(), {weekday: 'short', day: 'numeric', month: monthStyle(), year: 'numeric'}),
      numeric: new Intl.DateTimeFormat(locale(), {day: '2-digit', month: '2-digit', year: 'numeric'}),
    };
    dayFormats.set(locale(), f);
  }
  return f;
}

// weekday and date, "Mi., 11.11." or "Wed 11 Nov"
export const dayDate = (d: Date) => dayFormat().date.format(d);

// for a day that can lie further back: with its year when that's not this one, "Di., 11.11.2025" or "Tue, 11 Nov 2025"
export const dayDateYear = (d: Date) => (d.getFullYear() === new Date().getFullYear() ? dayFormat().date : dayFormat().year).format(d);

// a day (unix s) in numbers with its year, "09.11.2026" or "09/11/2026"
export const numericDay = (t: number) => dayFormat().numeric.format(new Date(t * 1000));

export function dayLabel(d: Date) {
  const today = new Date();
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
  const f = dayFormat();
  const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
  if (dayKey(d) === dayKey(today)) return cap(f.rel.format(0, 'day'));
  if (dayKey(d) === dayKey(yesterday)) return cap(f.rel.format(-1, 'day'));
  return f.date.format(d);
}

// like fmt: one formatter per language, with or without seconds
const clockFormats = new Map<string, Intl.DateTimeFormat>();
export const clock = (t: number, seconds = false) => {
  const key = `${locale()} ${seconds}`;
  let f = clockFormats.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat(locale(), {hour: '2-digit', minute: '2-digit', ...(seconds ? {second: '2-digit'} : {})});
    clockFormats.set(key, f);
  }
  return f.format(new Date(t * 1000));
};

// a moment with its day, "Di., 10.11., 07:15" (with the year when it's not this one)
export const dayClock = (t: number) => `${dayDateYear(new Date(t * 1000))}, ${clock(t)}`;

export function duration(seconds: number) {
  const m = Math.round(seconds / 60);
  if (m < 1) return '<1 min';
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
}

// "20260926" (event history file name) -> Date
export const parseDay = (d: string) => new Date(+d.slice(0, 4), +d.slice(4, 6) - 1, +d.slice(6, 8));
