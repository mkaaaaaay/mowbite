import type {Page} from '@playwright/test';
import {demoDocked, demoHas, expect, SIM, test} from './app';

// the updates on the mower (the demo mower has a made-up updater): each part with what runs, its version and
// updating it, OpenMower's release with the warning for the planner, only the log to select, the buttons alike
test('the updates on the mower: the parts, a warning for the release, the log', async ({page}) => {
  await page.goto('/settings/#updates');
  const updates = page.locator('#update');
  for (const name of ['MowBite', 'OpenMower', 'MowBite Planner']) await expect(updates.getByText(name, {exact: true})).toBeVisible();
  await expect(updates.getByText('Update available').first()).toBeVisible();

  const openmower = updates.getByRole('combobox', {name: 'Version'}).nth(1);
  await openmower.selectOption('latest');
  await expect(updates.getByText("With this version the MowBite Planner doesn't work", {exact: false})).toBeVisible();
  await openmower.selectOption('edge');
  await expect(updates.getByText("With this version the MowBite Planner doesn't work", {exact: false})).toHaveCount(0);

  await updates.getByText('Log', {exact: true}).click();
  const log = updates.locator('pre', {hasText: 'tidied up'});
  await expect(log).toBeVisible();
  expect(await log.evaluate((e) => getComputedStyle(e).userSelect)).toBe('text');
  expect(await updates.getByText('MowBite', {exact: true}).evaluate((e) => getComputedStyle(e).userSelect)).toBe('none');

  const sizes = await updates.locator('button:visible').evaluateAll((bs) => [...new Set(bs.map((b) => `${Math.round(b.getBoundingClientRect().width)}x${Math.round(b.getBoundingClientRect().height)}`))]);
  expect(sizes).toHaveLength(1);
});

// making room: what nothing needs with the room it frees, a delete only with a second tap a moment later
test('making room asks before it deletes', async ({page}) => {
  await page.goto('/settings/#updates');
  // the card: the innermost box with its name and its own button
  const room = page
    .locator('#update div')
    .filter({has: page.getByText('Make room', {exact: true})})
    .filter({has: page.getByRole('button', {name: 'Look again'})})
    .last();
  await expect(room.getByText('mowbite_planner:before-0888dd0')).toBeVisible();
  await expect(room.getByText('an older version of the planner, kept to go back to')).toBeVisible();
  const item = room.locator('div', {has: page.getByText('an image without a name')}).last();
  // the first tap only asks, a double tap doesn't answer the question it brings up
  await item.getByRole('button', {name: 'Delete'}).dblclick();
  await expect(item.getByRole('button', {name: 'Really delete?'})).toBeVisible();
  await expect(room.getByText('an image without a name')).toBeVisible();
  await page.waitForTimeout(700);
  await item.getByRole('button', {name: 'Really delete?'}).click();
  await expect(room.getByText('an image without a name')).toHaveCount(0, {timeout: 15_000});
});

// an update shows how far it is on a bar in the part's card (the demo mower plays one through in about 20 seconds)
test('an update shows how far it is', async ({page}) => {
  await page.goto('/settings/#updates');
  const updates = page.locator('#update');
  await updates.getByRole('button', {name: 'Update', exact: true}).first().click();
  const bar = updates.getByRole('progressbar');
  await expect(bar).toHaveCount(1);
  await expect(updates.getByText('Updating MowBite (1 of 1)…')).toBeVisible();
  await expect(bar).toHaveAttribute('aria-label', 'Downloading', {timeout: 10_000});
  await expect(bar).toHaveAttribute('aria-label', 'Unpacking', {timeout: 15_000});
  // (the updater's own one stays)
  await expect(updates.getByText('Update available')).toHaveCount(1, {timeout: 30_000});
  await expect(bar).toHaveCount(0);
});

// the updater itself: its own card, its download on the bar, then its restart on the new version
test('the updater updates itself', async ({page}) => {
  await page.goto('/settings/#updates');
  const card = page
    .locator('#update div')
    .filter({has: page.getByText('MowBite Updater', {exact: true})})
    .filter({has: page.getByRole('button', {name: 'Update', exact: true})})
    .last();
  await expect(card.getByText('Update available')).toBeVisible();
  await expect(card.getByText('commit 7cce417', {exact: false})).toBeVisible();
  await card.getByRole('button', {name: 'Update', exact: true}).click();
  await expect(card.getByRole('progressbar')).toHaveAttribute('aria-label', 'Downloading', {timeout: 10_000});
  await expect(card.getByText('Restarting the updater, this comes back by itself')).toBeVisible({timeout: 15_000});
  await expect(card.getByText('Up to date')).toBeVisible({timeout: 20_000});
  await expect(card.getByText('commit 70cb346', {exact: false})).toBeVisible();
  await expect(card.getByRole('progressbar')).toHaveCount(0);
});

