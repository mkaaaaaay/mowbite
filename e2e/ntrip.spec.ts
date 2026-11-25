import type {Page} from '@playwright/test';
import {demoDocked, demoFlag, demoWith, expect, SIM, test} from './app';

const PASSWORD = 'geheim-4711';

const open = async (page: Page) => {
  await page.goto('/settings/');
  const group = page.locator('#ntrip');
  await group.locator('summary').click();
  return group;
};

// the access to the caster of a mower with MowBite OS: the demo is an OpenMower and has none until a test switches it on
test.describe('ntrip', () => {
  test.skip(SIM, 'the demo mower only');

  test('not on a mower without it', async ({page}) => {
    await page.goto('/settings/');
    await expect(page.locator('#update')).toBeVisible();
    await expect(page.locator('#ntrip')).toHaveCount(0);
  });

  test('the stored access without its login, nothing to change while it mows', async ({page}) => {
    await demoWith(page, 'Ntrip');
    const group = await open(page);
    const stored = group.locator('[data-ntrip="stored"]');
    await expect(stored).toContainText('Caster: caster.example, port 2101');
    await expect(stored).toContainText('Mountpoint: VRS_3_4G');
    await expect(stored).toContainText('NTRIP version 2');
    await expect(stored).toContainText('Login: user and password are set');
    await expect(group).toContainText('Only possible while the mower is idle.');
    await expect(group.getByRole('button', {name: 'Change'})).toBeDisabled();
    await expect(group.getByRole('button', {name: 'Delete'})).toBeDisabled();
  });

  test('only shown on a mower that takes no access from the app', async ({page}) => {
    await demoWith(page, 'Ntrip');
    await demoFlag(page, 'mowbiteDemoNtripReadOnly', true);
    const group = await open(page);
    await expect(group.locator('[data-ntrip="stored"]')).toContainText('caster.example');
    await expect(group).toContainText('The access is set on the mower itself');
    await expect(group.getByRole('button')).toHaveCount(0);
  });

  test('saved with a new login, the password nowhere on the page afterwards', async ({page}) => {
    await demoWith(page, 'Ntrip');
    const group = await open(page);
    await demoDocked(page);
    await group.getByRole('button', {name: 'Change'}).click();
    const user = group.getByLabel('User');
    const password = group.getByLabel('Password');
    await expect(group.getByLabel('Host of the caster')).toHaveValue('caster.example');
    await expect(group.getByLabel('Port')).toHaveValue('2101');
    await expect(user).toHaveValue('');
    await expect(password).toHaveValue('');
    await expect(password).toHaveAttribute('type', 'password');
    await expect(password).toHaveAttribute('autocomplete', 'new-password');
    await expect(password).toHaveAttribute('placeholder', 'set, stays if left empty');

    await group.getByLabel('Host of the caster').fill('http://other.example');
    await group.getByRole('button', {name: 'Save'}).click();
    await expect(group).toContainText('Only the name of the host');

    await group.getByLabel('Host of the caster').fill('other.example');
    await expect(group).toContainText('enter user and password again');
    await group.getByLabel('Mountpoint').fill('NEAR');
    await group.getByRole('button', {name: '1', exact: true}).click();
    await user.fill('gartenfreund');
    await password.fill(PASSWORD);
    await expect(group).not.toContainText('enter user and password again');
    await group.getByRole('button', {name: 'Save'}).click();

    await expect(group).toContainText('Saved on the mower.');
    const stored = group.locator('[data-ntrip="stored"]');
    await expect(stored).toContainText('Caster: other.example, port 2101');
    await expect(stored).toContainText('Mountpoint: NEAR');
    await expect(stored).toContainText('NTRIP version 1');
    await expect(stored).toContainText('Login: user and password are set');
    await expect(group.locator('input')).toHaveCount(0);
    expect(await page.content()).not.toContain(PASSWORD);
    expect(await page.evaluate(() => JSON.stringify([{...localStorage}, {...sessionStorage}, location.href]))).not.toContain(PASSWORD);

    // opened again the login is empty, another port without one drops it
    await group.getByRole('button', {name: 'Change'}).click();
    await expect(group.getByLabel('Password')).toHaveValue('');
    await group.getByLabel('Port').fill('2102');
    await group.getByRole('button', {name: 'Save'}).click();
    await expect(stored).toContainText('Login: no user, no password');
  });

  test('deleted after asking once more, then set up anew', async ({page}) => {
    await demoWith(page, 'Ntrip');
    const group = await open(page);
    await demoDocked(page);
    await group.getByRole('button', {name: 'Delete'}).click();
    const sure = group.getByRole('button', {name: 'Really delete the access?'});
    await expect(sure).toBeVisible();
    await expect(group.locator('[data-ntrip="stored"]')).toBeVisible();
    await page.waitForTimeout(700);
    await sure.click();
    await expect(group.locator('[data-ntrip="none"]')).toContainText('No access stored');
    await expect(group.getByRole('button', {name: 'Delete'})).toHaveCount(0);
    await group.getByRole('button', {name: 'Set up'}).click();
    await expect(group.getByLabel('Port')).toHaveValue('2101');
    await expect(group.getByLabel('Password')).toHaveAttribute('placeholder', '');
  });
});
