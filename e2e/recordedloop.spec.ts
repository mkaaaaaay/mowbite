import type {Page} from '@playwright/test';
import {demoFlag, demoWith, expect, lawnPoint, openMap, SIM, test} from './app';

// the planner's recorded outline pass with the demo's planner (window.mowbiteDemoPlanner): asked before it's switched
// on, and why the planner goes without it
test.describe('recorded outline pass', () => {
  test.skip(SIM, 'the demo mower only');
  test.beforeEach(({page}) => demoWith(page, 'Planner'));

  // every fold open, the planner's list for experts in them
  const unfold = async (page: Page) => {
    await expect(page.locator('#fold-plannerAll')).toBeAttached();
    for (let round = 0; round < 3; round++) await page.$$eval('details', (all) => all.forEach((d) => ((d as HTMLDetailsElement).open = true)));
  };

  test('switching it on asks first and says what it means', async ({page}) => {
    await openMap(page);
    const loop = page.getByRole('checkbox', {name: /Recorded outline pass/});
    await unfold(page);
    await loop.click();
    const sheet = page.getByRole('alertdialog', {name: 'The mower drives right up to the recorded line'});
    await expect(sheet).toContainText('up to 20 cm');
    await expect(sheet).toContainText('at least 20 cm away');
    await sheet.getByRole('button', {name: 'Cancel'}).click();
    await expect(sheet).toHaveCount(0);
    await expect(loop).not.toBeChecked();

    await loop.click();
    await sheet.getByRole('button', {name: 'Switch on'}).click();
    await expect(loop).toBeChecked();
    await expect(page.getByText('At walls and fences a bumper can trigger.')).toBeVisible();

    // off again without a question
    await loop.click();
    await expect(loop).not.toBeChecked();
    await expect(sheet).toHaveCount(0);
  });

  test("a planner that goes without it says why, the switch can't be switched on", async ({page}) => {
    await demoFlag(page, 'mowbiteDemoLoopIgnored', 'fill_pattern concentric');
    await openMap(page);
    const loop = page.getByRole('checkbox', {name: /Recorded outline pass/});
    await unfold(page);
    await expect(page.getByText('Recorded outline pass not possible: Not with the pattern "Rings".')).toBeVisible();
    await expect(loop).toBeDisabled();
  });

  test('an area planned without it says why with its plan', async ({page}) => {
    await demoFlag(page, 'mowbiteDemoPlannerSet', {recorded_loop: true});
    await demoFlag(page, 'mowbiteDemoLoopIgnored', 'the area is too small for it');
    await openMap(page);
    const at = await lawnPoint(page);
    await page.mouse.click(at.x, at.y);
    await expect(page.getByRole('textbox').first()).not.toHaveValue('');
    for (let round = 0; round < 3; round++) await page.$$eval('details', (all) => all.forEach((d) => ((d as HTMLDetailsElement).open = true)));
    await expect(page.getByText('Recorded outline pass not possible: The area is too small for it.')).toBeVisible();
  });
});
