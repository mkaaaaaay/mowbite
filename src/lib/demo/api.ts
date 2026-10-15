import type {MowerMap} from '@/hooks/useMowerMap';
import {tr} from '../i18n';
import {closedRings} from '../rings';
import {demoMap, DEMO_SENSORS} from './garden';
import {demoMows} from './world';

// What the MowBite container on a mower answers (docker/*.cgi), for the demo mower: the schedule, the map backups,
// the settings and the histories its recorders keep. Changes stay in memory until the app is closed.

const text = (body: string) => new Response(body, {headers: {'content-type': 'text/plain'}});
const json = (body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {headers: {'content-type': 'application/json', ...headers}});
const missing = () => new Response('', {status: 404});

let schedule = ['enabled 1', 'minbattery 80', 'skiprain 1', 'skipforecast 0', 'forecasthours 1', 'plan 1,3,5 10:00', ''].join('\n');
let notify = '';
let params = 'enabled 1\n';
let settings: unknown = {};
let settingsVersion = 1;
let backups: {id: string; t: number; name: string; areas: number; auto: boolean; size: number; map: MowerMap}[] | null = null;

function backupList() {
  if (!backups) {
    const map = closedRings(demoMap());
    const size = JSON.stringify(map).length;
    const now = Date.now() / 1000;
    backups = [
      {id: 'demo-2', t: now - 3 * 86400, name: tr('before the flower bed'), areas: map.areas.length, auto: false, size, map},
      {id: 'demo-1', t: now - 12 * 86400, name: '', areas: map.areas.length, auto: true, size, map},
    ];
  }
  return backups;
}

// what the mower did at a moment (unix seconds): mowing, charging for an hour after it, or full in the dock
function phase(t: number): {mowing: boolean; charging: boolean; battery: number} {
  for (const m of demoMows()) {
    if (t >= m.start && t < m.end) return {mowing: true, charging: false, battery: Math.max(0.05, 1 - (t - m.start) / 6000)};
    const low = Math.max(0.05, 1 - (m.end - m.start) / 6000);
    const charged = (t - m.end) / 3600;
    if (t >= m.end && low + charged < 1) return {mowing: false, charging: true, battery: low + charged};
  }
  return {mowing: false, charging: false, battery: 1};
}

function sensorValue(id: string, t: number): number | null {
  const p = phase(t);
  const docked = !p.mowing;
  const w = Math.sin(t / 700 + id.length);
  switch (id) {
    case 'om_v_battery':
      return 24.7 + 3.5 * p.battery + (p.charging ? 0.5 : 0);
    case 'om_v_charge':
      return docked ? 32.1 : 0;
    case 'om_charge_current':
      return p.charging ? 1.25 : 0;
    case 'om_gps_accuracy':
      return 0.019 + 0.004 * w;
    case 'om_mow_motor_rpm':
      return p.mowing ? 3050 + 30 * w : 0;
    case 'om_mow_motor_current':
      return p.mowing ? 1.1 + 0.2 * w : 0;
    case 'om_mow_motor_temp':
      return (p.mowing ? 46 : 24) + w;
    case 'om_left_esc_temp':
    case 'om_right_esc_temp':
      return (p.mowing ? 41 : 31) + w;
    case 'om_mow_esc_temp':
      return (p.mowing ? 43 : 33) + w;
    default:
      return null;
  }
}

// the last 24 h in the recorder's 5 minute buckets: "id t lo hi value", tabs between
function sensorHistory(): string {
  const now = Math.floor(Date.now() / 1000 / 300) * 300;
  const lines: string[] = [];
  for (const {sensor_id: id} of DEMO_SENSORS) {
    for (let t = now - 86400; t < now; t += 300) {
      const v = sensorValue(id, t + 150);
      if (v === null) continue;
      const around = [sensorValue(id, t)!, v, sensorValue(id, t + 299)!];
      lines.push([id, t, Math.min(...around).toFixed(3), Math.max(...around).toFixed(3), v.toFixed(3)].join('\t'));
    }
  }
  return lines.join('\n');
}

