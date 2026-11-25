import type {Page} from '@playwright/test';
import {demoAction, demoDocked, demoEmergency, demoFlag, demoWith, expect, SIM, tab, test} from './app';

// the demo as a mower with MowBite OS and its host, as the platform named, idle on its station
async function mower(page: Page, platform: string) {
  await demoWith(page, 'Os', 'Host');
  await demoFlag(page, 'mowbiteDemoPlatform', platform);
  await page.goto('/settings/#update');
  await demoDocked(page);
}
const entry = (page: Page) => page.getByRole('button', {name: 'Restart into USB mode', exact: true});
const now = (page: Page) => page.getByRole('button', {name: 'Restart into USB mode now'});

test.describe("a Tron's USB mode", () => {
  test.skip(SIM, 'the demo mower only');

  test('only on a Tron with a host', async ({page}) => {
    await mower(page, 'nx60i');
    await expect(page.getByRole('heading', {name: 'On the mower'})).toBeVisible();
    await expect(entry(page)).toHaveCount(0);
  });

  test('restarts into it after what it means and a tick, then says where the mower went', async ({page}) => {
    await mower(page, 'airseekers_tron');
    await entry(page).click();
    const box = page.locator('[data-usb-mode]');
    await expect(box).toContainText('Afterwards the Tron can only be reached over USB from a PC. Without a PC: take the battery off and put it back on.');
    await expect(now(page)).toBeDisabled();
    await page.screenshot({path: test.info().outputPath('usb-mode-ask.png')});
    // with the emergency stop the host turns it down
    await box.getByRole('checkbox').check();
    await demoEmergency(page, ['STOP']);
    await now(page).click();
    await expect(box).toContainText('USB mode not started: emergency stop, reset it first');
    await expect(box).toHaveAttribute('data-usb-mode', 'none');
    await demoAction(page, 'mower_logic/reset_emergency');
    await now(page).click();
    const gone = page.locator('[data-usb-mode="gone"]');
    await expect(gone).toContainText(/The mower restarted into USB mode at \d\d:\d\d\. It can only be reached over USB from a PC now\./);
    await expect(entry(page)).toHaveCount(0);
    await page.screenshot({path: test.info().outputPath('usb-mode-gone.png')});
    // on the dashboard too, until it's closed
    await tab(page, '/').click();
    await expect(page.locator('[data-usb-mode="gone"]')).toContainText('Without a PC: take the battery off and put it back on.');
    await page.locator('[data-usb-mode="gone"]').getByRole('button', {name: 'Close'}).click();
    await expect(page.locator('[data-usb-mode]')).toHaveCount(0);
  });

  test('says when the mower did not restart', async ({page}) => {
    await demoFlag(page, 'mowbiteDemoUsbFails', true);
    await mower(page, 'airseekers_tron');
    await page.clock.install();
    await entry(page).click();
    await page.locator('[data-usb-mode]').getByRole('checkbox').check();
    await now(page).click();
    await expect(page.locator('[data-usb-mode="leaving"]')).toContainText('Restarting into USB mode…');
    await page.clock.fastForward(31_000);
    await expect(page.locator('[data-usb-mode="stayed"]')).toContainText('The mower did not restart into USB mode. Try again.');
    await expect(entry(page)).toBeVisible();
  });
});