// the updater's own page in here: only where it takes taps (MowBite from the updater's host), else MowBite's own cards.
// made up: MowBite at mowbite.test from the built app, its scripts and the updater's page stand-ins, no mower anywhere
test.describe("the updater's page in here", () => {
  test.skip(SIM, 'made up, not for a mower');
  const now = () => Math.round(Date.now() / 1000);
  const UPDATER_PAGE = "<p>the updater's page</p><script>parent.postMessage({mowbiteUpdater: 'height', height: 300}, '*')</script>";
  const CONFIG = "window.__MOWER_CONFIG__ = {mqttUrl: 'ws://mowbite.test:9001'};";
  const conf = {at: '03:00', days: 'daily', mowbite: 'beta', mowbite_auto: 0, openmower: 'edge', openmower_auto: 0, planner_auto: 0};
  async function madeUp(page: Page, app: string, where: string, status: Record<string, string>) {
    await page.addInitScript(() => localStorage.removeItem('mower'));
    // (mqtt goes nowhere: nothing answers it)
    await page.routeWebSocket(/.*/, () => {});
    await page.route(/./, async (route) => {
      const url = new URL(route.request().url());
      if (url.port === '8083') return route.fulfill({contentType: 'text/html', body: UPDATER_PAGE});
      if (url.hostname !== 'mowbite.test') return route.fulfill({status: 404, body: ''});
      if (url.pathname === '/config.js') return route.fulfill({contentType: 'text/javascript', body: CONFIG});
      if (url.pathname === '/cgi-bin/update' && url.search === '?where') return route.fulfill({contentType: 'text/plain', body: where});
      if (url.pathname === '/cgi-bin/update') {
        const all = {embed: '1', mowbite_running: '1.4.0 2026-10-24', mowbite_available: 'no ghcr.io/mkaaaaaay/mowbite:latest', ...status};
        return route.fulfill({json: {conf, requested: false, status: all, log: []}});
      }
      if (url.pathname.startsWith('/cgi-bin/')) return route.fulfill({contentType: 'text/plain', body: ''});
      // the built app, as the container hands it out
      return route.fulfill({response: await route.fetch({url: new URL(url.pathname + url.search, app).href})});
    });
    await page.goto('http://mowbite.test:8082/settings/#updates');
  }

  test('embedded from the same host', async ({page, baseURL}) => {
    await madeUp(page, baseURL!, '', {alive: String(now()), updater_running: '70cb346 2026-10-26'});
    const frame = page.locator('#update iframe[title="MowBite Updater"]');
    await expect(frame).toHaveAttribute('src', /^http:\/\/mowbite\.test:8083\/\?embed=1/);
    await expect(page.frameLocator('#update iframe').getByText("the updater's page")).toBeVisible();
    await expect(frame).toHaveCSS('height', '300px');
    await expect(page.locator('#update').getByRole('button', {name: 'Check for updates'})).toHaveCount(0);
  });

  test("its page on another host only shows, MowBite's own cards instead", async ({page, baseURL}) => {
    await madeUp(page, baseURL!, 'http://openmower.test:8083', {alive: String(now()), updater_running: '70cb346 2026-10-26'});
    const updates = page.locator('#update');
    await expect(updates.getByRole('button', {name: 'Check for updates'})).toBeVisible();
    await expect(updates.locator('iframe')).toHaveCount(0);
    const own = updates.getByRole('link', {name: 'http://openmower.test:8083'});
    await expect(own).toHaveAttribute('href', /^http:\/\/openmower\.test:8083\/\?theme=/);
  });

  test("one that's quiet for a while is still there, not one to set up", async ({page, baseURL}) => {
    await madeUp(page, baseURL!, '', {alive: String(now() - 900), updater_running: '70cb346 2026-10-26'});
    const updates = page.locator('#update');
    await expect(updates.getByText("The updater hasn't given a sign of life since", {exact: false})).toBeVisible();
    await expect(updates.locator('iframe')).toHaveCount(1);
    await expect(updates.getByText('not set up yet', {exact: false})).toHaveCount(0);
  });
});

