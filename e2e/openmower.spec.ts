import {readdirSync} from 'node:fs';
import {PARAM_FIELDS} from '@/lib/mowerParams';
import {expect, SIM, test} from './app';

// the demo mower is an OpenMower (no system.info): nothing of MowBite OS shows anywhere, not its name, not what only it
// tells or offers (the settings' own words for it among them). every page of the build, with everything folded opened
const OS_ONLY = /MowBite OS|not charging in the dock|Mowing refused|Back at sunset|Battery too hot|Go home at sunset/;
const OS_TEXTS = PARAM_FIELDS.flatMap((f) => [f.osLabel, f.osHelp]).filter((t) => t !== undefined);
// (the not-found ones aside, none without a build: against a simulator)
const PAGES = (SIM ? [] : readdirSync('out', {recursive: true, encoding: 'utf8'}))
  .filter((f) => f.endsWith('index.html') && !/^(_not-found|404)\//.test(f))
  .map((f) => '/' + f.slice(0, -'index.html'.length))
  .sort();

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
      const text = await page.locator('body').innerText();
      expect(text, path).not.toMatch(OS_ONLY);
      expect(OS_TEXTS.filter((t) => text.includes(t)), path).toEqual([]);
    }
  });
});
