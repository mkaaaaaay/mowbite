import {demoAction, demoDocked, demoEmergency, demoHas, expect, test} from './app';
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

// recording mode left on without its page (another phone, the back button): the overview leads back to it, and out of
// it while nothing would be lost
test('the overview in recording mode leads back to recording and out of it', async ({page}) => {
  await page.goto('/');
  await demoDocked(page);
  await demoAction(page, 'mower_logic:idle/start_area_recording');
  const back = page.getByRole('link', {name: 'Back to recording'});
  const end = page.getByRole('button', {name: 'Leave recording mode'});
  await expect(back).toBeVisible();
  await end.click();
  await expect.poll(() => state(page)).not.toBe('AREA_RECORDING');
  await expect(back).toBeHidden();
  await demoAction(page, 'mower_logic:idle/start_area_recording');
  // an outline being recorded: ending would lose it, only the way back is offered
  await demoAction(page, 'mower_logic:area_recording/start_recording');
  await expect(back).toBeVisible();
  await expect(end).toBeHidden();
  await back.click();
  await expect(page).toHaveURL(/\/record\/?$/);
  await expect(page.locator('button:visible', {hasText: 'Discard area'}).first()).toBeVisible();
});

// with the blade turning a reload asks first: what the page sends while it unloads doesn't get out
test('a reload while the blade turns in recording mode asks first', async ({page}) => {
  await page.goto('/record/');
  await demoDocked(page);
  await page.getByRole('button', {name: 'Start recording mode'}).click();
  await page.locator('button:visible', {hasText: 'Blade on'}).click();
  await expect(page.getByText('The blade is turning, also while the mower stands still.').first()).toBeVisible();
  const asked = new Promise<string>((done) =>
    page.once('dialog', (d) => {
      done(d.type());
      void d.dismiss();
    }),
  );
  void page.reload().catch(() => {});
  expect(await asked).toBe('beforeunload');
  await expect(page.getByText('The blade is turning, also while the mower stands still.').first()).toBeVisible();
});

// paused OpenMower takes a skip and does it once it goes on: the countdown runs and it goes out
test('skip area while paused goes out and is done on continue', async ({page}) => {
  await page.goto('/');
  await expect.poll(() => state(page)).toBe('MOWING');
  const area = async () => (await demoHas<{current_area: number}>(page, 'robot_state/json')).current_area;
  await expect.poll(area).toBeGreaterThanOrEqual(0);
  const before = await area();
  await page.getByRole('button', {name: 'Pause', exact: true}).click();
  await expect.poll(() => state(page)).toBe('PAUSED');
  await page.getByRole('button', {name: 'Skip area'}).click();
  const undo = page.getByRole('button', {name: /^Undo \(\d s\)$/});
  await expect(undo).toBeVisible();
  await expect(undo).toBeHidden({timeout: 8000});
  await page.getByRole('button', {name: 'Continue', exact: true}).click();
  await expect.poll(area).not.toBe(before);
});
