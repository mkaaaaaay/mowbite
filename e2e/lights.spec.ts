import {expect, SIM, test} from './app';

// the lights by state on a mower with MowBite OS: the demo is an OpenMower and has none until a test switches them on
test.describe('lights', () => {
  test.skip(SIM, 'the demo mower only');

  test('not on a mower without them', async ({page}) => {
    await page.goto('/settings/');
    await expect(page.locator('#notify')).toBeVisible();
    await expect(page.locator('#lights')).toHaveCount(0);
  });

  test('an effect by state, tried on the mower, saved and back to the defaults', async ({page}) => {
    await page.addInitScript(() => ((window as {mowbiteDemoLights?: boolean}).mowbiteDemoLights = true));
    await page.goto('/settings/');
    const group = page.locator('#lights');
    await group.locator('summary').click();
    await expect(group.locator('[data-light]')).toHaveCount(9);
    await expect(group).toContainText('55 LEDs on the mower');
    await expect(group).toContainText('The same on every mower');

    const mowing = group.locator('[data-light="MOWING"]');
    await mowing.locator('select').selectOption('blink');
    await expect(mowing.getByText('A second colour shows instead of dark.')).toBeVisible();
    await mowing.getByRole('button', {name: '+ colour'}).click();
    await expect(mowing.locator('input[type=color]')).toHaveCount(2);
    await mowing.getByRole('button', {name: 'Show on the mower'}).click();
    await expect(mowing).toContainText('Shows on the mower for 5 s.');

    await group.getByRole('button', {name: 'Save'}).click();
    await expect(group).toContainText('Saved on the mower.');
    await expect(group.getByRole('button', {name: 'Save'})).toBeDisabled();

    const reset = group.getByRole('button', {name: 'Back to the defaults'});
    await reset.click();
    await page.waitForTimeout(700);
    await group.getByRole('button', {name: 'Really back to the defaults?'}).click();
    await expect(group).toContainText('Back to the defaults.');
    await expect(mowing.locator('select')).toHaveValue('solid');
  });
});
