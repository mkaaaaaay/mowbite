import {expect, test} from './app';

// swiping between the pages (a setting per device): the map comes in as its frame, its editor is there once it's done
test('a swipe from the overview brings the map', async ({page, isMobile}) => {
  test.skip(!isMobile, 'fingers only');
  await page.addInitScript(() => localStorage.setItem('swipePages', '1'));
  await page.goto('/');
  await expect(page.getByRole('heading', {level: 1})).toBeVisible();
  await page.waitForTimeout(1500);
  // on the page's title: nothing there takes a sideways swipe itself
  const title = await page.getByRole('heading', {level: 1}).boundingBox();
  const y = title!.y + title!.height / 2;
  const cdp = await page.context().newCDPSession(page);
  const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', x?: number) =>
    cdp.send('Input.dispatchTouchEvent', {type, touchPoints: x === undefined ? [] : [{x, y, id: 0, radiusX: 4, radiusY: 4, force: 1}]});
  await touch('touchStart', 300);
  for (let x = 290; x >= 160; x -= 10) {
    await touch('touchMove', x);
    await page.waitForTimeout(16);
  }
  // the page beside it: the map's title and frame, not a second map
  const peek = page.locator('body > [aria-hidden="true"][inert]');
  // (hidden from screen readers, so not by its role)
  await expect(peek.locator('h1', {hasText: 'Map'})).toBeAttached();
  await expect(peek.locator('polygon')).toHaveCount(0);
  for (let x = 150; x >= 40; x -= 10) await touch('touchMove', x);
  await touch('touchEnd');
  await expect(page).toHaveURL(/\/map\/?$/);
  await expect(page.locator('polygon[data-area]:visible').first()).toBeVisible();
});
