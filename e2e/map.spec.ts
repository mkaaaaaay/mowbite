import type {MowerMap} from '@/hooks/useMowerMap';
import {demoAction, demoCall, demoDocked, demoHas, expect, handles, lawnPoint, openMap, pickedOutline, tab, test, touchDrag, visibleAreas} from './app';

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

test('the zoom buttons still work after another page was opened while a zoom eased', async ({page}) => {
  await openMap(page);
  const width = async () => (await visibleAreas(page).first().boundingBox())?.width ?? 0;
  const zoomIn = page.getByRole('button', {name: 'Zoom in'}).first();
  await zoomIn.click();
  await tab(page, '/sensors').click();
  await expect(visibleAreas(page)).toHaveCount(0);
  await tab(page, '/map').click();
  await expect(visibleAreas(page).first()).toBeVisible();
  await page.waitForTimeout(500);
  const before = await width();
  await zoomIn.click();
  await expect.poll(width).toBeGreaterThan(before * 1.2);
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
  // in the layers of the map
  await page.getByRole('button', {name: 'Layers'}).first().click();
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

test('saving over a map that was changed on another phone asks first', async ({page}) => {
  await openMap(page);
  // in the dock and without the job it was on: saving while it mows or with that job asks something else first
  await demoDocked(page);
  await demoAction(page, 'mower_logic:idle/reset_job');
  const at = await lawnPoint(page);
  await page.mouse.click(at.x, at.y);
  const name = page.getByRole('textbox').first();
  await expect(name).not.toHaveValue('');
  const picked = await name.inputValue();
  await name.fill('Changed here');
  // meanwhile another phone saves the map with a new name for another area
  const names = async () => (await demoHas<MowerMap>(page, 'map/json')).areas.map((a) => a.properties.name);
  const other = await demoHas<MowerMap>(page, 'map/json');
  other.areas.find((a) => a.properties.type === 'mow' && a.properties.name !== picked)!.properties.name = 'Changed elsewhere';
  await demoCall(page, 'map.replace', other);
  await expect(page.getByText('The map on the mower was changed since you started editing here')).toBeVisible();
  // the first tap only shows that, the second one saves this version
  const save = page.locator('button:visible', {hasText: 'Save anyway'}).first();
  await save.click();
  await expect(page.locator('[class*="warningArmed"]')).toBeVisible();
  await page.waitForTimeout(500);
  expect(await names()).toContain('Changed elsewhere');
  await save.click();
  await expect.poll(names).toContain('Changed here');
  await expect(page.getByText('The map on the mower was changed since you started editing here')).toHaveCount(0);
});

// a job the mower interrupted keeps the lanes of the old map: saving asks first and drops it, without one it doesn't ask
test('saving with an interrupted job asks first and drops the job', async ({page}) => {
  await openMap(page);
  // sent home in the middle of its job
  await demoDocked(page);
  const offered = async () => {
    const actions = await demoHas<{action_id: string; enabled: number}[]>(page, 'actions/json');
    return actions.find((a) => a.action_id === 'mower_logic:idle/reset_job')?.enabled;
  };
  const names = async () => (await demoHas<MowerMap>(page, 'map/json')).areas.map((a) => a.properties.name);
  expect(await offered()).toBe(1);
  const at = await lawnPoint(page);
  await page.mouse.click(at.x, at.y);
  const name = page.getByRole('textbox').first();
  await expect(name).not.toHaveValue('');
  await name.fill('Changed here');
  // (its label also says whether the map has warnings)
  const save = page.locator('[class*="changesBar"] [class*="saveButton"]');
  const ask = page.getByText('The interrupted job was planned on the old map, saving ends it.');
  await save.click();
  await expect(ask).toBeVisible();
  await expect(save).toHaveText('Save anyway');
  await page.waitForTimeout(500);
  expect(await names()).not.toContain('Changed here');
  expect(await offered()).toBe(1);
  await save.click();
  await expect.poll(names).toContain('Changed here');
  await expect.poll(offered).toBe(0);
  await expect(ask).toHaveCount(0);
  // no job left: saved at once
  await name.fill('Changed again');
  await save.click();
  await expect.poll(names).toContain('Changed again');
  await expect(ask).toHaveCount(0);
});

// drawing a new area: the view stays where it is with every point, undo takes back only the last point
test('drawing keeps the view still, undo takes back the last point', async ({page}) => {
  await openMap(page);
  await page.getByRole('button', {name: 'Draw'}).first().click();
  const svg = visibleAreas(page).first().locator('xpath=ancestor::*[local-name()="svg"][last()]');
  // (the svg reaches past the frame it's shown in)
  const box = (await page.locator('[class*="_frame"]:has(svg):visible').first().boundingBox())!;
  const view = () => svg.getAttribute('viewBox');
  const before = await view();
  for (const [dx, dy] of [
    [0.06, 0.45],
    [0.3, 0.3],
    [0.45, 0.55],
  ]) {
    await page.mouse.click(box.x + box.width * dx, box.y + box.height * dy);
    // (not a double click)
    await page.waitForTimeout(400);
  }
  await expect(page.getByText(/\(3 so far\)/)).toBeVisible();
  // the points aren't in the map yet
  await expect(page.getByText('Everything saved')).toBeHidden();
  expect(await view()).toBe(before);
  await page.getByRole('button', {name: 'Undo'}).first().click();
  await expect(page.getByText(/\(2 so far\)/)).toBeVisible();
  await page.getByRole('button', {name: 'Remove last point'}).click();
  await expect(page.getByText(/\(1 so far\)/)).toBeVisible();
});
