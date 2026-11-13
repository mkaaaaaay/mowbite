import {demoCall, demoWith, expect, test} from './app';

// the antenna typed under the mower sizes: the app can't set it, it hands over the lines for mower_params.yaml
test('the antenna typed in gives the lines for mower_params.yaml', async ({page}) => {
  await page.goto('/settings/');
  // folded away under the mower's sizes
  await page.locator('#mower > summary').click();
  const ahead = page.getByLabel('Antenna ahead of the rear axle (cm)');
  await ahead.scrollIntoViewIfNeeded();
  await expect(ahead).toHaveValue('-10');
  await expect(page.getByText('antenna_offset_x:')).toHaveCount(0);
  await ahead.fill('-12');
  await page.getByLabel('Antenna to the left of the middle (cm)').fill('-3');
  await expect(page.locator('code', {hasText: 'antenna_offset_x: -0.12'})).toContainText('antenna_offset_y: -0.03');
  await page.screenshot({path: test.info().outputPath('antenna.png'), fullPage: true});
});

// MowBite OS keeps the sizes and the antenna itself (robot.geometry): saved there, with its words when it refuses
test('on MowBite OS the sizes and the antenna go to robot.geometry', async ({page}) => {
  await demoWith(page, 'Geometry');
  await page.goto('/settings/');
  await page.locator('#mower > summary').click();
  const front = page.getByLabel('Rear axle to the front (cm)');
  await front.scrollIntoViewIfNeeded();
  await expect(front).toHaveValue('60');
  await front.fill('62');
  await page.getByLabel('Antenna ahead of the rear axle (cm)').fill('5');
  await expect(page.getByText('antenna_offset_x:')).toHaveCount(0);
  await page.getByRole('button', {name: 'Save', exact: true}).click();
  await expect(page.getByText('Saved. It counts from the next plan')).toBeVisible();
  await expect(page.getByLabel('Antenna ahead of the rear axle (cm)')).toHaveValue('5');
  // another phone changed them meanwhile: shown anew, saved again with the new version
  await demoCall(page, 'robot.geometry.set', {version: 2, settings: {blade_ahead: 0.25}});
  await front.fill('63');
  await page.getByRole('button', {name: 'Save', exact: true}).click();
  await expect(page.getByText('The sizes were changed elsewhere in the meantime')).toBeVisible();
  await expect(page.getByLabel('Blade ahead of the rear axle (cm)')).toHaveValue('25');
  await expect(front).toHaveValue('63');
  await page.screenshot({path: test.info().outputPath('geometry.png'), fullPage: true});
  await page.getByRole('button', {name: 'Save', exact: true}).click();
  await expect(page.getByText('Saved. It counts from the next plan')).toBeVisible();
});
