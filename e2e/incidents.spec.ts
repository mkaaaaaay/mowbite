import {readFileSync} from 'node:fs';
import {demoEmergency, demoWith, expect, SIM, tab, test} from './app';

// the blackbox of a mower with MowBite OS on the activity page: the demo is an OpenMower and keeps no incidents until
// a test switches them on. with them it has a crash from yesterday and opens one for each problem
test.describe('incidents', () => {
  test.skip(SIM, 'the demo mower only');

  test('not on a mower without them', async ({page}) => {
    await page.goto('/activity/');
    await expect(page.getByRole('heading', {level: 1, name: 'Activity'})).toBeVisible();
    await expect(page.getByRole('button', {name: 'Problems'})).toBeVisible();
    await expect(page.locator('#blackbox')).toHaveCount(0);
  });

  test('one looked into, downloaded and deleted', async ({page}) => {
    await demoWith(page, 'Incidents');
    await page.goto('/activity/');
    const box = page.locator('#blackbox');
    await expect(box).toContainText('1 kept');
    await expect(box).toContainText('Journal: 412 MB of 2.0 GB, the last 14 days.');
    await expect(box).toContainText('Not kept, they came too often: Position jumped (3×)');

    const crash = box.locator('[data-incident]').filter({hasText: 'A process of MowBite OS ended by itself'});
    await expect(crash).toContainText('Safety');
    await crash.getByRole('button', {expanded: false}).click();
    await expect(crash).toContainText('mowbite_planner ended by itself (signal 11)');
    await expect(crash).toContainText('ERROR mowbite_planner: lane 14: no way around the obstacle');
    await crash.getByRole('button', {name: 'What the processes did'}).click();
    await expect(crash).toContainText('mowbite_planner rpc mowing.plan()');
    await expect(crash).toContainText('12 lines left out by the mower');

    const saved = page.waitForEvent('download');
    await crash.getByRole('button', {name: 'Download'}).click();
    const file = await saved;
    expect(file.suggestedFilename()).toMatch(/^mowbite-incident-demo\w+\.tar$/);
    expect(readFileSync(await file.path()).length).toBe(300000);

    await crash.getByRole('button', {name: 'Delete'}).click();
    await page.waitForTimeout(700);
    await crash.getByRole('button', {name: 'Sure? Delete'}).click();
    await expect(box).toContainText('No incidents kept.');
  });

  test('a moment marked, and all deleted after asking', async ({page}) => {
    await demoWith(page, 'Incidents');
    await page.goto('/activity/');
    const box = page.locator('#blackbox');
    await box.getByRole('textbox').fill('it turned round twice');
    await box.getByRole('button', {name: 'Keep the last 5 minutes'}).click();
    await expect(box).toContainText('Kept. It shows up here once it has been collected.');
    const mark = box.locator('[data-incident]').filter({hasText: 'Marked by you: „it turned round twice“'});
    await expect(mark).toContainText('collecting…');

    await box.getByRole('button', {name: 'Delete all'}).click();
    await page.waitForTimeout(700);
    await box.getByRole('button', {name: 'Sure? Delete all 2'}).click();
    await expect(box).toContainText('No incidents kept.');
  });

  test('next to the problem that set it off', async ({page}) => {
    await demoWith(page, 'Incidents');
    await page.goto('/');
    await page.waitForFunction(() => 'mowbiteDemo' in window);
    // one mower_logic writes an event for
    await demoEmergency(page, ['MOWER_RPM_TIMEOUT']);
    await tab(page, '/activity').click();
    const problem = page.locator('li').filter({hasText: "Emergency stop: mow motor didn't reach its speed"});
    await problem.getByRole('button', {expanded: false}).click();
    await problem.getByRole('button', {name: 'Blackbox'}).click();
    await expect(problem.locator('ul li')).toHaveText(/^\d\d:\d\d:\d\dMOWER_RPM_TIMEOUT$/);
    await expect(problem).toContainText('Still being collected');
  });
});