// ten weeks of mowing every other day, the charges a little longer lately: "charge|run start end minutes from to"
function batteryHistory(): string {
  const now = Date.now() / 1000;
  const lines: string[] = [];
  for (let day = 70; day >= 1; day -= 2) {
    const start = now - day * 86400;
    const age = (70 - day) / 70;
    const minutes = 27 + Math.round(3 * Math.sin(day));
    const low = 27.2 - 0.25 * age - 0.1 * Math.sin(day * 1.3);
    lines.push(`run ${Math.round(start)} ${Math.round(start + minutes * 70)} ${minutes} 28.2 ${low.toFixed(2)}`);
    const charge = Math.round(34 + 4 * age + 2 * Math.sin(day * 0.7));
    lines.push(`charge ${Math.round(start + minutes * 70)} ${Math.round(start + minutes * 70 + charge * 60)} ${charge} ${low.toFixed(2)} 28.2`);
  }
  return lines.join('\n');
}

const SYSTEM = [
  'remote 0',
  'mem_total 3976200192',
  'mem_available 2415919104',
  'disk_total 15384707072',
  'disk_free 5261334528',
  'data_total 15384707072',
  'data_free 5261334528',
  'load 0.42',
  'cpus 4',
  'cpu_temp 48.7',
  `uptime ${6 * 86400 + 4 * 3600}`,
].join('\n');

export async function demoFetch(url: string, init?: RequestInit): Promise<Response> {
  const {pathname, searchParams: q} = new URL(url, 'http://demo.invalid');
  const post = init?.method === 'POST';
  const body = typeof init?.body === 'string' ? init.body : '';
  switch (pathname) {
    case '/version.json':
      return json({version: process.env.APP_VERSION ?? '0.0.0'});
    case '/cgi-bin/schedule':
      if (q.has('log')) {
        const day = 86400;
        const at = (d: number) => Math.round(Date.now() / 1000 - d * day);
        return text([`${at(5)} started`, `${at(3)} started`, `${at(1)} started`].join('\n'));
      }
      if (post) schedule = body;
      return text(schedule);
    case '/cgi-bin/notify':
      if (q.has('log')) return text('');
      if (q.has('test')) return text('no topic');
      if (q.has('snooze')) return text('');
      if (post) notify = body;
      return text(notify);
    case '/cgi-bin/params':
      if (post) params = body;
      return text(params);
    case '/cgi-bin/settings':
      if (post) {
        settings = JSON.parse(body || '{}');
        settingsVersion++;
      }
      return json(settings, {'X-Settings-Version': String(settingsVersion)});
    case '/cgi-bin/backups': {
      const list = backupList();
      const id = q.get('id');
      if (post && q.get('action') === 'delete') {
        backups = list.filter((b) => b.id !== id);
        return text('');
      }
      if (post) {
        const map: MowerMap = JSON.parse(body);
        list.unshift({
          id: `demo-${Date.now()}`,
          t: Date.now() / 1000,
          name: q.get('name') ?? '',
          areas: Number(q.get('areas')) || map.areas.length,
          auto: q.get('auto') === '1',
          size: body.length,
          map,
        });
        return text('');
      }
      if (id) {
        const b = list.find((x) => x.id === id);
        return b ? json(b.map) : missing();
      }
      return json(list.map((b) => ({id: b.id, t: b.t, name: b.name, areas: b.areas, auto: b.auto, size: b.size})));
    }
    case '/cgi-bin/sensors':
      return text(sensorHistory());
    case '/cgi-bin/battery':
      return text(batteryHistory());
    case '/cgi-bin/system':
      return text(SYSTEM);
    default:
      // the kept ros log among others: the demo mower has none
      return missing();
  }
}
