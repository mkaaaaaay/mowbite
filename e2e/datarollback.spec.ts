import {demoDocked, demoFlag, demoWith, expect, SIM, test} from './app';

// MowBite OS back on an older backup of its data (system.info data_rollback): the map is confirmed in the app
test.describe('after the way back to an older backup', () => {
  test.skip(SIM, 'the demo mower only');

  test('no start is offered until the map is confirmed on the dashboard', async ({page}) => {
    await demoWith(page, 'Os');
    await demoFlag(page, 'mowbiteDemoDataRollback', true);
    await page.goto('/');
    await demoDocked(page);
    const card = page.locator('[data-card="rollback"]');
    const start = page.getByRole('button', {name: 'Start', exact: true});
    await expect(card).toContainText('MowBite OS took its data back to the backup of');
    await expect(card).toContainText("Until it's confirmed the mower doesn't mow by itself.");
    await expect(card.getByRole('link', {name: 'Open the map'})).toBeVisible();
    await expect(start).toHaveCount(0);

    await card.getByRole('button', {name: 'Confirm the map'}).click();
    await expect(card).toHaveCount(0);
    await expect(start).toBeVisible();
  });

  test('a backup with the same map only says so', async ({page}) => {
    await demoWith(page, 'Os');
    await demoFlag(page, 'mowbiteDemoDataRollback', 'info');
    await page.goto('/');
    await demoDocked(page);
    const card = page.locator('[data-card="rollback"]');
    await expect(card).toContainText('Older backup restored');
    await expect(card).toContainText('the mower mows as usual');
    await expect(page.getByRole('button', {name: 'Start', exact: true})).toBeVisible();

    await card.getByRole('button', {name: 'Got it'}).click();
    await expect(card).toHaveCount(0);
  });

  test('nothing of it on a mower that never went back', async ({page}) => {
    await demoWith(page, 'Os');
    await page.goto('/');
    await demoDocked(page);
    await expect(page.getByRole('button', {name: 'Start', exact: true})).toBeVisible();
    await expect(page.locator('[data-card="rollback"]')).toHaveCount(0);
  });
});
