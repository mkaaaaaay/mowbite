import {demoFlagNow, demoWith, expect, SIM, test} from './app';

// root's login over ssh through MowBite OS's host (the demo's with mowbiteDemoHost)
test.describe("root's login over ssh", () => {
  test.skip(SIM, 'the demo mower only');

  test('not on a mower without a host, nor in its setup', async ({page}) => {
    await page.goto('/settings/#ssh');
    await expect(page.getByRole('heading', {level: 1})).toBeVisible();
    await expect(page.locator('#ssh')).toHaveCount(0);
    await demoWith(page, 'Setup');
    await page.goto('/setup/');
    await expect(page.getByRole('region', {name: 'Setup'})).toBeVisible();
    await expect(page.locator('[data-own="ssh"]')).toHaveCount(0);
  });

  test('on with a password, the login shown, a new password, off, and on without one turned down', async ({page}) => {
    await demoWith(page, 'Host');
    await page.goto('/settings/#ssh');
    const card = page.locator('[data-ssh]');
    const toggle = card.getByRole('switch', {name: 'Log in as root over SSH'});
    const password = card.getByLabel('New password', {exact: true});
    const again = card.getByLabel('New password again');
    await expect(card).toHaveAttribute('data-ssh', 'off');
    await expect(card.getByRole('button', {name: 'Change password'})).toHaveCount(0);
    // root has none yet: turning it on asks for one
    await toggle.click();
    await expect(card).toContainText('Set a password for root to turn SSH on.');
    await password.fill('short');
    await again.fill('short');
    await card.getByRole('button', {name: 'Turn on'}).click();
    await expect(card.getByRole('alert')).toHaveText('The password has 8 to 128 characters.');
    await password.fill('long enough');
    await again.fill('long enoug');
    await card.getByRole('button', {name: 'Turn on'}).click();
    await expect(card.getByRole('alert')).toHaveText("The two passwords don't match.");
    await again.fill('long enough');
    await card.getByRole('button', {name: 'Turn on'}).click();
    await expect(card).toHaveAttribute('data-ssh', 'on');
    await expect(toggle).toBeChecked();
    await expect(card.locator('code')).toHaveText(/^ssh -4 root@\S+$/);
    await expect(password).toHaveCount(0);
    await expect(page.locator('#ssh summary')).toContainText('On, as root');

    await card.getByRole('button', {name: 'Change password'}).click();
    await expect(password).toHaveValue('');
    await password.fill('another one');
    await again.fill('another one');
    await card.getByRole('button', {name: 'Save password'}).click();
    await expect(password).toHaveCount(0);
    await expect(card.getByRole('alert')).toHaveCount(0);
    expect(await page.evaluate(() => JSON.stringify({...localStorage, ...sessionStorage}))).not.toMatch(/long enough|another one/);

    await toggle.click();
    await expect(card).toHaveAttribute('data-ssh', 'off');
    await expect(card.locator('code')).toHaveCount(0);
    // on again with the password kept, no form
    await toggle.click();
    await expect(card).toHaveAttribute('data-ssh', 'on');
    await expect(password).toHaveCount(0);
    await toggle.click();
    await expect(card).toHaveAttribute('data-ssh', 'off');
    // the host finds root without a password after all
    await demoFlagNow(page, 'mowbiteDemoSshNoPassword', true);
    await toggle.click();
    await expect(card.getByRole('alert')).toHaveText('Root has no password yet, set one to turn SSH on.');
    await expect(card).toHaveAttribute('data-ssh', 'off');
    await expect(toggle).not.toBeChecked();
  });

  test('asked in the setup, the way to its card, skipped for this mower', async ({page}) => {
    await demoWith(page, 'Host', 'Setup');
    await page.goto('/setup/');
    const line = page.locator('[data-own="ssh"]');
    await expect(line).toContainText('Turn on SSH access?');
    await line.getByRole('link').click();
    await expect(page.locator('[data-ssh]')).toHaveAttribute('data-ssh', 'off');
    await page.goto('/setup/');
    await line.getByRole('button', {name: 'Skip'}).click();
    await expect(line).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole('region', {name: 'Setup'})).toBeVisible();
    await expect(line).toHaveCount(0);
  });
});
