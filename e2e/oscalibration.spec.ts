import type {Page} from '@playwright/test';
import type {DemoPart} from '@/lib/demo/flags';
import {demoAction, demoAhead, demoCall, demoDocked, demoEmergency, demoFlag, demoHas, demoWith, expect, tab, test} from './app';

// the demo as a mower with MowBite OS and its calibration drive, idle on the lawn off its station
async function onLawn(page: Page, path = '/calibration/', ...more: DemoPart[]) {
  await demoWith(page, 'Os', 'Calibration', 'Geometry', 'DockTest', ...more);
  await page.goto(path);
  await page.waitForFunction(() => 'mowbiteDemo' in window);
  await demoAction(page, 'mower_logic:mowing/abort_mowing');
  await demoAction(page, 'mower_logic:docking/abort_docking');
  await expect.poll(() => subState(page)).toBe('IDLE:');
}
const subState = async (page: Page) => {
  const s = await demoHas<{current_state: string; current_sub_state: string}>(page, 'robot_state/json');
  return `${s.current_state}:${s.current_sub_state}`;
};
const startButton = (page: Page) => page.getByRole('button', {name: 'Start the calibration drive'});
const stop = (page: Page) => page.getByRole('button', {name: 'Stop the mower'});
// the OS's setup step of the calibration drive, from the overview
const stage = (page: Page) => page.locator('button[aria-expanded]', {hasText: 'Calibration drive'});
async function toStep(page: Page) {
  if ((await stage(page).getAttribute('aria-expanded')) === 'false') await stage(page).click();
  await page.locator('button:not([aria-expanded])', {hasText: /^Calibration drive/}).click();
  await page.getByRole('link', {name: 'To the calibration drive'}).click();
}
// a value of the result by its name
const card = (page: Page, name: string) => page.locator('section', {hasText: name}).first();
// to the guide and back within the app: the page reads the result and the sizes anew (a new load starts the demo over)
async function again(page: Page) {
  await page.getByRole('link', {name: 'How the calibration drive works'}).click();
  await page.getByRole('link', {name: '← Calibration'}).click();
  await expect(page.getByRole('heading', {name: 'Last calibration drive'})).toBeVisible();
}
// both points ticked, then the start that names what moves
async function start(page: Page) {
  await startButton(page).click();
  const sheet = page.getByRole('dialog', {name: 'The mower moves in a moment'});
  const go = sheet.getByRole('button', {name: 'Let the mower drive'});
  await expect(go).toBeDisabled();
  await sheet.getByRole('checkbox', {name: /The strip is clear/}).check();
  await expect(go).toBeDisabled();
  await sheet.getByRole('checkbox', {name: /You stay with it/}).check();
  await go.click();
  await expect.poll(() => subState(page)).toBe('IDLE:CALIBRATING');
}

test('the calibration drive starts after its checks and both ticks, and stops from its page and the dashboard', async ({page}) => {
  await onLawn(page);
  await expect(page.getByText('Nothing stands in the way of a calibration drive here.')).toBeVisible();
  await expect(page.getByText('Needs a free strip of 4.9 × 1.9 m, the lane is 3.0 m long.')).toBeVisible();
  await startButton(page).click();
  const sheet = page.getByRole('dialog', {name: 'The mower moves in a moment'});
  await expect(sheet.getByText('The blade stays off')).toBeVisible();
  await expect(sheet.getByText('Closing the app or losing the connection does not stop the mower.')).toBeVisible();
  await page.screenshot({path: test.info().outputPath('oscalib-confirm.png')});
  await sheet.getByRole('button', {name: 'Cancel'}).click();
  expect(await subState(page)).toBe('IDLE:');

  await start(page);
  await expect(page.getByRole('heading', {name: 'Calibration drive running'})).toBeVisible();
  await expect(stop(page)).toBeVisible();
  await demoAhead(page, 4);
  await expect(page.getByText('Calibration: driving straight · Round 1')).toBeVisible();
  await page.screenshot({path: test.info().outputPath('oscalib-running.png')});
  // the dashboard says it and has the stop too
  await tab(page, '/').click();
  await expect(page.getByRole('heading', {name: 'Calibration drive running'})).toBeVisible();
  await expect(page.getByRole('button', {name: 'Start', exact: true})).toHaveCount(0);
  await page.screenshot({path: test.info().outputPath('oscalib-dashboard.png')});
  await page.getByRole('link', {name: 'To the calibration'}).click();
  // back on its page the drive is still shown, by the mower's state
  await expect(page.getByRole('heading', {name: 'Calibration drive running'})).toBeVisible();
  await stop(page).click();
  await expect.poll(() => subState(page)).toBe('IDLE:');
  await expect(page.getByText('Calibration stopped', {exact: true}).first()).toBeVisible();
  await expect(stop(page)).toHaveCount(0);
  await expect(startButton(page)).toBeEnabled();

  await start(page);
  await tab(page, '/').click();
  await stop(page).click();
  await expect.poll(() => subState(page)).toBe('IDLE:');
  await expect(page.getByRole('heading', {name: 'Waiting on the lawn'})).toBeVisible();
});

