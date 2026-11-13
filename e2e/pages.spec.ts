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

// the settings in two tabs: a link opens the one its part is in, the one picked stays on this device
test('the settings open the tab a link leads to and keep the one picked', async ({page}) => {
  await page.goto('/settings/');
  const mower = page.getByRole('tab', {name: 'Mower'});
  const app = page.getByRole('tab', {name: 'App'});
  await expect(mower).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#update')).toBeVisible();
  await expect(page.locator('#notify')).toBeHidden();
  await app.click();
  await expect(page.locator('#notify')).toBeVisible();
  await expect(page.locator('#updates')).toBeVisible();
  await expect(page.locator('#update')).toBeHidden();
  await page.reload();
  await expect(app).toHaveAttribute('aria-selected', 'true');

  // a link to a part of the other tab opens that tab and the part
  await page.goto('/settings/#auto');
  await expect(mower).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#auto')).toHaveAttribute('open', '');
  await page.goto('/settings/#mowers');
  await expect(app).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#mowers')).toHaveAttribute('open', '');
  await mower.click();
  await expect(page.locator('#update')).toBeVisible();
  await expect(page.getByRole('link', {name: /Start times and conditions/})).toHaveAttribute('href', /\/schedule\/?$/);
});
