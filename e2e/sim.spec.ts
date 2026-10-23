import {expect, lawnPoint, openMap, SIM, test} from './app';

// only against a MowBite with a mower or a simulator (E2E_URL): what the demo mower can't do

test.skip(!SIM, 'needs E2E_URL');

test('the container answers: version with its level, the battery', async ({page, request}) => {
  const version = await (await request.get('/cgi-bin/version')).json();
  expect(version.level).toBeGreaterThanOrEqual(1);
  await page.goto('/');
  await expect(page.getByText(/%/).first()).toBeVisible();
});

test('the plan of an area driven by the planner and played back', async ({page}) => {
  test.slow();
  await openMap(page);
  const at = await lawnPoint(page);
  await page.mouse.click(at.x, at.y);
  await page.getByText('This area', {exact: true}).click();
  const run = page.getByRole('button', {name: 'Simulate the drive'});
  test.skip(!(await run.isVisible()), 'the planner here has no planner.simulate');
  await run.click();
  await expect(page.getByText(/min \(.* min of it mowing\)/)).toBeVisible({timeout: 180_000});
  const player = page.locator('[class*="simPlayer"]');
  await expect(player).toBeVisible();
  const time = player.locator('[class*="simTime"]');
  const start = await time.textContent();
  await player.getByRole('button', {name: 'Play'}).click();
  await expect.poll(() => time.textContent()).not.toBe(start);
  await player.getByRole('button', {name: 'Close'}).click();
  await expect(player).toHaveCount(0);
});