// a newer build on the server reloads the page, not while the mower is out or something unsaved would be lost: then
// the next time the page is shown
test('a newer build reloads the page only while the mower waits', async ({page}) => {
  test.skip(SIM, 'the demo mower');
  let newer = false;
  await page.route('**/version.json', async (route) =>
    newer ? route.fulfill({json: {version: '99.0.0', level: 99}}) : route.fulfill({response: await route.fetch()}),
  );
  await page.goto('/');
  await expect.poll(async () => (await demoHas<{current_state: string}>(page, 'robot_state/json')).current_state).toBe('MOWING');
  await page.evaluate(() => ((window as unknown as {kept: boolean}).kept = true));
  newer = true;
  const shown = () => page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  // (a page that's just reloading has lost it)
  const kept = () => page.evaluate(() => !!(window as unknown as {kept?: boolean}).kept).catch(() => false);
  await shown();
  await page.waitForTimeout(1500);
  expect(await kept()).toBe(true);
  await demoDocked(page);
  await shown();
  await expect.poll(kept).toBe(false);
});

// made up like above, out of the demo on a page of its own: requests that find nothing fail in the console there
test.describe('MowBite on another mower or without a container', () => {
  test.skip(SIM, 'made up, not for a mower');
  const CONFIG = "window.__MOWER_CONFIG__ = {mqttUrl: 'ws://mowbite.test:9001'};";
  const CORS = {'access-control-allow-origin': '*'};

  test('without a container: no steps in dockge for a stack that isn\'t there', async ({context, baseURL}) => {
    await context.routeWebSocket(/.*/, () => {});
    const page = await context.newPage();
    await page.route(/./, async (route) => {
      const url = new URL(route.request().url());
      if (url.hostname !== 'mowbite.test' || url.pathname.startsWith('/cgi-bin/')) return route.fulfill({status: 404, body: ''});
      if (url.pathname === '/config.js') return route.fulfill({contentType: 'text/javascript', body: CONFIG});
      // the built app on a web server of its own
      return route.fulfill({response: await route.fetch({url: new URL(url.pathname + url.search, baseURL).href})});
    });
    await page.goto('http://mowbite.test:8082/settings/#updates');
    const updates = page.locator('#update');
    await expect(updates.getByText('Only when MowBite runs as its container on the mower.')).toBeVisible();
    await expect(updates.getByText('Update MowBite in Dockge')).toHaveCount(0);
    await expect(updates.getByText('not set up yet', {exact: false})).toHaveCount(0);
    // a 404 from the server the page came from is no container for good: what asks every few seconds stops
    const asked: string[] = [];
    page.on('request', (r) => r.url().includes('/cgi-bin/') && asked.push(r.url()));
    await page.waitForTimeout(6000);
    expect(asked).toEqual([]);
    await page.close();
  });

  test("another mower picked: its older container is told, not the page's version", async ({context, baseURL}) => {
    await context.routeWebSocket(/.*/, () => {});
    const page = await context.newPage();
    await page.addInitScript(() => {
      localStorage.setItem('appSettings', JSON.stringify({mowers: [{id: 'b', name: 'B', host: 'mower2.test'}]}));
      localStorage.setItem('mower', 'b');
    });
    await page.route(/./, async (route) => {
      const url = new URL(route.request().url());
      if (url.hostname === 'mower2.test' && url.pathname === '/cgi-bin/version') return route.fulfill({headers: CORS, json: {version: '1.0.0', level: 0}});
      if (url.hostname !== 'mowbite.test' || url.pathname.startsWith('/cgi-bin/')) return route.fulfill({status: 404, headers: CORS, body: ''});
      if (url.pathname === '/config.js') return route.fulfill({contentType: 'text/javascript', body: CONFIG});
      return route.fulfill({response: await route.fetch({url: new URL(url.pathname + url.search, baseURL).href})});
    });
    await page.goto('http://mowbite.test:8082/settings/#updates');
    await expect(page.locator('#update').getByText('MowBite on the mower (1.0.0) is older than this app.', {exact: false})).toBeVisible();
    await page.close();
  });
});
