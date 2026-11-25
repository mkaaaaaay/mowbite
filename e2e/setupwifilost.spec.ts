import type {Page} from '@playwright/test';
import {expect, test} from '@playwright/test';

// a mower the app can't reach: nothing leaves this machine, the gesture is what the mower said last time
async function unreachable(page: Page, gesture: unknown) {
  await page.route((url) => !['localhost', '127.0.0.1'].includes(url.hostname), (r) => r.abort());
  await page.routeWebSocket(/.*/, (ws) => ws.close());
  await page.addInitScript((g) => {
    if (g) localStorage.setItem('mowbiteSetupWifi', JSON.stringify(g));
  }, gesture);
  await page.goto('/');
  await expect(page.getByText("Can't reach the mower.")).toBeVisible({timeout: 20_000});
}

test.describe('the setup WLAN of a mower not reached', () => {
  test.skip(!!process.env.E2E_URL, 'the built app only');

  test('shows the gesture the mower said it has', async ({page}) => {
    await unreachable(page, {button: 'on_ok', presses: 5, within_s: 5, open_s: 1800});
    await expect(page.locator('[data-setup-wifi-lost]')).toContainText('Press On/OK at the mower 5 times within 5 s while it rests: it opens its setup WLAN for 30 minutes.');
  });

  test('nothing where it never said one', async ({page}) => {
    await unreachable(page, null);
    await expect(page.locator('[data-setup-wifi-lost]')).toHaveCount(0);
  });
});
