import type {MowerMap} from '@/hooks/useMowerMap';
import {tr} from '../i18n';
import {isPin} from '../mowerBody';
import {CONTAINER_LEVEL} from '../updates';
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
    // pins not counted, like lib/backups
    const areas = map.areas.filter((a) => !isPin(a)).length;
    backups = [
      {id: 'demo-2', t: now - 3 * 86400, name: tr('before the flower bed'), areas, auto: false, size, map},
      {id: 'demo-1', t: now - 12 * 86400, name: '', areas, auto: true, size, map},
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

// the machine's own values as the recorder keeps them (system.sh): memory in use %, the cpu's temperature and load, the
// wifi and the free disk in GB, warmer and the wifi weaker while it's out mowing
function systemValue(id: string, t: number): number | null {
  const p = phase(t);
  const w = Math.sin(t / 900 + id.length);
  switch (id) {
    case 'sys_mem':
      return 39 + 2 * w + (p.mowing ? 3 : 0);
    case 'sys_cpu_temp':
      return (p.mowing ? 54 : 47) + 2 * w;
    case 'sys_load':
      return (p.mowing ? 0.9 : 0.35) + 0.15 * w;
    case 'sys_wifi':
      return Math.round((p.mowing ? -66 : -58) + 3 * w);
    case 'sys_disk_free':
      return 5.26 - 0.002 * ((t / 3600) % 24);
    default:
      return null;
  }
}
const SYSTEM_IDS = ['sys_mem', 'sys_cpu_temp', 'sys_load', 'sys_wifi', 'sys_disk_free'];

// the last 24 h in the recorder's 5 minute buckets: "id t lo hi value", tabs between
function sensorHistory(): string {
  const now = Math.floor(Date.now() / 1000 / 300) * 300;
  const lines: string[] = [];
  for (const id of SYSTEM_IDS) {
    for (let t = now - 86400; t < now; t += 300) {
      const around = [systemValue(id, t)!, systemValue(id, t + 150)!, systemValue(id, t + 299)!];
      lines.push([id, t, Math.min(...around).toFixed(3), Math.max(...around).toFixed(3), around[1].toFixed(3)].join('\t'));
    }
  }
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

// what stats.sh counts, from the demo mows: blade time and 0.3 m/s with the blade by the hour, 40 m without a run.
// the blades two thirds through their hours
let parts: string[] | null = null;
function demoStats(): {text: string; blade: number} {
  const now = Date.now() / 1000;
  const hours = new Map<number, number[]>();
  let since = now;
  for (const m of demoMows()) {
    since = Math.min(since, m.start);
    for (let t = m.start; t < Math.min(m.end, now); ) {
      const h = t - (t % 3600);
      const until = Math.min(m.end, now, h + 3600);
      const v = hours.get(h) ?? [0, 0, 0, 0];
      v[0] += until - t;
      v[1] += (until - t) * 0.3;
      if (t === m.start) {
        v[2] += 40;
        v[3] += 1;
      }
      hours.set(h, v);
      t = until;
    }
  }
  const total = [...hours.values()].reduce((a, v) => a.map((x, i) => x + v[i]), [0, 0, 0, 0]);
  parts ??= [`blade 80 ${Math.max(0, total[0] - 0.65 * 80 * 3600).toFixed(1)} ${Math.round(now - 9 * 86400)}`, 'clean 200 0 0'];
  const line = (v: number[]) => `${v[0].toFixed(1)} ${v[1].toFixed(1)} ${v[2].toFixed(1)} ${v[3]}`;
  const text = [
    `since ${Math.round(since)}`,
    `total ${line(total)}`,
    ...[...hours].sort((a, b) => a[0] - b[0]).map(([h, v]) => `hour ${Math.round(h)} ${line(v)}`),
    ...parts.map((p) => `maint ${p}`),
  ].join('\n');
  return {text, blade: total[0]};
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
  'wifi_iface wlan0',
  'wifi_signal -58',
  'net_iface wlan0',
  'net_ip 192.168.178.42',
].join('\n');

// the updater next to MowBite (lib/autoUpdate), made up: MowBite has something new, OpenMower is up to date, the planner
// from github in an unknown state
let room = [
  {id: '5d97bb5f3d94', bytes: 1_116_000, refs: 'mowbite_planner:before-0888dd0', kind: 'planner'},
  {id: '274873b1639d', bytes: 10_630_000, refs: 'ghcr.io/mkaaaaaay/mowbite:rb-1792840000-274873b1', kind: 'rollback'},
  {id: 'a1b2c3d4e5f6', bytes: 2_336_000_000, refs: '-', kind: 'dangling'},
];
let cache = 1_262_000_000;
let updateConf = 'mowbite beta\nmowbite_auto 1\nopenmower edge\nopenmower_auto 0\nplanner_auto 0\nat 03:00\ndays daily\n';
// an update asked for: each part goes through its steps within seconds, the way the bar shows a real one. a step:
// its name, its seconds and of unpacking or building how many
type DemoStep = [step: string, secs: number, of?: number];
const DEMO_STEPS: Record<string, DemoStep[]> = {
  openmower: [['prepare', 2]],
  planner: [['prepare', 2], ['build', 12, 9], ['restart', 3], ['wait', 5]],
  mowbite: [['prepare', 2], ['download', 8], ['extract', 3, 4], ['restart', 3], ['wait', 4]],
  back: [['back', 3], ['restart', 3], ['wait', 4]],
  // the updater itself: its download, then it restarts on the new version (a few seconds without an answer)
  updater: [['prepare', 2], ['download', 5]],
};
let demoRun: {t: number; parts: string[]} | null = null;
const demoDone: Record<string, number> = {};
function demoProgress(status: Record<string, string>, now: number) {
  if (!demoRun) return;
  const part = (p: string) => (p === 'back' ? 'mowbite' : p);
  let t = now - demoRun.t;
  for (const p of demoRun.parts) {
    for (const [step, secs, of] of DEMO_STEPS[p]) {
      if (t < secs) {
        const pct = step === 'download' || of ? Math.floor((100 * t) / secs) : '-';
        status.progress = [part(p), step, pct, Math.round(now - t), ...(of ? [Math.floor((of * t) / secs), of] : [])].join(' ');
        status.run_parts = demoRun.parts.map(part).join(' ');
        status.result = 'running';
        return;
      }
      t -= secs;
    }
  }
  for (const p of demoRun.parts) demoDone[p] = Math.round(now);
  demoRun = null;
}

function demoUpdate(): Record<string, unknown> {
  const c = Object.fromEntries(updateConf.trim().split('\n').map((l) => [l.slice(0, l.indexOf(' ')), l.slice(l.indexOf(' ') + 1)]));
  const now = Math.round(Date.now() / 1000);
  const day = (d: number) => new Date(Date.now() - d * 86400_000).toISOString().slice(0, 10);
  const version = process.env.APP_VERSION ?? '0.0.0';
  const status: Record<string, string> = {
    alive: String(now),
    checked: String(now - 1800),
    mowbite_running: `${version} ${day(3)}`,
    mowbite_available: 'yes ghcr.io/mkaaaaaay/mowbite:latest',
    mowbite: `updated ${now - 3 * 86400} ${version}`,
    mowbite_back: 'yes',
    openmower_running: `edge ${day(11)}`,
    openmower_env: 'edge',
    openmower_available: 'no ghcr.io/clemenselflein/open_mower_ros:edge',
    planner_running: `? ${day(1)}`,
    planner_source: 'github',
    planner_available: 'unknown main',
    updater_running: `7cce417 ${day(2)}`,
    updater_available: 'yes ghcr.io/mkaaaaaay/mowbite-updater:latest',
    disk_free: '2380',
    result: 'done',
  };
  if (demoDone.mowbite) Object.assign(status, {mowbite: `updated ${demoDone.mowbite} ${version}`, mowbite_available: 'no ghcr.io/mkaaaaaay/mowbite:latest'});
  if (demoDone.back) status.mowbite = `back ${demoDone.back} ${version}`;
  if (demoDone.openmower) status.openmower = 'current';
  if (demoDone.updater) {
    const back = demoDone.updater + 6;
    if (now < back) status.updater = `restarting ${demoDone.updater}`;
    else Object.assign(status, {updater: `updated ${back} 70cb346`, updater_running: `70cb346 ${day(0)}`, updater_available: 'no ghcr.io/mkaaaaaay/mowbite-updater:latest'});
  }
  if (demoDone.planner)
    Object.assign(status, {planner: `updated ${demoDone.planner} 3f2a9c1`, planner_running: `3f2a9c1e5b7d ${day(0)}`, planner_available: 'no main'});
  demoProgress(status, Date.now() / 1000);
  return {
    conf: {...c, mowbite_auto: Number(c.mowbite_auto), openmower_auto: Number(c.openmower_auto), planner_auto: Number(c.planner_auto)},
    requested: false,
    status,
    room: {items: room, cache},
    log: [
      `${day(3)} 03:00:12 mowbite: kept the version before as ghcr.io/mkaaaaaay/mowbite:prev-1a2b3c4d`,
      `${day(3)} 03:00:13 mowbite: ghcr.io/mkaaaaaay/mowbite:latest -> ghcr.io/mkaaaaaay/mowbite:latest`,
      `${day(3)} 03:00:41 mowbite: updated to ${process.env.APP_VERSION ?? '0.0.0'}`,
      `${day(3)} 03:00:44 tidied up: images 23.4MB, build cache 0B, 2380 MB free`,
    ],
  };
}

export async function demoFetch(url: string, init?: RequestInit): Promise<Response> {
  const {pathname, searchParams: q} = new URL(url, 'http://demo.invalid');
  const post = init?.method === 'POST';
  const body = typeof init?.body === 'string' ? init.body : '';
  switch (pathname) {
    case '/version.json':
    case '/cgi-bin/version':
      return json({version: process.env.APP_VERSION ?? '0.0.0', level: CONTAINER_LEVEL});
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
    case '/cgi-bin/update':
      if (post && q.has('conf')) {
        // the lines sent replace the ones there were, the rest stays
        const sent = new Map(body.trim().split('\n').map((l) => [l.slice(0, l.indexOf(' ')), l]));
        updateConf = updateConf.trim().split('\n').map((l) => sent.get(l.slice(0, l.indexOf(' '))) ?? l).join('\n') + '\n';
        return text('ok');
      }
      if (post && q.get('free')) {
        const what = q.get('free')!;
        if (what === 'cache') cache = 0;
        else room = what === 'all' ? [] : room.filter((i) => `img:${i.id}` !== what);
        return text('ok');
      }
      // an update or going back: played through in a few seconds. a check: the demo mower has nothing to look for
      if (post && (q.has('now') || q.has('back') || q.has('self')) && !demoRun) {
        const one = q.get('now');
        demoRun = {
          t: Date.now() / 1000,
          parts: q.has('back') ? ['back'] : q.has('self') ? ['updater'] : one && one in DEMO_STEPS ? [one] : ['openmower', 'planner', 'mowbite'],
        };
      }
      if (post) return text('ok');
      return json(demoUpdate());
    case '/cgi-bin/sensors':
      return text(sensorHistory());
    case '/cgi-bin/battery':
      return text(batteryHistory());
    case '/cgi-bin/system':
      return text(SYSTEM);
    case '/cgi-bin/stats': {
      const {blade} = demoStats();
      const part = q.get('done') ?? q.get('due');
      if (post && part && parts) {
        parts = parts.map((p) => {
          const f = p.split(' ');
          if (f[0] !== part) return p;
          if (q.has('done')) return `${f[0]} ${f[1]} ${blade.toFixed(1)} ${Math.round(Date.now() / 1000)}`;
          return `${f[0]} ${Math.round(Number(q.get('h')))} ${f[2]} ${f[3]}`;
        });
      }
      return text(demoStats().text);
    }
    default:
      // the kept ros log among others: the demo mower has none
      return missing();
  }
}