test('what stands in the way of a calibration drive keeps it from starting, in the words of its reason', async ({page}) => {
  await demoFlag(page, 'mowbiteDemoCalibProblems', [
    {reason: 'NO_ROOM', message: 'No room for a calibration drive here: 1.2 m free, 2.0 m needed', free_length: 1.2, length: 2},
    {reason: 'MOON_PHASE', message: 'The moon is full'},
  ]);
  await onLawn(page);
  await expect(page.getByText('Not enough room here, the drive needs 2.0 m and has 1.2 m.')).toBeVisible();
  await expect(page.getByText('The moon is full.')).toBeVisible();
  await expect(startButton(page)).toBeDisabled();
  await page.screenshot({path: test.info().outputPath('oscalib-problems.png')});
  // with the emergency stop
  await demoEmergency(page, ['STOP']);
  await expect(page.getByText('Emergency stop, reset it first.')).toBeVisible();
  await expect(startButton(page)).toBeDisabled();
});

test('a mower on its station says so instead of starting a calibration drive', async ({page}) => {
  await demoWith(page, 'Os', 'Calibration', 'Geometry');
  await page.goto('/calibration/');
  await demoDocked(page);
  await expect(page.getByText('On the docking station, drive it off by remote control first.')).toBeVisible();
  await expect(startButton(page)).toBeDisabled();
});

test('a stop the mower does not follow is said, with the way to stop it at the mower', async ({page}) => {
  await demoFlag(page, 'mowbiteDemoCalibAbortLost', true);
  await onLawn(page);
  await start(page);
  await stop(page).click();
  await expect(page.getByText('The stop is not confirmed. Press STOP at the mower.')).toBeVisible();
  expect(await subState(page)).toBe('IDLE:CALIBRATING');
  await expect(stop(page)).toBeEnabled();
});

test('the result of a calibration drive: only what can be taken is ticked, applied into the sizes and set back', async ({page}) => {
  await onLawn(page);
  await expect(page.getByText('Not driven yet')).toBeVisible();
  await start(page);
  await demoAhead(page, 60);
  await expect.poll(() => subState(page)).toBe('IDLE:');
  await expect(page.getByText('Calibration done', {exact: true})).toBeVisible();
  // trusted and changed: ticked. a big change and one within the accuracy: for the user to tick. not trusted: not offered
  await expect(card(page, 'Distance per wheel turn').getByRole('checkbox')).toBeChecked();
  await expect(card(page, 'IMU tilted to the side').getByRole('checkbox')).toBeChecked();
  await expect(card(page, 'Antenna ahead of the axle').getByRole('checkbox')).not.toBeChecked();
  await expect(card(page, 'Antenna ahead of the axle')).toContainText('big change');
  await expect(card(page, 'Antenna left of the middle').getByRole('checkbox')).not.toBeChecked();
  await expect(card(page, 'Wheel distance').getByRole('checkbox')).toHaveCount(0);
  await expect(card(page, 'Wheel distance')).toContainText("Can't be applied.");
  await page.screenshot({path: test.info().outputPath('oscalib-result.png'), fullPage: true});
  await expect(page.getByRole('button', {name: 'Keep the sizes'})).toBeVisible();
  await card(page, 'Antenna ahead of the axle').getByRole('checkbox').check();
  await page.getByRole('button', {name: 'Apply 4 values'}).click();
  const ask = page.getByRole('group', {name: 'Apply these values?'});
  await expect(ask).toContainText('The values before stay in this result to set back');
  await ask.getByRole('button', {name: 'Apply 4 values'}).click();
  await expect(card(page, 'Distance per wheel turn')).toContainText('Applied');
  await expect(card(page, 'Antenna ahead of the axle')).toContainText('Applied');
  await expect(card(page, 'Antenna left of the middle').getByRole('checkbox')).not.toBeChecked();
  await expect(page.getByRole('button', {name: 'Keep the sizes'})).toHaveCount(0);
  // the antenna moved: the station again
  await expect(page.getByText('Record the docking station again')).toBeVisible();
  await page.screenshot({path: test.info().outputPath('oscalib-applied.png'), fullPage: true});
  // on the mower, not only on this page
  await again(page);
  await expect(card(page, 'Distance per wheel turn')).toContainText('Applied');
  await page.getByRole('button', {name: 'Set back'}).click();
  await page.getByRole('group', {name: 'Set back to the values before this drive?'}).getByRole('button', {name: 'Yes, set back'}).click();
  // the sizes changed since its apply: the OS takes nothing more from this drive
  await expect(page.getByText('The sizes were changed after this drive. Its values no longer fit: drive again.')).toBeVisible();
  await expect(page.getByRole('checkbox')).toHaveCount(0);
  await expect(page.getByText('Record the docking station again')).toHaveCount(0);
});

