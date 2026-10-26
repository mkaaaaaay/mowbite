import {demoDocked, demoHas, expect, test} from './app';
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
