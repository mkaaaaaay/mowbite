import type {MowerMap} from '../src/hooks/useMowerMap';
import {demoFlag, demoHas, demoWith, expect, handles, lawnPoint, openMap, pickedOutline, SIM, test} from './app';
import {unfoldAll} from './texts';

// the demo's planner holds the plans of the mow it's out on (job_open): a change for all areas asks first
test.describe('planner settings during a mow', () => {
  test.skip(SIM, 'the demo mower only');
  test.beforeEach(({page}) => demoWith(page, 'Planner'));

  test('a change asks first, cancel keeps it as it was', async ({page}) => {
    await openMap(page);
    await expect(page.locator('#fold-plannerAll')).toBeAttached();
    await unfoldAll(page);
    const check = page.getByRole('checkbox', {name: 'Collision check'});
    const fit = page.getByRole('alertdialog', {name: 'Switch the collision check off?'});
    const job = page.getByRole('alertdialog', {name: 'Save during a mow?'});
    await expect(check).toBeChecked();

    await check.click();
    await fit.getByRole('button', {name: 'Switch off'}).click();
    await expect(job).toContainText('starts again from its beginning');
    await job.getByRole('button', {name: 'Cancel'}).click();
    await expect(job).toHaveCount(0);
    await expect(check).toBeChecked();

    await check.click();
    await fit.getByRole('button', {name: 'Switch off'}).click();
    await job.getByRole('button', {name: 'Save anyway'}).click();
    await expect(check).not.toBeChecked();
  });

  test('backing out of dead ends: on by default, for all areas', async ({page}) => {
    await openMap(page);
    await unfoldAll(page);
    const back = page.getByRole('checkbox', {name: 'Back out of dead ends'});
    await expect(back).toBeChecked();
    await back.click();
    await page.getByRole('alertdialog', {name: 'Save during a mow?'}).getByRole('button', {name: 'Save anyway'}).click();
    await expect(back).not.toBeChecked();
    await expect(page.getByText('It turns only where it has room for it; where not, the end of the lane stays unmowed.')).toBeVisible();
  });

  test('backing out the planner goes without: greyed out, with why', async ({page}) => {
    await demoFlag(page, 'mowbiteDemoBackOutIgnored', "OpenMower's FTC drives forwards only (no back_up_with_plan)");
    await openMap(page);
    await unfoldAll(page);
    const back = page.getByRole('checkbox', {name: 'Back out of dead ends'});
    await expect(back).toBeChecked();
    await expect(back).toBeDisabled();
    await expect(page.getByText('Backing out not possible: OpenMower on this mower drives forwards only along a plan.')).toBeVisible();
  });

  test('a map save asks first only when it changes what the planner plans from', async ({page, isMobile}) => {
    test.skip(isMobile, 'a point dragged with the mouse');
    await openMap(page);
    const at = await lawnPoint(page);
    await page.mouse.click(at.x, at.y);
    const name = page.getByRole('textbox').first();
    await expect(name).not.toHaveValue('');
    const save = page.locator('[class*="changesBar"] [class*="saveButton"]');
    const job = page.getByRole('alertdialog', {name: 'Save during a mow?'});
    const mower = () => demoHas<MowerMap>(page, 'map/json');
    // the demo is out mowing: the first tap only says so. a save ends its job, the last one here
    const saveAnyway = async () => {
      await save.click();
      await expect(save).toHaveText('Save anyway');
      await save.click();
    };

    await expect.poll(async () => (await handles(page)).length).toBeGreaterThan(2);
    const before = await pickedOutline(page);
    const [p] = await handles(page);
    await page.mouse.move(p.x, p.y);
    await page.mouse.down();
    await page.mouse.move(p.x + 25, p.y + 20, {steps: 8});
    await page.mouse.up();
    await expect.poll(() => pickedOutline(page)).not.toBe(before);
    const saved = JSON.stringify((await mower()).areas);
    await saveAnyway();
    await expect(job).toContainText('starts again from its beginning');
    await job.getByRole('button', {name: 'Cancel'}).click();
    await expect(job).toHaveCount(0);
    expect(JSON.stringify((await mower()).areas)).toBe(saved);

    // the outline back as it was, only the name changed: saved without the question
    await page.getByRole('button', {name: 'Undo'}).first().click();
    await expect.poll(() => pickedOutline(page)).toBe(before);
    await name.fill('Renamed during the mow');
    await saveAnyway();
    await expect.poll(async () => (await mower()).areas.map((a) => a.properties.name)).toContain('Renamed during the mow');
    await expect(job).toHaveCount(0);
  });
});
