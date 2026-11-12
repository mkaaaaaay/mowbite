import type {DemoPart} from '@/lib/demo/flags';
import type {World} from '@/lib/demo/world';
import {expect, test as base, type Page} from '@playwright/test';

// With E2E_URL the tests go to a MowBite with a mower or a simulator, else to the built app with the demo mower
export const SIM = !!process.env.E2E_URL;

// every test: the demo mower chosen (without a mower to go to), and nothing in the console that says something broke
export const test = base.extend<{errors: string[]}>({
  // (the fixture's own function named run, not use: the react hook rules would take it for one)
  page: async ({page}, run) => {
    if (!SIM) await page.addInitScript(() => localStorage.setItem('mower', 'demo'));
    await run(page);
  },
  errors: [
    async ({page}, run) => {
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(e.message));
      page.on('console', (m) => {
        if (m.type() === 'error') errors.push(m.text());
      });
      await run(errors);
      expect(errors, 'errors in the console').toEqual([]);
    },
    {auto: true},
  ],
});
export {expect};

// MowBite OS's parts the demo has behind a switch (lib/demo/flags), switched on before the page loads
export const demoWith = (page: Page, ...parts: DemoPart[]) =>
  page.addInitScript((names) => names.forEach((n) => ((window as unknown as Record<string, boolean>)[`mowbiteDemo${n}`] = true)), parts);

// the demo mower as the app reaches it (lib/demo/client): what it has on a topic now, and a call to it like another phone
// would make one
type DemoMower = Pick<World, 'retained' | 'published' | 'ahead' | 'emergency' | 'refuseReset' | 'cameras'>;
export const demoHas = async <T>(page: Page, topic: string): Promise<T> => {
  await page.waitForFunction(() => 'mowbiteDemo' in window);
  return page.evaluate((t) => JSON.parse((window as unknown as {mowbiteDemo: DemoMower}).mowbiteDemo.retained(t)[0][1]), topic);
};
// it's out mowing when the demo opens: sent home, and the way there driven at once
export async function demoDocked(page: Page) {
  await page.waitForFunction(() => 'mowbiteDemo' in window);
  await page.evaluate(() => {
    const demo = (window as unknown as {mowbiteDemo: DemoMower}).mowbiteDemo;
    demo.published('action', 'mower_logic:mowing/abort_mowing');
    demo.ahead(1800);
  });
  await expect.poll(async () => (await demoHas<{current_state: string}>(page, 'robot_state/json')).current_state).toBe('IDLE');
}
// an action as another phone would send it
export const demoAction = (page: Page, action: string) =>
  page.evaluate((a) => (window as unknown as {mowbiteDemo: DemoMower}).mowbiteDemo.published('action', a), action);
// the emergency stop as a bumper or the lift sets it, with the reasons its line in the ros log gives
export const demoEmergency = (page: Page, reasons?: string[]) =>
  page.evaluate((r) => (window as unknown as {mowbiteDemo: DemoMower}).mowbiteDemo.emergency(r), reasons);
// a reset turned down the way MowBite OS does it (EMERGENCY_RESET_REFUSED with these fields), null lets it go again
export const demoRefuseReset = (page: Page, why: Record<string, unknown> | null) =>
  page.evaluate((w) => (window as unknown as {mowbiteDemo: DemoMower}).mowbiteDemo.refuseReset(w), why);
// the cameras' process of MowBite OS coming up or going while the app is open
export const demoCameras = (page: Page, on: boolean) => page.evaluate((o) => (window as unknown as {mowbiteDemo: DemoMower}).mowbiteDemo.cameras(o), on);
export const demoCall = (page: Page, method: string, params: unknown) =>
  page.evaluate(
    ([method, params]) =>
      (window as unknown as {mowbiteDemo: DemoMower}).mowbiteDemo.published('rpc/request', JSON.stringify({jsonrpc: '2.0', method, params, id: 'another-phone'})),
    [method, params] as const,
  );

// the map on the page that's shown (the editor is kept hidden while other pages are open)
export const visibleAreas = (page: Page) => page.locator('polygon[data-area]:visible');

