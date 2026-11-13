import {demoFlag, demoFlagNow, demoWith, expect, SIM, test} from './app';

// MowBite OS's own updates in the settings: the demo is an OpenMower and has none until a test switches them on
test.describe('updates of MowBite OS', () => {
  test.skip(SIM, 'the demo mower only');

  test('not on a mower without them', async ({page}) => {
    await page.goto('/settings/#update');
    const group = page.locator('#update');
    await expect(group.locator('summary').first()).toContainText('MowBite Updater');
    // the updater's parts, none of MowBite OS
    await expect(group.locator('[data-part="mowbite"]')).toBeVisible();
    await expect(group.locator('[data-part="os"]')).toHaveCount(0);
    // the app's own version and update in the other tab
    await page.getByRole('tab', {name: 'App'}).click();
    await expect(page.locator('#updates')).toBeVisible();
  });

  test('each part with what runs, an update waiting for the mower, cancelled, then installed', async ({page}) => {
    await demoWith(page, 'Updates');
    await demoFlag(page, 'mowbiteDemoUpdateGate', 'BUSY');
    await page.goto('/settings/#update');
    const group = page.locator('#update');
    await expect(group.locator('summary').first()).toContainText('MowBite OS');
    await expect(group.locator('[data-part]')).toHaveCount(4);
    await expect(group).toContainText('1 update available');
    const os = group.locator('[data-part="os"]');
    await expect(os).toContainText('Update available');
    await expect(group.locator('[data-part="planner"]')).toContainText('Up to date');

    await group.getByLabel('Update automatically at night').check();
    await expect(group.getByLabel('From')).toHaveValue('02:00');
    await expect(group).toContainText('Next in line: MowBite OS.');

    await os.getByRole('button', {name: 'Update', exact: true}).click();
    const run = group.locator('[data-update="os"]');
    await expect(run).toContainText('MowBite OS is being updated');
    await expect(run.locator('[data-step="verifying"]')).toContainText('Where it comes from and its signature are right.');
    await expect(run.locator('[data-step="waiting_gate"]')).toContainText('The mower is working right now.');
    await expect(run.locator('[data-step="waiting_gate"]')).toContainText('It waits for 30 minutes at most.');
    // the others only show what runs meanwhile
    await expect(group.locator('[data-part]')).toHaveCount(3);
    await expect(group.getByRole('button', {name: 'Details and the version before'})).toHaveCount(0);
    await run.getByRole('button', {name: 'Cancel'}).click();
    await expect(group).toContainText('update of MowBite OS cancelled.');

    await demoFlagNow(page, 'mowbiteDemoUpdateGate', null);
    await os.getByRole('button', {name: 'Update', exact: true}).click();
    await expect(os).toContainText('Just updated');
    await expect(group).toContainText('MowBite OS updated.');
    await expect(group).toContainText('Everything is up to date');
    // the page is the mower's app there, its updates are that part's
    await page.getByRole('tab', {name: 'App'}).click();
    await expect(page.locator('#notify')).toBeVisible();
    await expect(page.locator('#updates')).toHaveCount(0);
  });

  test('the planner back to the version before, without waiting for an open mowing job', async ({page}) => {
    await demoWith(page, 'Updates');
    await demoFlag(page, 'mowbiteDemoUpdateGate', 'JOB_OPEN');
    await page.goto('/settings/#update');
    const group = page.locator('#update');
    const planner = group.locator('[data-part="planner"]');
    await planner.getByRole('button', {name: 'Details and the version before'}).click();
    await planner.getByRole('button', {name: 'Back to the version before'}).click();
    await expect(planner).toContainText('Back to MowBite Planner 1.3.2?');
    await planner.getByRole('button', {name: 'Back to 1.3.2'}).click();
    const run = group.locator('[data-update="planner"]');
    await expect(run).toContainText('MowBite Planner goes back');
    await expect(run).toContainText('A mowing job is still open.');
    await run.getByRole('button', {name: "Don't wait for the job"}).click();
    await expect(planner).toContainText('Taken back');
    await expect(planner).toContainText("Taken back by hand, it isn't installed again by itself. A newer one is.");
    await expect(group).toContainText('MowBite Planner went back to the version before.');
  });

  test('an update the mower took back is held back, and asked about before it is tried again', async ({page}) => {
    await demoWith(page, 'Updates');
    await demoFlag(page, 'mowbiteDemoUpdateFails', true);
    await page.goto('/settings/#update');
    const group = page.locator('#update');
    const os = group.locator('[data-part="os"]');
    await os.getByRole('button', {name: 'Update', exact: true}).click();
    await expect(group).toContainText('MowBite OS: update taken back');
    await expect(os).toContainText('Taken back');
    await expect(os).toContainText("This version isn't installed by itself any more, a newer one is.");
    // held back, it isn't counted as an update
    await expect(group).toContainText('Everything is up to date');
    await os.getByRole('button', {name: 'Install anyway'}).click();
    await expect(os.getByRole('heading')).toContainText('anyway?');
    await os.getByRole('button', {name: 'Cancel'}).click();
    await expect(os.getByRole('button', {name: 'Install anyway'})).toBeVisible();
  });
});
