import type {Page} from '@playwright/test';
import {demoWith, expect, SIM, test} from './app';

// the demo's emergency stop, as a press of a button on the mower
const press = (page: Page, reason: string) => page.evaluate((r) => (window as unknown as {mowbiteDemo: {emergency: (r: string[]) => void}}).mowbiteDemo.emergency([r]), reason);
const step = (page: Page, id: string) => page.locator(`[data-step="${id}"]`);

// MowBite OS's setup program: only on a mower that lists it, its steps as the OS gives them
test.describe('setup', () => {
  test.skip(SIM, 'the demo mower only');

  test('not offered on a mower without it', async ({page}) => {
    await page.goto('/setup/');
    await expect(page.getByText('This mower has no setup program.')).toBeVisible();
    await page.goto('/');
    await expect(page.locator('[data-card="setup"]')).toHaveCount(0);
  });

  test('assigns the inputs line by line, waits out the restart, then their delays under advanced', async ({page}) => {
    await demoWith(page, 'Setup', 'Assign');
    await page.goto('/setup/?step=assign');
    const s = step(page, 'assign');
    await s.getByRole('button', {name: 'Start'}).click();
    await expect(s.locator('li[data-state="waiting"]')).toContainText('STOP button');
    await press(page, 'STOP');
    await expect(s.locator('[data-asked-line="IN1"]')).toContainText('STOP button: seen on line IN1');
    await s.getByLabel('Take it').check();
    await s.getByRole('button', {name: 'Save'}).click();
    await expect(s.locator('[data-line="IN1"]')).toContainText('STOP button');
    await press(page, 'LIFT');
    await expect(s.locator('[data-asked-line="IN2"]')).toBeVisible();
    await s.getByLabel('Take it').check();
    await s.getByRole('button', {name: 'Save'}).click();
    await expect(s.getByText('MowBite OS is starting again')).toBeVisible();
    await expect(s).toHaveAttribute('data-state', 'ok');
    await s.getByText('Advanced').click();
    const delay = s.getByRole('spinbutton').first();
    await expect(delay).toHaveValue('50');
    await delay.fill('30');
    await s.getByRole('button', {name: 'Save'}).click();
    await expect(s.getByText('MowBite OS is starting again')).toBeVisible();
    await expect(s.getByText('MowBite OS is starting again')).toHaveCount(0);
    await expect(s.locator('[data-line="IN1"]')).toContainText('STOP button');
  });

  test('from the dashboard through a measured step, an input with its emergency, a choice and a skip', async ({page}) => {
    await demoWith(page, 'Setup', 'Geometry');
    await page.goto('/');
    const card = page.locator('[data-card="setup"]');
    await expect(card).toContainText('1 of 9 steps done');
    await card.getByRole('link', {name: 'Go on with the setup'}).click();
    await expect(page).toHaveURL(/\/setup\/?\?step=board/);

    await step(page, 'board').getByRole('button', {name: 'Start'}).click();
    await expect(step(page, 'board')).toHaveAttribute('data-state', 'ok');
    await expect(step(page, 'board')).toContainText('87 %');

    // the points first, the start only once every one is ticked
    await page.goto('/setup/?step=outdoors');
    await step(page, 'outdoors').getByRole('button', {name: 'Start'}).click();
    const sheet = page.getByRole('dialog');
    await expect(sheet.getByRole('button', {name: 'Start'})).toBeDisabled();
    for (const box of await sheet.getByRole('checkbox').all()) await box.check();
    await sheet.getByRole('button', {name: 'Start'}).click();
    await expect(step(page, 'outdoors')).toHaveAttribute('data-state', 'ok');

    // two presses, the emergency of the first released in between from the step itself
    await page.goto('/setup/?step=stop');
    await expect(step(page, 'stop').getByRole('button', {name: 'Skip'})).toHaveCount(0);
    await step(page, 'stop').getByRole('button', {name: 'Start'}).click();
    await expect(step(page, 'stop').locator('li[data-state="waiting"]')).toContainText('STOP button on top');
    await press(page, 'STOP');
    await expect(step(page, 'stop').locator('li[data-state="ok"]')).toContainText('STOP button on top');
    await expect(step(page, 'stop').locator('[data-line="stop1"]')).toContainText('Held until released');
    await expect(step(page, 'stop').getByRole('alert')).toContainText('The emergency stop is still on.');
    await step(page, 'stop').getByRole('button', {name: 'Reset emergency'}).click();
    await expect(step(page, 'stop').getByRole('alert')).toHaveCount(0);
    await press(page, 'STOP');
    await expect(step(page, 'stop')).toHaveAttribute('data-state', 'ok');

    // locked until its choice is made
    await page.goto('/setup/?step=fix');
    await expect(step(page, 'fix')).toContainText('First: Source of corrections');
    await page.goto('/setup/?step=correction');
    await step(page, 'correction').getByLabel('Correction service over the network (NTRIP)').check();
    await step(page, 'correction').getByRole('button', {name: 'Save'}).click();
    await expect(step(page, 'correction')).toHaveAttribute('data-state', 'ok');

    // skipped with a reason of the user's own, and the way to the screen it asks for
    await page.goto('/setup/?step=ntrip');
    await expect(step(page, 'ntrip').getByRole('link', {name: 'Enter the correction service'})).toHaveAttribute('href', /\/settings\/?#ntrip/);
    await step(page, 'ntrip').getByRole('button', {name: 'Skip'}).click();
    await page.getByRole('dialog').getByLabel('Other reason').check();
    await expect(page.getByRole('dialog').getByRole('button', {name: 'Skip'})).toBeDisabled();
    await page.getByRole('dialog').getByLabel('Why').fill('radio at the receiver');
    await page.getByRole('dialog').getByRole('button', {name: 'Skip'}).click();
    await expect(step(page, 'ntrip')).toContainText('Skipped: Other reason (radio at the receiver)');
  });

  test('turns the wheels jacked up while the page follows, asks which wheel, a wrong one closes the lock', async ({page}) => {
    await demoWith(page, 'Setup');
    // within the app: a new load starts the demo over. the phone shows the overview on its own, the desktop beside the step
    const overview = async () => {
      const back = page.getByRole('link', {name: 'Overview'});
      if (await back.isVisible()) await back.click();
    };
    const to = async (stage: string, name: string) => {
      await overview();
      const head = page.locator('button[aria-expanded]', {hasText: stage});
      if ((await head.getAttribute('aria-expanded')) === 'false') await head.click();
      await page.locator('button:not([aria-expanded])', {hasText: new RegExp(`^${name}`)}).click();
    };
    await page.goto('/setup/?step=wheels');
    await expect(step(page, 'wheels').locator('[data-blocked="SAFETY_INPUTS"]')).toContainText('STOP button, lifting and bumper');
    await to('Inputs', 'STOP button');
    await step(page, 'stop').getByRole('button', {name: 'Start'}).click();
    await press(page, 'STOP');
    await step(page, 'stop').getByRole('button', {name: 'Reset emergency'}).click();
    await press(page, 'STOP');
    await expect(step(page, 'stop')).toHaveAttribute('data-state', 'ok');
    await to('Inputs', 'Lifting');
    await step(page, 'lift').getByRole('button', {name: 'Start'}).click();
    await press(page, 'LIFT');
    await expect(step(page, 'lift')).toHaveAttribute('data-state', 'ok');

    // what turns and the points to tick, then part by part until the question
    await to('Wheels', 'Wheels');
    const go = async () => {
      await step(page, 'wheels').getByRole('button', {name: /Start|Repeat/}).click();
      const sheet = page.getByRole('dialog');
      await expect(sheet).toContainText('The wheels turn in the air');
      await expect(sheet).toContainText('Keep this page open');
      for (const box of await sheet.getByRole('checkbox').all()) await box.check();
      await sheet.getByRole('button', {name: 'Let the wheels turn'}).click();
    };
    await go();
    await expect(step(page, 'wheels')).toHaveAttribute('data-state', 'running');
    await step(page, 'wheels').getByLabel('Left wheel').check({timeout: 15000});
    await step(page, 'wheels').getByRole('button', {name: 'Save'}).click();
    await expect(step(page, 'wheels')).toHaveAttribute('data-state', 'failed');
    await expect(step(page, 'wheels')).toContainText('Another wheel than the right one turned');
    await overview();
    await expect(page.locator('[data-cause="WRONG_WHEEL"]')).toContainText('Wheels: Another wheel than the right one turned');

    // passed again the lock opens; a repeat says what failing it would do
    await to('Wheels', 'Wheels');
    await go();
    await step(page, 'wheels').getByLabel('Right wheel').check({timeout: 15000});
    await step(page, 'wheels').getByRole('button', {name: 'Save'}).click();
    await expect(step(page, 'wheels')).toHaveAttribute('data-state', 'ok');
    await overview();
    await expect(page.getByText('With the setup program')).toBeVisible();
    await to('Wheels', 'Wheels');
    await step(page, 'wheels').getByRole('button', {name: 'Repeat'}).click();
    await expect(page.getByRole('dialog').locator('[data-risky]')).toContainText('the mower stays locked until it passes again');
    await page.getByRole('dialog').getByRole('button', {name: 'Cancel'}).click();

    // a page no longer seen stops following the step, the mower ends it
    await go();
    await expect(step(page, 'wheels')).toHaveAttribute('data-state', 'running');
    await page.evaluate(() => Object.defineProperty(document, 'visibilityState', {get: () => 'hidden'}));
    await expect(step(page, 'wheels')).toContainText('The app stopped following the step', {timeout: 5000});
  });

  test('a mark moves when its state changes, not when it is shown', async ({page, isMobile}) => {
    test.skip(isMobile, 'the overview beside the step on a desktop');
    await demoWith(page, 'Setup');
    await page.goto('/setup/?step=board');
    const mark = page.locator('[aria-current] [data-state]');
    await expect(page.locator('[data-moved]')).toHaveCount(0);
    await step(page, 'board').getByRole('button', {name: 'Start'}).click();
    await expect(mark).toHaveAttribute('data-state', 'ok');
    await expect(mark).toHaveAttribute('data-moved', 'true');

    // shown again already passed it stands still, passed again by a repeat it moves
    const stage = page.getByRole('button', {name: /^Device/});
    await stage.click();
    await stage.click();
    await expect(mark).toHaveAttribute('data-state', 'ok');
    await expect(mark).not.toHaveAttribute('data-moved');
    await step(page, 'board').getByRole('button', {name: 'Repeat'}).click();
    await expect(mark).toHaveAttribute('data-state', 'running');
    await expect(mark).toHaveAttribute('data-state', 'ok');
    await expect(mark).toHaveAttribute('data-moved', 'true');
  });

  test('the image of a step from the mower, as a mask', async ({page}) => {
    await demoWith(page, 'Setup');
    await page.goto('/setup/?step=stop');
    const layers = step(page, 'stop').locator('[style*="mask-image"]');
    await expect(layers).toHaveCount(2);
    await expect(layers.first()).toHaveAttribute('style', /data:image\/svg\+xml;base64,/);
    await expect(step(page, 'stop').locator('[data-symbol] svg')).toHaveCount(0);
  });

  test('the sizes confirmed as they are, for the step of the dimensions', async ({page}) => {
    await demoWith(page, 'Geometry');
    await page.goto('/settings/');
    await page.locator('#mower summary').click();
    const open = page.locator('[data-unconfirmed]');
    await expect(open).toContainText('Not confirmed yet: Width 47 cm');
    await expect(open).toContainText('Track of the drive wheels 39.5 cm');
    await open.getByRole('button', {name: 'These sizes are right'}).click();
    await expect(open).toHaveCount(0);
  });
});
