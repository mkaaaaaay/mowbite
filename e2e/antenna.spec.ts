import {expect, test} from './app';

// the antenna typed under the mower sizes: the app can't set it, it hands over the lines for mower_params.yaml
test('the antenna typed in gives the lines for mower_params.yaml', async ({page}) => {
  await page.goto('/settings/');
  // folded away under "Your mower"
  await page.locator('summary', {hasText: 'Your mower'}).click();
  const ahead = page.getByLabel('Antenna ahead of the rear axle (cm)');
  await ahead.scrollIntoViewIfNeeded();
  await expect(ahead).toHaveValue('-10');
  await expect(page.getByText('antenna_offset_x:')).toHaveCount(0);
  await ahead.fill('-12');
  await page.getByLabel('Antenna to the left of the middle (cm)').fill('-3');
  await expect(page.locator('code', {hasText: 'antenna_offset_x: -0.12'})).toContainText('antenna_offset_y: -0.03');
  await page.screenshot({path: test.info().outputPath('antenna.png'), fullPage: true});
});
