import {expect, SIM, test} from './app';

// the sounds of a mower with MowBite OS and a speaker: the demo is an OpenMower and has none until a test switches them on
test.describe('sounds', () => {
  test.skip(SIM, 'the demo mower only');

  test('not on a mower without them', async ({page}) => {
    await page.goto('/settings/');
    await expect(page.locator('#notify')).toBeVisible();
    await expect(page.locator('#sounds')).toHaveCount(0);
  });

  test('each situation to listen to, one without a sound, the volume', async ({page}) => {
    await page.addInitScript(() => ((window as {mowbiteDemoSounds?: boolean}).mowbiteDemoSounds = true));
    await page.goto('/settings/');
    const group = page.locator('#sounds');
    await group.locator('summary').click();
    await expect(group.locator('[data-sound]')).toHaveCount(4);

    const start = group.locator('[data-sound="MOWING_START"]');
    await expect(start).toContainText('Mowing starts');
    await expect(start).toContainText('from the manufacturer');
    await expect(start).not.toContainText('STATE MOWING');
    await start.getByRole('button', {name: 'Listen'}).click();
    await expect(start).toContainText('Plays on the mower (2 s).');

    const home = group.locator('[data-sound="DOCKING_START"]');
    await expect(home).toContainText('No sound');
    await expect(home.getByRole('button', {name: 'Listen'})).toHaveCount(0);

    const slider = group.locator('input[type=range]');
    await slider.fill('0');
    await expect(group).toContainText('Volume 0 %');
    await expect(group).toContainText('not even for an emergency stop');
  });
});
