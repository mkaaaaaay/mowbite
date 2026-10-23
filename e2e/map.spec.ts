import {expect, handles, lawnPoint, openMap, pickedOutline, tab, test, touchDrag, visibleAreas} from './app';

test('an area picked stays picked while another page is open', async ({page}) => {
  await openMap(page);
  const at = await lawnPoint(page);
  await page.mouse.click(at.x, at.y);
  const name = page.getByRole('textbox').first();
  await expect(name).not.toHaveValue('');
  const picked = await name.inputValue();
  expect((await handles(page)).length).toBeGreaterThan(2);

  await tab(page, '/sensors').click();
  await expect(page.getByRole('heading', {level: 1, name: 'Sensors'})).toBeVisible();
  await expect(visibleAreas(page)).toHaveCount(0);
  await tab(page, '/map').click();
  await expect(page.getByRole('textbox').first()).toHaveValue(picked);
});

test('a point dragged moves the area, undo takes it back', async ({page, isMobile}) => {
  await openMap(page);
  const at = await lawnPoint(page);
  await page.mouse.click(at.x, at.y);
  await expect.poll(async () => (await handles(page)).length).toBeGreaterThan(2);
  const before = await pickedOutline(page);
  // the point nearest the middle of the map a finger can reach, dragged a little
  const [p] = await handles(page);
  const to = {x: p.x + 25, y: p.y + 20};
  if (isMobile) {
    let loupe = false;
    await touchDrag(page, p, to, {during: async () => void (loupe = await page.locator('[class*="loupe"]').isVisible())});
    expect(loupe, 'the loupe while the finger drags').toBe(true);
  } else {
    await page.mouse.move(p.x, p.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, {steps: 8});
    await page.mouse.up();
  }
  await expect.poll(() => pickedOutline(page)).not.toBe(before);
  await page.getByRole('button', {name: 'Undo'}).first().click();
  await expect.poll(() => pickedOutline(page)).toBe(before);
});

test('decorating from the map settings: a picture set, moved and taken back', async ({page, isMobile}) => {
  await openMap(page);
  await page.getByRole('button', {name: 'map settings'}).click();
  const garden = page.getByRole('button', {name: 'Garden', exact: true});
  await garden.click();
  await page.getByRole('button', {name: 'Decorate'}).click();
  // the row of pictures under the map, the first one picked
  const tile = page.locator('[class*="decorTiles"] [role="radio"]').first();
  await expect(tile).toBeVisible();
  await tile.click();
  const before = await visibleAreas(page).count();
  const at = await lawnPoint(page);
  if (isMobile) await page.touchscreen.tap(at.x, at.y);
  else await page.mouse.click(at.x, at.y);
  // set and picked: its handles to turn and size it
  await expect(page.locator('[class*="thingHandles"]').first()).toBeVisible();
  const set = await page.evaluate(() => document.querySelectorAll('polygon[data-area]').length);
  expect(set).toBeGreaterThanOrEqual(before);
  if (isMobile) await touchDrag(page, at, {x: at.x + 30, y: at.y + 10});
  // with a picture set it asks once more
  await page.getByRole('button', {name: 'Cancel'}).click();
  await page.getByRole('button', {name: 'Discard changes?'}).click();
  await expect(page.locator('[class*="decorTiles"]')).toHaveCount(0);
  await expect(tab(page, '/map')).not.toContainText('Unsaved changes');
});
