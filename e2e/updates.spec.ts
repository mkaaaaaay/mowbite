import type {Locator, Page} from '@playwright/test';
import {demoDocked, demoFlag, demoHas, demoWith, expect, SIM, test} from './app';

// the updates on the mower (the demo mower has a made-up updater), laid out like MowBite OS's: how many there are, each
// part with what runs, its channel and updating it, OpenMower's release with the warning for the planner, only the log
// to select
test('the updates on the mower: the parts, no planner warning for edge or the release, the log', async ({page}) => {
  await page.goto('/settings/#update');
  const updates = page.locator('#update');
  await expect(updates.locator('[data-part]')).toHaveCount(4);
  for (const name of ['MowBite', 'OpenMower', 'MowBite Planner', 'MowBite Updater']) await expect(updates.locator('[data-part]').getByText(name, {exact: true})).toBeVisible();
  await expect(updates.getByText('2 updates available')).toBeVisible();
  await expect(updates.locator('[data-part="mowbite"]')).toContainText('Update available');
  await expect(updates.locator('[data-part="openmower"]')).toContainText('Up to date');
  await expect(updates.locator('iframe')).toHaveCount(0);

  const openmower = updates.locator('[data-part="openmower"]').getByRole('combobox', {name: 'Channel'});
  // both have what the planner needs since OpenMower 1.5.0 (older tags: lacksPlanner)
  await openmower.selectOption('latest');
  await expect(openmower).toHaveValue('latest');
  await expect(updates.getByText("With this version the MowBite Planner doesn't work", {exact: false})).toHaveCount(0);
  await openmower.selectOption('edge');
  await expect(updates.getByText("With this version the MowBite Planner doesn't work", {exact: false})).toHaveCount(0);

  await updates.getByText('Log', {exact: true}).click();
  const log = updates.locator('pre', {hasText: 'tidied up'});
  await expect(log).toBeVisible();
  expect(await log.evaluate((e) => getComputedStyle(e).userSelect)).toBe('text');
  expect(await updates.getByText('MowBite', {exact: true}).evaluate((e) => getComputedStyle(e).userSelect)).toBe('none');
});

// a look for updates asked for: the button says so and stays locked from the tap until the updater has looked, also
// while it only noted the request (taken). an update can still be asked for, the look stops for it
test('checking for updates shows while the updater looks', async ({page}) => {
  await page.goto('/settings/#update');
  const updates = page.locator('#update');
  await updates.getByRole('button', {name: 'Check for updates'}).click();
  await expect(updates.getByRole('button', {name: 'Checking…'})).toBeDisabled();
  await expect(updates.getByText('Looking for updates', {exact: true})).toBeVisible();
  await page.waitForTimeout(1500);
  await expect(updates.getByRole('button', {name: 'Checking…'})).toBeDisabled();
  await expect(updates.locator('[data-part="mowbite"]').getByRole('button', {name: 'Update', exact: true})).toBeEnabled();
  await expect(updates.getByRole('button', {name: 'Check for updates'})).toBeEnabled({timeout: 15000});
});

// another channel picked: looked for at once, as on the updater's page
test('another channel looks for updates', async ({page}) => {
  await page.goto('/settings/#update');
  const updates = page.locator('#update');
  await updates.locator('[data-part="mowbite"]').getByRole('combobox', {name: 'Channel'}).selectOption('stable');
  await expect(updates.getByRole('button', {name: 'Checking…'})).toBeDisabled();
});

// going back asks first, in the part's details
test('back to the version before, asked first', async ({page}) => {
  await page.goto('/settings/#update');
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
  await page.goto('/settings/#update');
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
  // (where it was tapped, the buttons locked until it's done)
  await expect(item.getByRole('button', {name: 'Delete'})).toBeDisabled();
  await expect(item.getByText('Deleting…', {exact: true})).toBeVisible();
  await expect(item.getByRole('progressbar')).toBeVisible();
  await expect(room.getByRole('button', {name: 'Look again'})).toBeDisabled();
  await expect(room.getByText('an image without a name')).toHaveCount(0, {timeout: 15_000});
  await expect(room.getByRole('button', {name: 'Look again'})).toBeEnabled();
});

