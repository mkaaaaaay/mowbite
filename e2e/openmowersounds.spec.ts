import type {Page} from '@playwright/test';
import {demoFlag, demoHas, expect, SIM, tab, test} from './app';

const FILE = '/ll/services/sound/config_file';
const params = (page: Page) => demoHas<Record<string, unknown>>(page, 'params/json');

// OpenMower's own sounds (1.5.0 on) in the settings: the demo mower runs with them and has a made-up updater that
// writes them, 4 seconds after it's asked
test.describe("OpenMower's sounds", () => {
  test.skip(SIM, 'the demo mower only');

  const open = async (page: Page) => {
    await page.goto('/settings/#sounds');
    const group = page.locator('#sounds');
    await expect(group.locator('[data-om-sounds]')).toBeVisible();
    return group;
  };

  test('what runs, changed and saved through the updater, in effect once OpenMower restarted', async ({page}) => {
    const group = await open(page);
    await expect(group.locator('summary')).toContainText('on · 60 % · English');
    const card = group.locator('[data-om-sounds="set"]');
    await expect(card.getByRole('checkbox', {name: 'Play sounds'})).toBeChecked();
    await expect(card).toContainText('Volume 60 %');
    const language = card.getByRole('combobox', {name: 'Language'});
    await expect(language).toHaveValue('en');
    await expect(language.locator('option')).toHaveCount(6);
    const save = card.getByRole('button', {name: 'Save'});
    await expect(save).toBeDisabled();
    await expect(card.locator('pre')).toHaveCount(0);

    await card.locator('input[type=range]').fill('35');
    await language.selectOption('de');
    await expect(card).toContainText('Saving restarts OpenMower');
    await save.click();
    await expect(card.locator('[data-om-sounds-state="asked"]')).toBeVisible();
    await expect(save).toBeDisabled();
    await expect(card.locator('[data-om-sounds-state="written"]')).toContainText('Restarted, in effect since', {timeout: 15_000});
    // OpenMower runs with it: the folded card says so, nothing waits
    await expect(group.locator('summary')).toContainText('on · 35 % · German');
    await expect(card.locator('[data-om-sounds-waits]')).toHaveCount(0);
    await expect(save).toBeDisabled();
    expect(await params(page)).toMatchObject({'/ll/services/sound/volume': 35, [FILE]: expect.stringMatching(/\/sounds_de\.yaml$/)});

    // the volume left to the mower: no slider, -1 written
    await card.getByRole('checkbox', {name: 'Volume as set on the mower'}).check();
    await expect(card.locator('input[type=range]')).toHaveCount(0);
    await save.click();
    await expect(group.locator('summary')).toHaveText(/on · German/, {timeout: 15_000});
    expect(await params(page)).toMatchObject({'/ll/services/sound/volume': -1});
  });

  test('a request waiting for the dock shows as not in effect yet', async ({page}) => {
    await demoFlag(page, 'mowbiteDemoSoundSays', 'waiting');
    const group = await open(page);
    const card = group.locator('[data-om-sounds="set"]');
    await card.getByRole('checkbox', {name: 'Play sounds'}).uncheck();
    await card.getByRole('button', {name: 'Save'}).click();
    await expect(card.locator('[data-om-sounds-state="waiting"]')).toContainText('once the mower stands quietly in the dock', {timeout: 15_000});
    await expect(card.locator('[data-om-sounds-waits]')).toHaveCount(0);

    // the page left and opened again: what runs, and next to it what waits
    await tab(page, '/').click();
    await tab(page, '/settings').click();
    await expect(group.locator('summary')).toBeVisible();
    if (!(await group.evaluate((g) => (g as HTMLDetailsElement).open))) await group.locator('summary').click();
    await expect(card.getByRole('checkbox', {name: 'Play sounds'})).toBeChecked();
    await expect(card.locator('[data-om-sounds-waits]')).toContainText('Not in effect yet: Sounds: off. The updater writes it');
    await expect(card.getByRole('button', {name: 'Save'})).toBeDisabled();
    expect(await params(page)).toMatchObject({'/ll/services/sound/enabled': true});
  });

  test('a request turned down says why, with the lines to enter by hand where the file is the reason', async ({page}) => {
    await demoFlag(page, 'mowbiteDemoSoundSays', 'refused missing_ll/services');
    const group = await open(page);
    const card = group.locator('[data-om-sounds="set"]');
    await card.locator('input[type=range]').fill('20');
    await card.getByRole('button', {name: 'Save'}).click();
    await expect(card.locator('[data-om-sounds-state="refused"]')).toContainText('has no ll: services: block', {timeout: 15_000});
    await expect(card.locator('pre')).toContainText('      volume: 20');
    await expect(card).toContainText('openmower restart');
    await expect(card.getByRole('button', {name: 'Copy'})).toBeVisible();
    // (nothing written: it runs as before and can be asked again)
    await expect(group.locator('summary')).toContainText('on · 60 % · English');
    await expect(card.getByRole('button', {name: 'Save'})).toBeEnabled();
  });

  test('a sound file of your own stays until another language is picked and confirmed', async ({page}) => {
    await demoFlag(page, 'mowbiteDemoSoundFile', '/data/sounds/mine.yaml');
    const group = await open(page);
    await expect(group.locator('summary')).toHaveText(/on · 60 %$/);
    const card = group.locator('[data-om-sounds="set"]');
    const language = card.getByRole('combobox', {name: 'Language'});
    await expect(language.locator('option')).toHaveCount(7);
    await expect(language.locator('option:checked')).toHaveText('your own file');

    await card.locator('input[type=range]').fill('80');
    await card.getByRole('button', {name: 'Save'}).click();
    await expect(group.locator('summary')).toHaveText(/on · 80 %$/, {timeout: 15_000});
    expect(await params(page)).toMatchObject({[FILE]: '/data/sounds/mine.yaml'});

    await language.selectOption('nl');
    await card.getByRole('button', {name: 'Save'}).click();
    const sure = card.getByRole('button', {name: 'Really replace your own sound file?'});
    await expect(sure).toBeVisible();
    expect(await params(page)).toMatchObject({[FILE]: '/data/sounds/mine.yaml'});
    await page.waitForTimeout(700);
    await sure.click();
    await expect(group.locator('summary')).toContainText('on · 80 % · Dutch', {timeout: 15_000});
    expect(await params(page)).toMatchObject({[FILE]: expect.stringMatching(/\/sounds_nl\.yaml$/)});
  });

  test('without the updater only what runs, and the lines to enter by hand', async ({page}) => {
    await demoFlag(page, 'mowbiteDemoNoUpdater', true);
    const group = await open(page);
    const card = group.locator('[data-om-sounds="read"]');
    await expect(card.locator('[data-om-sounds-runs]')).toHaveText('Sounds: on · Volume: 60 % · Language: English');
    await expect(card).toContainText('needs the MowBite Updater');
    await expect(card.locator('pre')).toContainText('sound: enabled: true volume: 60 config_file: /opt/open_mower_ros/src/open_mower/params/sounds_en.yaml');
    await expect(card).toContainText('openmower restart');
    await expect(card.getByRole('checkbox')).toHaveCount(0);
    await expect(card.getByRole('button', {name: 'Save'})).toHaveCount(0);
    await expect(card.locator('[data-om-sounds-firmware="hint"]')).toContainText('openmower update-firmware');
  });

  test('the app guide has a step for them', async ({page}) => {
    await page.goto('/guide/app/');
    await expect(page.getByText('1/4')).toBeVisible();
    await page.getByRole('button', {name: 'Next'}).last().click();
    await expect(page.getByRole('heading', {level: 1, name: 'Sounds'})).toBeVisible();
    await expect(page.getByText('Settings › Mower › Sounds')).toBeVisible();
  });
});
