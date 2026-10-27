import {demoDocked, demoEmergency, demoHas, expect, test} from './app';
import type {Page} from '@playwright/test';

const state = async (page: Page) => (await demoHas<{current_state: string}>(page, 'robot_state/json')).current_state;

// pause turns into continue under the finger: a second tap right after mustn't take the pause back
test('pause and continue, a quick second tap on pause does nothing', async ({page}) => {
  await page.goto('/');
  // the demo mower is out mowing when it opens
  await expect.poll(() => state(page)).toBe('MOWING');
  const pause = page.getByRole('button', {name: 'Pause', exact: true});
  await pause.dblclick();
  const go = page.getByRole('button', {name: 'Continue', exact: true});
  await expect(go).toBeVisible();
  await expect(go).toBeDisabled();
  await expect.poll(() => state(page)).toBe('PAUSED');
  // a moment later it takes taps again
  await expect(go).toBeEnabled();
  expect(await state(page)).toBe('PAUSED');
  await go.click();
  await expect.poll(() => state(page)).toBe('MOWING');
  await expect(pause).toBeVisible();
});

// the blade in recording mode (mowing by hand): off when it's switched off, and when the phone is put away
test('the blade in recording mode goes off with its button and when the phone is put away', async ({page}) => {
  await page.goto('/record/');
  await demoDocked(page);
  await page.getByRole('button', {name: 'Start recording mode'}).click();
  const on = page.locator('button:visible', {hasText: 'Blade on'});
  const off = page.locator('button:visible', {hasText: 'Blade off'});
  const turning = page.getByText('The blade is turning, also while the mower stands still.').first();
  await on.click();
  await expect(turning).toBeVisible();
  await off.click();
  await expect(turning).toBeHidden();
  await on.click();
  await expect(turning).toBeVisible();
  const away = (hidden: boolean) =>
    page.evaluate((hidden) => {
      Object.defineProperty(document, 'hidden', {configurable: true, get: () => hidden});
      document.dispatchEvent(new Event('visibilitychange'));
    }, hidden);
  await away(true);
  await away(false);
  await expect(turning).toBeHidden();
  await expect(on).toBeEnabled();
});

const pose = async (page: Page) => (await demoHas<{pose: {x: number; y: number}}>(page, 'robot_state/json')).pose;
// the stick of the upright layout held forward
async function holdStick(page: Page) {
  const box = (await page.locator('[class*="Joystick-module"][class*="__pad"]').boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + 8, {steps: 4});
}

// a second finger on Sideways while the stick is held: the stick is gone from under the first one, the mower stops anyway
test('the mower stops when the layout changes under a held stick', async ({page, isMobile}) => {
  test.skip(!isMobile, 'Sideways is on phones');
  await page.goto('/record/');
  await demoDocked(page);
  await page.getByRole('button', {name: 'Start recording mode'}).click();
  await holdStick(page);
  const from = await pose(page);
  await expect.poll(async () => Math.hypot((await pose(page)).x - from.x, (await pose(page)).y - from.y)).toBeGreaterThan(0.05);
  await page.getByRole('button', {name: 'Sideways'}).dispatchEvent('click');
  await page.mouse.up();
  await expect(page.getByRole('button', {name: 'Upright'})).toBeVisible();
  // the wheels stop a second after the last command
  await page.waitForTimeout(1500);
  const stopped = await pose(page);
  await page.waitForTimeout(1500);
  const later = await pose(page);
  expect(Math.hypot(later.x - stopped.x, later.y - stopped.y)).toBeLessThan(0.01);
});

// on OpenMower an emergency stop holds recording where it is: reset on the page, what's recorded stays
test('an emergency stop while recording is reset on the record page', async ({page}) => {
  await page.goto('/record/');
  await demoDocked(page);
  await page.getByRole('button', {name: 'Start recording mode'}).click();
  await demoEmergency(page);
  const reset = page.locator('button:visible', {hasText: 'Reset emergency'});
  await expect(page.getByText('Release the mower, then reset the emergency to drive again.')).toBeVisible();
  await reset.click();
  await expect(reset).toBeHidden();
  await expect(page.locator('[class*="Joystick-module"][class*="__pad"]')).toBeVisible();
  expect(await state(page)).toBe('AREA_RECORDING');
});

// a line without its second point drops the whole area on OpenMower: stop right after Record obstacle asks first
test('stop right after record obstacle asks before the area is lost', async ({page}) => {
  await page.goto('/record/');
  await demoDocked(page);
  await page.getByRole('button', {name: 'Start recording mode'}).click();
  const button = (name: string) => page.locator('button:visible', {hasText: name}).first();
  await button('Record outline').click();
  await holdStick(page);
  await page.waitForTimeout(1500);
  await page.mouse.up();
  await button('Stop').click();
  await expect(button('Record obstacle')).toBeVisible();
  await button('Record obstacle').click();
  await button('Stop').click();
  const ask = page.getByRole('alertdialog', {name: 'Stop already?'});
  await expect(ask).toBeVisible();
  await ask.getByRole('button', {name: 'Keep recording'}).click();
  await expect(ask).toBeHidden();
  await expect(button('Stop')).toBeVisible();
  await button('Stop').click();
  await ask.getByRole('button', {name: 'Discard area'}).click();
  await expect(button('Record outline')).toBeVisible();
});
