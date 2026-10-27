import {expect, test} from './app';

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

// making room: what nothing needs with the room it frees, a delete only with a second tap
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
  await item.getByRole('button', {name: 'Delete'}).click();
  // the first tap only asks
  await expect(room.getByText('an image without a name')).toBeVisible();
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
