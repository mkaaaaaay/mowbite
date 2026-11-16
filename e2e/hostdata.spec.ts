import {demoAction, demoDocked, demoEmergency, demoFlag, demoWith, expect, SIM, tab, test} from './app';

// MowBite OS's host and what the mower keeps of its drives: the demo is an OpenMower and has neither until a test
// switches them on
test.describe('MowBite OS off and started again', () => {
  test.skip(SIM, 'the demo mower only');

  test('not on a mower without a host', async ({page}) => {
    await page.goto('/');
    await expect(page.getByRole('heading', {level: 1})).toBeVisible();
    await expect(page.locator('[data-os]')).toHaveCount(0);
    await page.goto('/settings/#update');
    await expect(page.locator('#update')).toBeVisible();
    await expect(page.getByRole('button', {name: 'Restart MowBite OS'})).toHaveCount(0);
  });

  test('off after crashes: told on the dashboard with the reason, started again with one tap', async ({page}) => {
    await demoWith(page, 'Host');
    await demoFlag(page, 'mowbiteDemoHostOs', 'down');
    await page.goto('/');
    const box = page.locator('[data-os]');
    await expect(box).toHaveAttribute('data-os', 'down');
    await expect(box).toContainText("MowBite OS isn't running: it crashed 5 times and stays off.");
    await box.getByRole('button', {name: 'Restart MowBite OS'}).click();
    await expect(box).toHaveCount(0);
  });

  test('halted before its start: the reason in the settings too', async ({page}) => {
    await demoWith(page, 'Host');
    await demoFlag(page, 'mowbiteDemoHostOs', 'halted');
    await page.goto('/settings/#update');
    const box = page.locator('#update [data-os]');
    await expect(box).toContainText("MowBite OS isn't running: another MowBite OS holds the mower's data.");
    await box.getByRole('button', {name: 'Restart MowBite OS'}).click();
    await expect(box).toHaveAttribute('data-os', 'running');
    await expect(box).toContainText('MowBite OS is starting again.');
  });

  test('while it runs: only idle without an emergency stop, after asking', async ({page}) => {
    await demoWith(page, 'Host');
    await page.goto('/settings/#update');
    const group = page.locator('#update');
    await expect(group).toBeVisible();
    // the demo is out mowing
    const button = group.getByRole('button', {name: 'Restart MowBite OS'});
    await expect(button).toHaveCount(0);
    await demoDocked(page);
    await expect(button).toBeVisible();
    await demoEmergency(page);
    await expect(button).toHaveCount(0);
    await demoAction(page, 'mower_logic/reset_emergency');
    await expect(button).toBeVisible();

    await button.click();
    await page.waitForTimeout(700);
    await group.getByRole('button', {name: 'Sure? Restart MowBite OS'}).click();
    await expect(group).toContainText('MowBite OS is starting again.');
    await expect(group.locator('[data-os]')).toHaveAttribute('data-os', 'running');
  });
});

test.describe('data on the mower', () => {
  test.skip(SIM, 'the demo mower only');

  test('not on a mower that cannot delete it', async ({page}) => {
    await page.goto('/settings/#update');
    await expect(page.locator('#update')).toBeVisible();
    await expect(page.locator('#data')).toHaveCount(0);
  });

  test('all events deleted after asking, the activity forgets them too', async ({page}) => {
    await demoWith(page, 'Erase');
    await page.goto('/activity/');
    // the days before today, by their date
    const before = page.locator('main button').filter({hasText: /^\w{3} \d+ \w{3}$/});
    await expect(before).not.toHaveCount(0);

    await tab(page, '/settings').click();
    await page.locator('#data > summary').click();
    const data = page.locator('#data');
    await data.getByRole('button', {name: 'Delete all events'}).click();
    await page.waitForTimeout(700);
    await data.getByRole('button', {name: 'Sure? Delete all events'}).click();
    await expect(data.getByRole('status')).toHaveText(/^\d+ files deleted$/);

    // today comes back with what happens from now on, the days before stay gone
    await tab(page, '/activity').click();
    await expect(page.getByRole('heading', {level: 1, name: 'Activity'})).toBeVisible();
    await expect(before).toHaveCount(0);
  });

  test('all tracks deleted after asking, the one of the running job stays', async ({page}) => {
    await demoWith(page, 'Erase');
    await page.goto('/settings/#data');
    const data = page.locator('#data');
    const button = data.getByRole('button', {name: 'Delete all tracks'});
    await button.click();
    // one tap asks only
    await expect(data.getByRole('button', {name: 'Sure? Delete all tracks'})).toBeVisible();
    await expect(data.getByRole('status')).toHaveCount(0);
    await page.waitForTimeout(700);
    await data.getByRole('button', {name: 'Sure? Delete all tracks'}).click();
    await expect(data.getByRole('status')).toHaveText(/^[1-9]\d* files deleted$/);
    // nothing left but the job out mowing
    await button.click();
    await page.waitForTimeout(700);
    await data.getByRole('button', {name: 'Sure? Delete all tracks'}).click();
    await expect(data.getByRole('status')).toHaveText('0 files deleted');
  });
});