test('a result is not offered once the sizes changed after its drive, nor one that was not evaluated or lies outside the range', async ({page}) => {
  await demoFlag(page, 'mowbiteDemoCalibResult', 'out_of_range');
  await onLawn(page);
  await start(page);
  await demoAhead(page, 60);
  await expect(page.getByText('Calibration done', {exact: true})).toBeVisible();
  const ticks = card(page, 'Distance per wheel turn');
  await expect(ticks).toContainText(/Can't be applied: outside what the mower accepts \(100 to 10.?000\)\./);
  await expect(ticks.getByRole('checkbox')).toHaveCount(0);
  await expect(page.getByRole('button', {name: 'Apply 2 values'})).toBeVisible();
  // the sizes changed on another phone
  await demoCall(page, 'robot.geometry.set', {version: 1, settings: {antenna_y: 0.02}});
  await again(page);
  await expect(page.getByText('The sizes were changed after this drive. Its values no longer fit: drive again.')).toBeVisible();
  await expect(page.getByRole('checkbox')).toHaveCount(0);
  await expect(page.getByRole('button', {name: /^Apply/})).toHaveCount(0);
});

test('a drive that was not evaluated has nothing to apply', async ({page}) => {
  await demoFlag(page, 'mowbiteDemoCalibResult', 'not_evaluated');
  await onLawn(page);
  await start(page);
  await demoAhead(page, 60);
  await expect(page.getByText('Calibration drive done, not evaluated')).toBeVisible();
  await expect(page.getByText('Driven, but not evaluated: the planner on the mower is missing or did not answer. Drive again.')).toBeVisible();
  await expect(page.getByRole('checkbox')).toHaveCount(0);
});

test('the setup step, the settings and its guide lead to the calibration drive', async ({page}) => {
  await demoWith(page, 'Os', 'Calibration', 'Geometry', 'Setup');
  await page.goto('/setup/');
  // the OS's step in its own stage, no line of the app's own
  await expect(stage(page)).toBeVisible();
  await expect(page.locator('a[data-own="calibration"]')).toHaveCount(0);
  await page.screenshot({path: test.info().outputPath('oscalib-setup.png')});
  await toStep(page);
  await expect(startButton(page)).toBeVisible();
  await page.getByRole('link', {name: 'How the calibration drive works'}).click();
  await expect(page.getByRole('heading', {name: 'You stay with it'})).toBeVisible();
  await expect(page.getByText("closing the app doesn't stop the mower")).toBeVisible();
  await page.screenshot({path: test.info().outputPath('oscalib-guide.png'), fullPage: true});
  await tab(page, '/settings').click();
  await page.getByText('Sizes and calibration').click();
  await page.getByRole('link', {name: 'To the calibration'}).click();
  await expect(startButton(page)).toBeVisible();
});

test('taking none of the values on purpose ticks the setup step, a new drive opens it again', async ({page}) => {
  await onLawn(page, '/setup/', 'Setup');
  await expect(stage(page)).toContainText('1 step');
  await toStep(page);
  await start(page);
  await demoAhead(page, 60);
  await expect(page.getByText('Calibration done', {exact: true})).toBeVisible();
  await page.getByRole('button', {name: 'Keep the sizes'}).click();
  await expect(page.getByText(/^Kept the sizes as they were/)).toBeVisible();
  await expect(page.getByRole('button', {name: 'Keep the sizes'})).toHaveCount(0);
  await page.goBack();
  await expect(stage(page)).toContainText('Passed');
  await page.goForward();
  await start(page);
  await page.goBack();
  await expect(stage(page)).toContainText('1 step');
});

test('without the calibration drive on the mower nothing of the setup leads to it', async ({page}) => {
  await demoWith(page, 'Os', 'Geometry', 'Setup');
  await page.goto('/setup/');
  await expect(page.getByText('Safety measurement missing')).toBeVisible();
  await expect(page.locator('a[data-own="calibration"]')).toHaveCount(0);
});
