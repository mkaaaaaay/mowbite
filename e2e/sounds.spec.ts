import {join} from 'node:path';
import {demoWith, expect, SIM, test} from './app';

const BEEP = join(__dirname, 'fixtures', 'beep.mp3');

// the sounds of a mower with MowBite OS and a speaker: the demo is an OpenMower and has none until a test switches them on
test.describe('sounds', () => {
  test.skip(SIM, 'the demo mower only');

  test('not on a mower without them', async ({page}) => {
    await page.goto('/settings/');
    await expect(page.locator('#notify')).toBeVisible();
    await expect(page.locator('#sounds')).toHaveCount(0);
  });

  test('each situation to listen to, one without a sound, the volume', async ({page}) => {
    await demoWith(page, 'Sounds');
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

  test('an own sound uploaded and the manufacturer\'s back, one too large and one the mower turns down', async ({page}) => {
    await demoWith(page, 'Sounds');
    await page.goto('/settings/');
    const group = page.locator('#sounds');
    await group.locator('summary').click();
    const start = group.locator('[data-sound="MOWING_START"]');
    const choose = async (file: string | {name: string; mimeType: string; buffer: Buffer}) => {
      const picked = page.waitForEvent('filechooser');
      await start.getByRole('button', {name: 'Choose your own sound'}).click();
      await (await picked).setFiles(file);
    };

    // larger than 2 MB: turned down before anything is sent
    await choose({name: 'big.mp3', mimeType: 'audio/mpeg', buffer: Buffer.alloc(2 * 1024 * 1024 + 1)});
    await expect(start).toContainText('Sound not uploaded: the file is larger than 2 MB');
    await expect(start).toContainText('from the manufacturer');

    await page.evaluate(() => ((window as {mowbiteDemoSoundRefuse?: string}).mowbiteDemoSoundRefuse = 'NO_SPACE'));
    await choose(BEEP);
    await expect(start).toContainText('Sound not uploaded: no space left on the mower');
    await expect(start).toContainText('from the manufacturer');

    await page.evaluate(() => delete (window as {mowbiteDemoSoundRefuse?: string}).mowbiteDemoSoundRefuse);
    await choose(BEEP);
    await expect(start).toContainText('Uploaded');
    await expect(start).toContainText('your own');

    await start.getByRole('button', {name: 'Sound of the manufacturer'}).click();
    await page.waitForTimeout(700);
    await start.getByRole('button', {name: 'Really delete your own sound?'}).click();
    await expect(start).toContainText('from the manufacturer');
    await expect(start.getByRole('button', {name: 'Sound of the manufacturer'})).toHaveCount(0);
  });
});