// a look for room: on its card, locked until it's done
test('looking for room again shows where it was tapped', async ({page}) => {
  await page.goto('/settings/#update');
  const room = page
    .locator('#update div')
    .filter({has: page.getByText('Make room', {exact: true})})
    .filter({has: page.getByText('Build cache', {exact: true})})
    .last();
  await room.getByRole('button', {name: 'Look again'}).click();
  await expect(room.getByRole('button', {name: 'Look again'})).toBeDisabled();
  await expect(room.getByText('Looking what can go…')).toBeVisible();
  await expect(room.getByRole('button', {name: 'Look again'})).toBeEnabled({timeout: 10_000});
});

// an update shows its steps and the one it's on (the demo mower plays one through in about 20 seconds), the other
// parts only show what runs meanwhile
test('an update shows how far it is', async ({page}) => {
  await page.goto('/settings/#update');
  const updates = page.locator('#update');
  await updates.locator('[data-part="mowbite"]').getByRole('button', {name: 'Update', exact: true}).click();
  const run = updates.locator('[data-update="mowbite"]');
  // at once in the card's place, also while the updater only noted it, with a bar on the step it's on
  await expect(run).toContainText('MowBite is being updated');
  await expect(run.locator('[data-step="prepare"]')).toContainText('Getting ready');
  await expect(run.getByRole('progressbar')).toBeVisible();
  await expect(updates.locator('[data-part="mowbite"]')).toHaveCount(0);
  await page.waitForTimeout(1500);
  await expect(updates.getByRole('button', {name: /^(Update|Update all)$/})).toHaveCount(0);
  // (what runs is said once, on its card: no line and no look for updates above it)
  await expect(updates.getByRole('button', {name: 'Check for updates'})).toHaveCount(0);
  await expect(updates).not.toContainText('Updating MowBite');
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
  await page.goto('/settings/#update');
  const card = page.locator('#update [data-part="updater"]');
  await expect(card).toContainText('Update available');
  await expect(card).toContainText('commit 7cce417');
  await card.getByRole('button', {name: 'Update', exact: true}).click();
  const run = page.locator('#update [data-update="updater"]');
  // (in sight where it was tapped, also with the cards above it folded to their heads)
  await expect(run).toBeInViewport();
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
  const OPENMOWER = [{id: 'openmower', name: 'OpenMower', kind: 'openmower', container: 'open_mower_ros', gate: 'mower'}];
  // (posts: the requests sent, each answered ok; down: no answer then)
  async function madeUp(
    page: Page,
    app: string,
    where: string,
    status: Record<string, string>,
    {parts, posts, down}: {parts?: object[]; posts?: string[]; down?: () => boolean} = {},
  ) {
    await page.addInitScript(() => localStorage.removeItem('mower'));
    // (mqtt goes nowhere: nothing answers it)
    await page.routeWebSocket(/.*/, () => {});
    await page.route(/./, async (route) => {
      const url = new URL(route.request().url());
      if (url.hostname !== 'mowbite.test') return route.fulfill({status: 404, body: ''});
      if (url.pathname === '/config.js') return route.fulfill({contentType: 'text/javascript', body: CONFIG});
      if (url.pathname === '/cgi-bin/update' && url.search === '?where') return route.fulfill({contentType: 'text/plain', body: where});
      if (url.pathname === '/cgi-bin/update' && route.request().method() === 'POST') {
        posts?.push(url.search.slice(1));
        return route.fulfill({contentType: 'text/plain', body: 'ok\n'});
      }
      if (url.pathname === '/cgi-bin/update') {
        if (down?.()) return route.fulfill({status: 502, body: ''});
        const all = {embed: '1', mowbite_running: '1.4.0 2026-10-24', mowbite_available: 'no ghcr.io/mkaaaaaay/mowbite:latest', ...status};
        return route.fulfill({json: {conf, parts, requested: !!posts?.length, status: all, log: []}});
      }
      if (url.pathname.startsWith('/cgi-bin/')) return route.fulfill({contentType: 'text/plain', body: ''});
      // the built app, as the container hands it out
      return route.fulfill({response: await route.fetch({url: new URL(url.pathname + url.search, app).href})});
    });
    await page.goto('http://mowbite.test:8082/settings/#update');
  }

  test("MowBite's own cards, its page behind a link", async ({page, baseURL}) => {
    await madeUp(page, baseURL!, 'http://openmower.test:8083', {alive: String(now()), updater_running: '70cb346 2026-10-26'});
    const updates = page.locator('#update');
    await expect(updates.getByRole('button', {name: 'Check for updates'})).toBeVisible();
    await expect(updates.locator('iframe')).toHaveCount(0);
    const own = updates.getByRole('link', {name: 'http://openmower.test:8083'});
    await expect(own).toHaveAttribute('href', /^http:\/\/openmower\.test:8083\/\?theme=/);
  });

  // OpenMower without room for both versions: deleting the one that runs first, offered on its card, two taps, one
  // request; the run then shows on the card at once
  test('OpenMower without a copy, asked on its card', async ({page, baseURL}) => {
    const posts: string[] = [];
    const status = {
      alive: String(now()),
      openmower_running: 'edge 2026-11-03',
      openmower_available: 'yes ghcr.io/clemenselflein/open_mower_ros:edge',
      openmower: 'nospace 7179 2942',
      openmower_nokeep: 'yes 5800 planner - -',
    };
    const parts = [...OPENMOWER, {id: 'planner', name: 'MowBite Planner', kind: 'build', container: 'mowbite_planner', gate: 'mower'}];
    await madeUp(page, baseURL!, '', status, {parts, posts});
    const card = page.locator('#update [data-part="openmower"]');
    await expect(card).toContainText("Both versions don't fit side by side.");
    await expect(card).toContainText("What's built on OpenMower (MowBite Planner) is deleted with it");
    await card.getByRole('button', {name: 'Delete the old version and update'}).dblclick();
    await expect(card.getByRole('button', {name: 'Really delete it first?'})).toBeVisible();
    expect(posts).toEqual([]);
    await page.waitForTimeout(700);
    await card.getByRole('button', {name: 'Really delete it first?'}).click();
    const run = page.locator('#update [data-update="openmower"]');
    await expect(run).toContainText('OpenMower is being updated');
    expect(posts).toEqual(['nokeep=openmower']);
  });

  // OpenMower missing after it: the next try, the commands by hand, and its download again
  test('OpenMower missing after its update without a copy', async ({page, baseURL}) => {
    const posts: string[] = [];
    const status = {
      alive: String(now()),
      openmower_running: 'missing',
      openmower_available: 'unknown ghcr.io/clemenselflein/open_mower_ros:edge',
      openmower_missing: '3 - new ghcr.io/x/om:edge ghcr.io/x/om@sha256:1 ghcr.io/x/om:edge /opt/stacks/openmower',
    };
    await madeUp(page, baseURL!, '', status, {parts: OPENMOWER, posts});
    const card = page.locator('#update [data-part="openmower"]');
    await expect(card).toContainText("OpenMower isn't on the mower right now, the mower can't mow.");
    await expect(card).toContainText('No more tries by itself: tap Try again.');
    await expect(card.locator('pre').first()).toHaveText('docker pull ghcr.io/x/om:edge && cd /opt/stacks/openmower && docker compose up -d');
    await card.getByRole('button', {name: 'Try again'}).dblclick();
    await expect(page.locator('#update [data-update="openmower"]')).toBeVisible();
    expect(posts).toEqual(['now=openmower']);
  });

  // an updater that stops answering for a while: said, the buttons locked, what came last stays
  test('no answer from the updater for a while', async ({page, baseURL, errors}) => {
    let quiet = false;
    const status = {alive: String(now()), updater_running: '70cb346 2026-10-26', updater_available: 'yes ghcr.io/mkaaaaaay/mowbite-updater:latest'};
    await madeUp(page, baseURL!, '', status, {down: () => quiet});
    const card = page.locator('#update [data-part="updater"]');
    await expect(card.getByRole('button', {name: 'Update', exact: true})).toBeEnabled();
    quiet = true;
    await expect(page.locator('#update').getByText('No connection to the updater', {exact: false})).toBeVisible({timeout: 20_000});
    await expect(card.getByRole('button', {name: 'Update', exact: true})).toBeDisabled();
    quiet = false;
    await expect(card.getByRole('button', {name: 'Update', exact: true})).toBeEnabled({timeout: 10_000});
    // (the answers it didn't get, nothing else)
    expect(errors.filter((e) => !e.includes('502'))).toEqual([]);
    errors.length = 0;
  });

  // MowBite OS in OpenMower's place: why not as the updater says it, else one request on two taps
  test("MowBite OS not offered, and why", async ({page, baseURL}) => {
    await madeUp(page, baseURL!, '', {alive: String(now()), os_switch: 'no room 2300 1400'}, {parts: OPENMOWER});
    const card = page.locator('#update [data-part="os"]');
    await expect(card).toContainText("MowBite OS can't take OpenMower's place right now: there isn't room even without OpenMower's version");
    await expect(card.getByRole('button')).toHaveCount(0);
  });

  test('MowBite OS offered, one request on two taps', async ({page, baseURL}) => {
    const posts: string[] = [];
    await madeUp(page, baseURL!, '', {alive: String(now()), os_switch: 'yes 0 drop kept'}, {parts: OPENMOWER, posts});
    const card = page.locator('#update [data-part="os"]');
    await expect(card).toContainText('on the mower already');
    await card.getByRole('button', {name: 'Switch to MowBite OS'}).click();
    await expect(card).toContainText("OpenMower's version and what's built on it, like the planner, are deleted first");
    await expect(card).toContainText('MowBite OS keeps its own data from an earlier switch');
    expect(posts).toEqual([]);
    await card.getByRole('button', {name: 'Switch', exact: true}).click();
    await expect(page.locator('#update [data-update="os"]')).toContainText('Switching to MowBite OS…');
    expect(posts).toEqual(['switch=os']);
  });

  test("one that's quiet for a while is still there, not one to set up", async ({page, baseURL}) => {
    await madeUp(page, baseURL!, '', {alive: String(now() - 900), updater_running: '70cb346 2026-10-26'});
    const updates = page.locator('#update');
    await expect(updates.getByText("The updater hasn't given a sign of life since", {exact: false})).toBeVisible();
    await expect(updates.locator('iframe')).toHaveCount(0);
    await expect(updates.getByText('not set up yet', {exact: false})).toHaveCount(0);
  });
});

