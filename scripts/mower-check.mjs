#!/usr/bin/env node
// Checks the app against a running mower or simulator (masterplan 3.8): how it connects there and what it sends for its
// buttons, actions or calls, read from the app's own websocket in a browser. Only reading without --write; --write taps
// start, pause, continue, skip, go home, the emergency reset and recording mode, and only against a simulator.
//
//   npm run build, then
//   node scripts/mower-check.mjs --target openmower|mowbite-os --host localhost --port 11883 --ws-port 19001 [--write]
//     [--release] [--gate connack|close] [--out <a build's out/>] [--seconds 5] [--user u --pass p]
//
// --release: the build is a release from before the calls (expects actions and 3.1.1 everywhere). --gate: the app goes
// through a broker in front that turns MQTT 5 down, it has to fall back to 3.1.1. Credentials also from
// MOWER_MQTT_USER / MOWER_MQTT_PASS. Prints json: one entry per point, then the summary. Exit 0 without missing or
// different, 1 with, 2 when the mower can't be reached or the call is wrong.

import {chromium} from '@playwright/test';
import {readFile, stat} from 'node:fs/promises';
import {createServer} from 'node:http';
import {extname, join, normalize, resolve, sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import mqtt from 'mqtt';
import mqttPacket from 'mqtt-packet';
import {WebSocket, WebSocketServer} from 'ws';

const USAGE = 'usage: mower-check.mjs --target openmower|mowbite-os --host <host> [--port 1883] [--ws-port 9001] [--write] [--release] [--gate connack|close] [--out <dir>] [--seconds 5] [--user u --pass p]';

function options(argv) {
  const o = {port: 1883, wsPort: 9001, seconds: 5, write: false, release: false};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === '--target') o.target = next();
    else if (a === '--host') o.host = next();
    else if (a === '--port') o.port = Number(next());
    else if (a === '--ws-port') o.wsPort = Number(next());
    else if (a === '--seconds') o.seconds = Number(next());
    else if (a === '--out') o.out = next();
    else if (a === '--gate') o.gate = next();
    else if (a === '--user') o.user = next();
    else if (a === '--pass') o.pass = next();
    else if (a === '--write') o.write = true;
    else if (a === '--release') o.release = true;
    else return null;
  }
  o.user ??= process.env.MOWER_MQTT_USER;
  o.pass ??= process.env.MOWER_MQTT_PASS;
  const ok = ['openmower', 'mowbite-os'].includes(o.target) && o.host && o.port > 0 && o.wsPort > 0 && o.seconds > 0;
  return ok && (!o.gate || ['connack', 'close'].includes(o.gate)) ? o : null;
}

const opt = options(process.argv.slice(2));
if (!opt) {
  console.error(USAGE);
  process.exit(2);
}

// the commands this checks: the action and the call MowBite OS takes for it (src/lib/openmower.ts COMMAND)
const COMMANDS = {
  'mower_logic:idle/start_mowing': 'mowing.start',
  'mower_logic:mowing/pause': 'mowing.pause',
  'mower_logic:mowing/continue': 'mowing.continue',
  'mower_logic:mowing/abort_mowing': 'mowing.abort',
  'mower_logic:mowing/skip_area': 'mowing.skip_area',
  'mower_logic:mowing/skip_path': 'mowing.skip_path',
  'mower_logic/reset_emergency': 'emergency.reset',
  'mower_logic:idle/start_area_recording': 'recording.start',
  'mower_logic:area_recording/exit_recording_mode': 'recording.exit',
};
const CALLS = new Set(Object.values(COMMANDS));
// the app waits this long before a skip goes out (src/app/page.tsx SKIP_DELAY)
const SKIP_DELAY_MS = 4000;

const points = [];
const report = (point, status, detail) =>
  points.push({point, status, ...(status === 'skipped' ? {reason: detail} : detail === undefined ? {} : {value: detail})});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(pred, ms) {
  const end = Date.now() + ms;
  for (;;) {
    const v = pred();
    if (v) return v;
    if (Date.now() >= end) return null;
    await sleep(100);
  }
}

