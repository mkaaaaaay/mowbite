import {expect, SIM, test} from './app';

// the lights by state on a mower with MowBite OS: the demo is an OpenMower and has none until a test switches them on
test.describe('lights', () => {
  test.skip(SIM, 'the demo mower only');

  test('not on a mower without them', async ({page}) => {
    await page.goto('/settings/');
    await expect(page.locator('#notify')).toBeVisible();
    await expect(page.locator('#lights')).toHaveCount(0);
  });

  test('each state folded with its colors, changed, tried on the mower and saved in its own tile', async ({page}) => {
    await page.addInitScript(() => ((window as {mowbiteDemoLights?: boolean}).mowbiteDemoLights = true));
    await page.goto('/settings/');
    const group = page.locator('#lights');
    await group.locator('summary').first().click();
    await expect(group.locator('[data-light]')).toHaveCount(9);
    await expect(group).toContainText('55 LEDs on the mower');
    await expect(group).toContainText('The same on every mower');

    const mowing = group.locator('[data-light="MOWING"]');
    await expect(mowing.locator('summary')).toContainText('Steady');
    await mowing.locator('summary').click();
    await expect(mowing.getByRole('button', {name: 'Save'})).toHaveCount(0);
    await mowing.locator('select').selectOption('blink');
    await expect(mowing.locator('summary')).toContainText('changed');
    await mowing.getByRole('button', {name: '+ color'}).click();
    await expect(mowing.locator('summary [style*="background"]')).toHaveCount(2);
    await mowing.locator('input[type=color]').nth(1).fill('#ff00ff');
    await expect(mowing.locator('label[title="#ff00ff"]')).toHaveCount(1);

    // the period as typed, taken when the field is left
    const period = mowing.getByLabel('One cycle in s');
    await period.fill('3.5');
    await period.blur();
    await expect(period).toHaveValue('3.5');

    await mowing.getByRole('button', {name: 'Show on the mower'}).click();
    await expect(mowing).toContainText('Shows on the mower for 5 s.');
    await mowing.getByRole('button', {name: 'Save'}).click();
    await expect(mowing).toContainText('Saved on the mower.');
    await expect(mowing.getByRole('button', {name: 'Save'})).toHaveCount(0);

    await group.getByRole('button', {name: 'All back to the defaults'}).click();
    await page.waitForTimeout(700);
    await group.getByRole('button', {name: 'Really back to the defaults?'}).click();
    await expect(group).toContainText('Back to the defaults.');
    await expect(mowing.locator('summary')).toContainText('Steady');
  });
});