// MowBite OS in OpenMower's place (the demo's updater offers it with window.mowbiteDemoOsSwitch): the model chosen
// first, two taps there, its steps, the way to the setup afterwards, and two taps back with the map
test.describe("MowBite OS in OpenMower's place", () => {
  test.skip(SIM, 'the demo mower');

  // (the switch is offered once a model that fits is chosen, in the sheet of the card's line)
  const chooseModel = async (card: Locator, key: string) => {
    await card.getByRole('button', {name: 'Choose the mower'}).click();
    const sheet = card.page().getByRole('dialog');
    await sheet.locator(`[data-model="${key}"]`).click();
    await sheet.getByRole('button', {name: 'Choose this mower'}).click();
    await expect(sheet).toHaveCount(0);
  };

  test('the model chosen first, one with a warning only once that is confirmed', async ({page}) => {
    await demoFlag(page, 'mowbiteDemoOsSwitch', true);
    await page.goto('/settings/#update');
    const card = page.locator('#update [data-part="os"]');
    await expect(card).toContainText('Which mower is this?Not chosen yet');
    await expect(card).not.toContainText("MowBite OS can't take OpenMower's place right now");
    const go = card.getByRole('button', {name: 'Switch to MowBite OS'});
    await expect(go).toBeDisabled();

    await card.getByRole('button', {name: 'Choose the mower'}).click();
    const sheet = page.getByRole('dialog');
    await expect(sheet.locator('[data-model]')).toHaveCount(2);
    await expect(sheet.locator('[data-model="nx60i"] img')).toHaveAttribute('src', /^blob:/);
    await expect(sheet.locator('[data-model="nx60i"]')).toContainText('The NX60i with the OpenMower board.');
    await expect(sheet).not.toContainText('Expects the xCore board');
    await sheet.locator('[data-model="openmower-v2"]').click();
    await expect(sheet).toContainText('Only the xCore board is supported.');
    const choose = sheet.getByRole('button', {name: 'Choose this mower'});
    await expect(choose).toBeDisabled();
    await sheet.getByRole('checkbox', {name: 'I have checked this'}).check();
    await choose.click();
    await expect(sheet).toHaveCount(0);
    await expect(card).toContainText('This mowerOpenMower v2');

    await card.getByRole('button', {name: 'Change'}).click();
    await expect(sheet.locator('[data-model="openmower-v2"]')).toContainText('Chosen');
    await expect(sheet).not.toContainText('Only the xCore board is supported.');
    await expect(sheet.getByRole('button', {name: 'Choose this mower'})).toBeDisabled();
    await sheet.getByRole('button', {name: 'Cancel'}).click();
    await expect(sheet).toHaveCount(0);
    await expect(go).toBeEnabled();
    await go.click();
    await expect(card.getByRole('heading')).toHaveText('Switch to MowBite OS?');
    await expect(card).toContainText('MowBite OS starts as OpenMower v2.');
  });

  test('no model fits: no switch, and why', async ({page}) => {
    await demoFlag(page, 'mowbiteDemoOsSwitch', true);
    await demoFlag(page, 'mowbiteDemoOsNoModels', true);
    await page.goto('/settings/#update');
    const card = page.locator('#update [data-part="os"]');
    await expect(card).toContainText("MowBite OS can't take OpenMower's place right now: none of its models fits this mower yet.");
    await expect(card.locator('[data-model]')).toHaveCount(0);
    await expect(card.getByRole('button', {name: 'Switch to MowBite OS'})).toHaveCount(0);
  });

  test('there and back, each on two taps', async ({page}) => {
    await demoFlag(page, 'mowbiteDemoOsSwitch', true);
    await page.goto('/settings/#update');
    const card = page.locator('#update [data-part="os"]');
    await chooseModel(card, 'nx60i');
    await expect(card).toContainText('stays on the mower, stopped');
    await card.getByRole('button', {name: 'Switch to MowBite OS'}).click();
    await expect(card.getByRole('heading')).toHaveText('Switch to MowBite OS?');
    await expect(card).toContainText('make a full image of the eMMC by hand');
    await expect(card).toContainText("from there the switch goes on on the updater's own page");
    await card.getByRole('button', {name: 'Switch', exact: true}).click();
    const run = page.locator('#update [data-update="os"]');
    await expect(run).toContainText('Switching to MowBite OS…');
    await expect(run.locator('[data-step="stop"]')).toContainText('Stopping OpenMower');
    // (from OpenMower's stop on: the updater's page instead of the steps)
    await expect(run.getByRole('link', {name: "The updater's page"})).toHaveAttribute('href', /:8083\/\?theme=/, {timeout: 15_000});
    await expect(run.locator('[data-step]')).toHaveCount(0);
    // (afterwards: the way to its setup)
    await expect(card.getByRole('link', {name: 'To the setup'})).toHaveAttribute('href', /\/setup\/?$/, {timeout: 30_000});
    await expect(card).toContainText("It took OpenMower's map and mower_params.yaml.");

    await card.getByRole('button', {name: 'Back to OpenMower'}).click();
    await expect(card.getByRole('heading')).toHaveText('Back to OpenMower?');
    await expect(card.getByText('A safety step failed', {exact: false})).toHaveCount(0);
    await card.getByRole('button', {name: 'Back to OpenMower'}).click();
    await expect(run).toContainText('Back to OpenMower…');
    await expect(run.locator('[data-step="export"]')).toBeVisible();
    await expect(card).toContainText('with the map from MowBite OS.', {timeout: 30_000});
    await expect(card.getByRole('button', {name: 'Switch to MowBite OS'})).toBeVisible();
  });

  test("back to OpenMower by itself when MowBite OS doesn't run, with the reason", async ({page}) => {
    await demoFlag(page, 'mowbiteDemoOsSwitch', true);
    await demoFlag(page, 'mowbiteDemoOsFails', 'health');
    await page.goto('/settings/#update');
    const card = page.locator('#update [data-part="os"]');
    await chooseModel(card, 'nx60i');
    await card.getByRole('button', {name: 'Switch to MowBite OS'}).click();
    await card.getByRole('button', {name: 'Switch', exact: true}).click();
    await expect(page.locator('#update [data-update="os"]')).toContainText("MowBite OS didn't run as it should, back to OpenMower…", {timeout: 30_000});
    await expect(card).toContainText("MowBite OS didn't run as it should (its health check didn't pass), OpenMower runs again as before.", {timeout: 15_000});
    await expect(card.getByRole('button', {name: 'Switch to MowBite OS'})).toBeVisible();
  });

  // a safety step failed on MowBite OS: OpenMower doesn't know its lock, said before going back, the tap stays possible
  test('the way back warns while a safety step failed', async ({page}) => {
    await demoWith(page, 'Setup');
    await demoFlag(page, 'mowbiteDemoSafetyFailed', true);
    await demoFlag(page, 'mowbiteDemoOsSwitch', 'on');
    await page.goto('/settings/#update');
    const card = page.locator('#update [data-part="os"]');
    await card.getByRole('button', {name: 'Back to OpenMower'}).click();
    const unlocked = card.getByText("A safety step failed. OpenMower doesn't know MowBite OS's lock", {exact: false});
    await expect(unlocked).toBeVisible();
    // (red like what went wrong, not yellow)
    await expect(unlocked).toHaveClass(/error/);
    await card.getByRole('button', {name: 'Back to OpenMower'}).click();
    await expect(page.locator('#update [data-update="os"]')).toContainText('Back to OpenMower…');
  });

  // MowBite OS without the updater's status: the way back on the updater's page, only on the NX60i where it can be
  for (const [platform, there] of [
    ['nx60i', true],
    ['airseekers_tron', false],
  ] as const)
    test(`on MowBite OS (${platform}) the way back ${there ? 'on the updater\'s page' : 'is not offered'}`, async ({page}) => {
      await demoWith(page, 'Os', 'Setup');
      await demoFlag(page, 'mowbiteDemoPlatform', platform);
      await demoFlag(page, 'mowbiteDemoNoUpdater', true);
      await demoFlag(page, 'mowbiteDemoSafetyFailed', true);
      await page.goto('/settings/#update');
      const card = page.locator('#update [data-part="os"]');
      if (!there) {
        await expect(page.locator('#update h2', {hasText: 'On the mower'})).toBeVisible();
        await page.waitForTimeout(1500);
        return expect(card).toHaveCount(0);
      }
      await expect(card.getByRole('link', {name: 'Back to OpenMower'})).toHaveAttribute('href', /:8083\/\?theme=/);
      await expect(card.getByText("A safety step failed. OpenMower doesn't know MowBite OS's lock", {exact: false})).toBeVisible();
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
    // an OpenMower seen before: the note on the container waits for the platform, and without mqtt nothing tells it
    await page.addInitScript(() => localStorage.setItem('mowbiteOs', 'false'));
    await page.goto('http://mowbite.test:8082/settings/#update');
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
    await expect(page.locator('#updates').getByText('MowBite on the mower (1.0.0) is older than this app.', {exact: false})).toBeVisible();
    await page.close();
  });
});