// a tab of the tab bar by its page (the links end in a slash in the built app)
// (the visible one: on a phone the logo, also a link to the overview, isn't shown)
export const tab = (page: Page, path: string) => page.locator(`nav a[href="${path === '/' ? '/' : `${path}/`}"]:visible`).first();

export async function openMap(page: Page) {
  await page.goto('/');
  await tab(page, '/map').click();
  await expect(page).toHaveURL(/\/map\/?$/);
  await expect(visibleAreas(page).first()).toBeVisible();
}

// a point on the map in the biggest mowing area, away from the buttons on the map and from what lies on the lawn (by its
// geometry: while decorating the areas take no taps)
export function lawnPoint(page: Page): Promise<{x: number; y: number}> {
  return page.evaluate(() => {
    const visible = [...document.querySelectorAll<SVGPolygonElement>('polygon[data-area]')].filter((p) => p.getBoundingClientRect().width > 0);
    const kind = (p: Element) => p.getAttribute('class') ?? '';
    const size = (p: Element) => p.getBoundingClientRect().width * p.getBoundingClientRect().height;
    const lawn = visible.filter((p) => kind(p).includes('mowArea')).sort((a, b) => size(b) - size(a))[0];
    const others = visible.filter((p) => p !== lawn && !kind(p).includes('mowArea'));
    const inside = (p: SVGPolygonElement, x: number, y: number) => {
      const m = p.getScreenCTM()?.inverse();
      return !!m && p.isPointInFill(new DOMPoint(x, y).matrixTransform(m));
    };
    const frame = lawn.closest('svg')!.parentElement!.parentElement!.getBoundingClientRect();
    const r = lawn.getBoundingClientRect();
    const x0 = Math.max(r.left, frame.left + 30);
    const x1 = Math.min(r.right, frame.right - 70);
    const y0 = Math.max(r.top, frame.top + 50);
    const y1 = Math.min(r.bottom, frame.bottom - 50);
    // rings outwards from the middle until a spot on the lawn and on nothing else
    const cx = (x0 + x1) / 2;
    const cy = (y0 + y1) / 2;
    for (let d = 0; d < Math.max(x1 - x0, y1 - y0); d += 4) {
      for (const [x, y] of [[cx + d, cy], [cx - d, cy], [cx, cy + d], [cx, cy - d], [cx + d, cy + d], [cx - d, cy - d]]) {
        if (x <= x0 || x >= x1 || y <= y0 || y >= y1) continue;
        if (!inside(lawn, x, y) || others.some((o) => inside(o, x, y)) || document.elementFromPoint(x, y)?.closest('button')) continue;
        return {x, y};
      }
    }
    throw new Error('no free spot on the lawn');
  });
}

// the points of the area being edited on the screen, the ones a finger can reach first (not under a bar on the map),
// nearest the middle of the map first
export const handles = (page: Page) =>
  page.evaluate(() => {
    const circles = [...document.querySelectorAll('circle')].filter((c) => /vertex|activeVertex/.test(c.getAttribute('class') ?? '') && c.getBoundingClientRect().width > 0);
    const frame = circles[0]?.closest('svg')?.parentElement?.parentElement?.getBoundingClientRect();
    const mid = frame ? {x: frame.left + frame.width / 2, y: frame.top + frame.height / 2} : {x: 0, y: 0};
    return circles
      .map((c) => {
        const r = c.getBoundingClientRect();
        const at = {x: r.left + r.width / 2, y: r.top + r.height / 2};
        return {...at, free: document.elementFromPoint(at.x, at.y) instanceof SVGElement, d: Math.hypot(at.x - mid.x, at.y - mid.y)};
      })
      .sort((a, b) => Number(b.free) - Number(a.free) || a.d - b.d)
      .map(({x, y}) => ({x, y}));
  });

