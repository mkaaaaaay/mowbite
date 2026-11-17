import {demoWith, expect, SIM, test} from './app';

// the guide to the setup program: reached from the setup group in the settings, ends at the setup
test.describe('setup guide', () => {
  test.skip(SIM, 'the demo mower only');

  test('not listed on a mower without the setup program', async ({page}) => {
    await page.goto('/settings/#guides');
    await expect(page.locator('a[href="/guide/lights"], a[href="/guide/lights/"]')).toHaveCount(0);
    await expect(page.locator('a[href^="/guide/setup"]')).toHaveCount(0);
  });

  test('goes through its steps to the setup', async ({page}) => {
    await demoWith(page, 'Setup');
    await page.goto('/settings/#setup');
    await page.locator('#setup').getByRole('link', {name: 'Guide'}).click();
    await expect(page.getByRole('heading', {level: 1})).toHaveText('The setup');
    for (const title of ['A step', 'Sensors on their lines', 'Before it moves', 'Skipping and the safety measurement']) {
      await page.getByRole('button', {name: 'Next'}).last().click();
      await expect(page.getByRole('heading', {level: 1})).toHaveText(title);
    }
    await page.getByRole('button', {name: 'To the setup'}).click();
    await expect(page).toHaveURL(/\/setup\/?$/);
  });
});
