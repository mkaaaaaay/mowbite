import {describe, expect, it} from 'vitest';
import {ACTION, RPC, TOPIC} from '../openmower';
import {parseBattery} from '../battery';
import {parseKept} from '../mowerParams';
import {parseSchedule} from '../schedule';
import {demoFetch} from './api';
import {demoMap} from './garden';
import {areaPaths, buildRoute, createWorld, poseIndex} from './world';

const NOW = Date.UTC(2026, 5, 15, 12, 0, 0);

function world() {
  const got: Record<string, string> = {};
  let now = NOW;
  const w = createWorld((topic, text) => (got[topic] = text), {now, timer: false});
  const state = () => JSON.parse(w.retained(TOPIC.robotState)[0][1]);
  const actions = (): Record<string, number> =>
    Object.fromEntries(JSON.parse(w.retained(TOPIC.actions)[0][1]).map((a: {action_id: string; enabled: number}) => [a.action_id, a.enabled]));
  return {
    w,
    got,
    state,
    actions,
    // in steps, like the timer would
    pass(seconds: number, step = 5) {
      for (let s = 0; s < seconds; s += step) w.tick((now += step * 1000));
    },
    act: (id: string) => w.published(TOPIC.action, id),
    async rpc<T>(method: string, params: unknown = []): Promise<T> {
      delete got[TOPIC.rpcResponse];
      w.published(TOPIC.rpcRequest, JSON.stringify({jsonrpc: '2.0', id: 'x', method, params}));
      await new Promise((r) => setTimeout(r, 60));
      const answer = JSON.parse(got[TOPIC.rpcResponse]);
      if (answer.error) throw new Error(answer.error.message);
      return answer.result;
    },
  };
}

const inside = (p: {x: number; y: number}, ring: {x: number; y: number}[]) => {
  let hit = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i];
    const b = ring[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) hit = !hit;
  }
  return hit;
};

describe('the demo garden', () => {
  const map = demoMap();
  const obstacles = map.areas.filter((a) => a.properties.type === 'obstacle').map((a) => a.outline);

  it('plans every lawn with outline passes and lanes, inside the lawn and around the obstacles', () => {
    for (const area of map.areas.filter((a) => a.properties.type === 'mow')) {
      const paths = areaPaths(area, obstacles);
      expect(paths.filter((p) => p.outline).length).toBeGreaterThanOrEqual(3);
      expect(paths.some((p) => !p.outline)).toBe(true);
      for (const p of paths.flatMap((x) => x.points)) {
        expect(inside(p, area.outline)).toBe(true);
        expect(obstacles.some((o) => inside(p, o))).toBe(false);
      }
    }
  });

  it('drives a job from the station through both lawns and back, never across an obstacle', () => {
    const legs = buildRoute(map);
    const dock = map.docking_stations[0].position;
    expect(legs[0].pts[0]).toEqual(dock);
    expect(legs[legs.length - 1].pts.at(-1)).toEqual(dock);
    expect(new Set(legs.map((l) => l.area))).toEqual(new Set([-1, 0, 1]));
    // each leg starts where the one before ended
    for (let i = 1; i < legs.length; i++) expect(legs[i].pts[0]).toEqual(legs[i - 1].pts.at(-1));
    // sampled every 5 cm
    for (const l of legs) {
      for (let i = 1; i < l.pts.length; i++) {
        const [a, b] = [l.pts[i - 1], l.pts[i]];
        const n = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 0.05);
        for (let k = 0; k <= n; k++) {
          const p = {x: a.x + ((b.x - a.x) * k) / (n || 1), y: a.y + ((b.y - a.y) * k) / (n || 1)};
          if (obstacles.some((o) => inside(p, o))) throw new Error(`leg ${legs.indexOf(l)} of ${legs.length} (area ${l.area}, path ${l.path}, ${l.approach ? 'approach' : l.state}) crosses an obstacle at ${p.x.toFixed(2)}, ${p.y.toFixed(2)}`);
        }
      }
    }
    const minutes = legs.reduce((s, l) => s + l.len, 0) / 0.45 / 60;
    expect(minutes).toBeGreaterThan(15);
    expect(minutes).toBeLessThan(60);
  });

  it('numbers the poses of a path rising', () => {
    const index = poseIndex([{x: 0, y: 0}, {x: 0, y: 0.001}, {x: 1, y: 0.001}, {x: 1, y: 0.001}]);
    expect(index).toEqual([0, 1, 100, 101]);
  });
});

