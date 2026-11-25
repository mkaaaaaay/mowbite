import {readFileSync} from 'node:fs';
import {demoDocked, demoWith, expect, SIM, tab, test} from './app';

// what the obstacle sensors of a mower with MowBite OS saw: the demo is an OpenMower and has none until a test switches
// them on. three entries, the hedgehog and the ball with a photo, the person without
test.describe('obstacles', () => {
  test.skip(SIM, 'the demo mower only');

  test('on the maps: a tap shows the photo with its box, delete takes it off', async ({page}) => {
    await demoWith(page, 'Os', 'Obstacles');
    await page.goto('/');
    // the dashboard's while it mows, the map page's (the editor's is kept hidden by the layout)
    const signs = page.locator('[data-obstacle]:visible');
    await expect(signs).toHaveCount(3);
    await demoDocked(page);
    await tab(page, '/map').click();
    await expect(signs).toHaveCount(3);
    // (its round to hit, a little larger than the sign)
    await page.locator('[data-obstacle="3"]:visible circle').nth(1).click();
    const card = page.locator('[data-obstacle-card="3"]');
    await expect(card).toContainText('Hedgehog');
    await expect(card).toContainText('2 times');
    await expect(card.locator('img')).toBeVisible();
    await expect(card.locator('img')).toHaveAttribute('src', /^data:image\/jpeg;base64,/);
    await expect(card.locator('rect')).toHaveAttribute('width', '52');
    const saved = page.waitForEvent('download');
    await card.getByRole('button', {name: 'Download'}).click();
    const file = await saved;
    expect(file.suggestedFilename()).toBe('mowbite-obstacle-3.jpg');
    expect(readFileSync(await file.path()).subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]));
    // (two taps, the first asks)
    await card.getByRole('button', {name: 'Delete'}).click();
    await page.waitForTimeout(700);
    await card.getByRole('button', {name: 'Sure? Delete'}).click();
    await expect(card).toHaveCount(0);
    await expect(signs).toHaveCount(2);

    // the person was seen with photos off
    await page.locator('[data-obstacle="1"]:visible circle').nth(1).click();
    await expect(page.locator('[data-obstacle-card="1"]')).toContainText('No photo of it.');

    // the ball was driven around: the circle it keeps out of shows as unmowed, without the meters left out
    await expect(page.locator('[data-obstacle="2"]:visible [data-kept-out]')).toBeVisible();
    await page.locator('[data-obstacle="2"]:visible circle').nth(2).click();
    const ball = page.locator('[data-obstacle-card="2"]');
    await expect(ball).toContainText('Drove around it');
    await expect(ball).toContainText('the circle round it stays unmowed');
    await expect(ball).not.toContainText(/6[.,]7/);
  });

  test('in the settings: only the modes the mower can do, the photos, how often it would have stopped, deleting all', async ({page}) => {
    await demoWith(page, 'Os', 'Obstacles');
    await page.goto('/');
    await expect(page.locator('[data-obstacle]:visible')).toHaveCount(3);
    await tab(page, '/settings').click();
    await page.locator('#obstacles summary').click();
    const group = page.locator('#obstacles');
    const mode = group.getByRole('combobox', {name: 'Obstacles the sensors see'});
    await expect(mode.locator('option')).toHaveText(['Off', 'Show on the map', 'Stop for them', 'Drive around them']);
    await expect(group.getByRole('checkbox', {name: 'Keep a photo of each'})).toBeChecked();
    await expect(group).toContainText('at most 200 entries and 20 MB, each for 14 days');
    await expect(group).toContainText('3 entries on the mower · it would have stopped for 1');
    await mode.selectOption('2');
    await expect(page.locator('#obstacles summary')).toContainText('stops for them, with photos');
    await group.getByRole('button', {name: 'Delete all'}).click();
    await page.waitForTimeout(700);
    await group.getByRole('button', {name: 'Sure? Delete all 3'}).click();
    await expect(group).not.toContainText('entries on the mower');
    // taking the stop away asks first
    const ask = group.getByText('The mower then no longer stops for what the camera sees');
    await mode.selectOption('1');
    await expect(ask).toBeVisible();
    await group.getByRole('button', {name: 'Keep it'}).click();
    await expect(ask).toBeHidden();
    await expect(mode).toHaveValue('2');
    await mode.selectOption('0');
    await group.getByRole('button', {name: 'Change', exact: true}).click();
    await expect(page.locator('#obstacles summary')).toContainText('off');
    await tab(page, '/map').click();
    await expect(page.locator('polygon[data-area]:visible').first()).toBeVisible();
    await expect(page.locator('[data-obstacle]')).toHaveCount(0);
  });

  test('without an obstacle sensor nothing of it shows', async ({page}) => {
    await demoWith(page, 'Os');
    await page.goto('/');
    await expect(page.locator('section svg').first()).toBeVisible();
    await expect(page.locator('[data-obstacle]')).toHaveCount(0);
    await tab(page, '/settings').click();
    await expect(page.locator('#obstacles')).toHaveCount(0);
  });
});
