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