describe('the demo mower', () => {
  it('is in the middle of a mow when it opens, with the days before in its history', async () => {
    const d = world();
    expect(d.state()).toMatchObject({current_state: 'MOWING', current_area: 0, emergency: 0, is_charging: 0});
    expect(d.state().battery_percentage).toBeCloseTo(0.91, 2);
    const jobs = await d.rpc<{job_id: string; timestamp: number}[]>(RPC.jobs);
    expect(jobs).toHaveLength(4);
    expect(jobs[0].timestamp).toBe(NOW / 1000 - 540);
    const days = await d.rpc<string[]>(RPC.eventDays);
    expect(days[0]).toBe('20260615');
    expect(days).toHaveLength(4);
    const past = await d.rpc<{type: string}[]>(RPC.events, {date: days[1]});
    expect(past.map((e) => e.type)).toEqual(expect.arrayContaining(['UNDOCKED', 'AREA', 'BLADES', 'JOB_COMPLETE', 'DOCKED']));
    const track = await d.rpc<{segments: {attributes: {blades: boolean}; points: number[][]}[]}>(RPC.jobTrack, {job_id: jobs[0].job_id});
    expect(track.segments.some((s) => s.attributes.blades && s.points.length > 20)).toBe(true);
  });

  it('moves along the plan it hands out', async () => {
    const d = world();
    const before = d.state();
    d.pass(20, 1);
    const after = d.state();
    expect(Math.hypot(after.pose.x - before.pose.x, after.pose.y - before.pose.y)).toBeGreaterThan(0.5);
    const plan = await d.rpc<{paths: {points: [number, number][]; pose_index: number[]}[]}>(RPC.areaPlan, {area_id: demoMap().areas[0].id});
    const path = plan.paths[after.current_path];
    expect(path.pose_index).toHaveLength(path.points.length);
    expect(after.current_path_index).toBeLessThanOrEqual(path.pose_index.at(-1)! + 1);
    // on the path: not further from its points than its longest lane
    expect(Math.min(...path.points.map(([x, y]) => Math.hypot(after.pose.x - x, after.pose.y - y)))).toBeLessThan(12);
  });

  it('plans an area as it is in the editor', async () => {
    const d = world();
    const square = [{x: 20, y: 0}, {x: 24, y: 0}, {x: 24, y: 4}, {x: 20, y: 4}];
    const plan = await d.rpc<{paths: {is_outline: boolean}[]}>(RPC.areaPlan, {outline: square, obstacles: [], outline_count: 1, angle: 0});
    expect(plan.paths.filter((p) => p.is_outline)).toHaveLength(1);
    expect(plan.paths.some((p) => !p.is_outline)).toBe(true);
    await expect(d.rpc(RPC.areaPlan, {area_id: 'nope'})).rejects.toThrow();
    await expect(d.rpc('no.such.method')).rejects.toThrow('not found');
  });

  it('pauses and goes on', () => {
    const d = world();
    d.act(ACTION.pause);
    expect(d.state().current_state).toBe('PAUSED');
    expect(d.actions()[ACTION.resume]).toBe(1);
    const at = d.state().pose;
    d.pass(30);
    expect(d.state().pose).toMatchObject({x: at.x, y: at.y});
    d.act(ACTION.resume);
    d.pass(10, 1);
    expect(d.state().current_state).toBe('MOWING');
    expect(d.state().pose.x === at.x && d.state().pose.y === at.y).toBe(false);
  });

  it('goes home when sent, charges, and takes the job up again where it stopped', async () => {
    const d = world();
    const stopped = d.state();
    const [job] = await d.rpc<{job_id: string}[]>(RPC.jobs);
    d.act(ACTION.goHome);
    expect(d.state().current_state).toBe('DOCKING');
    d.pass(120);
    expect(d.state()).toMatchObject({current_state: 'IDLE', is_charging: 1, current_area: -1});
    expect(d.state().pose).toMatchObject(demoMap().docking_stations[0].position);
    expect(d.actions()).toMatchObject({[ACTION.startMowing]: 1, [ACTION.resetJob]: 1});
    d.act(ACTION.startMowing);
    expect(d.state().current_state).toBe('UNDOCKING');
    d.pass(120);
    const back = d.state();
    expect(back).toMatchObject({current_state: 'MOWING', current_area: stopped.current_area});
    expect(back.current_path).toBeGreaterThanOrEqual(stopped.current_path);
    expect((await d.rpc<{job_id: string}[]>(RPC.jobs))[0].job_id).toBe(job.job_id);
    const today = await d.rpc<{type: string; reason?: string}[]>(RPC.events, {date: '20260615'});
    expect(today.find((e) => e.type === 'DOCKING')?.reason).toBe('Manual pause');
  });

  it('skips to the next area and finishes the job in the station', async () => {
    const d = world();
    d.act(ACTION.skipArea);
    d.pass(60);
    expect(d.state().current_area).toBe(1);
    d.act(ACTION.skipArea);
    d.pass(180);
    expect(d.state()).toMatchObject({current_state: 'IDLE', is_charging: 1});
    expect(d.actions()[ACTION.resetJob]).toBe(0);
    const today = await d.rpc<{type: string}[]>(RPC.events, {date: '20260615'});
    expect(today.map((e) => e.type).slice(-4)).toEqual(['JOB_COMPLETE', 'STATE', 'BLADES', 'DOCKED'].concat('STATE').slice(-4));
    d.act(ACTION.startMowing);
    expect(d.state().current_state).toBe('UNDOCKING');
    expect(await d.rpc<unknown[]>(RPC.jobs)).toHaveLength(5);
  });

  it('mows a whole job through', () => {
    const d = world();
    d.pass(3600, 20);
    expect(d.state().current_state).toBe('IDLE');
    expect(d.state().battery_percentage).toBeGreaterThan(0.5);
  });

  it('takes settings set on the mower and plans with them', async () => {
    const d = world();
    const front = demoMap().areas[0].id;
    const before = await d.rpc<{angle: number; paths: {is_outline: boolean}[]}>(RPC.areaPlan, {area_id: front});
    expect(await d.rpc(RPC.setParams, {params: {'/mower_logic/outline_count': 5, '/mower_logic/mow_angle_offset': 90}})).toEqual({
      '/mower_logic/outline_count': 5,
      '/mower_logic/mow_angle_offset': 90,
    });
    expect(JSON.parse(d.got[TOPIC.params])['/mower_logic/outline_count']).toBe(5);
    const after = await d.rpc<{angle: number; paths: {is_outline: boolean}[]}>(RPC.areaPlan, {area_id: front});
    expect(after.angle).toBeCloseTo(before.angle + Math.PI / 2, 6);
    expect(after.paths.filter((p) => p.is_outline).length).toBeGreaterThan(before.paths.filter((p) => p.is_outline).length);
    await expect(d.rpc(RPC.setParams, {params: {'/other/x': 1}})).rejects.toThrow('No dynamic_reconfigure server');
    await expect(d.rpc(RPC.setParams, {})).rejects.toThrow('Expected');
    expect((await d.rpc<string[]>(RPC.methods)).includes(RPC.setParams)).toBe(true);
  });

  it('takes a saved map: the job is gone, it comes home and plans the new one', async () => {
    const d = world();
    const map = demoMap();
    map.areas = map.areas.filter((a) => a.properties.name !== 'Back lawn');
    await d.rpc(RPC.replaceMap, [map]);
    expect(JSON.parse(d.got[TOPIC.map]).areas).toHaveLength(map.areas.length);
    // closed like the mower sends it
    const ring = JSON.parse(d.got[TOPIC.map]).areas[0].outline;
    expect(ring[0]).toEqual(ring.at(-1));
    expect(d.state().current_state).toBe('DOCKING');
    d.pass(120);
    expect(d.state().current_state).toBe('IDLE');
    expect(d.actions()[ACTION.resetJob]).toBe(0);
    d.act(ACTION.startMowing);
    d.pass(3600, 20);
    expect(d.state().current_state).toBe('IDLE');
    const today = await d.rpc<{type: string; area_name?: string}[]>(RPC.events, {date: '20260615'});
    expect(today.filter((e) => e.type === 'AREA').map((e) => e.area_name)).toEqual(['Front lawn', 'Front lawn']);
  });
});

