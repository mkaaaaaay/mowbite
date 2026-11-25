import {PARAM_FIELDS} from '@/lib/mowerParams';
import {expect, SIM, test} from './app';
import {PAGES, pageText} from './texts';

// the demo mower is an OpenMower (no system.info): nothing of MowBite OS shows anywhere, not its name, not what only it
// tells or offers (the settings' own words for it among them). every page of the build, with everything folded opened
const OS_ONLY = /MowBite OS|not charging in the dock|Mowing refused|Back at sunset|Battery too hot|Go home at sunset|Going home at sunset/;
const OS_TEXTS = PARAM_FIELDS.flatMap((f) => [f.osLabel, f.osHelp]).filter((t) => t !== undefined);

test.describe('on OpenMower', () => {
  test.skip(SIM, 'the demo mower only');

  test('no page says anything of MowBite OS', async ({page}) => {
    test.setTimeout(180_000);
    for (const path of PAGES) {
      const text = await pageText(page, path);
      expect(text, path).not.toMatch(OS_ONLY);
      expect(OS_TEXTS.filter((t) => text.includes(t)), path).toEqual([]);
    }
  });
});
