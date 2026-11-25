import {demoFlag, demoWith, expect, lawnPoint, openMap, SIM, test} from './app';

// MowBite OS on a platform that sets the cutting height (system.info blade_height): an area can have its own
test.describe('a cutting height for one area', () => {
  test.skip(SIM, 'the demo mower only');

  test('within what the platform sets, empty is the one for all areas', async ({page}) => {
    await demoWith(page, 'Os');
    await demoFlag(page, 'mowbiteDemoBladeHeight', true);
    await openMap(page);
    const at = await lawnPoint(page);
    await page.mouse.click(at.x, at.y);
    const height = page.getByRole('textbox', {name: /Own cutting height/});
    const all = page.getByRole('button', {name: 'As all areas 50 mm'});
    await expect(height).toHaveAttribute('placeholder', '50');
    await expect(all).toHaveAttribute('aria-pressed', 'true');

    await height.fill('120');
    await height.press('Enter');
    await expect(height).toHaveValue('90');
    await expect(all).toHaveAttribute('aria-pressed', 'false');
    await expect(page.getByText('30 to 90 mm', {exact: true})).toBeVisible();

    await height.fill('');
    await height.press('Enter');
    await expect(height).toHaveValue('');
    await expect(all).toHaveAttribute('aria-pressed', 'true');

    await height.fill('70');
    await height.press('Enter');
    await all.click();
    await expect(height).toHaveValue('');
  });

  test('not offered where the platform sets no height', async ({page}) => {
    await demoWith(page, 'Os');
    await openMap(page);
    const at = await lawnPoint(page);
    await page.mouse.click(at.x, at.y);
    await expect(page.getByRole('textbox').first()).not.toHaveValue('');
    await expect(page.getByRole('textbox', {name: /Own cutting height/})).toHaveCount(0);
  });
});