describe("the demo mower's container", () => {
  it('keeps a schedule', async () => {
    expect(parseSchedule(await (await demoFetch('/cgi-bin/schedule')).text())).toMatchObject({enabled: true, plans: [{days: [1, 3, 5], time: '10:00'}]});
    await demoFetch('/cgi-bin/schedule', {method: 'POST', body: 'enabled 0\nplan 2 08:30\n'});
    const res = await demoFetch('/cgi-bin/schedule');
    expect(res.headers.get('content-type')).toContain('text/plain');
    expect(parseSchedule(await res.text())).toMatchObject({enabled: false, plans: [{days: [2], time: '08:30'}]});
  });

  it('keeps map backups', async () => {
    const list = async () => (await demoFetch('/cgi-bin/backups')).json() as Promise<{id: string; name: string}[]>;
    const before = await list();
    expect(before.length).toBeGreaterThan(0);
    await demoFetch('/cgi-bin/backups?name=mine&areas=7&auto=0', {method: 'POST', body: JSON.stringify(demoMap())});
    const [mine] = await list();
    expect(mine.name).toBe('mine');
    expect((await (await demoFetch(`/cgi-bin/backups?id=${mine.id}`)).json()).areas).toHaveLength(7);
    await demoFetch(`/cgi-bin/backups?action=delete&id=${mine.id}`, {method: 'POST'});
    expect(await list()).toHaveLength(before.length);
  });

  it('has the histories its recorders would have kept', async () => {
    createWorld(() => {}, {now: Date.now(), timer: false});
    const lines = (await (await demoFetch('/cgi-bin/sensors')).text()).split('\n').map((l) => l.split('\t'));
    expect(lines.filter((l) => l[0] === 'om_v_battery')).toHaveLength(288);
    expect(lines.every((l) => l.length === 5 && Number(l[2]) <= Number(l[4]) && Number(l[4]) <= Number(l[3]))).toBe(true);
    // the blade ran during yesterday's mow
    expect(lines.some((l) => l[0] === 'om_mow_motor_rpm' && Number(l[4]) > 2000)).toBe(true);
    const cycles = parseBattery(await (await demoFetch('/cgi-bin/battery')).text());
    expect(cycles.filter((c) => c.kind === 'charge').length).toBeGreaterThan(20);
    expect((await demoFetch('/cgi-bin/roslog?oldest')).ok).toBe(false);
    await demoFetch('/cgi-bin/params', {method: 'POST', body: 'enabled 1\n/mower_logic/gps_timeout 20\n'});
    expect(parseKept(await (await demoFetch('/cgi-bin/params')).text())).toEqual({enabled: true, values: {gps_timeout: 20}});
    expect(await (await demoFetch('/version.json')).json()).toHaveProperty('version');
  });
});
