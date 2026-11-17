import {demoWith, expect, SIM, test} from './app';

// the guide to the setup program: reached from the setup page and the guides in the settings, ends at the setup
test.describe('setup guide', () => {
  test.skip(SIM, 'the demo mower only');

  test('listed only with the setup program, goes through its steps to the setup', async ({page}) => {
    await page.goto('/settings/#guides');
    await expect(page.locator('a[href^="/guide/setup"]')).toHaveCount(0);
    await demoWith(page, 'Setup');
    await page.reload();
    await expect(page.locator('#guides a[href^="/guide/setup"]')).toBeVisible();
    await page.goto('/setup/');
    await page.getByRole('link', {name: 'How the setup works'}).click();
    await expect(page.getByRole('heading', {level: 1})).toHaveText('The setup');
    for (const title of ['A step', 'Sensors on their lines', 'Before it moves', 'Wheels in the air', 'Driving on the ground', 'The blade', 'Skipping and the safety measurement', 'Releasing the safety']) {
      await page.getByRole('button', {name: 'Next'}).last().click();
      await expect(page.getByRole('heading', {level: 1})).toHaveText(title);
    }
    await page.getByRole('button', {name: 'To the setup'}).click();
    await expect(page).toHaveURL(/\/setup\/?$/);
  });
});