// the outline of the area being edited, to see whether it moved
export const pickedOutline = (page: Page) =>
  page.evaluate(() => [...document.querySelectorAll('polygon')].find((p) => /selected\b|selected_/.test(p.getAttribute('class') ?? '') && p.getBoundingClientRect().width > 0)?.getAttribute('points') ?? '');

// a finger: held at from for a moment, then moved to to and let go. playwright's touchscreen only taps
export async function touchDrag(page: Page, from: {x: number; y: number}, to: {x: number; y: number}, {hold = 450, steps = 12, during}: {hold?: number; steps?: number; during?: () => Promise<void>} = {}) {
  const cdp = await page.context().newCDPSession(page);
  const touch = (type: string, points: {x: number; y: number}[]) => cdp.send('Input.dispatchTouchEvent', {type: type as 'touchStart', touchPoints: points.map((p, id) => ({...p, id, radiusX: 4, radiusY: 4, force: 1}))});
  await touch('touchStart', [from]);
  await page.waitForTimeout(hold);
  for (let i = 1; i <= steps; i++) {
    await touch('touchMove', [{x: from.x + ((to.x - from.x) * i) / steps, y: from.y + ((to.y - from.y) * i) / steps}]);
    await page.waitForTimeout(30);
  }
  await during?.();
  await touch('touchEnd', []);
  await cdp.detach();
}

// the demo mower driven with the stick at once, as if the seconds had passed: [m/s forward, rad/s left, seconds] each,
// 0 and 0 the stick let go (else the last move goes on for a second once the clock gets there)
export const demoDrive = (page: Page, moves: [number, number, number][]) =>
  page.evaluate((moves) => {
    type Demo = {published(topic: string, message: Uint8Array): void; tick(now: number): void};
    const demo = (window as unknown as {mowbiteDemo: Demo}).mowbiteDemo;
    // the stick's command as bson {vx, vz}, like lib/teleop
    const twist = (vx: number, vz: number) => {
      const d = new DataView(new ArrayBuffer(29));
      let o = 0;
      d.setInt32(o, 29, true);
      o += 4;
      for (const [k, v] of [['vx', vx], ['vz', vz]] as const) {
        d.setUint8(o++, 1);
        for (const c of k + '\0') d.setUint8(o++, c.charCodeAt(0));
        d.setFloat64(o, v, true);
        o += 8;
      }
      return new Uint8Array(d.buffer);
    };
    // the demo's clock to now first: the first step as long as the others, not as long as since its last tick
    let t = Date.now();
    demo.tick(t);
    for (const [vx, vz, s] of moves)
      for (let i = 0; i < s * 5; i++) {
        demo.published('teleop', twist(vx, vz));
        demo.tick((t += 200));
      }
  }, moves);

// the record page's guide for the docking station, from the mower standing in it: measured there, backed out 1.5 m and
// measured there, saved (said: how it compares to the one before), driven in again and recording mode ended
export async function recordStation(page: Page, said: string) {
  await expect(page.getByText('it measures where it charges')).toBeVisible();
  expect((await demoHas<{current_state: string}>(page, 'robot_state/json')).current_state).toBe('AREA_RECORDING');
  await expect(page.getByText('Back it out straight', {exact: true})).toBeVisible({timeout: 15_000});
  await demoDrive(page, [
    [-0.25, 0, 6],
    [0, 0, 1],
  ]);
  await expect(page.getByText('it measures the way out')).toBeVisible({timeout: 15_000});
  const save = page.getByRole('button', {name: 'Save docking station'});
  await expect(save).toBeVisible({timeout: 15_000});
  await save.click();
  await expect(page.getByText(said)).toBeVisible();
  // straight in again until it charges, then out of recording mode: the page tells it once more
  await demoDrive(page, [
    [0.25, 0, 6],
    [0, 0, 1],
  ]);
  await expect(page.getByText('On the station. Now end recording mode.')).toBeVisible();
  await page.getByRole('button', {name: 'End recording mode'}).click();
  await expect.poll(async () => (await demoHas<{current_state: string}>(page, 'robot_state/json')).current_state).toBe('IDLE');
  await expect(page.getByText(said)).toBeVisible();
}