// the check's own connection to the broker: what the mower publishes, and calls of its own (id check-<n>)
const own = {state: null, actions: null, answers: new Map()};
let ownId = 0;
const broker = mqtt.connect(`mqtt://${opt.host}:${opt.port}`, {
  protocolVersion: 4,
  username: opt.user,
  password: opt.pass,
  reconnectPeriod: 1000,
  connectTimeout: 5000,
});
broker.on('message', (topic, payload) => {
  try {
    const v = JSON.parse(payload.toString());
    if (topic === 'robot_state/json') own.state = v;
    else if (topic === 'actions/json') own.actions = Object.fromEntries(v.map((a) => [a.action_id, !!a.enabled]));
    else if (topic === 'rpc/response' && typeof v.id === 'string' && v.id.startsWith('check-')) own.answers.set(v.id, v);
  } catch {}
});
async function call(method, params = {}, ms = 10000) {
  const id = `check-${++ownId}`;
  broker.publish('rpc/request', JSON.stringify({jsonrpc: '2.0', method, params, id}));
  return (await waitFor(() => own.answers.get(id), ms)) ?? {error: {code: 'timeout'}};
}

function finish(code) {
  const summary = {ok: 0, missing: 0, different: 0, skipped: 0};
  for (const p of points) summary[p.status]++;
  console.log(JSON.stringify({target: opt.target, release: opt.release, points, summary}, null, 1));
  process.exit(code ?? (summary.missing || summary.different ? 1 : 0));
}

const up = await waitFor(() => broker.connected, 8000);
if (!up) {
  report('3.8 broker', 'missing', `no connection to mqtt://${opt.host}:${opt.port}`);
  finish(2);
}
broker.subscribe(['robot_state/json', 'actions/json', 'rpc/response']);

// --- what the mower itself offers (3.1)
const state = await waitFor(() => own.state, opt.seconds * 1000);
report('3.1 robot_state', state ? 'ok' : 'missing', state ? state.current_state : `nothing in ${opt.seconds} s`);
const actions = await waitFor(() => own.actions, opt.seconds * 1000);
report('3.1 actions/json', actions ? 'ok' : 'missing', actions ? `${Object.keys(actions).length} actions` : `nothing in ${opt.seconds} s`);
if (!state) finish(2);
const listed = await call('rpc.methods', [], 5000);
const methods = Array.isArray(listed.result) ? new Set(listed.result) : null;
report('3.1 rpc.methods', methods ? 'ok' : 'skipped', methods ? `${methods.size} methods` : 'the mower has no list (older OpenMower)');

let info = null;
if (methods?.has('system.info')) info = (await call('system.info')).result ?? null;
if (opt.target === 'mowbite-os') {
  const fine = info?.name === 'mowbite-os' && Number.isInteger(info.api) && [3, 5].includes(info.mqtt);
  report('AS1 system.info api and mqtt', info ? (fine ? 'ok' : 'different') : 'missing', info ?? 'no system.info');
} else report('AS1 no system.info on OpenMower', info ? 'different' : 'ok', info ?? 'none');
// the calls the app should take: those the mower names, never for the release
const expectCall = (method) => !opt.release && !!methods?.has(method);
const expect5 = !opt.release && opt.target === 'mowbite-os' && info?.mqtt === 5;

