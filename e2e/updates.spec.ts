import type {Page} from '@playwright/test';
import {demoDocked, demoHas, expect, SIM, test} from './app';

// the updates on the mower (the demo mower has a made-up updater), laid out like MowBite OS's: how many there are, each
// part with what runs, its channel and updating it, OpenMower's release with the warning for the planner, only the log
// to select
test('the updates on the mower: the parts, a warning for the release, the log', async ({page}) => {
  await page.goto('/settings/#updates');
  const updates = page.locator('#update');
  await expect(updates.locator('[data-part]')).toHaveCount(4);
  for (const name of ['MowBite', 'OpenMower', 'MowBite Planner', 'MowBite Updater']) await expect(updates.locator('[data-part]').getByText(name, {exact: true})).toBeVisible();
  await expect(updates.getByText('2 updates available')).toBeVisible();
  await expect(updates.locator('[data-part="mowbite"]')).toContainText('Update available');
  await expect(updates.locator('[data-part="openmower"]')).toContainText('Up to date');
  await expect(updates.locator('iframe')).toHaveCount(0);

  const openmower = updates.locator('[data-part="openmower"]').getByRole('combobox', {name: 'Channel'});
  await openmower.selectOption('latest');
  await expect(updates.getByText("With this version the MowBite Planner doesn't work", {exact: false})).toBeVisible();
  await openmower.selectOption('edge');
  await expect(updates.getByText("With this version the MowBite Planner doesn't work", {exact: false})).toHaveCount(0);

  await updates.getByText('Log', {exact: true}).click();
  const log = updates.locator('pre', {hasText: 'tidied up'});
  await expect(log).toBeVisible();
  expect(await log.evaluate((e) => getComputedStyle(e).userSelect)).toBe('text');
  expect(await updates.getByText('MowBite', {exact: true}).evaluate((e) => getComputedStyle(e).userSelect)).toBe('none');
});

// going back asks first, in the part's details
test('back to the version before, asked first', async ({page}) => {
  await page.goto('/settings/#updates');
  const mowbite = page.locator('#update [data-part="mowbite"]');
  await mowbite.getByRole('button', {name: 'Details and the version before'}).click();
  await mowbite.getByRole('button', {name: 'Back to the version before'}).click();
  await expect(mowbite.getByRole('heading')).toHaveText('Take MowBite back to the version before?');
  await mowbite.getByRole('button', {name: 'Go back'}).click();
  const run = page.locator('#update [data-update="mowbite"]');
  await expect(run).toContainText('MowBite goes back');
  await expect(run.locator('[data-step="back"]')).toBeVisible();
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

// an update shows its steps and the one it's on (the demo mower plays one through in about 20 seconds), the other
// parts only show what runs meanwhile
test('an update shows how far it is', async ({page}) => {
  await page.goto('/settings/#updates');
  const updates = page.locator('#update');
  await updates.locator('[data-part="mowbite"]').getByRole('button', {name: 'Update', exact: true}).click();
  const run = updates.locator('[data-update="mowbite"]');
  await expect(run).toContainText('MowBite is being updated');
  await expect(run).toContainText('Updating MowBite (1 of 1)…');
  await expect(updates.getByRole('button', {name: 'Update', exact: true})).toHaveCount(0);
  await expect(run.locator('[data-step="download"]')).toContainText('Downloading', {timeout: 10_000});
  await expect(run.locator('[data-step="download"]')).toContainText('Downloaded', {timeout: 15_000});
  await expect(run.locator('[data-step="extract"]')).toContainText('Unpacking');
  // (the updater's own one stays)
  await expect(updates.getByText('1 update available')).toBeVisible({timeout: 30_000});
  await expect(run).toHaveCount(0);
  await expect(updates.locator('[data-part="mowbite"]')).toContainText('Just updated');
});

// the updater itself: its own card, its download, then its restart on the new version
test('the updater updates itself', async ({page}) => {
  await page.goto('/settings/#updates');
  const card = page.locator('#update [data-part="updater"]');
  await expect(card).toContainText('Update available');
  await expect(card).toContainText('commit 7cce417');
  await card.getByRole('button', {name: 'Update', exact: true}).click();
  const run = page.locator('#update [data-update="updater"]');
  await expect(run.locator('[data-step="download"]')).toContainText('Downloading', {timeout: 10_000});
  await expect(run).toContainText('Restarting the updater, this comes back by itself', {timeout: 15_000});
  await expect(card).toContainText('Just updated', {timeout: 20_000});
  await expect(card).toContainText('commit 70cb346');
  await expect(run).toHaveCount(0);
});

// MowBite's own cards also with an updater that has a page for in here, its page behind a link. made up: MowBite at
// mowbite.test from the built app, its scripts and the updater stand-ins, no mower anywhere
test.describe("the updater's page", () => {
  test.skip(SIM, 'made up, not for a mower');
  const now = () => Math.round(Date.now() / 1000);
  const CONFIG = "window.__MOWER_CONFIG__ = {mqttUrl: 'ws://mowbite.test:9001'};";
  const conf = {at: '03:00', days: 'daily', mowbite: 'beta', mowbite_auto: 0, openmower: 'edge', openmower_auto: 0, planner_auto: 0};
  async function madeUp(page: Page, app: string, where: string, status: Record<string, string>) {
    await page.addInitScript(() => localStorage.removeItem('mower'));
    // (mqtt goes nowhere: nothing answers it)
    await page.routeWebSocket(/.*/, () => {});
    await page.route(/./, async (route) => {
      const url = new URL(route.request().url());
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

  test("MowBite's own cards, its page behind a link", async ({page, baseURL}) => {
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
    await expect(updates.locator('iframe')).toHaveCount(0);
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
