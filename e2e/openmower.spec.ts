import {expect, SIM, test} from './app';

// the demo mower is an OpenMower (no system.info): nothing of MowBite OS shows anywhere, not its name, not what only it
// tells or offers. every page, with everything folded opened
const OS_ONLY = /MowBite OS|In the dock, not charging|not charging in the dock|Mowing refused|Back at sunset|Battery too hot|Go home at sunset/;
const PAGES = ['/', '/map/', '/sensors/', '/schedule/', '/activity/', '/settings/', '/record/', '/calibration/', '/guide/', '/guide/editor/', '/guide/calibration/'];

test.describe('on OpenMower', () => {
  test.skip(SIM, 'the demo mower only');

  test('no page says anything of MowBite OS', async ({page}) => {
    test.setTimeout(180_000);
    for (const path of PAGES) {
      await page.goto(path);
      // what comes from the mower first (state, settings, the day's events)
      await page.waitForTimeout(1500);
      // folded groups open, a few rounds for the ones inside others
      for (let round = 0; round < 3; round++) await page.$$eval('details', (all) => all.forEach((d) => ((d as HTMLDetailsElement).open = true)));
      await page.waitForTimeout(300);
      expect(await page.locator('body').innerText(), path).not.toMatch(OS_ONLY);
    }
  });
});
