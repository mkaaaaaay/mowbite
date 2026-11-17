import type {Page} from '@playwright/test';
import {demoWith, expect, SIM, test} from './app';

// the demo's emergency stop, as a press of a button on the mower
const press = (page: Page, reason: string) => page.evaluate((r) => (window as unknown as {mowbiteDemo: {emergency: (r: string[]) => void}}).mowbiteDemo.emergency([r]), reason);
const step = (page: Page, id: string) => page.locator(`[data-step="${id}"]`);

// MowBite OS's setup program: only on a mower that lists it, its steps as the OS gives them
test.describe('setup', () => {
  test.skip(SIM, 'the demo mower only');

  test('not offered on a mower without it', async ({page}) => {
    await page.goto('/setup/');
    await expect(page.getByText('This mower has no setup program.')).toBeVisible();
    await page.goto('/');
    await expect(page.locator('[data-card="setup"]')).toHaveCount(0);
  });

  test('from the dashboard through a measured step, an input with its emergency, a choice and a skip', async ({page}) => {
    await demoWith(page, 'Setup', 'Geometry');
    await page.goto('/');
    const card = page.locator('[data-card="setup"]');
    await expect(card).toContainText('1 of 8 steps done');
    await card.getByRole('link', {name: 'Go on with the setup'}).click();
    await expect(page).toHaveURL(/\/setup\/?\?step=board/);

    await step(page, 'board').getByRole('button', {name: 'Start'}).click();
    await expect(step(page, 'board')).toHaveAttribute('data-state', 'ok');
    await expect(step(page, 'board')).toContainText('87 %');

    // the points first, the start only once every one is ticked
    await page.goto('/setup/?step=outdoors');
    await step(page, 'outdoors').getByRole('button', {name: 'Start'}).click();
    const sheet = page.getByRole('dialog');
    await expect(sheet.getByRole('button', {name: 'Start'})).toBeDisabled();
    for (const box of await sheet.getByRole('checkbox').all()) await box.check();
    await sheet.getByRole('button', {name: 'Start'}).click();
    await expect(step(page, 'outdoors')).toHaveAttribute('data-state', 'ok');

    // two presses, the emergency of the first released in between from the step itself
    await page.goto('/setup/?step=stop');
    await expect(step(page, 'stop').getByRole('button', {name: 'Skip'})).toHaveCount(0);
    await step(page, 'stop').getByRole('button', {name: 'Start'}).click();
    await expect(step(page, 'stop').locator('li[data-state="waiting"]')).toContainText('STOP button on top');
    await press(page, 'STOP');
    await expect(step(page, 'stop').locator('li[data-state="ok"]')).toContainText('STOP button on top');
    await expect(step(page, 'stop').getByRole('alert')).toContainText('The emergency stop is still on.');
    await step(page, 'stop').getByRole('button', {name: 'Reset emergency'}).click();
    await expect(step(page, 'stop').getByRole('alert')).toHaveCount(0);
    await press(page, 'STOP');
    await expect(step(page, 'stop')).toHaveAttribute('data-state', 'ok');

    // locked until its choice is made
    await page.goto('/setup/?step=fix');
    await expect(step(page, 'fix')).toContainText('First: Source of corrections');
    await page.goto('/setup/?step=correction');
    await step(page, 'correction').getByLabel('Correction service over the network (NTRIP)').check();
    await step(page, 'correction').getByRole('button', {name: 'Save'}).click();
    await expect(step(page, 'correction')).toHaveAttribute('data-state', 'ok');

    // skipped with a reason of the user's own, and the way to the screen it asks for
    await page.goto('/setup/?step=ntrip');
    await expect(step(page, 'ntrip').getByRole('link', {name: 'Enter the correction service'})).toHaveAttribute('href', /\/settings\/?#ntrip/);
    await step(page, 'ntrip').getByRole('button', {name: 'Skip'}).click();
    await page.getByRole('dialog').getByLabel('Other reason').check();
    await expect(page.getByRole('dialog').getByRole('button', {name: 'Skip'})).toBeDisabled();
    await page.getByRole('dialog').getByLabel('Why').fill('radio at the receiver');
    await page.getByRole('dialog').getByRole('button', {name: 'Skip'}).click();
    await expect(step(page, 'ntrip')).toContainText('Skipped: Other reason (radio at the receiver)');
  });

  test('the image of a step from the mower, as a mask', async ({page}) => {
    await demoWith(page, 'Setup');
    await page.goto('/setup/?step=stop');
    const layers = step(page, 'stop').locator('[style*="mask-image"]');
    await expect(layers).toHaveCount(2);
    await expect(layers.first()).toHaveAttribute('style', /data:image\/svg\+xml;base64,/);
    await expect(step(page, 'stop').locator('svg')).toHaveCount(0);
  });

  test('the sizes confirmed as they are, for the step of the dimensions', async ({page}) => {
    await demoWith(page, 'Geometry');
    await page.goto('/settings/');
    await page.locator('#mower summary').click();
    const open = page.locator('[data-unconfirmed]');
    await expect(open).toContainText('Not confirmed yet: Width 47 cm');
    await expect(open).toContainText('Track of the drive wheels 39,5 cm'.replace(',', '.'));
    await open.getByRole('button', {name: 'These sizes are right'}).click();
    await expect(open).toHaveCount(0);
  });
});