// --- the app in a browser, served from out/ with config.js pointing to the mower (or the gate in front of it)
const root = resolve(opt.out ?? fileURLToPath(new URL('../out/', import.meta.url))) + sep;
try {
  await stat(join(root, 'index.html'));
} catch {
  console.error(`no build in ${root}: npm run build first`);
  finish(2);
}
const TYPES = {'.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2'};
let wsUrl = `ws://${opt.host}:${opt.wsPort}`;
const server = createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname));
  if (path === '/config.js') return res.writeHead(200, {'content-type': 'text/javascript'}).end(`window.__MOWER_CONFIG__=${JSON.stringify({mqttUrl: wsUrl})};`);
  let file = join(root, path);
  if (!(file + sep).startsWith(root)) return res.writeHead(403).end();
  try {
    if ((await stat(file)).isDirectory()) file = join(file, 'index.html');
    res.writeHead(200, {'content-type': TYPES[extname(file)] ?? 'application/octet-stream'}).end(await readFile(file));
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const appUrl = `http://127.0.0.1:${server.address().port}`;

// everything the app's websockets carry, as mqtt packets: connects with their version, publishes both ways
const seen = [];
function watch(ws) {
  let version = 4;
  const make = (dir) => {
    const p = mqttPacket.parser({protocolVersion: version});
    p.on('packet', (pk) => {
      if (pk.cmd === 'connect') {
        version = pk.protocolVersion;
        sides.out = make('out');
        sides.in = make('in');
        seen.push({dir, cmd: 'connect', version, clientId: pk.clientId, at: Date.now()});
      } else if (pk.cmd === 'connack') seen.push({dir, cmd: 'connack', version, code: pk.reasonCode ?? pk.returnCode, at: Date.now()});
      else if (pk.cmd === 'publish')
        seen.push({dir, cmd: 'publish', topic: pk.topic, payload: pk.payload.toString(), responseTopic: pk.properties?.responseTopic ?? null, version, at: Date.now()});
    });
    p.on('error', () => {});
    return p;
  };
  const sides = {out: make('out'), in: make('in')};
  const feed = (side) => (f) => typeof f.payload !== 'string' && sides[side].parse(Buffer.from(f.payload));
  ws.on('framesent', feed('out'));
  ws.on('framereceived', feed('in'));
}
const connects = () => seen.filter((s) => s.cmd === 'connect');
const json = (s) => {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
};
// the command the app sent for an action since mark: as the action or as its call
function sentFor(mark, action) {
  for (const s of seen.slice(mark)) {
    if (s.dir !== 'out' || s.cmd !== 'publish') continue;
    if (s.topic === 'action' && s.payload === action) return {via: 'action'};
    const req = s.topic === 'rpc/request' ? json(s.payload) : null;
    if (req?.method === COMMANDS[action]) return {via: 'call', id: req.id, params: req.params, responseTopic: s.responseTopic, version: s.version};
  }
  return null;
}
const answerTo = (id) => seen.filter((s) => s.dir === 'in' && s.cmd === 'publish' && s.topic.startsWith('rpc/response')).map((s) => ({...json(s.payload), topic: s.topic})).find((a) => a.id === id);

const browser = await chromium.launch(process.env.CI ? {} : {channel: 'chrome'});
const newPage = async (init) => {
  const context = await browser.newContext({locale: 'en-US', viewport: {width: 412, height: 915}, hasTouch: true});
  if (init) await context.addInitScript(init.fn, init.arg);
  const page = await context.newPage();
  page.on('websocket', watch);
  return page;
};
const live = (page) => page.getByText(/%/).first().waitFor({timeout: 20000}).then(() => true, () => false);

// --- AS4: 3.1.1 first, MQTT 5 from the next connection where MowBite OS says so, never on OpenMower
let page = await newPage();
await page.goto(appUrl);
const shown = await live(page);
report('3.1 the app shows the mower', shown ? 'ok' : 'missing', shown ? undefined : 'no battery after 20 s');
// system.info asked and answered before the next connection
await waitFor(() => seen.some((s) => s.cmd === 'publish' && s.topic === 'rpc/request' && json(s.payload)?.method === 'system.info') || !methods?.has('system.info'), 10000);
await sleep(1500);
const first = connects()[0];
report('AS4 first connection 3.1.1', first?.version === 4 ? 'ok' : 'different', first ? `version ${first.version}` : 'none');
const mark0 = connects().length;
await page.reload();
await live(page);
const second = await waitFor(() => connects()[mark0], 10000);
report(`AS4 next connection ${expect5 ? 'MQTT 5' : '3.1.1'}`, second?.version === (expect5 ? 5 : 4) ? 'ok' : 'different', second ? `version ${second.version}` : 'none');
await sleep(2000);
// the calls after it: with MQTT 5 each with the response topic rpc/response/<client id>, answered there; else none
const after = seen.slice(seen.indexOf(second)).filter((s) => s.dir === 'out' && s.cmd === 'publish' && s.topic === 'rpc/request');
if (!after.length) report('AS4 response topic', 'skipped', 'no call after the second connection');
else {
  const want = expect5 ? `rpc/response/${second.clientId}` : null;
  const wrong = after.find((s) => s.responseTopic !== want);
  report('AS4 response topic', wrong ? 'different' : 'ok', wrong ? `${json(wrong.payload)?.method}: ${wrong.responseTopic}` : (want ?? 'none'));
  if (expect5) {
    const answered = after.map((s) => answerTo(json(s.payload)?.id)).filter(Boolean);
    const elsewhere = answered.find((a) => a.topic !== want);
    report('AS4 answers on the own topic', !answered.length ? 'missing' : elsewhere ? 'different' : 'ok', elsewhere ? elsewhere.topic : `${answered.length} answers`);
  }
}

// --- AS4: a broker in front that turns MQTT 5 down, the app falls back to 3.1.1 and goes on
if (opt.gate) {
  const upstream = wsUrl;
  const gate = new WebSocketServer({port: 0, handleProtocols: (p) => (p.has('mqtt') ? 'mqtt' : false)});
  gate.on('connection', (client) => {
    let upper = null;
    const queue = [];
    client.on('message', (data) => {
      if (upper) return upper.readyState === WebSocket.OPEN ? upper.send(data) : queue.push(data);
      // CONNECT: fixed header, remaining length, "MQTT" with its length, then the level
      let i = 1;
      while (data[i] & 0x80) i++;
      const level = data[i + 7];
      if (level === 5) {
        if (opt.gate === 'connack') client.send(Buffer.from([0x20, 0x02, 0x00, 0x01]));
        return client.close();
      }
      upper = new WebSocket(upstream, 'mqtt');
      queue.push(data);
      upper.on('open', () => queue.splice(0).forEach((d) => upper.send(d)));
      upper.on('message', (d) => client.readyState === WebSocket.OPEN && client.send(d));
      upper.on('close', () => client.close());
      upper.on('error', () => client.close());
    });
    client.on('close', () => upper?.close());
  });
  await new Promise((r) => gate.on('listening', r));
  wsUrl = `ws://127.0.0.1:${gate.address().port}`;
  const mark = seen.length;
  // this mower remembered with MQTT 5, as after system.info said so (src/lib/mqttClient.ts)
  const gated = await newPage({fn: (key) => localStorage.setItem(key, '1'), arg: `mowbite.mqtt5.${wsUrl}|`});
  await gated.goto(appUrl);
  const ok = await live(gated);
  const tried = seen.slice(mark).filter((s) => s.cmd === 'connect').map((s) => s.version);
  const fine = tried[0] === 5 && tried.includes(4) && ok;
  report(`AS4 back to 3.1.1 (gate ${opt.gate})`, fine ? 'ok' : 'different', `connects ${tried.join(',')}, ${ok ? 'shows the mower' : 'no data'}`);
  await gated.context().close();
  gate.close();
  wsUrl = upstream;
}

// --- AS2: the buttons, as actions on OpenMower and as calls where MowBite OS names them (--write, simulator only)
const sim = methods?.has('sim.flags') ? 'flags' : methods?.has('sim.emergency.set') ? 'emergency' : null;
if (!opt.write) report('AS2 commands', 'skipped', 'read only, --write taps the buttons');
else if (!sim) {
  report('AS2 commands', 'skipped', 'refusing --write: no sim.flags or sim.emergency.set, so not a simulator');
} else await commands();

async function commands() {
  const is = (st) => () => own.state?.current_state === st;
  const docked = () => own.state?.current_state === 'IDLE' && !own.state.emergency;
  if (!(await waitFor(docked, 5000))) return report('AS2 commands', 'skipped', `not idle: ${own.state?.current_state}, emergency ${own.state?.emergency}`);
  page = await newPage();
  await page.goto(appUrl);
  await live(page);

  // taps the button and checks what went out for the action, and what came back
  const tap = async (label, action, {delay = 0, seenParam} = {}) => {
    const method = COMMANDS[action];
    const point = `AS2 ${method}`;
    const mark = seen.length;
    const before = own.state;
    try {
      await page.getByRole('button', {name: label, exact: true}).first().click({timeout: 15000});
    } catch {
      return report(point, 'skipped', `no button "${label}" (${own.state?.current_state})`);
    }
    const sent = await waitFor(() => sentFor(mark, action), 6000 + delay);
    if (!sent) return report(point, 'different', 'nothing sent');
    if (!expectCall(method)) return report(point, sent.via === 'action' ? 'ok' : 'different', sent.via === 'action' ? action : sent);
    const fiveOk = sent.responseTopic === (sent.version === 5 ? `rpc/response/${connects().at(-1)?.clientId}` : null);
    const want = seenParam ? before?.[seenParam[1]] : undefined;
    const paramsOk = sent.params?.client === 'app' && (!seenParam || sent.params?.[seenParam[0]] === want);
    const answer = await waitFor(() => answerTo(sent.id), 10000);
    const fine = sent.via === 'call' && fiveOk && paramsOk && !!answer;
    report(point, fine ? 'ok' : 'different', {sent: sent.via, params: sent.params, responseTopic: sent.responseTopic, answer: answer?.result ?? answer?.error ?? 'none'});
  };

  await tap('Start', 'mower_logic:idle/start_mowing');
  if (!(await waitFor(is('MOWING'), 240000))) return report('AS2 commands', 'different', `not mowing after start: ${own.state?.current_state}`);
  await sleep(3000);
  await tap('Pause', 'mower_logic:mowing/pause');
  await waitFor(is('PAUSED'), 15000);
  await sleep(1500);
  await tap('Continue', 'mower_logic:mowing/continue');
  await waitFor(is('MOWING'), 30000);

  // a refusal: another client paused it a moment before the app's tap, the app says why (only with the calls)
  if (expectCall('mowing.pause')) {
    await sleep(3000);
    const mark = seen.length;
    const other = call('mowing.pause', {client: 'check'});
    await page.getByRole('button', {name: 'Pause', exact: true}).first().click({timeout: 3000}).catch(() => {});
    await other;
    const sent = await waitFor(() => sentFor(mark, 'mower_logic:mowing/pause'), 3000);
    const answer = sent && (await waitFor(() => answerTo(sent.id), 10000));
    if (!answer?.error) report('AS2 refusal WRONG_STATE', 'skipped', sent ? 'the app was first' : 'the button had turned into continue already');
    else {
      const text = await page.getByText("Not done: doesn't fit what the mower is doing now").first().isVisible().catch(() => false);
      const fine = answer.error.code === -32600 && answer.error.data?.reason === 'WRONG_STATE' && text;
      report('AS2 refusal WRONG_STATE', fine ? 'ok' : 'different', {error: answer.error, shown: text});
    }
    await waitFor(is('PAUSED'), 10000);
    await call('mowing.continue', {client: 'check'});
    await waitFor(is('MOWING'), 30000);
  } else report('AS2 refusal WRONG_STATE', 'skipped', 'no calls here');

  await sleep(3000);
  await tap('Skip this path', 'mower_logic:mowing/skip_path', {delay: SKIP_DELAY_MS, seenParam: ['path', 'current_path']});
  await sleep(3000);
  if (own.state?.current_state === 'MOWING') await tap('Skip area', 'mower_logic:mowing/skip_area', {delay: SKIP_DELAY_MS, seenParam: ['area', 'current_area']});
  await sleep(3000);
  if (own.state?.current_state === 'MOWING') await tap('Go home', 'mower_logic:mowing/abort_mowing');
  if (!(await waitFor(docked, 300000))) return report('AS2 commands', 'different', `not back home: ${own.state?.current_state}`);

  // the emergency stop: set and cleared in the simulator, reset with the app's button
  await (sim === 'flags' ? call('sim.flags', [{bumper: 1}]) : call('sim.emergency.set', {active: true}));
  await waitFor(() => own.state?.emergency, 10000);
  await (sim === 'flags' ? call('sim.flags', [{}]) : call('sim.emergency.set', {active: false}));
  await sleep(1500);
  await tap('Reset emergency', 'mower_logic/reset_emergency');
  if (!(await waitFor(docked, 15000))) report('AS2 emergency released', 'different', `still: ${JSON.stringify(own.state?.emergency)}`);

  // held by the updater: start isn't offered meanwhile, it's let go again
  if (opt.target === 'mowbite-os' && methods?.has('system.hold')) {
    const held = await call('system.hold', {seconds: 60});
    await sleep(2000);
    const start = await page.getByRole('button', {name: 'Start', exact: true}).count();
    report('AS2 HOLD: no start offered', held.result && start === 0 ? 'ok' : 'different', {hold: held.result ?? held.error, startButtons: start});
    await call('system.hold', {seconds: 0});
    await sleep(1500);
  }

  // recording mode on from its page, off again from the dashboard
  await page.goto(`${appUrl}/record`);
  await live(page);
  await tap('Start recording mode', 'mower_logic:idle/start_area_recording');
  if (await waitFor(is('AREA_RECORDING'), 15000)) {
    await page.goto(appUrl);
    await live(page);
    await tap('Leave recording mode', 'mower_logic:area_recording/exit_recording_mode');
    await waitFor(is('IDLE'), 15000);
  }
  report('AS2 teleop', 'skipped', 'not driven by this check');
}

// left as found: no hold, no emergency, idle
if (opt.write && sim) {
  if (opt.target === 'mowbite-os' && methods?.has('system.hold')) await call('system.hold', {seconds: 0});
  if (sim === 'flags') await call('sim.flags', [{}]);
  if (own.state?.emergency) broker.publish('action', 'mower_logic/reset_emergency');
}
await browser.close();
server.close();
broker.end();
finish();
