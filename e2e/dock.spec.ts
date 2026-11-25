import {demoAction, demoAhead, demoEmergency, demoFlagNow, demoState, demoWith, expect, openMap, tab, test} from './app';
import type {Page} from '@playwright/test';

// the demo mower with MowBite OS's docking test, idle off its station: sent home and stopped on the way
async function inFront(page: Page) {
  await demoWith(page, 'DockTest');
  await page.goto('/');
  await page.waitForFunction(() => 'mowbiteDemo' in window);
  await demoAction(page, 'mower_logic:mowing/abort_mowing');
  await page.getByRole('button', {name: 'Stop docking'}).click();
  await expect.poll(() => demoState(page)).toBe('IDLE');
  await expect(page.getByRole('button', {name: 'Test docking by camera'})).toBeVisible();
}

// driven on second by second until the overview says so
const until = (page: Page, text: string) =>
  expect(async () => {
    await demoAhead(page, 1);
    await expect(page.getByText(text, {exact: true})).toBeVisible({timeout: 300});
  }).toPass({timeout: 30_000});

test('a docking test with several dockings in a row says how each run ended', async ({page}) => {
  await inFront(page);
  await page.getByRole('button', {name: 'Test docking by camera'}).click();
  // one docking unless more are picked, the warning is for all of them
  await expect(page.getByText('docks by the dock camera alone, without map or GPS. Stay at the STOP button.')).toBeVisible();
  await page.getByLabel('Dockings in a row').selectOption('3');
  await expect(page.getByText('docks 3 times in a row')).toBeVisible();
  await expect(page.getByText('Stay at the STOP button until the last one is done.')).toBeVisible();
  await page.screenshot({path: test.info().outputPath('dock-test-ask.png')});
  await page.getByRole('button', {name: 'Start the test'}).click();
  await expect.poll(() => demoState(page)).toBe('DOCKING');
  await until(page, 'Run 1 of 3: docked');
  // it goes on by itself
  expect(await demoState(page)).toBe('DOCKING');
  await until(page, 'Run 3 of 3: docked');
  await expect.poll(() => demoState(page)).toBe('IDLE');
  await page.screenshot({path: test.info().outputPath('dock-test-done.png')});
  await tab(page, '/activity').click();
  for (const run of [1, 2, 3]) await expect(page.getByText(`Run ${run} of 3: docked`)).toBeVisible();
  await page.screenshot({path: test.info().outputPath('dock-test-activity.png'), fullPage: true});
});

test('the first docking that fails ends the docking test, with the reason', async ({page}) => {
  await inFront(page);
  await demoFlagNow(page, 'mowbiteDemoDockTestFails', 1);
  await page.getByRole('button', {name: 'Test docking by camera'}).click();
  await page.getByLabel('Dockings in a row').selectOption('4');
  await page.getByRole('button', {name: 'Start the test'}).click();
  await until(page, 'Run 1 of 4: no contact with the charger');
  await expect.poll(() => demoState(page)).toBe('IDLE');
  // in front of the station again: the test is offered once more under what the last one said
  await expect(page.getByRole('button', {name: 'Test docking by camera'})).toBeVisible();
  await tab(page, '/activity').click();
  await page.getByText('Run 1 of 4: no contact with the charger').click();
  await expect(page.getByText('The test ended here, the runs after it were not driven.')).toBeVisible();
});

test('a mower idle off its station is sent home after a question and stopped on the way', async ({page}) => {
  await inFront(page);
  const home = page.getByRole('button', {name: 'Go home'});
  await home.click();
  await expect(page.getByText('The mower drives to the docking station by itself, the blade stays off.')).toBeVisible();
  await page.screenshot({path: test.info().outputPath('home-ask.png')});
  await page.getByRole('button', {name: 'Cancel'}).click();
  expect(await demoState(page)).toBe('IDLE');
  await home.click();
  await page.getByRole('button', {name: 'Drive home'}).click();
  await expect.poll(() => demoState(page)).toBe('DOCKING');
  await expect(home).toHaveCount(0);
  await page.getByRole('button', {name: 'Stop docking'}).click();
  await expect.poll(() => demoState(page)).toBe('IDLE');
  // turned down: why, in the mower's words
  await demoFlagNow(page, 'mowbiteDemoHomeRefuse', 'NO_DOCK');
  await home.click();
  await page.getByRole('button', {name: 'Drive home'}).click();
  await expect(page.getByText('Not heading home: no docking station on the map')).toBeVisible();
  expect(await demoState(page)).toBe('IDLE');
  // home all the way
  await demoFlagNow(page, 'mowbiteDemoHomeRefuse', undefined);
  await home.click();
  await page.getByRole('button', {name: 'Drive home'}).click();
  await expect.poll(() => demoState(page)).toBe('DOCKING');
  await demoAhead(page, 600);
  await expect.poll(() => demoState(page)).toBe('IDLE');
  await expect(home).toHaveCount(0);
});

test('home from idle is not offered with the emergency stop', async ({page}) => {
  await inFront(page);
  const home = page.getByRole('button', {name: 'Go home'});
  await expect(home).toBeVisible();
  await demoEmergency(page, ['STOP']);
  await expect(page.getByRole('button', {name: 'Reset emergency'})).toBeVisible();
  await expect(home).toHaveCount(0);
});

// the station from above (robot.geometry's dock_footprint) under the docking point, only from a mower that gives one
test('the map draws the docking station where MowBite OS knows its footprint', async ({page}) => {
  await openMap(page);
  await expect(page.locator('polygon[data-dock-footprint]')).toHaveCount(0);
  await demoWith(page, 'Geometry');
  await openMap(page);
  const station = page.locator('polygon[data-dock-footprint]:visible').first();
  await expect(station).toBeVisible();
  const box = (await station.boundingBox())!;
  expect(Math.min(box.width, box.height)).toBeGreaterThan(4);
  await page.screenshot({path: test.info().outputPath('dock-footprint.png')});
});
