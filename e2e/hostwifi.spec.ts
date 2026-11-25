import {demoFlag, demoWith, expect, SIM, test} from './app';

// the WLAN and the trial of a newly written system, both through MowBite OS's host (the demo's with mowbiteDemoHost)
test.describe("the mower's WLAN and its trial", () => {
  test.skip(SIM, 'the demo mower only');

  test('not on a mower without a host', async ({page}) => {
    await page.goto('/settings/#wifi');
    await expect(page.getByRole('heading', {level: 1})).toBeVisible();
    await expect(page.locator('#wifi')).toHaveCount(0);
  });

  test('a WLAN chosen with its password, tried by the mower and kept once it connects', async ({page}) => {
    await demoWith(page, 'Host');
    await page.goto('/settings/#wifi');
    const card = page.locator('[data-wifi]');
    await card.getByRole('button', {name: 'Show the WLANs'}).click();
    await expect(card.locator('label', {hasText: 'Garden'})).toContainText('in use');
    await card.getByRole('radio', {name: /Guests/}).check();
    // an open one asks for no password, it's taken only once its risk is ticked
    await expect(card.getByLabel(/Password/)).toHaveCount(0);
    await expect(card.locator('[data-open-wifi]')).toContainText('anyone in reach can set up or stop the mower');
    await expect(card.getByRole('button', {name: 'Connect'})).toBeDisabled();
    await card.getByLabel('I know, connect it anyway').check();
    await expect(card.getByRole('button', {name: 'Connect'})).toBeEnabled();
    await card.getByRole('radio', {name: /Shed/}).check();
    await card.getByRole('button', {name: 'Connect'}).click();
    await expect(card.getByRole('alert')).toHaveText('Enter the password of the WLAN.');
    await card.getByLabel('Password of Shed').fill('short');
    await card.getByRole('button', {name: 'Connect'}).click();
    await expect(card.getByRole('alert')).toContainText('8 to 63 characters');
    await card.getByLabel('Password of Shed').fill('long enough');
    await card.getByRole('button', {name: 'Connect'}).click();
    await expect(card).toHaveAttribute('data-wifi', 'failed');
    await expect(card.getByRole('alert')).toContainText("Not connected to Shed. The mower couldn't join this WLAN, the previous connection stays.");
    await card.getByRole('button', {name: 'Search again'}).click();
    await card.getByRole('radio', {name: 'Another WLAN, by its name'}).check();
    await card.getByLabel('Name of the WLAN').fill('Barn');
    await expect(card.locator('[data-open-wifi]')).toBeVisible();
    await card.getByLabel('Password, empty for an open WLAN').fill('long enough');
    await expect(card.locator('[data-open-wifi]')).toHaveCount(0);
    await card.getByRole('button', {name: 'Connect'}).click();
    await expect(card).toHaveAttribute('data-wifi', 'connected');
    await expect(card).toContainText('The mower is connected to Barn.');
    await expect(page.locator('#wifi')).toContainText('Barn');
  });

  test('a new system on trial: confirmed from the dashboard, then gone', async ({page}) => {
    await demoWith(page, 'Host');
    await demoFlag(page, 'mowbiteDemoTrial', true);
    await page.goto('/');
    const box = page.locator('[data-trial]');
    await expect(box).toContainText('MowBite OS is new on this mower.');
    await box.getByRole('button', {name: 'Confirm the start'}).click();
    await expect(box).toHaveCount(0);
  });

  test('the setup WLAN opened at a Tron: until when, its WLAN chosen, closed once that connects', async ({page}) => {
    await demoWith(page, 'Host', 'Os');
    await demoFlag(page, 'mowbiteDemoSetupWifi', true);
    await demoFlag(page, 'mowbiteDemoPlatform', 'airseekers_tron');
    await page.goto('/');
    const banner = page.locator('[data-setup-wifi]');
    await expect(banner).toContainText("The mower's setup WLAN is open until");
    await banner.getByRole('link', {name: 'Choose its WLAN'}).click();
    const card = page.locator('[data-wifi]');
    await expect(card.locator('[data-setup-wifi]')).toBeVisible();
    await expect(card).toContainText('Press On/OK 5 times quickly at the mower');
    await card.getByRole('button', {name: 'Show the WLANs'}).click();
    await card.getByRole('radio', {name: /Guests/}).check();
    await card.getByLabel('I know, connect it anyway').check();
    await card.getByRole('button', {name: 'Connect'}).click();
    await expect(card).toHaveAttribute('data-wifi', 'connected');
    await expect(card.locator('[data-setup-wifi]')).toHaveCount(0);
  });
});
