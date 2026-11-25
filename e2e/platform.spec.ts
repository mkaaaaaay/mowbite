import {demoFlag, demoState, demoWith, expect, SIM, tab, test} from './app';

// MowBite OS's choice of the mower (setup.platforms, setup.platform.set): the first step of the setup, the only one
// while it runs as no mower yet
test.describe('the choice of the mower', () => {
  test.skip(SIM, 'the demo mower only');
  test.beforeEach(({page}) => demoWith(page, 'Os', 'Setup'));
  const step = (page: import('@playwright/test').Page) => page.locator('[data-step="platform"]');

  test('a MowBite OS that runs as no mower has it chosen in the setup and starts again as it', async ({page}) => {
    await demoFlag(page, 'mowbiteDemoSetupPlatform', 'choice');
    await page.goto('/');
    await expect(page.getByRole('heading', {name: 'Choose the mower'})).toBeVisible();
    await expect(page.getByRole('button', {name: 'Start', exact: true})).toHaveCount(0);
    const card = page.locator('[data-card="setup"]');
    await expect(card).toContainText('0 of 1 steps done');
    await card.getByRole('link', {name: 'Go on with the setup'}).click();

    await expect(step(page)).toHaveAttribute('data-state', 'open');
    const choose = step(page).getByRole('button', {name: 'Choose this mower'});
    await expect(choose).toBeDisabled();
    await step(page).getByRole('radio', {name: /YardForce NX60i/}).check();
    await choose.click();
    await expect(step(page).getByText('MowBite OS is starting again')).toBeVisible();
    // back as that mower: the step passed, the next one opens by itself
    await expect(page.locator('[data-step="board"]')).toBeVisible();
    await expect.poll(() => demoState(page)).not.toBe('SETUP');
    await tab(page, '/').click();
    await expect(page.getByRole('heading', {name: 'Choose the mower'})).toHaveCount(0);
    await expect(page.locator('[data-card="setup"]')).toContainText('2 of 13 steps done');
  });

  test('another mower on one set up already asks first', async ({page}) => {
    await page.goto('/setup?step=platform');
    await expect(step(page)).toHaveAttribute('data-state', 'ok');
    await expect(step(page).locator('[data-platform="airseekers_tron"]')).toContainText('This mower now');
    // each mower with its drawing, the one MowBite OS gives or the app's, no figure above the list
    await expect(step(page).locator('[data-platform="airseekers_tron"] [data-picture="os"]')).toBeVisible();
    await expect(step(page).locator('[data-platform="yardforce_nx60i"] [data-picture="nx100"]')).toBeVisible();
    const choose = step(page).getByRole('button', {name: 'Choose this mower'});
    await expect(choose).toBeDisabled();
    await step(page).getByRole('radio', {name: /YardForce NX60i/}).check();
    await choose.click();
    const sheet = page.getByRole('dialog', {name: 'Choose another mower?'});
    await expect(sheet).toContainText('Everything checked in the setup so far is taken back.');
    await expect(sheet).toContainText('MowBite OS starts again as YardForce NX60i.');
    await sheet.getByRole('button', {name: 'Cancel'}).click();
    await expect(sheet).toHaveCount(0);
    await expect(step(page).locator('[data-platform="airseekers_tron"]')).toContainText('This mower now');

    await choose.click();
    await sheet.getByRole('button', {name: 'Choose this mower'}).click();
    await expect(step(page).getByText('MowBite OS is starting again')).toBeVisible();
    await expect(step(page).locator('[data-platform="yardforce_nx60i"]')).toContainText('This mower now');
  });

  test('none other where the installation set the mower', async ({page}) => {
    await demoFlag(page, 'mowbiteDemoSetupPlatform', 'fixed');
    await page.goto('/setup?step=platform');
    await expect(step(page).getByText('The installation sets which mower this is.')).toBeVisible();
    await expect(step(page).getByRole('radio', {name: /YardForce NX60i/})).toBeDisabled();
    await expect(step(page).getByRole('button', {name: 'Choose this mower'})).toHaveCount(0);
  });
});
