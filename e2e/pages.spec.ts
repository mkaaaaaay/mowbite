import {expect, tab, test} from './app';

// every tab from the tab bar, each with its title and nothing broken on the way
test('the tabs open their pages', async ({page}) => {
  await page.goto('/');
  // the overview: the mower's state and the buttons to steer it
  await expect(page.getByRole('button', {name: /home|pause|start|continue/i}).first()).toBeVisible();
  for (const [href, title] of [
    ['/map', 'Map'],
    ['/sensors', 'Sensors'],
    ['/schedule', 'Schedule'],
    ['/activity', 'Activity'],
    ['/settings', 'Settings'],
  ]) {
    await tab(page, href).click();
    await expect(page).toHaveURL(new RegExp(`${href}/?$`));
    await expect(page.getByRole('heading', {level: 1, name: title})).toBeVisible();
  }
  await tab(page, '/').click();
  await expect(page).toHaveURL(/\/$/);
});

test('a page loaded on its own works too', async ({page}) => {
  await page.goto('/schedule/');
  await expect(page.getByRole('heading', {level: 1, name: 'Schedule'})).toBeVisible();
  await page.goto('/map/');
  await expect(page.locator('polygon[data-area]:visible').first()).toBeVisible();
});
